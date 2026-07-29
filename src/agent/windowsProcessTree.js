'use strict';

const { spawn: defaultSpawn } = require('node:child_process');
const path = require('node:path');

const { AgentError } = require('./agentErrors.js');

function commandResult(child, { capture = false, maximumBytes = 4096 } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0);
    const onData = (chunk) => {
      if (!capture) return;
      stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
      if (stdout.length > maximumBytes) reject(new Error('Process inspection output exceeded its bound'));
    };
    child.stdout?.on?.('data', onData);
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout: stdout.toString('utf8') }));
  });
}

async function defaultWaitForExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function systemTool(systemRoot, name) {
  if (typeof systemRoot !== 'string' || !path.win32.isAbsolute(systemRoot)
      || systemRoot.includes('\0')) throw new AgentError('COMMAND_FAILED');
  return path.win32.join(systemRoot, 'System32', name);
}

async function defaultInspectProcess(pid, {
  spawn = defaultSpawn,
  systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT,
} = {}) {
  const powershell = path.win32.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const helper = path.join(__dirname, '..', '..', 'resources', 'windows', 'inspect-process.ps1');
  const child = spawn(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned',
    '-File', helper, '-ProcessId', String(pid),
  ], {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const result = await commandResult(child, { capture: true });
  if (result.code !== 0) throw new AgentError('COMMAND_FAILED');
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch (error) {
    throw new AgentError('COMMAND_FAILED', { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || typeof parsed.exists !== 'boolean'
      || (parsed.exists && (typeof parsed.executablePath !== 'string'
        || !path.win32.isAbsolute(parsed.executablePath)))
      || (!parsed.exists && parsed.executablePath !== null)) {
    throw new AgentError('COMMAND_FAILED');
  }
  return parsed;
}

function sameExecutable(left, right) {
  return path.win32.normalize(left).toLowerCase()
    === path.win32.normalize(right).toLowerCase();
}

async function terminateWindowsProcessTree({
  pid,
  execFile,
  grandchildPids = [],
  waitForExit = defaultWaitForExit,
  spawn = defaultSpawn,
  inspectProcess = defaultInspectProcess,
  systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT,
} = {}) {
  if (!Number.isInteger(pid) || pid <= 0 || typeof execFile !== 'string'
      || !path.win32.isAbsolute(execFile) || typeof inspectProcess !== 'function') {
    throw new AgentError('COMMAND_FAILED');
  }
  let identity;
  try {
    identity = await inspectProcess(pid);
  } catch (error) {
    throw error instanceof AgentError
      ? error
      : new AgentError('COMMAND_FAILED', { cause: error });
  }
  if (!identity?.exists) return true;
  if (!sameExecutable(identity.executablePath, execFile)) {
    throw new AgentError('COMMAND_FAILED');
  }

  const child = spawn(systemTool(systemRoot, 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], {
    shell: false,
    windowsHide: true,
  });
  let exitCode;
  try {
    exitCode = (await commandResult(child)).code;
  } catch (error) {
    throw new AgentError('COMMAND_FAILED', { cause: error });
  }
  if (exitCode !== 0) {
    const current = await inspectProcess(pid);
    if (!current?.exists) return true;
    throw new AgentError('COMMAND_FAILED');
  }

  for (const processId of [pid, ...grandchildPids]) {
    if (!Number.isInteger(processId) || processId <= 0 || !(await waitForExit(processId))) {
      throw new AgentError('COMMAND_FAILED');
    }
  }
  return true;
}

module.exports = {
  defaultInspectProcess,
  terminateWindowsProcessTree,
};
