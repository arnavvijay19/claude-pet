'use strict';

const { spawn: defaultSpawn } = require('node:child_process');
const { AgentError } = require('./agentErrors.js');
const { terminateWindowsProcessTree: defaultTerminateWindowsProcessTree } = require('./windowsProcessTree.js');

const MAX_CAPTURE_BYTES = 1024 * 1024;
const MAX_JSONL_LINE_BYTES = 65536;
const MAX_JSONL_PARTIAL_BYTES = 131072;
const CORE_ENVIRONMENT_KEYS = Object.freeze([
  'APPDATA', 'COMSPEC', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'PATH', 'PATHEXT',
  'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR',
]);

function cappedBufferAppend(current, chunk, maximum) {
  const source = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  if (current.length >= maximum) return current;
  return Buffer.concat([current, source.subarray(0, maximum - current.length)]);
}

function minimalEnvironment(overrides = {}) {
  const environment = {};
  for (const key of CORE_ENVIRONMENT_KEYS) {
    if (typeof process.env[key] === 'string') environment[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(overrides || {})) {
    if (typeof value === 'string') environment[key] = value;
  }
  return environment;
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });
}

function resolveWithWhere(command) {
  if (/[\\/]/.test(command)) return Promise.resolve(command);
  return new Promise((resolve, reject) => {
    const child = defaultSpawn('where.exe', [command], {
      shell: false,
      windowsHide: spec.visible !== true,
      env: minimalEnvironment(),
    });
    let output = Buffer.alloc(0);
    child.stdout.on('data', (chunk) => { output = cappedBufferAppend(output, chunk, MAX_CAPTURE_BYTES); });
    child.once('error', reject);
    child.once('close', (exitCode) => {
      const first = output.toString('utf8').split(/\r?\n/).find(Boolean);
      if (exitCode !== 0 || !first) reject(new AgentError('CLI_NOT_INSTALLED'));
      else resolve(first.trim());
    });
  });
}

function createCliRunner({
  spawn = defaultSpawn,
  resolveCommand = resolveWithWhere,
  terminateWindowsProcessTree = defaultTerminateWindowsProcessTree,
} = {}) {
  async function start(spec = {}) {
    if (typeof spec.command !== 'string' || spec.command.length === 0 || !Array.isArray(spec.args)) {
      throw new AgentError('COMMAND_FAILED');
    }
    let command;
    try {
      command = await resolveCommand(spec.command);
    } catch (error) {
      if (error instanceof AgentError) throw error;
      throw new AgentError('CLI_NOT_INSTALLED', { cause: error });
    }
    if (typeof command !== 'string' || command.length === 0) throw new AgentError('CLI_NOT_INSTALLED');
    const child = spawn(command, spec.args.map(String), {
      cwd: typeof spec.cwd === 'string' ? spec.cwd : undefined,
      env: minimalEnvironment(spec.env),
      shell: command.toLowerCase().endsWith('.cmd'),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (typeof spec.goal === 'string') child.stdin.end(spec.goal);
    else child.stdin.end();
    return { child, command };
  }

  async function execute(spec, onData) {
    const { child, command } = await start(spec);
    let finished = false;
    let timeout = null;
    let rejectExecution;
    let dataCleanup = null;
    const signal = spec.signal;
    const finishCleanup = () => {
      if (timeout !== null) clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', onAbort);
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
      if (Number.isFinite(spec.timeoutMs) && spec.timeoutMs > 0) {
        timeout = setTimeout(() => { void stop('REQUEST_TIMEOUT'); }, spec.timeoutMs);
      }
      child.once('error', (error) => {
        if (finished) return;
        finished = true;
        finishCleanup();
        reject(new AgentError('COMMAND_FAILED', { cause: error }));
      });
      child.once('close', (exitCode, childSignal) => {
        if (finished) return;
        finished = true;
        finishCleanup();
        resolve({ exitCode, signal: childSignal });
      });
      dataCleanup = onData(child, (error) => {
        void stop(error instanceof AgentError ? error : new AgentError('COMMAND_FAILED', { cause: error }));
      }) || null;
    });
    return result;
  }

  return Object.freeze({
    async capture(spec) {
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      const result = await execute(spec, (child) => {
        child.stdout.on('data', (chunk) => { stdout = cappedBufferAppend(stdout, chunk, MAX_CAPTURE_BYTES); });
        child.stderr.on('data', (chunk) => { stderr = cappedBufferAppend(stderr, chunk, MAX_CAPTURE_BYTES); });
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
};
