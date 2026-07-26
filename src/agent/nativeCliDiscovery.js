'use strict';

const path = require('node:path');
const { AgentError } = require('./agentErrors.js');
const {
  CORE_ENVIRONMENT_KEYS,
  minimalEnvironment,
  resolveCommandCandidatesWithWhere,
} = require('./cliRunner.js');
const { inspectNativeCliCandidate } = require('./nativeCliLaunchLease.js');

const REPOSITORY_ROOT = path.win32.resolve(__dirname, '..', '..');
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

const NATIVE_CLI_POLICY = Object.freeze({
  'codex-cli': Object.freeze({
    rootEnvironmentKey: 'LOCALAPPDATA',
    rootParts: Object.freeze(['Programs', 'OpenAI', 'Codex']),
    allowedJunction: Object.freeze({
      pathEnvironmentKey: 'LOCALAPPDATA',
      pathParts: Object.freeze(['Programs', 'OpenAI', 'Codex', 'bin']),
      targetEnvironmentKey: 'USERPROFILE',
      targetParts: Object.freeze([
        '.codex', 'packages', 'standalone', 'releases',
        '0.145.0-x86_64-pc-windows-msvc', 'bin',
      ]),
      reparseChain: Object.freeze([
        Object.freeze({
          pathEnvironmentKey: 'LOCALAPPDATA',
          pathParts: Object.freeze(['Programs', 'OpenAI', 'Codex', 'bin']),
          rawTargetEnvironmentKey: 'USERPROFILE',
          rawTargetParts: Object.freeze([
            '.codex', 'packages', 'standalone', 'current', 'bin',
          ]),
          type: 'junction',
        }),
        Object.freeze({
          pathEnvironmentKey: 'USERPROFILE',
          pathParts: Object.freeze(['.codex', 'packages', 'standalone', 'current']),
          rawTargetEnvironmentKey: 'USERPROFILE',
          rawTargetParts: Object.freeze([
            '.codex', 'packages', 'standalone', 'releases',
            '0.145.0-x86_64-pc-windows-msvc',
          ]),
          type: 'junction',
        }),
      ]),
    }),
    publisher: 'OpenAI OpCo, LLC',
    version: '0.145.0',
    executable: 'codex.exe',
  }),
  'claude-code-cli': Object.freeze({
    rootEnvironmentKey: 'USERPROFILE',
    rootParts: Object.freeze(['.local', 'bin']),
    publisher: 'Anthropic, PBC',
    version: '2.1.217',
    executable: 'claude.exe',
  }),
});

function driveAbsolute(candidate) {
  return typeof candidate === 'string'
    && /^[A-Za-z]:[\\/]/.test(candidate)
    && path.win32.isAbsolute(candidate);
}

function normalizeAbsolute(candidate) {
  return driveAbsolute(candidate) ? path.win32.normalize(candidate) : null;
}

function samePath(first, second) {
  return first.toLowerCase() === second.toLowerCase();
}

function isWithin(root, candidate) {
  const relative = path.win32.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..\\') && relative !== '..' && !path.win32.isAbsolute(relative));
}

function sanitizedCoreEnvironment(source) {
  const overrides = {};
  for (const key of CORE_ENVIRONMENT_KEYS) {
    if (typeof source?.[key] === 'string') overrides[key] = source[key];
  }
  const complete = minimalEnvironment(overrides);
  const environment = {};
  for (const key of CORE_ENVIRONMENT_KEYS) {
    if (typeof complete[key] === 'string') environment[key] = complete[key];
  }
  return environment;
}

function exclusionRoots(workspacePath, environment) {
  const roots = [workspacePath, REPOSITORY_ROOT];
  for (const key of ['TEMP', 'TMP']) {
    const root = normalizeAbsolute(environment[key]);
    if (root && !roots.some((item) => samePath(item, root))) roots.push(root);
  }
  return roots;
}

function candidateAllowed(candidate, policy, officialRoot, exclusions, expectedLexicalCandidate) {
  const normalized = normalizeAbsolute(candidate);
  if (!normalized) return null;
  if (path.win32.extname(normalized).toLowerCase() !== '.exe') return null;
  if (path.win32.basename(normalized).toLowerCase() !== policy.executable) return null;
  if (!isWithin(officialRoot, normalized)) return null;
  if (!samePath(normalized, expectedLexicalCandidate)) return null;
  if (exclusions.some((root) => isWithin(root, normalized))) return null;
  return normalized;
}

function resolveReparsePolicy(policy, environment) {
  if (!policy.allowedJunction) {
    return Object.freeze({ allowedJunction: null, expectedReparseChain: Object.freeze([]) });
  }
  const lexicalBase = normalizeAbsolute(environment?.[policy.allowedJunction.pathEnvironmentKey]);
  const targetBase = normalizeAbsolute(environment?.[policy.allowedJunction.targetEnvironmentKey]);
  if (!lexicalBase || !targetBase) return null;
  const allowedJunction = Object.freeze({
    path: path.win32.join(lexicalBase, ...policy.allowedJunction.pathParts),
    target: path.win32.join(targetBase, ...policy.allowedJunction.targetParts),
  });
  const expectedReparseChain = [];
  for (const entry of policy.allowedJunction.reparseChain) {
    const entryBase = normalizeAbsolute(environment?.[entry.pathEnvironmentKey]);
    const rawTargetBase = normalizeAbsolute(environment?.[entry.rawTargetEnvironmentKey]);
    if (!entryBase || !rawTargetBase || entry.type !== 'junction') return null;
    expectedReparseChain.push(Object.freeze({
      path: path.win32.join(entryBase, ...entry.pathParts),
      rawTarget: path.win32.join(rawTargetBase, ...entry.rawTargetParts),
      type: entry.type,
    }));
  }
  return Object.freeze({
    allowedJunction,
    expectedReparseChain: Object.freeze(expectedReparseChain),
  });
}

function exactReparseChain(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return actual.every((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    if (Object.keys(entry).sort().join('\0') !== 'path\0rawTarget\0type') return false;
    const entryPath = normalizeAbsolute(entry.path);
    const rawTarget = normalizeAbsolute(entry.rawTarget);
    return entryPath !== null
      && rawTarget !== null
      && entry.type === 'junction'
      && samePath(entryPath, expected[index].path)
      && samePath(rawTarget, expected[index].rawTarget);
  });
}

function bindingFromInspection(
  candidate, inspection, policy, officialRoot, exclusions, allowedJunction,
  expectedReparseChain, expectedLexicalCandidate,
) {
  if (!inspection || typeof inspection !== 'object' || Array.isArray(inspection)) return null;
  const inspectedPath = normalizeAbsolute(inspection.path);
  if (!inspectedPath) return null;
  if (inspection.reparsePoint === false) {
    if (expectedReparseChain.length !== 0 || !exactReparseChain(inspection.reparseChain, [])) return null;
    if (!samePath(candidate, inspectedPath)) return null;
    if (!candidateAllowed(
      inspectedPath, policy, officialRoot, exclusions, expectedLexicalCandidate,
    )) return null;
  } else if (inspection.reparsePoint === true) {
    if (!allowedJunction || expectedReparseChain.length === 0) return null;
    const expectedLexicalCandidate = path.win32.join(allowedJunction.path, policy.executable);
    const expectedCanonicalTarget = path.win32.join(allowedJunction.target, policy.executable);
    const reportedJunctionPath = normalizeAbsolute(inspection.junctionPath);
    const reportedJunctionTarget = normalizeAbsolute(inspection.junctionTarget);
    if (
      !samePath(candidate, expectedLexicalCandidate)
      || !samePath(inspectedPath, expectedCanonicalTarget)
      || !exactReparseChain(inspection.reparseChain, expectedReparseChain)
      || !reportedJunctionPath
      || !samePath(reportedJunctionPath, allowedJunction.path)
      || !reportedJunctionTarget
      || !samePath(reportedJunctionTarget, allowedJunction.target)
      || exclusions.some((root) => isWithin(root, inspectedPath))
    ) {
      return null;
    }
  } else {
    return null;
  }
  if (
    inspection.regularFile !== true
    || inspection.signatureValid !== true
    || typeof inspection.sha256 !== 'string'
    || !SHA256_PATTERN.test(inspection.sha256)
    || typeof inspection.volumeSerial !== 'string'
    || inspection.volumeSerial.length === 0
    || typeof inspection.fileId !== 'string'
    || inspection.fileId.length === 0
    || inspection.version !== policy.version
    || inspection.publisher !== policy.publisher
  ) {
    return null;
  }
  return Object.freeze({
    path: inspectedPath,
    sha256: inspection.sha256.toLowerCase(),
    volumeSerial: inspection.volumeSerial,
    fileId: inspection.fileId,
    version: inspection.version,
    publisher: inspection.publisher,
  });
}

async function discoverSignedNativeCli({
  provider,
  workspacePath,
  environment = process.env,
  inspectCandidate = inspectNativeCliCandidate,
  resolveCandidates = resolveCommandCandidatesWithWhere,
} = {}) {
  const policy = NATIVE_CLI_POLICY[provider];
  const normalizedWorkspace = normalizeAbsolute(workspacePath);
  const knownFolder = normalizeAbsolute(environment?.[policy?.rootEnvironmentKey]);
  const systemRoot = normalizeAbsolute(environment?.SYSTEMROOT || environment?.WINDIR);
  if (
    !policy
    || !normalizedWorkspace
    || !knownFolder
    || !systemRoot
    || typeof inspectCandidate !== 'function'
    || typeof resolveCandidates !== 'function'
  ) {
    throw new AgentError('CLI_NOT_INSTALLED');
  }

  const officialRoot = path.win32.join(knownFolder, ...policy.rootParts);
  const exclusions = exclusionRoots(normalizedWorkspace, environment);
  const reparsePolicy = resolveReparsePolicy(policy, environment);
  if (!reparsePolicy) throw new AgentError('CLI_NOT_INSTALLED');
  const { allowedJunction, expectedReparseChain } = reparsePolicy;
  const expectedLexicalCandidate = path.win32.join(
    allowedJunction?.path || officialRoot,
    policy.executable,
  );
  if (exclusions.some((root) => isWithin(root, officialRoot))) {
    throw new AgentError('CLI_NOT_INSTALLED');
  }
  if (allowedJunction) {
    const heldPaths = [
      allowedJunction.path,
      allowedJunction.target,
      ...expectedReparseChain.flatMap((entry) => [entry.path, entry.rawTarget]),
    ];
    if (exclusions.some((root) => heldPaths.some((heldPath) => isWithin(root, heldPath)))) {
      throw new AgentError('CLI_NOT_INSTALLED');
    }
  }

  let candidates;
  try {
    candidates = await resolveCandidates(policy.executable, {
      environment: sanitizedCoreEnvironment(environment),
      systemRoot,
    });
  } catch (error) {
    throw error instanceof AgentError
      ? error
      : new AgentError('CLI_NOT_INSTALLED', { cause: error });
  }
  if (!Array.isArray(candidates)) throw new AgentError('CLI_NOT_INSTALLED');

  const seen = new Set();
  for (const unresolvedCandidate of candidates) {
    const candidate = candidateAllowed(
      unresolvedCandidate, policy, officialRoot, exclusions, expectedLexicalCandidate,
    );
    if (!candidate) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let inspection;
    try {
      inspection = await inspectCandidate(candidate, {
        allowedJunction,
        expectedPublisher: policy.publisher,
        expectedReparseChain,
        expectedVersion: policy.version,
        environment: sanitizedCoreEnvironment(environment),
      });
    } catch {
      continue;
    }
    const binding = bindingFromInspection(
      candidate, inspection, policy, officialRoot, exclusions, allowedJunction,
      expectedReparseChain, expectedLexicalCandidate,
    );
    if (binding) return binding;
  }
  throw new AgentError('CLI_NOT_INSTALLED');
}

module.exports = {
  NATIVE_CLI_POLICY,
  discoverSignedNativeCli,
};
