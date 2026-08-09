'use strict';

// Node-side adapter that launches the Windows provider-job helper (`provider-job-host.exe`)
// and returns a retained helper identity. The helper owns a private non-breakaway Job Object,
// starts each verified native provider suspended, assigns it before resume, and proves cleanup
// only for processes in that job. This module never falls back to direct provider spawn,
// taskkill, descendant PID lists, or WMI when helper launch or job assignment fails; it surfaces
// a clear failure instead.
//
// Runtime constraints honoured:
//   * no PowerShell, Add-Type, downloaded packages, or compilers at runtime
//   * provider inherits only its stdin/stdout/stderr pipe handles
//   * goals/credentials are never placed in arguments, the envelope, or the environment

const { spawn: defaultSpawn } = require('node:child_process');
const path = require('node:path');
const { AgentError } = require('./agentErrors.js');

const JOB_PROTOCOL_VERSION = 1;
const MAX_ENVELOPE_BYTES = 65536;
const MAX_READY_BYTES = 128;
const MAX_READY_TIMEOUT_MS = 30000;
const READY_LINE = Buffer.from('CLAUDE_PET_JOB_READY 1\r\n', 'ascii');

const MAX_COMPONENT_BYTES = 32768;
const MAX_ARGS = 256;
const MAX_ENV_ENTRIES = 256;
const SPAWN_OPTION_KEYS = Object.freeze(['cwd', 'env', 'shell', 'stdio', 'windowsHide']);

function exactOwnKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function resolveHelperPath() {
  return path.join(__dirname, '..', '..', 'resources', 'windows', 'generated', 'provider-job-host.exe');
}

// Returns true only for the exact readiness record; never for a malformed/duplicate frame.
function parseReadiness(input) {
  const text = Buffer.isBuffer(input) ? input.toString('latin1') : String(input == null ? '' : input);
  let line = text;
  const newline = line.indexOf('\n');
  if (newline !== -1) line = line.slice(0, newline);
  if (line.endsWith('\r')) line = line.slice(0, -1);
  return line === 'CLAUDE_PET_JOB_READY 1';
}

function buildLaunchEnvelope({
  command,
  args,
  options,
  ownerPid,
  ownerExecutable,
}) {
  if (typeof command !== 'string'
      || command.length === 0
      || !path.win32.isAbsolute(command)
      || command.includes('\0')
      || !command.toLowerCase().endsWith('.exe')
      || Buffer.byteLength(command, 'utf8') > MAX_COMPONENT_BYTES) {
    throw new AgentError('COMMAND_FAILED');
  }
  if (!Array.isArray(args)
      || args.length > MAX_ARGS
      || args.some((argument) => (
        typeof argument !== 'string'
        || argument.includes('\0')
        || Buffer.byteLength(argument, 'utf8') > MAX_COMPONENT_BYTES
      ))) {
    throw new AgentError('COMMAND_FAILED');
  }
  if (!exactOwnKeys(options, SPAWN_OPTION_KEYS)
      || options.shell !== false
      || typeof options.windowsHide !== 'boolean'
      || !Array.isArray(options.stdio)
      || options.stdio.length !== 3
      || options.stdio.some((value) => value !== 'pipe')
      || !(options.cwd === undefined
        || (typeof options.cwd === 'string'
          && path.win32.isAbsolute(options.cwd)
          && !options.cwd.includes('\0')))
      || typeof options.env !== 'object'
      || options.env === null
      || Array.isArray(options.env)) {
    throw new AgentError('COMMAND_FAILED');
  }
  const envEntries = Object.entries(options.env);
  if (envEntries.length > MAX_ENV_ENTRIES
      || envEntries.some(([key, value]) => (
        !/^[A-Za-z_][A-Za-z0-9_()]*$/.test(key)
        || typeof value !== 'string'
        || value.includes('\0')
        || Buffer.byteLength(value, 'utf8') > MAX_COMPONENT_BYTES
      ))) {
    throw new AgentError('COMMAND_FAILED');
  }
  if (!Number.isInteger(ownerPid) || ownerPid <= 0
      || typeof ownerExecutable !== 'string'
      || ownerExecutable.length === 0
      || ownerExecutable.includes('\0')
      || Buffer.byteLength(ownerExecutable, 'utf8') > MAX_COMPONENT_BYTES) {
    throw new AgentError('COMMAND_FAILED');
  }

  // The envelope deliberately omits `env`: the provider inherits the helper's already-bounded
  // environment exactly (passed to spawn as `options.env`). Goals/credentials never enter it.
  const envelope = {
    protocolVersion: JOB_PROTOCOL_VERSION,
    command,
    args: [...args],
    cwd: typeof options.cwd === 'string' ? options.cwd : '',
    visible: options.windowsHide === false,
    ownerPid,
    ownerExecutable,
  };
  const serialized = JSON.stringify(envelope);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_ENVELOPE_BYTES) {
    throw new AgentError('COMMAND_FAILED');
  }
  return Buffer.from(`${serialized}\n`, 'utf8');
}

function createWindowsJobProcessLauncher({
  spawn = defaultSpawn,
  helperPath = resolveHelperPath(),
  ownerPid = process.pid,
  ownerExecutable = path.win32.basename(process.execPath),
  readyTimeoutMs = MAX_READY_TIMEOUT_MS,
} = {}) {
  const normalizedHelperPath = path.win32.normalize(helperPath);
  if (!path.win32.isAbsolute(normalizedHelperPath)) {
    throw new AgentError('COMMAND_FAILED');
  }
  const boundedTimeout = Number.isFinite(readyTimeoutMs) && readyTimeoutMs > 0
    ? Math.min(readyTimeoutMs, MAX_READY_TIMEOUT_MS)
    : MAX_READY_TIMEOUT_MS;

  // Collects exactly the first stderr line as the readiness frame, then stops. Any bytes that
  // arrived after the marker are returned so the caller can restore provider stderr intact.
  function consumeReadiness(child, timeoutMs) {
    return new Promise((resolve, reject) => {
      let pending = Buffer.alloc(0);
      let timer = null;
      let settled = false;
      const cleanup = () => {
        child.stderr.removeListener('data', onData);
        child.stderr.removeListener('error', onError);
        child.removeListener('close', onClose);
        if (timer !== null) clearTimeout(timer);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof AgentError ? error : new AgentError('COMMAND_FAILED', { cause: error }));
      };
      const onData = (chunk) => {
        if (settled) return;
        const source = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (pending.length >= MAX_READY_BYTES) return fail(new AgentError('COMMAND_FAILED'));
        pending = Buffer.concat([pending, source]);
        const newline = pending.indexOf(0x0A);
        if (newline === -1) {
          if (pending.length > MAX_READY_BYTES) fail(new AgentError('COMMAND_FAILED'));
          return;
        }
        if (pending.subarray(0, newline).length > MAX_READY_BYTES) {
          return fail(new AgentError('COMMAND_FAILED'));
        }
        if (!parseReadiness(pending.subarray(0, newline))) {
          return fail(new AgentError('COMMAND_FAILED'));
        }
        const leftover = pending.subarray(newline + 1);
        settled = true;
        cleanup();
        child.stderr.pause();
        resolve({ leftover });
      };
      const onError = () => fail(new AgentError('COMMAND_FAILED'));
      const onClose = () => fail(new AgentError('COMMAND_FAILED'));
      child.stderr.on('data', onData);
      child.stderr.on('error', onError);
      child.once('close', onClose);
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(() => fail(new AgentError('COMMAND_FAILED')), timeoutMs);
      }
    });
  }

  async function launch({ command, args, options } = {}) {
    const envelope = buildLaunchEnvelope({ command, args, options, ownerPid, ownerExecutable });

    let child;
    try {
      child = spawn(normalizedHelperPath, [], {
        cwd: path.win32.dirname(normalizedHelperPath),
        env: options.env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new AgentError('COMMAND_FAILED', { cause: error });
    }

    // Begin readiness collection before writing the envelope, then write it exactly once.
    const readiness = consumeReadiness(child, boundedTimeout);
    let writeError = null;
    try {
      if (!child.stdin.write(envelope)) {
        await new Promise((resolve) => child.stdin.once('drain', resolve));
      }
    } catch (error) {
      writeError = error;
    }

    let leftover = Buffer.alloc(0);
    let readinessError = null;
    try {
      ({ leftover } = await readiness);
    } catch (error) {
      readinessError = error;
    }

    if (writeError || readinessError) {
      // Surface a clear failure: destroy stdin, kill only the helper we started, wait for close.
      try { child.stdin.destroy(); } catch {}
      try { child.kill(); } catch {}
      await new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once('close', () => resolve());
      });
      throw new AgentError('COMMAND_FAILED', { cause: readinessError || writeError });
    }

    // Restore any provider-stderr bytes captured after the readiness marker, then resume so the
    // caller can read them (and all later provider output). The caller attaches its stderr
    // listener in the microtask right after this launch promise resolves, before the restored
    // bytes flush on the next I/O tick. We never surface a bare spawn event as assignment, and
    // providerAssigned is set only after this exact readiness.
    if (leftover.length > 0) child.stderr.unshift(leftover);
    child.stderr.resume();

    return Object.freeze({
      child,
      execFile: normalizedHelperPath,
      providerAssigned: true,
    });
  }

  return Object.freeze({ launch });
}

module.exports = {
  JOB_PROTOCOL_VERSION,
  MAX_ENVELOPE_BYTES,
  MAX_READY_BYTES,
  MAX_READY_TIMEOUT_MS,
  READY_LINE,
  createWindowsJobProcessLauncher,
  resolveHelperPath,
  buildLaunchEnvelope,
  parseReadiness,
};
