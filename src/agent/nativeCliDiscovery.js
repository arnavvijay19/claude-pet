'use strict';

const path = require('node:path');
const { AgentError, throwIfAborted } = require('./agentErrors.js');
const {
  CORE_ENVIRONMENT_KEYS,
  minimalEnvironment,
  resolveCommandCandidatesWithWhere,
} = require('./cliRunner.js');
const {
  codexVersionAllowed,
  codexReleaseFromReparseChain,
  inspectNativeCliCandidate,
} = require('./nativeCliLaunchLease.js');

const REPOSITORY_ROOT = path.win32.resolve(__dirname, '..', '..');
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

const NATIVE_CLI_POLICY = Object.freeze({
  'codex-cli': Object.freeze({
    rootEnvironmentKey: 'LOCALAPPDATA',
    rootParts: Object.freeze(['Programs', 'OpenAI', 'Codex']),
    releasePolicy: Object.freeze({
      minimumVersion: '0.145.0',
      blockedVersions: Object.freeze([]),
      releaseSuffix: '-x86_64-pc-windows-msvc',
    }),
    publisher: 'OpenAI OpCo, LLC',
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

function resolveCodexReleasePolicy(policy, environment) {
  if (!policy.releasePolicy) return null;
  const localAppData = normalizeAbsolute(environment?.LOCALAPPDATA);
  const userProfile = normalizeAbsolute(environment?.USERPROFILE);
  if (!localAppData || !userProfile) return null;
  return Object.freeze({
    minimumVersion: policy.releasePolicy.minimumVersion,
    blockedVersions: policy.releasePolicy.blockedVersions,
    releaseRoot: path.win32.join(
      userProfile, '.codex', 'packages', 'standalone', 'releases',
    ),
    releaseSuffix: policy.releasePolicy.releaseSuffix,
    installerBin: path.win32.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin'),
    standaloneCurrent: path.win32.join(
      userProfile, '.codex', 'packages', 'standalone', 'current',
    ),
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

function codexReleaseFromInspection(candidate, inspection, policy, executable) {
  if (!policy || !Array.isArray(inspection.reparseChain)) return null;
  const derived = codexReleaseFromReparseChain(
    candidate, inspection.reparseChain, inspection.path, policy, executable,
  );
  if (!derived) return null;
  const target = derived.target;
  const junctionPath = normalizeAbsolute(inspection.junctionPath);
  const junctionTarget = normalizeAbsolute(inspection.junctionTarget);
  if (!samePath(candidate, path.win32.join(policy.installerBin, executable))
    || !samePath(inspection.path, path.win32.join(target, executable))
    || !junctionPath || !samePath(junctionPath, policy.installerBin)
    || !junctionTarget || !samePath(junctionTarget, target)
    || inspection.version !== derived.version) {
    return null;
  }
  return Object.freeze({ version: derived.version, target });
}

function bindingFromInspection(
  candidate, inspection, policy, officialRoot, exclusions, allowedJunction,
  expectedReparseChain, expectedLexicalCandidate, codexReleasePolicy,
) {
  if (!inspection || typeof inspection !== 'object' || Array.isArray(inspection)) return null;
  const inspectedPath = normalizeAbsolute(inspection.path);
  if (!inspectedPath) return null;
  const dynamicRelease = codexReleasePolicy
    ? codexReleaseFromInspection(candidate, inspection, codexReleasePolicy, policy.executable)
    : null;
  if (codexReleasePolicy) {
    if (inspection.reparsePoint !== true
      || !dynamicRelease
      || exclusions.some((root) => isWithin(root, inspectedPath))) return null;
  } else if (inspection.reparsePoint === false) {
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
    || inspection.version !== (dynamicRelease?.version || policy.version)
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
  retainSession = false,
  signal = undefined,
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
  const codexReleasePolicy = resolveCodexReleasePolicy(policy, environment);
  if (policy.releasePolicy && !codexReleasePolicy) throw new AgentError('CLI_NOT_INSTALLED');
  const expectedLexicalCandidate = path.win32.join(
    codexReleasePolicy?.installerBin || allowedJunction?.path || officialRoot,
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
  if (codexReleasePolicy) {
    const heldPaths = [
      codexReleasePolicy.installerBin,
      codexReleasePolicy.standaloneCurrent,
      codexReleasePolicy.releaseRoot,
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
      const inspectionOptions = {
        expectedPublisher: policy.publisher,
        environment: sanitizedCoreEnvironment(environment),
      };
      if (codexReleasePolicy) {
        inspectionOptions.codexReleasePolicy = codexReleasePolicy;
      } else {
        inspectionOptions.allowedJunction = allowedJunction;
        inspectionOptions.expectedReparseChain = expectedReparseChain;
        inspectionOptions.expectedVersion = policy.version;
      }
      inspectionOptions.retainSession = retainSession;
      if (signal !== undefined) inspectionOptions.signal = signal;
      inspection = await inspectCandidate(candidate, inspectionOptions);
    } catch (error) {
      // A cancellation must stop the scan and propagate rather than be treated as "not found".
      if (signal?.aborted) throw error;
      continue;
    }
    const retainedSession = retainSession ? inspection?.session : null;
    const inspectionFacts = retainSession ? inspection?.inspection : inspection;
    const binding = bindingFromInspection(
      candidate, inspectionFacts, policy, officialRoot, exclusions, allowedJunction,
      expectedReparseChain, expectedLexicalCandidate, codexReleasePolicy,
    );
    if (binding) return retainSession ? Object.freeze({ binding, session: retainedSession }) : binding;
    if (retainedSession?.release) {
      try { await retainedSession.release(); } catch {}
    }
  }
  throw new AgentError('CLI_NOT_INSTALLED');
}

module.exports = {
  NATIVE_CLI_POLICY,
  codexVersionAllowed,
  discoverSignedNativeCli,
};
