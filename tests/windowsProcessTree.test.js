'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { terminateWindowsProcessTree } = require('../src/agent/windowsProcessTree.js');

test('invokes taskkill without a shell and proves child and recorded grandchild exit', async () => {
  const calls = [];
  let exits = 0;
  const result = await terminateWindowsProcessTree({
    pid: 321,
    execFile: 'C:\\tool.exe',
    systemRoot: 'C:\\Windows',
    inspectProcess: async () => ({ exists: true, executablePath: 'c:\\TOOL.exe' }),
    grandchildPids: [654],
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { once(event, callback) { if (event === 'close') queueMicrotask(() => callback(0)); } };
    },
    waitForExit: async () => { exits += 1; return true; },
  });
  assert.equal(result, true);
  assert.deepEqual(calls, [{
    command: 'C:\\Windows\\System32\\taskkill.exe',
    args: ['/PID', '321', '/T', '/F'],
    options: { shell: false, windowsHide: true },
  }]);
  assert.equal(exits, 2);
});

test('does not target an exited or identity-mismatched reused PID', async () => {
  let spawns = 0;
  assert.equal(await terminateWindowsProcessTree({
    pid: 321,
    execFile: 'C:\\tools\\provider.exe',
    inspectProcess: async () => ({ exists: false, executablePath: null }),
    spawn: () => { spawns += 1; },
  }), true);
  await assert.rejects(
    terminateWindowsProcessTree({
      pid: 321,
      execFile: 'C:\\tools\\provider.exe',
      inspectProcess: async () => ({
        exists: true,
        executablePath: 'C:\\unrelated\\replacement.exe',
      }),
      spawn: () => { spawns += 1; },
    }),
    (error) => error?.code === 'COMMAND_FAILED',
  );
  assert.equal(spawns, 0);
});

test('fails when taskkill fails or either observed process remains alive', async () => {
  await assert.rejects(
    terminateWindowsProcessTree({
      pid: 321,
      execFile: 'C:\\tool.exe',
      systemRoot: 'C:\\Windows',
      inspectProcess: async () => ({ exists: true, executablePath: 'C:\\tool.exe' }),
      spawn() { return { once(event, callback) { if (event === 'close') queueMicrotask(() => callback(1)); } }; },
      waitForExit: async () => true,
    }),
    (error) => error.code === 'COMMAND_FAILED',
  );
  await assert.rejects(
    terminateWindowsProcessTree({
      pid: 321, execFile: 'C:\\tool.exe', grandchildPids: [654],
      systemRoot: 'C:\\Windows',
      inspectProcess: async () => ({ exists: true, executablePath: 'C:\\tool.exe' }),
      spawn() { return { once(event, callback) { if (event === 'close') queueMicrotask(() => callback(0)); } }; },
      waitForExit: async (pid) => pid !== 654,
    }),
    (error) => error.code === 'COMMAND_FAILED',
  );
});

test('terminates a real Windows child and grandchild process tree', { skip: process.platform !== 'win32' }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-process-tree-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const childPidPath = path.join(directory, 'child.pid');
  const grandchildPidPath = path.join(directory, 'grandchild.pid');
  const fixtures = path.join(__dirname, 'fixtures');
  const child = spawn(process.execPath, [
    path.join(fixtures, 'processTreeChild.js'), childPidPath, grandchildPidPath,
    path.join(fixtures, 'processTreeGrandchild.js'),
  ], { stdio: 'ignore', windowsHide: true });
  t.after(() => { try { child.kill(); } catch {} });
  const readPid = async (filePath) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { return Number(await fs.readFile(filePath, 'utf8')); } catch { await new Promise((resolve) => setTimeout(resolve, 25)); }
    }
    throw new Error('Timed out waiting for fixture PID.');
  };
  const childPid = await readPid(childPidPath);
  const grandchildPid = await readPid(grandchildPidPath);
  const waitForExit = async (pid) => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return true; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  };
  assert.equal(await terminateWindowsProcessTree({ pid: childPid, execFile: process.execPath, grandchildPids: [grandchildPid], waitForExit }), true);
});
