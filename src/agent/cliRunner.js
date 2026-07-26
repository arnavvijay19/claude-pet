'use strict';

const { spawn: defaultSpawn } = require('node:child_process');
const path = require('node:path');
const { AgentError } = require('./agentErrors.js');
const { terminateWindowsProcessTree: defaultTerminateWindowsProcessTree } = require('./windowsProcessTree.js');

const MAX_CAPTURE_BYTES = 1024 * 1024;
const MAX_JSONL_LINE_BYTES = 65536;
const MAX_JSONL_PARTIAL_BYTES = 131072;
const CORE_ENVIRONMENT_KEYS = Object.freeze([
  'APPDATA', 'COMSPEC', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'PATH', 'PATHEXT',
  'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR',
]);
const ALLOWED_WHERE_COMMANDS = Object.freeze(new Set(['claude.exe', 'codex.exe', 'where.exe']));
const STARTUP_CORE_ENVIRONMENT = Object.freeze(Object.fromEntries(
  CORE_ENVIRONMENT_KEYS
    .filter((key) => typeof process.env[key] === 'string')
    .map((key) => [key, process.env[key]]),
));

function isDriveAbsolute(candidate) {
  return typeof candidate === 'string'
    && /^[A-Za-z]:[\\/]/.test(candidate)
    && path.win32.isAbsolute(candidate);
}

function absolutePathEntries(value) {
  if (typeof value !== 'string') return [];
  const seen = new Set();
  const entries = [];
  for (const rawEntry of value.split(';')) {
    let entry = rawEntry.trim();
    if (entry.startsWith('"') && entry.endsWith('"') && entry.length >= 2) {
      entry = entry.slice(1, -1).trim();
    }
    if (!isDriveAbsolute(entry)) continue;
    const normalized = path.win32.normalize(entry);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(normalized);
  }
  return entries;
}

function coreEnvironmentFrom(source) {
  const environment = {};
  for (const key of CORE_ENVIRONMENT_KEYS) {
    if (typeof source?.[key] === 'string') environment[key] = source[key];
  }
  const pathEntries = absolutePathEntries(environment.PATH);
  if (typeof environment.PATH === 'string') environment.PATH = pathEntries.join(';');
  return environment;
}

function cappedBufferAppend(current, chunk, maximum) {
  const source = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  if (current.length >= maximum) return current;
  return Buffer.concat([current, source.subarray(0, maximum - current.length)]);
}

function minimalEnvironment(overrides = {}) {
  const environment = coreEnvironmentFrom(STARTUP_CORE_ENVIRONMENT);
  for (const [key, value] of Object.entries(overrides || {})) {
    if (typeof value === 'string') environment[key] = value;
  }
  if (typeof environment.PATH === 'string') {
    environment.PATH = absolutePathEntries(environment.PATH).join(';');
  }
  return environment;
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });
}

function resolveCommandCandidatesWithWhere(command, {
  spawn = defaultSpawn,
  environment = STARTUP_CORE_ENVIRONMENT,
  systemRoot = STARTUP_CORE_ENVIRONMENT.SYSTEMROOT || STARTUP_CORE_ENVIRONMENT.WINDIR,
} = {}) {
  const normalizedCommand = typeof command === 'string' ? command.toLowerCase() : '';
  if (
    typeof command !== 'string'
    || command !== command.trim()
    || /[\\/]/.test(command || '')
    || !ALLOWED_WHERE_COMMANDS.has(normalizedCommand)
    || !isDriveAbsolute(systemRoot)
  ) {
    return Promise.reject(new AgentError('CLI_NOT_INSTALLED'));
  }
  const normalizedSystemRoot = path.win32.normalize(systemRoot);
  const system32 = path.win32.join(normalizedSystemRoot, 'System32');
  const wherePath = path.win32.join(system32, 'where.exe');
  const whereEnvironment = coreEnvironmentFrom(environment);
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = Buffer.alloc(0);
    let outputBytes = 0;
    let stderrBytes = 0;
    let child;
    const fail = (cause) => {
      if (settled) return;
      settled = true;
      reject(cause instanceof AgentError ? cause : new AgentError('CLI_NOT_INSTALLED', { cause }));
    };
    try {
      child = spawn(wherePath, [normalizedCommand], {
        shell: false,
        windowsHide: true,
        env: whereEnvironment,
        cwd: system32,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      fail(error);
      return;
    }
    child.stdout.on('data', (chunk) => {
      const source = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += source.length;
      output = cappedBufferAppend(output, source, MAX_CAPTURE_BYTES);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    });
    child.once('error', fail);
    child.once('close', (exitCode) => {
      if (settled) return;
      if (exitCode !== 0 || outputBytes > MAX_CAPTURE_BYTES || stderrBytes > MAX_CAPTURE_BYTES) {
        fail(new AgentError('CLI_NOT_INSTALLED'));
        return;
      }
      const candidates = output.toString('utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (candidates.length === 0 || candidates.some((candidate) => (
        !isDriveAbsolute(candidate)
        || path.win32.extname(candidate).toLowerCase() !== '.exe'
        || path.win32.basename(candidate).toLowerCase() !== normalizedCommand
      ))) {
        fail(new AgentError('CLI_NOT_INSTALLED'));
        return;
      }
      settled = true;
      resolve(candidates.map((candidate) => path.win32.normalize(candidate)));
    });
  });
}

function createCliRunner({
  spawn = defaultSpawn,
  resolveCommand,
  environment = STARTUP_CORE_ENVIRONMENT,
  systemRoot = STARTUP_CORE_ENVIRONMENT.SYSTEMROOT || STARTUP_CORE_ENVIRONMENT.WINDIR,
  terminateWindowsProcessTree = defaultTerminateWindowsProcessTree,
} = {}) {
  const commandResolver = typeof resolveCommand === 'function'
    ? resolveCommand
    : async (command) => {
      const candidates = await resolveCommandCandidatesWithWhere(command, { spawn, environment, systemRoot });
      return candidates[0];
    };

  async function start(spec = {}) {
    if (typeof spec.command !== 'string' || spec.command.length === 0 || !Array.isArray(spec.args)) {
      throw new AgentError('COMMAND_FAILED');
    }
    let command;
    try {
      command = spec.launchLease ? spec.command : await commandResolver(spec.command);
    } catch (error) {
      if (error instanceof AgentError) throw error;
      throw new AgentError('CLI_NOT_INSTALLED', { cause: error });
    }
    if (
      !isDriveAbsolute(command)
      || path.win32.extname(command).toLowerCase() !== '.exe'
      || (spec.launchLease && typeof spec.launchLease.launch !== 'function')
    ) {
      throw new AgentError('CLI_NOT_INSTALLED');
    }
    const args = spec.args.map(String);
    const options = {
      cwd: typeof spec.cwd === 'string' ? spec.cwd : undefined,
      env: minimalEnvironment(spec.env),
      shell: false,
      windowsHide: spec.visible !== true,
      stdio: ['pipe', 'pipe', 'pipe'],
    };
    let child;
    try {
      child = spec.launchLease
        ? await spec.launchLease.launch({ command, args, options })
        : spawn(command, args, options);
    } catch (error) {
      throw error instanceof AgentError ? error : new AgentError('COMMAND_FAILED', { cause: error });
    }
    if (typeof spec.goal === 'string') child.stdin.end(spec.goal);
    else child.stdin.end();
    return { child, command };
  }

  async function execute(spec, onData) {
    const { child, command } = await start(spec);
    let finished = false;
    let timeout = null;
    let terminalCheck = null;
    let rejectExecution;
    let dataCleanup = null;
    const signal = spec.signal;
    let onChildError = null;
    let onChildClose = null;
    const finishCleanup = () => {
      if (timeout !== null) clearTimeout(timeout);
      if (terminalCheck !== null) clearImmediate(terminalCheck);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (onChildError) child.removeListener('error', onChildError);
      if (onChildClose) child.removeListener('close', onChildClose);
      dataCleanup?.();
      dataCleanup = null;
    };
    const stop = async (errorOrCode) => {
      if (finished) return;
      finished = true;
      finishCleanup();
      try {
        const terminationSpec = {
          pid: child.pid,
          execFile: command,
          waitForExit: spec.waitForExit,
        };
        if (Array.isArray(spec.grandchildPids)) terminationSpec.grandchildPids = spec.grandchildPids;
        await terminateWindowsProcessTree(terminationSpec);
      } catch (error) {
        rejectExecution(error instanceof AgentError ? error : new AgentError('COMMAND_FAILED', { cause: error }));
        return;
      }
      rejectExecution(errorOrCode instanceof AgentError ? errorOrCode : new AgentError(errorOrCode));
    };
    const onAbort = () => { void stop('RUN_STOPPED'); };

    const result = await new Promise((resolve, reject) => {
      rejectExecution = reject;
      if (signal?.aborted) {
        void stop('RUN_STOPPED');
        return;
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      onChildError = (error) => {
        if (finished) return;
        finished = true;
        finishCleanup();
        reject(new AgentError('COMMAND_FAILED', { cause: error }));
      };
      onChildClose = (exitCode, childSignal) => {
        if (finished) return;
        finished = true;
        finishCleanup();
        resolve({ exitCode, signal: childSignal });
      };
      child.once('error', onChildError);
      child.once('close', onChildClose);
      dataCleanup = onData(child, (error) => {
        void stop(error instanceof AgentError ? error : new AgentError('COMMAND_FAILED', { cause: error }));
      }) || null;
      const alreadyExited = Number.isInteger(child.exitCode) || typeof child.signalCode === 'string';
      if (alreadyExited) {
        terminalCheck = setImmediate(() => {
          terminalCheck = null;
          onChildClose(child.exitCode, child.signalCode);
        });
      } else if (Number.isFinite(spec.timeoutMs) && spec.timeoutMs > 0) {
        timeout = setTimeout(() => { void stop('REQUEST_TIMEOUT'); }, spec.timeoutMs);
      }
    });
    return result;
  }

  return Object.freeze({
    async capture(spec) {
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      const result = await execute(spec, (child) => {
        const onStdout = (chunk) => { stdout = cappedBufferAppend(stdout, chunk, MAX_CAPTURE_BYTES); };
        const onStderr = (chunk) => { stderr = cappedBufferAppend(stderr, chunk, MAX_CAPTURE_BYTES); };
        child.stdout.on('data', onStdout);
        child.stderr.on('data', onStderr);
        return () => {
          child.stdout.removeListener('data', onStdout);
          child.stderr.removeListener('data', onStderr);
        };
      });
      return { ...result, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') };
    },

    async streamJsonl(spec, onEvent) {
      if (typeof onEvent !== 'function') throw new AgentError('PROVIDER_OUTPUT_INVALID');
      let pending = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      const result = await execute(spec, (child, fail) => {
        const onStderr = (chunk) => { stderr = cappedBufferAppend(stderr, chunk, MAX_CAPTURE_BYTES); };
        const onStdout = (chunk) => {
          pending = Buffer.concat([pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
          try {
            while (true) {
              const newline = pending.indexOf(0x0A);
              if (newline === -1) break;
              const line = pending.subarray(0, newline);
              pending = pending.subarray(newline + 1);
              const normalized = line.at(-1) === 0x0D ? line.subarray(0, -1) : line;
              if (normalized.length > MAX_JSONL_LINE_BYTES) throw new AgentError('PROVIDER_OUTPUT_INVALID');
              if (normalized.length !== 0) onEvent(JSON.parse(normalized.toString('utf8')));
            }
            if (pending.length > MAX_JSONL_PARTIAL_BYTES || pending.length > MAX_JSONL_LINE_BYTES) {
              throw new AgentError('PROVIDER_OUTPUT_INVALID');
            }
          } catch (error) {
            fail(error instanceof AgentError ? error : new AgentError('PROVIDER_OUTPUT_INVALID', { cause: error }));
          }
        };
        child.stderr.on('data', onStderr);
        child.stdout.on('data', onStdout);
        return () => {
          child.stderr.removeListener('data', onStderr);
          child.stdout.removeListener('data', onStdout);
        };
      });
      if (pending.length !== 0 || result.exitCode !== 0) throw new AgentError('PROVIDER_OUTPUT_INVALID');
      return { ...result, stderr: stderr.toString('utf8') };
    },

    async launch(spec) {
      return start(spec);
    },
  });
}

module.exports = {
  CORE_ENVIRONMENT_KEYS,
  MAX_CAPTURE_BYTES,
  MAX_JSONL_LINE_BYTES,
  MAX_JSONL_PARTIAL_BYTES,
  createCliRunner,
  minimalEnvironment,
  resolveCommandCandidatesWithWhere,
};
