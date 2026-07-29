'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  MAX_CAPTURE_BYTES,
  createCliRunner,
  minimalEnvironment,
  resolveCommandCandidatesWithWhere,
} = require('../src/agent/cliRunner.js');

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
    resolveCommand: async (command) => path.win32.isAbsolute(command)
      ? command
      : `C:\\tools\\${command.replace(/\.exe$/i, '')}.exe`,
    terminateWindowsProcessTree: async () => {},
    ...overrides,
  });
  return { runner, calls, child };
}

test('launches a resolved exe without a shell and sends goals through stdin', async () => {
  const { runner, calls, child } = runnerHarness();
  await runner.capture({ command: 'codex.exe', args: ['--version'], goal: 'never put a goal in argv', timeoutMs: 1000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'C:\\tools\\codex.exe');
  assert.deepEqual(calls[0].args, ['--version']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.env.PATH !== undefined, true);
  assert.equal(calls[0].options.env.OPENAI_API_KEY, undefined);
  assert.equal(child.stdinValue, 'never put a goal in argv');
});

test('normalizes stdin EPIPE before writing can crash the main process', async () => {
  const child = fakeChild();
  child.stdin = new EventEmitter();
  child.stdin.end = () => {
    setImmediate(() => child.stdin.emit('error', Object.assign(new Error('closed'), {
      code: 'EPIPE',
    })));
  };
  const runner = createCliRunner({
    spawn: () => child,
    resolveCommand: async () => 'C:\\tools\\codex.exe',
    terminateWindowsProcessTree: async () => true,
  });
  await assert.rejects(
    runner.capture({
      command: 'codex.exe',
      args: [],
      goal: 'bounded goal',
      timeoutMs: 100,
    }),
    (error) => error?.code === 'COMMAND_FAILED',
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(child.stdin.listenerCount('error'), 0);
});

test('resolveCommandCandidatesWithWhere uses absolute where.exe with a bounded minimal environment and returns every candidate', async () => {
  const calls = [];
  const child = fakeChild();
  const pending = resolveCommandCandidatesWithWhere('codex.exe', {
    systemRoot: 'C:\\Windows',
    environment: {
      PATH: 'C:\\safe;;relative;D:\\tools',
      SYSTEMROOT: 'C:\\Windows',
      TOKEN_THAT_MUST_NOT_LEAK: 'secret',
    },
    spawn(command, args, options) {
      calls.push({ command, args, options });
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('C:\\Program Files\\OpenAI\\codex.exe\r\nD:\\OpenAI\\codex.exe\r\n'));
        child.emit('close', 0, null);
      });
      return child;
    },
  });

  assert.deepEqual(await pending, [
    'C:\\Program Files\\OpenAI\\codex.exe',
    'D:\\OpenAI\\codex.exe',
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'C:\\Windows\\System32\\where.exe');
  assert.deepEqual(calls[0].args, ['codex.exe']);
  assert.deepEqual(calls[0].options, {
    shell: false,
    windowsHide: true,
    env: {
      PATH: 'C:\\safe;D:\\tools',
      SYSTEMROOT: 'C:\\Windows',
    },
    cwd: 'C:\\Windows\\System32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
});

test('resolveCommandCandidatesWithWhere rejects unallowlisted names and unsafe where.exe output', async () => {
  let spawns = 0;
  for (const command of [
    null, 7, {}, '', 'codex', 'tool.exe', '.\\codex.exe', 'folder\\codex.exe', 'C:\\tools\\codex.exe',
    'codex.cmd', 'codex.bat',
  ]) {
    await assert.rejects(
      resolveCommandCandidatesWithWhere(command, { spawn() { spawns += 1; } }),
      (error) => error.code === 'CLI_NOT_INSTALLED',
    );
  }
  assert.equal(spawns, 0);

  for (const output of ['relative\\codex.exe\r\n', 'C:\\tools\\codex.cmd\r\n', '\r\n']) {
    const child = fakeChild();
    await assert.rejects(
      resolveCommandCandidatesWithWhere('codex.exe', {
        systemRoot: 'C:\\Windows',
        spawn() {
          setImmediate(() => {
            child.stdout.emit('data', Buffer.from(output));
            child.emit('close', 0, null);
          });
          return child;
        },
      }),
      (error) => error.code === 'CLI_NOT_INSTALLED',
    );
  }
});

test('resolveCommandCandidatesWithWhere fails closed when output exceeds its cap', async () => {
  const child = fakeChild();
  await assert.rejects(
    resolveCommandCandidatesWithWhere('codex.exe', {
      systemRoot: 'C:\\Windows',
      spawn() {
        setImmediate(() => {
          child.stdout.emit('data', Buffer.alloc(MAX_CAPTURE_BYTES + 1, 'x'));
          child.emit('close', 0, null);
        });
        return child;
      },
    }),
    (error) => error.code === 'CLI_NOT_INSTALLED',
  );
});

test('createCliRunner default resolver uses the injected spawn and safe where.exe options', async () => {
  const calls = [];
  const children = [fakeChild(), fakeChild()];
  const runner = createCliRunner({
    systemRoot: 'C:\\Windows',
    environment: { PATH: 'C:\\Windows\\System32', SYSTEMROOT: 'C:\\Windows' },
    spawn(command, args, options) {
      const child = children[calls.length];
      calls.push({ command, args, options });
      setImmediate(() => {
        if (calls.length === 1) child.stdout.emit('data', Buffer.from('C:\\official\\codex.exe\r\n'));
        child.emit('close', 0, null);
      });
      return child;
    },
    terminateWindowsProcessTree: async () => {},
  });

  const result = await runner.capture({ command: 'codex.exe', args: ['--version'] });
  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    command: 'C:\\Windows\\System32\\where.exe',
    args: ['codex.exe'],
    options: {
      shell: false,
      windowsHide: true,
      env: { PATH: 'C:\\Windows\\System32', SYSTEMROOT: 'C:\\Windows' },
      cwd: 'C:\\Windows\\System32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  });
  assert.equal(calls[1].command, 'C:\\official\\codex.exe');
  assert.equal(calls[1].options.shell, false);
  assert.equal(calls[1].options.windowsHide, true);
});

test('createCliRunner rejects relative and cmd resolver results before spawning', async () => {
  for (const resolved of ['codex.exe', 'C:\\tools\\codex.cmd', 'C:\\tools\\codex.bat']) {
    let spawned = false;
    const runner = createCliRunner({
      resolveCommand: async () => resolved,
      spawn() { spawned = true; },
    });
    await assert.rejects(
      runner.capture({ command: 'codex.exe', args: [] }),
      (error) => error.code === 'CLI_NOT_INSTALLED',
    );
    assert.equal(spawned, false);
  }
});

test('visible launch is the only path that sets windowsHide false', async () => {
  const { runner, calls } = runnerHarness();
  await runner.launch({ command: 'codex.exe', args: ['login'], visible: true });
  assert.equal(calls[0].options.windowsHide, false);

  const hidden = runnerHarness();
  await hidden.runner.launch({ command: 'codex.exe', args: ['login'], visible: 1 });
  assert.equal(hidden.calls[0].options.windowsHide, true);
});

test('launchLease creates the child with the resolved command and cliRunner launch options', async () => {
  const leaseChild = fakeChild();
  const leaseCalls = [];
  const runner = createCliRunner({
    resolveCommand: async () => { throw new Error('a verified lease command must not use PATH resolution'); },
    spawn() { throw new Error('direct spawn must not run while a launch lease is supplied'); },
    terminateWindowsProcessTree: async () => {},
  });
  const launchLease = {
    async launch(spec) {
      leaseCalls.push(spec);
      setImmediate(() => leaseChild.emit('close', 0, null));
      return leaseChild;
    },
  };

  const result = await runner.capture({
    command: 'C:\\official\\codex.exe', args: ['--version'], visible: true, launchLease,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(leaseCalls, [{
    command: 'C:\\official\\codex.exe',
    args: ['--version'],
    options: {
      cwd: undefined,
      env: minimalEnvironment(),
      shell: false,
      windowsHide: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  }]);
});

test('capture recovers buffered output and terminal state when a leased child closes before launch resolves', async () => {
  const child = fakeChild();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  const terminations = [];
  const runner = createCliRunner({
    resolveCommand: async () => { throw new Error('lease command must not resolve through PATH'); },
    spawn() { throw new Error('direct spawn must not run'); },
    terminateWindowsProcessTree: async (spec) => { terminations.push(spec); },
  });
  const launchLease = {
    async launch() {
      child.stdout.end('buffered stdout');
      child.stderr.end('buffered stderr');
      child.exitCode = 7;
      child.emit('close', 7, null);
      await Promise.resolve();
      return child;
    },
  };

  const result = await runner.capture({
    command: 'C:\\official\\codex.exe', args: ['--version'], launchLease, timeoutMs: 50,
  });
  assert.deepEqual(result, {
    exitCode: 7,
    signal: null,
    stdout: 'buffered stdout',
    stderr: 'buffered stderr',
  });
  assert.deepEqual(terminations, []);
  assert.equal(child.listenerCount('close'), 0);
  assert.equal(child.listenerCount('error'), 0);
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
  assert.deepEqual(kills, [{ pid: 1234, execFile: 'C:\\tools\\tool.exe', waitForExit: undefined }]);
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
    assert.deepEqual(kills, [{ pid: 1234, execFile: 'C:\\tools\\tool.exe', waitForExit: undefined }]);
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

test('default cliRunner resolves and captures the real System32 where.exe', { skip: process.platform !== 'win32' }, async () => {
  const runner = createCliRunner();
  const result = await runner.capture({ command: 'where.exe', args: ['where.exe'], timeoutMs: 5000 });
  const firstLine = result.stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
  assert.equal(result.exitCode, 0);
  assert.equal(path.win32.isAbsolute(firstLine), true);
  assert.equal(path.win32.extname(firstLine).toLowerCase(), '.exe');
});
