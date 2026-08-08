'use strict';

const { spawn: defaultSpawn } = require('node:child_process');
const { TextDecoder } = require('node:util');
const path = require('node:path');
const { AgentError } = require('./agentErrors.js');

const MAX_HELPER_LINE_BYTES = 32768;
const MAX_VERSION_OUTPUT_BYTES = 65536;
const DEFAULT_HELPER_TIMEOUT_MS = 30000;
const DEFAULT_LAUNCH_TIMEOUT_MS = 5000;
const MAX_REPARSE_DEPTH = 8;
const BINDING_KEYS = Object.freeze([
  'fileId', 'path', 'publisher', 'sha256', 'version', 'volumeSerial',
]);
const FACT_KEYS = Object.freeze([
  'fileId', 'fileVersion', 'path', 'publisher', 'regularFile', 'reparsePoint',
  'reparseChain', 'sha256', 'signatureValid', 'volumeSerial',
]);
const REPARSE_ENTRY_KEYS = Object.freeze(['path', 'rawTarget', 'type']);
const LEASE_LAUNCH_KEYS = Object.freeze(['args', 'command', 'options']);
const SPAWN_OPTION_KEYS = Object.freeze(['cwd', 'env', 'shell', 'stdio', 'windowsHide']);
const CODEX_RELEASE_POLICY_KEYS = Object.freeze([
  'blockedVersions', 'installerBin', 'minimumVersion', 'releaseRoot',
  'releaseSuffix', 'standaloneCurrent',
]);
const CODEX_RELEASE_SUFFIX = '-x86_64-pc-windows-msvc';
const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function commandFailed(error) {
  return error instanceof AgentError ? error : new AgentError('COMMAND_FAILED', { cause: error });
}

function cliUnavailable(error) {
  return error instanceof AgentError && error.code === 'CLI_NOT_INSTALLED'
    ? error
    : new AgentError('CLI_NOT_INSTALLED', { cause: error });
}

function assertMainProcess() {
  if (process.type === 'renderer') throw new AgentError('COMMAND_FAILED');
}

function exactOwnKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function normalizeBinding(binding) {
  if (!exactOwnKeys(binding, BINDING_KEYS)
    || typeof binding.path !== 'string'
    || !path.win32.isAbsolute(binding.path)
    || !binding.path.toLowerCase().endsWith('.exe')
    || typeof binding.sha256 !== 'string'
    || !/^[a-fA-F0-9]{64}$/.test(binding.sha256)
    || !['volumeSerial', 'fileId', 'version', 'publisher'].every(
      (key) => typeof binding[key] === 'string' && binding[key].length > 0,
    )) {
    throw new AgentError('CLI_NOT_INSTALLED');
  }
  return Object.freeze({
    path: binding.path,
    sha256: binding.sha256.toLowerCase(),
    volumeSerial: binding.volumeSerial,
    fileId: binding.fileId,
    version: binding.version,
    publisher: binding.publisher,
  });
}

function normalizeReparseChain(rawChain) {
  if (!Array.isArray(rawChain) || rawChain.length > MAX_REPARSE_DEPTH) return null;
  const seenPaths = new Set();
  const chain = [];
  for (const rawEntry of rawChain) {
    if (!exactOwnKeys(rawEntry, REPARSE_ENTRY_KEYS)
      || typeof rawEntry.path !== 'string'
      || typeof rawEntry.rawTarget !== 'string'
      || !path.win32.isAbsolute(rawEntry.path)
      || !path.win32.isAbsolute(rawEntry.rawTarget)
      || path.win32.normalize(rawEntry.path) !== rawEntry.path
      || path.win32.normalize(rawEntry.rawTarget) !== rawEntry.rawTarget
      || Buffer.byteLength(rawEntry.path, 'utf8') > 16384
      || Buffer.byteLength(rawEntry.rawTarget, 'utf8') > 16384
      || !['junction', 'symbolic-link'].includes(rawEntry.type)) {
      return null;
    }
    const pathKey = rawEntry.path.toLowerCase();
    if (seenPaths.has(pathKey)) return null;
    seenPaths.add(pathKey);
    chain.push(Object.freeze({
      path: rawEntry.path,
      rawTarget: rawEntry.rawTarget,
      type: rawEntry.type,
    }));
  }
  return Object.freeze(chain);
}

function terminalPathFromReparseChain(candidatePath, chain) {
  let current = path.win32.normalize(candidatePath);
  for (const entry of chain) {
    const relative = path.win32.relative(entry.path, current);
    if (relative === '..'
      || relative.startsWith(`..${path.win32.sep}`)
      || path.win32.isAbsolute(relative)) {
      return null;
    }
    current = path.win32.normalize(path.win32.join(entry.rawTarget, relative));
  }
  return current;
}

function samePath(first, second) {
  return typeof first === 'string'
    && typeof second === 'string'
    && path.win32.normalize(first).toLowerCase() === path.win32.normalize(second).toLowerCase();
}

function sameReparseChain(first, second) {
  return first.length === second.length && first.every((entry, index) => (
    entry.type === second[index].type
    && samePath(entry.path, second[index].path)
    && samePath(entry.rawTarget, second[index].rawTarget)
  ));
}

function parseStrictVersion(value) {
  const match = typeof value === 'string' ? STRICT_SEMVER.exec(value) : null;
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(first, second) {
  for (let index = 0; index < 3; index += 1) {
    if (first[index] !== second[index]) return first[index] < second[index] ? -1 : 1;
  }
  return 0;
}

function codexVersionAllowed(value, {
  minimumVersion,
  blockedVersions = [],
} = {}) {
  const version = parseStrictVersion(value);
  const minimum = parseStrictVersion(minimumVersion);
  if (!version || !minimum || !Array.isArray(blockedVersions)
    || blockedVersions.some((blocked) => !parseStrictVersion(blocked))) {
    return false;
  }
  return compareVersions(version, minimum) >= 0 && !blockedVersions.includes(value);
}

function normalizeCodexReleasePolicy(raw) {
  if (!exactOwnKeys(raw, CODEX_RELEASE_POLICY_KEYS)
    || raw.releaseSuffix !== CODEX_RELEASE_SUFFIX
    || !codexVersionAllowed(raw.minimumVersion, {
      minimumVersion: raw.minimumVersion,
      blockedVersions: raw.blockedVersions,
    })
    || !['releaseRoot', 'installerBin', 'standaloneCurrent'].every((key) => (
      typeof raw[key] === 'string'
      && path.win32.isAbsolute(raw[key])
      && path.win32.normalize(raw[key]) === raw[key]
    ))) {
    return null;
  }
  return Object.freeze({
    minimumVersion: raw.minimumVersion,
    blockedVersions: Object.freeze([...raw.blockedVersions]),
    releaseRoot: raw.releaseRoot,
    releaseSuffix: raw.releaseSuffix,
    installerBin: raw.installerBin,
    standaloneCurrent: raw.standaloneCurrent,
  });
}

function codexReleaseFromFacts(candidatePath, facts, policy) {
  if (facts.reparseChain.length !== 2) return null;
  const [installer, current] = facts.reparseChain;
  const expectedLexicalCandidate = path.win32.join(policy.installerBin, 'codex.exe');
  const expectedCurrentBin = path.win32.join(policy.standaloneCurrent, 'bin');
  const release = current.rawTarget;
  const releaseName = path.win32.basename(release);
  if (!samePath(candidatePath, expectedLexicalCandidate)
    || installer.type !== 'junction'
    || current.type !== 'junction'
    || !samePath(installer.path, policy.installerBin)
    || !samePath(installer.rawTarget, expectedCurrentBin)
    || !samePath(current.path, policy.standaloneCurrent)
    || !samePath(path.win32.dirname(release), policy.releaseRoot)
    || !releaseName.endsWith(policy.releaseSuffix)) {
    return null;
  }
  const version = releaseName.slice(0, -policy.releaseSuffix.length);
  const target = path.win32.join(release, 'bin');
  if (!codexVersionAllowed(version, policy)
    || !samePath(facts.path, path.win32.join(target, 'codex.exe'))
    || !samePath(terminalPathFromReparseChain(candidatePath, facts.reparseChain), facts.path)) {
    return null;
  }
  return Object.freeze({ version, target });
}

function normalizeFacts(raw) {
  const reparseChain = exactOwnKeys(raw, FACT_KEYS)
    ? normalizeReparseChain(raw.reparseChain)
    : null;
  if (!reparseChain
    || typeof raw.path !== 'string'
    || !path.win32.isAbsolute(raw.path)
    || typeof raw.regularFile !== 'boolean'
    || typeof raw.reparsePoint !== 'boolean'
    || typeof raw.signatureValid !== 'boolean'
    || typeof raw.sha256 !== 'string'
    || !/^[a-fA-F0-9]{64}$/.test(raw.sha256)
    || !['volumeSerial', 'fileId', 'fileVersion', 'publisher'].every(
      (key) => typeof raw[key] === 'string',
    )
    || raw.reparsePoint !== (reparseChain.length > 0)) {
    throw new AgentError('CLI_NOT_INSTALLED');
  }
  return Object.freeze({
    path: raw.path,
    regularFile: raw.regularFile,
    reparsePoint: raw.reparsePoint,
    reparseChain,
    sha256: raw.sha256.toLowerCase(),
    volumeSerial: raw.volumeSerial,
    fileId: raw.fileId,
    fileVersion: raw.fileVersion,
    publisher: raw.publisher,
    signatureValid: raw.signatureValid,
  });
}

function fileVersionMatches(fileVersion, cliVersion, publisher) {
  return (fileVersion === '' && publisher === 'OpenAI OpCo, LLC')
    || fileVersion === cliVersion
    || fileVersion === `${cliVersion}.0`;
}

function sameFinalFacts(binding, facts) {
  return facts.regularFile === true
    && facts.reparsePoint === false
    && facts.reparseChain.length === 0
    && facts.signatureValid === true
    && facts.path === binding.path
    && facts.sha256 === binding.sha256
    && facts.volumeSerial === binding.volumeSerial
    && facts.fileId === binding.fileId
    && fileVersionMatches(facts.fileVersion, binding.version, binding.publisher)
    && facts.publisher === binding.publisher;
}

function reportsExactVersion(output, version) {
  if (typeof output !== 'string' || Buffer.byteLength(output, 'utf8') > MAX_VERSION_OUTPUT_BYTES) {
    return false;
  }
  const normalized = output.trim();
  if (normalized.length === 0 || /[\r\n]/.test(normalized)) return false;
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^(?:(?:codex(?:-cli)?|claude(?: code)?)\\s+)?v?${escaped}(?:\\s+\\(Claude Code\\))?$`,
    'i',
  ).test(normalized);
}

function minimalHelperEnvironment(environment = process.env) {
  const result = {};
  for (const key of ['COMSPEC', 'PSModulePath', 'SYSTEMROOT', 'TEMP', 'TMP', 'WINDIR']) {
    if (typeof environment[key] === 'string') result[key] = environment[key];
  }
  return result;
}

function minimalNativeEnvironment(environment = process.env) {
  const result = {};
  for (const key of [
    'APPDATA', 'COMSPEC', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'PATH', 'PATHEXT',
    'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR',
  ]) {
    if (typeof environment[key] === 'string') result[key] = environment[key];
  }
  return result;
}

function versionSpawnOptions(command, environment = process.env) {
  return {
    cwd: path.win32.dirname(command),
    env: minimalNativeEnvironment(environment),
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
}

function createNativeCliLeaseRunner({ spawn = defaultSpawn } = {}) {
  return Object.freeze({
    capture({ command, args, options, timeoutMs = DEFAULT_LAUNCH_TIMEOUT_MS } = {}) {
      let child;
      try {
        child = spawn(command, args, options);
      } catch (error) {
        return Promise.reject(new AgentError('COMMAND_FAILED', { cause: error }));
      }
      return new Promise((resolve, reject) => {
        let stdout = Buffer.alloc(0);
        let stderr = Buffer.alloc(0);
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;
        let timer = null;
        const boundedTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
          ? Math.min(timeoutMs, 30000)
          : DEFAULT_LAUNCH_TIMEOUT_MS;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          if (timer !== null) clearTimeout(timer);
          if (error) reject(error);
          else resolve(value);
        };
        child.stdout.on('data', (chunk) => {
          const source = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          stdoutBytes += source.length;
          if (stdout.length < MAX_VERSION_OUTPUT_BYTES) {
            stdout = Buffer.concat([
              stdout,
              source.subarray(0, MAX_VERSION_OUTPUT_BYTES - stdout.length),
            ]);
          }
        });
        child.stderr.on('data', (chunk) => {
          const source = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          stderrBytes += source.length;
          if (stderr.length < MAX_VERSION_OUTPUT_BYTES) {
            stderr = Buffer.concat([
              stderr,
              source.subarray(0, MAX_VERSION_OUTPUT_BYTES - stderr.length),
            ]);
          }
        });
        child.once('error', (error) => finish(new AgentError('COMMAND_FAILED', { cause: error })));
        child.once('close', (exitCode, signal) => {
          if (stdoutBytes > MAX_VERSION_OUTPUT_BYTES || stderrBytes > MAX_VERSION_OUTPUT_BYTES) {
            finish(new AgentError('COMMAND_FAILED'));
            return;
          }
          finish(null, {
            exitCode,
            signal,
            stdout: stdout.toString('utf8'),
            stderr: stderr.toString('utf8'),
          });
        });
        timer = setTimeout(() => {
          try { child.kill(); } catch {}
          finish(new AgentError('REQUEST_TIMEOUT'));
        }, boundedTimeout);
      });
    },

    launch({ command, args, options } = {}) {
      return spawn(command, args, options);
    },
  });
}

function readHelperMessage(child, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    let timer = null;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      child.stdout.removeListener('data', onData);
      child.removeListener('error', onError);
      child.removeListener('close', onClose);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      const source = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      pending = Buffer.concat([pending, source]);
      const newline = pending.indexOf(0x0A);
      if ((newline === -1 && pending.length > MAX_HELPER_LINE_BYTES)
        || newline > MAX_HELPER_LINE_BYTES) {
        finish(new AgentError('COMMAND_FAILED'));
        return;
      }
      if (newline === -1) return;
      const line = pending.subarray(0, newline);
      try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        const decoded = decoder.decode(line.at(-1) === 0x0D ? line.subarray(0, -1) : line);
        finish(null, JSON.parse(decoded));
      } catch (error) {
        finish(new AgentError('COMMAND_FAILED', { cause: error }));
      }
    };
    const onError = (error) => finish(new AgentError('COMMAND_FAILED', { cause: error }));
    const onClose = () => finish(new AgentError('COMMAND_FAILED'));
    const onAbort = () => finish(new AgentError('RUN_STOPPED'));
    child.stdout.on('data', onData);
    child.once('error', onError);
    child.once('close', onClose);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish(new AgentError('REQUEST_TIMEOUT')), timeoutMs);
  });
}

async function stopHelper(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('close', finish);
      resolve();
    };
    const timer = setTimeout(finish, 1000);
    timer.unref?.();
    child.once('close', finish);
    try { child.kill(); } catch { finish(); }
    if (child.exitCode !== null || child.signalCode !== null) finish();
  });
}

function createNativeCliInspectionHelper({
  spawn = defaultSpawn,
  environment = process.env,
  systemRoot = environment.SystemRoot || environment.SYSTEMROOT || 'C:\\Windows',
  helperPath = path.join(__dirname, '..', '..', 'resources', 'windows', 'generated', 'native-cli-inspector.exe'),
  timeoutMs = DEFAULT_HELPER_TIMEOUT_MS,
} = {}) {
  const boundedTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.min(timeoutMs, 30000)
    : DEFAULT_HELPER_TIMEOUT_MS;

  return Object.freeze({
    async open(candidatePath, { signal } = {}) {
      assertMainProcess();
      if (typeof candidatePath !== 'string'
        || !path.win32.isAbsolute(candidatePath)
        || !candidatePath.toLowerCase().endsWith('.exe')
        || Buffer.byteLength(candidatePath, 'utf8') > 16384) {
        throw new AgentError('CLI_NOT_INSTALLED');
      }

      let child;
      try {
        child = spawn(helperPath, [], {
          cwd: path.dirname(helperPath),
          env: minimalHelperEnvironment(environment),
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        throw cliUnavailable(error);
      }
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => {});

      try {
        const readyMessage = readHelperMessage(child, boundedTimeout, signal);
        child.stdin.write(`${JSON.stringify({ path: candidatePath })}\n`);
        const ready = await readyMessage;
        if (!exactOwnKeys(ready, ['facts', 'type']) || ready.type !== 'ready') {
          throw new AgentError('CLI_NOT_INSTALLED');
        }
        const facts = normalizeFacts(ready.facts);
        let releasePromise = null;
        return Object.freeze({
          facts,
          release() {
            if (releasePromise) return releasePromise;
            releasePromise = (async () => {
              if (child.exitCode !== null || child.signalCode !== null) return;
              try {
                const closedCleanlyPromise = new Promise((resolve) => {
                  let settled = false;
                  const finish = (closedCleanly) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    child.removeListener('close', onClose);
                    resolve(closedCleanly);
                  };
                  const onClose = () => finish(true);
                  const timer = setTimeout(() => finish(false), boundedTimeout);
                  timer.unref?.();
                  child.once('close', onClose);
                });
                child.stdin.end(`${JSON.stringify({ action: 'release' })}\n`);
                const closedCleanly = await closedCleanlyPromise;
                if (!closedCleanly) await stopHelper(child);
              } finally {
                child.stdout.destroy();
                child.stderr.destroy();
              }
            })();
            return releasePromise;
          },
        });
      } catch (error) {
        await stopHelper(child);
        throw cliUnavailable(error);
      }
    },
  });
}

function expectedChainFromOptions({
  expectedReparseChain,
  allowedJunction,
}) {
  const expected = expectedReparseChain === undefined
    ? Object.freeze([])
    : normalizeReparseChain(expectedReparseChain);
  if (!expected || expected.some((entry) => entry.type !== 'junction')) return null;
  if (allowedJunction !== null && allowedJunction !== undefined) {
    if (!exactOwnKeys(allowedJunction, ['path', 'target'])
      || typeof allowedJunction.path !== 'string'
      || typeof allowedJunction.target !== 'string'
      || !path.win32.isAbsolute(allowedJunction.path)
      || !path.win32.isAbsolute(allowedJunction.target)
      || expected.length === 0
      || !samePath(allowedJunction.path, expected[0].path)) {
      return null;
    }
  }
  return expected;
}

async function inspectNativeCliCandidate(candidatePath, {
  helper = createNativeCliInspectionHelper(),
  runner = createNativeCliLeaseRunner(),
  expectedPublisher,
  expectedVersion,
  expectedReparseChain,
  allowedJunction = null,
  codexReleasePolicy,
  environment = process.env,
  retainSession = false,
} = {}) {
  assertMainProcess();
  const dynamicPolicy = codexReleasePolicy === undefined
    ? null
    : normalizeCodexReleasePolicy(codexReleasePolicy);
  const dynamicMode = codexReleasePolicy !== undefined;
  const expectedChain = dynamicMode ? null : expectedChainFromOptions({
    expectedReparseChain, allowedJunction,
  });
  if (!helper || typeof helper.open !== 'function'
    || !runner || typeof runner.capture !== 'function'
    || typeof expectedPublisher !== 'string' || expectedPublisher.length === 0
    || (dynamicMode && (!dynamicPolicy
      || expectedVersion !== undefined
      || expectedReparseChain !== undefined
      || allowedJunction !== null))
    || (!dynamicMode && (typeof expectedVersion !== 'string'
      || expectedVersion.length === 0
      || !expectedChain))) {
    throw new AgentError('CLI_NOT_INSTALLED');
  }
  let session;
  let result;
  let failure = null;
  try {
    session = await helper.open(candidatePath);
    const facts = normalizeFacts(session?.facts);
    const dynamicRelease = dynamicPolicy
      ? codexReleaseFromFacts(candidatePath, facts, dynamicPolicy)
      : null;
    const verifiedVersion = dynamicRelease?.version || expectedVersion;
    if (typeof session?.release !== 'function'
      || facts.regularFile !== true
      || facts.signatureValid !== true
      || facts.publisher !== expectedPublisher
      || !fileVersionMatches(facts.fileVersion, verifiedVersion, expectedPublisher)
      || (dynamicMode && !dynamicRelease)
      || (!dynamicMode && (
        facts.reparsePoint !== (expectedChain.length > 0)
        || !sameReparseChain(facts.reparseChain, expectedChain)
        || (allowedJunction && !samePath(allowedJunction.target, path.win32.dirname(facts.path)))
        || !samePath(terminalPathFromReparseChain(candidatePath, facts.reparseChain), facts.path)
      ))) {
      throw new AgentError('CLI_NOT_INSTALLED');
    }
    const versionResult = await runner.capture({
      command: facts.path,
      args: ['--version'],
      options: versionSpawnOptions(facts.path, environment),
      timeoutMs: DEFAULT_LAUNCH_TIMEOUT_MS,
    });
    if (versionResult?.exitCode !== 0 || !reportsExactVersion(versionResult.stdout, verifiedVersion)) {
      throw new AgentError('CLI_NOT_INSTALLED');
    }
    const publicInspection = {
      path: facts.path,
      regularFile: facts.regularFile,
      reparsePoint: facts.reparsePoint,
      reparseChain: facts.reparseChain,
      sha256: facts.sha256,
      volumeSerial: facts.volumeSerial,
      fileId: facts.fileId,
      version: verifiedVersion,
      publisher: facts.publisher,
      signatureValid: facts.signatureValid,
    };
    if (facts.reparseChain.length > 0) {
      publicInspection.junctionPath = facts.reparseChain[0].path;
      publicInspection.junctionTarget = dynamicRelease?.target || path.win32.dirname(facts.path);
    }
    result = Object.freeze(retainSession
      ? { inspection: Object.freeze(publicInspection), session }
      : publicInspection);
    if (retainSession) session = null;
  } catch (error) {
    failure = cliUnavailable(error);
  }
  if (session) {
    try {
      if (typeof session.release !== 'function') throw new AgentError('CLI_NOT_INSTALLED');
      await session.release();
    } catch (error) {
      if (!failure) failure = cliUnavailable(error);
    }
  }
  if (failure) throw failure;
  return result;
}

function sanitizedLaunchSpec(spec, canonicalPath) {
  if (!exactOwnKeys(spec, LEASE_LAUNCH_KEYS)
    || spec.command !== canonicalPath
    || !Array.isArray(spec.args)
    || spec.args.length > 1024
    || spec.args.some((argument) => (
      typeof argument !== 'string'
      || argument.includes('\0')
      || Buffer.byteLength(argument, 'utf8') > 32768
    ))
    || !exactOwnKeys(spec.options, SPAWN_OPTION_KEYS)
    || spec.options.shell !== false
    || typeof spec.options.windowsHide !== 'boolean'
    || !Array.isArray(spec.options.stdio)
    || spec.options.stdio.length !== 3
    || spec.options.stdio.some((value) => value !== 'pipe')
    || !(spec.options.cwd === undefined || (
      typeof spec.options.cwd === 'string'
      && path.win32.isAbsolute(spec.options.cwd)
      && !spec.options.cwd.includes('\0')
    ))
    || spec.options.env === null
    || typeof spec.options.env !== 'object'
    || Array.isArray(spec.options.env)) {
    throw new AgentError('COMMAND_FAILED');
  }
  const environmentEntries = Object.entries(spec.options.env);
  if (environmentEntries.length > 256 || environmentEntries.some(([key, value]) => (
    !/^[A-Za-z_][A-Za-z0-9_()]*$/.test(key)
    || typeof value !== 'string'
    || value.includes('\0')
    || Buffer.byteLength(value, 'utf8') > 32768
  ))) {
    throw new AgentError('COMMAND_FAILED');
  }
  return {
    command: canonicalPath,
    args: [...spec.args],
    options: {
      cwd: spec.options.cwd,
      env: Object.fromEntries(environmentEntries),
      shell: false,
      windowsHide: spec.options.windowsHide,
      stdio: [...spec.options.stdio],
    },
  };
}

function waitForChildCreated(child, { timeoutMs, cleanupRequested }) {
  return new Promise((resolve, reject) => {
    if (!child || typeof child.once !== 'function' || typeof child.removeListener !== 'function') {
      reject(new AgentError('COMMAND_FAILED'));
      return;
    }
    let settled = false;
    let timer = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      child.removeListener('spawn', onSpawn);
      child.removeListener('error', onError);
      cleanupRequested.delete(onCleanup);
      if (error) reject(error);
      else resolve();
    };
    const stopChild = () => { try { child.kill?.(); } catch {} };
    const onSpawn = () => finish();
    const onError = (error) => finish(new AgentError('COMMAND_FAILED', { cause: error }));
    const onCleanup = () => { stopChild(); finish(new AgentError('COMMAND_FAILED')); };
    child.once('spawn', onSpawn);
    child.once('error', onError);
    cleanupRequested.add(onCleanup);
    timer = setTimeout(() => {
      stopChild();
      finish(new AgentError('REQUEST_TIMEOUT'));
    }, timeoutMs);
  });
}

async function openVerifiedNativeCliLaunchLease(binding, {
  helper = createNativeCliInspectionHelper(),
  runner = createNativeCliLeaseRunner(),
  environment = process.env,
  launchTimeoutMs = DEFAULT_LAUNCH_TIMEOUT_MS,
  session: retainedSession = null,
} = {}) {
  assertMainProcess();
  const expected = normalizeBinding(binding);
  if ((!retainedSession && (!helper || typeof helper.open !== 'function'))
    || !runner || typeof runner.capture !== 'function' || typeof runner.launch !== 'function') {
    throw new AgentError('CLI_NOT_INSTALLED');
  }

  let session = retainedSession;
  let failure = null;
  try {
    if (!session) session = await helper.open(expected.path);
    const facts = normalizeFacts(session?.facts);
    if (typeof session?.release !== 'function' || !sameFinalFacts(expected, facts)) {
      throw new AgentError('CLI_NOT_INSTALLED');
    }
    const versionResult = await runner.capture({
      command: facts.path,
      args: ['--version'],
      options: versionSpawnOptions(facts.path, environment),
      timeoutMs: 5000,
    });
    if (versionResult?.exitCode !== 0 || !reportsExactVersion(versionResult.stdout, expected.version)) {
      throw new AgentError('CLI_NOT_INSTALLED');
    }
  } catch (error) {
    failure = cliUnavailable(error);
  }
  if (failure) {
    if (session && typeof session.release === 'function') {
      try { await session.release(); } catch {}
    }
    throw failure;
  }

  let state = 'open';
  let releasePromise = null;
  let launchPromise = null;
  const cleanupRequested = new Set();
  const boundedLaunchTimeout = Number.isFinite(launchTimeoutMs) && launchTimeoutMs > 0
    ? Math.min(launchTimeoutMs, 30000)
    : DEFAULT_LAUNCH_TIMEOUT_MS;
  const release = () => {
    if (!releasePromise) {
      releasePromise = Promise.resolve().then(() => session.release()).catch((error) => {
        throw commandFailed(error);
      });
    }
    return releasePromise;
  };

  const lease = {
    async launch(spec) {
      assertMainProcess();
      if (state !== 'open') throw new AgentError('COMMAND_FAILED');
      state = 'launching';
      let safeSpec;
      try {
        safeSpec = sanitizedLaunchSpec(spec, expected.path);
      } catch (error) {
        state = 'closed';
        await release();
        throw commandFailed(error);
      }

      launchPromise = (async () => {
        let child;
        let launchFailure = null;
        try {
          let launched = runner.launch(safeSpec);
          if (launched && typeof launched.then === 'function') launched = await launched;
          child = launched?.child || launched;
          await waitForChildCreated(child, {
            timeoutMs: boundedLaunchTimeout,
            cleanupRequested,
          });
        } catch (error) {
          launchFailure = commandFailed(error);
        }
        if (launchFailure) {
          state = 'closed';
          try {
            await release();
          } catch (error) {
            if (!launchFailure) launchFailure = commandFailed(error);
          }
          throw launchFailure;
        }
        state = 'launched';
        return child;
      })();
      return launchPromise;
    },

    async cleanup() {
      assertMainProcess();
      if (state === 'open') {
        state = 'closed';
        await release();
        return;
      }
      if (state === 'launching') {
        for (const cancel of [...cleanupRequested]) cancel();
        try { await launchPromise; } catch {}
      }
      if (state === 'launched') state = 'closed';
      await release();
    },
  };
  return Object.freeze(lease);
}

module.exports = {
  codexVersionAllowed,
  createNativeCliInspectionHelper,
  createNativeCliLeaseRunner,
  inspectNativeCliCandidate,
  openVerifiedNativeCliLaunchLease,
};
