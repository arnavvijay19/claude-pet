'use strict';

const { spawn: defaultSpawn } = require('node:child_process');
const { AgentError } = require('./agentErrors.js');

function commandResult(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
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

async function terminateWindowsProcessTree({
  pid,
  execFile,
  grandchildPids = [],
  waitForExit = defaultWaitForExit,
  spawn = defaultSpawn,
} = {}) {
  if (!Number.isInteger(pid) || pid <= 0) throw new AgentError('COMMAND_FAILED');
  void execFile;
  const child = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    shell: false,
    windowsHide: true,
  });
  let exitCode;
  try {
    exitCode = await commandResult(child);
  } catch (error) {
    throw new AgentError('COMMAND_FAILED', { cause: error });
  }
  if (exitCode !== 0) throw new AgentError('COMMAND_FAILED');

  for (const processId of [pid, ...grandchildPids]) {
    if (!Number.isInteger(processId) || processId <= 0 || !(await waitForExit(processId))) {
      throw new AgentError('COMMAND_FAILED');
    }
  }
  return true;
}

module.exports = { terminateWindowsProcessTree };
