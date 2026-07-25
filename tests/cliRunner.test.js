'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createCliRunner } = require('../src/agent/cliRunner.js');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end(value) { child.stdinValue = value; } };
  child.pid = 1234;
  return child;
}

function runnerHarness(overrides = {}) {
  const calls = [];
  const child = fakeChild();
  const runner = createCliRunner({
    spawn(command, args, options) {
      calls.push({ command, args, options });
      setImmediate(() => child.emit('close', 0, null));
      return child;
    },
    resolveCommand: async (command) => command === 'codex' ? 'C:\\tools\\codex.cmd' : command,
    terminateWindowsProcessTree: async () => {},
    ...overrides,
  });
  return { runner, calls, child };
}

test('resolves .cmd commands without a shell except where Windows requires it and sends goals through stdin', async () => {
  const { runner, calls, child } = runnerHarness();
  await runner.capture({ command: 'codex', args: ['--version'], goal: 'never put a goal in argv', timeoutMs: 1000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'C:\\tools\\codex.cmd');
  assert.deepEqual(calls[0].args, ['--version']);
  assert.equal(calls[0].options.shell, true);
  assert.equal(calls[0].options.env.PATH !== undefined, true);
  assert.equal(calls[0].options.env.OPENAI_API_KEY, undefined);
  assert.equal(child.stdinValue, 'never put a goal in argv');
});

test('capture retains no more than one MiB of stdout or stderr', async () => {
  const child = fakeChild();
  const { runner } = runnerHarness({
    spawn() {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.alloc(1024 * 1024 + 100, 'a'));
        child.stderr.emit('data', Buffer.alloc(1024 * 1024 + 100, 'b'));
        child.emit('close', 0, null);
      });
      return child;
    },
  });
  const result = await runner.capture({ command: 'tool', args: [] });
  assert.equal(Buffer.byteLength(result.stdout), 1024 * 1024);
  assert.equal(Buffer.byteLength(result.stderr), 1024 * 1024);
});

test('streamJsonl decodes split chunks, streams every valid record, and has no cumulative output cap', async () => {
  const child = fakeChild();
  const { runner } = runnerHarness({
    spawn() {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('{"message":"caf'));
        child.stdout.emit('data', Buffer.from([0xc3]));
        child.stdout.emit('data', Buffer.from([0xa9, 0x22, 0x7d, 0x0a]));
        for (let index = 0; index < 140000; index += 1) child.stdout.emit('data', Buffer.from('{"n":1}\n'));
        child.emit('close', 0, null);
      });
      return child;
    },
  });
  const events = [];
  await runner.streamJsonl({ command: 'tool', args: [] }, (event) => events.push(event));
  assert.equal(events[0].message, 'caf\u00e9');
  assert.equal(events.length, 140001);
});

test('streamJsonl rejects oversized JSONL records and undecoded partial buffers', async () => {
  for (const size of [65537, 131073]) {
    const child = fakeChild();
    const { runner } = runnerHarness({
      spawn() {
        setImmediate(() => {
          child.stdout.emit('data', Buffer.alloc(size, 'x'));
          child.emit('close', 0, null);
        });
        return child;
      },
    });
    await assert.rejects(
      runner.streamJsonl({ command: 'tool', args: [] }, () => {}),
      (error) => error.code === 'PROVIDER_OUTPUT_INVALID',
    );
  }
});

test('streamJsonl immediately terminates a still-running process after invalid JSONL', async () => {
  const child = fakeChild();
  const kills = [];
  const signal = {
    aborted: false,
    listeners: new Set(),
    addEventListener(type, listener) { if (type === 'abort') this.listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'abort') this.listeners.delete(listener); },
  };
  const { runner } = runnerHarness({
    spawn() {
      setImmediate(() => child.stdout.emit('data', Buffer.from('{not-json}\n')));
      return child;
    },
    terminateWindowsProcessTree: async (spec) => { kills.push(spec); },
  });

  await assert.rejects(
    runner.streamJsonl({ command: 'tool', args: [], timeoutMs: 1000, signal }, () => {}),
    (error) => error.code === 'PROVIDER_OUTPUT_INVALID',
  );
  assert.deepEqual(kills, [{ pid: 1234, execFile: 'tool', waitForExit: undefined }]);
  assert.equal(signal.listeners.size, 0);
});

test('streamJsonl returns no more than one MiB of stderr', async () => {
  const child = fakeChild();
  const { runner } = runnerHarness({
    spawn() {
      setImmediate(() => {
        child.stderr.emit('data', Buffer.alloc(1024 * 1024 + 100, 'e'));
        child.emit('close', 0, null);
      });
      return child;
    },
  });

  const result = await runner.streamJsonl({ command: 'tool', args: [] }, () => {});
  assert.equal(Buffer.byteLength(result.stderr), 1024 * 1024);
});

test('timeout and abort terminate the complete Windows tree and remove listeners', async () => {
  for (const mode of ['timeout', 'abort']) {
    const child = fakeChild();
    const kills = [];
    const signal = {
      aborted: false,
      listeners: new Set(),
      addEventListener(type, listener) { if (type === 'abort') this.listeners.add(listener); },
      removeEventListener(type, listener) { if (type === 'abort') this.listeners.delete(listener); },
      abort() { this.aborted = true; for (const listener of [...this.listeners]) listener(); },
    };
    const { runner } = runnerHarness({
      spawn() { return child; },
      terminateWindowsProcessTree: async (spec) => { kills.push(spec); },
    });
    const pending = runner.capture({ command: 'tool', args: [], timeoutMs: mode === 'timeout' ? 1 : 1000, signal });
    if (mode === 'abort') signal.abort();
    await assert.rejects(pending, (error) => error.code === (mode === 'timeout' ? 'REQUEST_TIMEOUT' : 'RUN_STOPPED'));
    assert.deepEqual(kills, [{ pid: 1234, execFile: 'tool', waitForExit: undefined }]);
    assert.equal(signal.listeners.size, 0);
  }
});

test('aborting cliRunner terminates a real Windows child and grandchild process tree', { skip: process.platform !== 'win32' }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-runner-tree-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const childPidPath = path.join(directory, 'child.pid');
  const grandchildPidPath = path.join(directory, 'grandchild.pid');
  const fixtures = path.join(__dirname, 'fixtures');
  const controller = new AbortController();
  const grandchildPids = [];
  const runner = createCliRunner({ resolveCommand: async () => process.execPath });
  const pending = runner.capture({
    command: 'node',
    args: [
      path.join(fixtures, 'processTreeChild.js'), childPidPath, grandchildPidPath,
      path.join(fixtures, 'processTreeGrandchild.js'),
    ],
    signal: controller.signal,
    grandchildPids,
    timeoutMs: 5000,
  });
  const readPid = async (filePath) => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { return Number(await fs.readFile(filePath, 'utf8')); } catch { await new Promise((resolve) => setTimeout(resolve, 25)); }
    }
    throw new Error('Timed out waiting for fixture PID.');
  };
  const childPid = await readPid(childPidPath);
  grandchildPids.push(await readPid(grandchildPidPath));
  controller.abort();

  await assert.rejects(pending, (error) => error.code === 'RUN_STOPPED');
  for (const pid of [childPid, ...grandchildPids]) {
    assert.throws(() => process.kill(pid, 0), (error) => error.code === 'ESRCH');
  }
});
