'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AgentError } = require('../src/agent/agentErrors.js');
const { createCliRunner } = require('../src/agent/cliRunner.js');

const {
  createNativeCliInspectionHelper,
  inspectNativeCliCandidate,
  openVerifiedNativeCliLaunchLease,
} = require('../src/agent/nativeCliLaunchLease.js');

const CANONICAL_PATH = 'C:\\Program Files\\OpenAI\\Codex\\codex.exe';
const BINDING = Object.freeze({
  path: CANONICAL_PATH,
  sha256: '6f20fdd8b66ce9e1a00c29b0d77e5099871540499b269d4a564929b9813a3f2f',
  volumeSerial: 'A1B2C3D4',
  fileId: '0011223344556677',
  version: '0.145.0',
  publisher: 'OpenAI OpCo, LLC',
});
const CODEX_PROFILE = 'C:\\Users\\tester';
const CODEX_LEXICAL_BIN = `${CODEX_PROFILE}\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin`;
const CODEX_CURRENT = `${CODEX_PROFILE}\\.codex\\packages\\standalone\\current`;
const CODEX_RELEASE_ROOT = `${CODEX_PROFILE}\\.codex\\packages\\standalone\\releases`;
const CODEX_RELEASE_SUFFIX = '-x86_64-pc-windows-msvc';
const CODEX_RELEASE = `${CODEX_PROFILE}\\.codex\\packages\\standalone\\releases\\0.145.0-x86_64-pc-windows-msvc`;
const CODEX_FUTURE_RELEASE = `${CODEX_RELEASE_ROOT}\\0.146.0${CODEX_RELEASE_SUFFIX}`;
const CODEX_LEXICAL_CANDIDATE = `${CODEX_LEXICAL_BIN}\\codex.exe`;
const CODEX_FINAL_CANDIDATE = `${CODEX_RELEASE}\\bin\\codex.exe`;
const CODEX_FUTURE_CANDIDATE = `${CODEX_FUTURE_RELEASE}\\bin\\codex.exe`;
const CODEX_REPARSE_CHAIN = Object.freeze([
  Object.freeze({
    path: CODEX_LEXICAL_BIN,
    rawTarget: `${CODEX_CURRENT}\\bin`,
    type: 'junction',
  }),
  Object.freeze({
    path: CODEX_CURRENT,
    rawTarget: CODEX_RELEASE,
    type: 'junction',
  }),
]);
const CODEX_FUTURE_REPARSE_CHAIN = Object.freeze([
  CODEX_REPARSE_CHAIN[0],
  Object.freeze({
    path: CODEX_CURRENT,
    rawTarget: CODEX_FUTURE_RELEASE,
    type: 'junction',
  }),
]);
// Current OpenAI installer layout: installerBin is a single junction straight to release\bin.
const CODEX_SINGLE_REPARSE_CHAIN_FUTURE = Object.freeze([
  Object.freeze({
    path: CODEX_LEXICAL_BIN,
    rawTarget: `${CODEX_FUTURE_RELEASE}\\bin`,
    type: 'junction',
  }),
]);
const CODEX_RELEASE_POLICY = Object.freeze({
  minimumVersion: '0.145.0',
  blockedVersions: Object.freeze([]),
  releaseRoot: CODEX_RELEASE_ROOT,
  releaseSuffix: CODEX_RELEASE_SUFFIX,
  installerBin: CODEX_LEXICAL_BIN,
  standaloneCurrent: CODEX_CURRENT,
});
const FUTURE_BINDING = Object.freeze({
  ...BINDING,
  path: CODEX_FUTURE_CANDIDATE,
  sha256: '7'.repeat(64),
  fileId: '8899AABBCCDDEEFF',
  version: '0.146.0',
});

function validFacts(overrides = {}) {
  return Object.freeze({
    path: BINDING.path,
    regularFile: true,
    reparsePoint: false,
    reparseChain: Object.freeze([]),
    sha256: BINDING.sha256,
    volumeSerial: BINDING.volumeSerial,
    fileId: BINDING.fileId,
    fileVersion: '',
    publisher: BINDING.publisher,
    signatureValid: true,
    ...overrides,
  });
}

function holdingHelper(facts = validFacts(), requestedPath = BINDING.path) {
  const state = { held: false, openCalls: 0, releaseCalls: 0 };
  return {
    state,
    helper: {
      async open(candidatePath) {
        assert.equal(candidatePath, requestedPath);
        assert.equal(state.held, false);
        state.openCalls += 1;
        state.held = true;
        let released = false;
        return Object.freeze({
          facts,
          async release() {
            if (released) return;
            released = true;
            state.releaseCalls += 1;
            state.held = false;
          },
        });
      },
    },
  };
}

function childProcess() {
  const child = new EventEmitter();
  child.pid = 4242;
  return child;
}

function launchRequest(args = [], optionOverrides = {}) {
  return {
    command: BINDING.path,
    args,
    options: {
      cwd: 'C:\\workspace',
      env: { CODEX_HOME: 'C:\\private\\native-codex' },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...optionOverrides,
    },
  };
}

function verifiedRunner(state, overrides = {}) {
  return {
    async capture(spec) {
      assert.equal(state.held, true, 'the executable handle must cover the CLI version check');
      assert.equal(spec.command, BINDING.path);
      assert.deepEqual(spec.args, ['--version']);
      assert.equal(spec.timeoutMs, 5000);
      assert.equal(spec.options.cwd, path.win32.dirname(BINDING.path));
      assert.equal(spec.options.shell, false);
      assert.equal(spec.options.windowsHide, true);
      assert.deepEqual(spec.options.stdio, ['ignore', 'pipe', 'pipe']);
      return { exitCode: 0, signal: null, stdout: 'codex-cli 0.145.0\r\n', stderr: '' };
    },
    async launch(spec) {
      assert.equal(state.held, true, 'the executable handle must still be held when launch starts');
      const child = childProcess();
      setImmediate(() => child.emit('spawn'));
      return child;
    },
    ...overrides,
  };
}

test('each native operation holds one fresh lease through successful child creation and exposes no binding facts', async () => {
  const operationArgs = [
    ['--version'],
    ['login'],
    ['exec', '--json'],
    ['auth', 'status', '--json'],
  ];

  for (const args of operationArgs) {
    const { helper, state } = holdingHelper();
    const launchSpecs = [];
    const runner = verifiedRunner(state, {
      async launch(spec) {
        assert.equal(state.held, true);
        launchSpecs.push(spec);
        const child = childProcess();
        setImmediate(() => {
          assert.equal(state.held, true, 'the helper may not release before the child-created event');
          child.emit('spawn');
        });
        return child;
      },
    });

    const lease = await openVerifiedNativeCliLaunchLease(BINDING, { helper, runner });
    assert.deepEqual(Object.keys(lease).sort(), ['cleanup', 'launch']);
    assert.equal(Object.isFrozen(lease), true);
    assert.equal(state.held, true);

    const launched = await lease.launch(launchRequest(args));
    assert.equal(launched.pid, 4242);
    assert.equal(state.held, true);
    assert.equal(state.releaseCalls, 0);
    assert.equal(launchSpecs[0].command, BINDING.path);
    assert.deepEqual(launchSpecs[0].args, args);
    assert.deepEqual(launchSpecs[0].options, launchRequest(args).options);
    await lease.cleanup();
    assert.equal(state.held, false);
    assert.equal(state.releaseCalls, 1);
    await assert.rejects(lease.launch(launchRequest(args)), (error) => error.code === 'COMMAND_FAILED');
    assert.equal(state.releaseCalls, 1);
  }
});

test('a verified launch lease reuses a retained session without opening the helper again', async () => {
  const { helper, state } = holdingHelper();
  const session = await helper.open(BINDING.path);
  let helperOpens = 0;
  const lease = await openVerifiedNativeCliLaunchLease(BINDING, {
    session,
    helper: { async open() { helperOpens += 1; throw new Error('must not reopen'); } },
    runner: verifiedRunner(state),
  });

  assert.equal(helperOpens, 0);
  assert.equal(state.held, true);
  await lease.cleanup();
  assert.equal(state.held, false);
  assert.equal(state.releaseCalls, 1);
});

test('rejects post-discovery replacement or any changed final fact before executing the candidate', async () => {
  const replacements = [
    { path: 'C:\\Program Files\\OpenAI\\Codex\\replacement.exe' },
    { regularFile: false },
    { reparsePoint: true },
    { sha256: '0'.repeat(64) },
    { volumeSerial: 'DEADBEEF' },
    { fileId: '8899AABBCCDDEEFF' },
    { fileVersion: '0.146.0' },
    { publisher: 'Unknown Publisher' },
    { signatureValid: false },
  ];

  for (const replacement of replacements) {
    const { helper, state } = holdingHelper(validFacts(replacement));
    let executed = false;
    const runner = {
      async capture() { executed = true; },
      async launch() { executed = true; },
    };
    await assert.rejects(
      openVerifiedNativeCliLaunchLease(BINDING, { helper, runner }),
      (error) => error.code === 'CLI_NOT_INSTALLED'
        && !error.message.includes(BINDING.path)
        && !error.message.includes(BINDING.sha256),
    );
    assert.equal(executed, false);
    assert.equal(state.held, false);
    assert.equal(state.releaseCalls, 1);
  }
});

test('rejects a mismatched bounded CLI version while the handle is held and releases it', async () => {
  const { helper, state } = holdingHelper();
  const runner = verifiedRunner(state, {
    async capture() {
      assert.equal(state.held, true);
      return { exitCode: 0, stdout: 'codex-cli 0.145.0-malicious\n', stderr: '' };
    },
  });

  await assert.rejects(
    openVerifiedNativeCliLaunchLease(BINDING, { helper, runner }),
    (error) => error.code === 'CLI_NOT_INSTALLED' && !error.message.includes(BINDING.path),
  );
  assert.equal(state.held, false);
  assert.equal(state.releaseCalls, 1);
});

test('retains the verified inspection session for a later launch lease', async () => {
  const { helper, state } = holdingHelper(validFacts({ fileVersion: '' }));
  const retained = await inspectNativeCliCandidate(BINDING.path, {
    helper,
    expectedPublisher: BINDING.publisher,
    expectedVersion: BINDING.version,
    expectedReparseChain: [],
    retainSession: true,
    runner: {
      async capture() {
        assert.equal(state.held, true);
        return { exitCode: 0, stdout: 'codex-cli 0.145.0\n', stderr: '' };
      },
    },
  });

  assert.equal(retained.inspection.path, BINDING.path);
  assert.equal(retained.session?.facts.path, BINDING.path);
  assert.equal(state.held, true);
  assert.equal(state.releaseCalls, 0);
  await retained.session.release();
  assert.equal(state.held, false);
  assert.equal(state.releaseCalls, 1);
});

test('discovery derives Codex version from bounded CLI output while the blank-version PE handle is held', async () => {
  const { helper, state } = holdingHelper(validFacts({ fileVersion: '' }));
  let captures = 0;
  const inspection = await inspectNativeCliCandidate(BINDING.path, {
    helper,
    expectedPublisher: BINDING.publisher,
    expectedVersion: BINDING.version,
    runner: {
      async capture(spec) {
        captures += 1;
        assert.equal(state.held, true);
        assert.equal(spec.command, BINDING.path);
        assert.deepEqual(spec.args, ['--version']);
        assert.equal(spec.options.shell, false);
        assert.equal(spec.options.windowsHide, true);
        return { exitCode: 0, stdout: 'codex-cli 0.145.0\n', stderr: '' };
      },
    },
  });

  assert.equal(captures, 1);
  assert.equal(inspection.version, '0.145.0');
  assert.equal(Object.hasOwn(inspection, 'fileVersion'), false);
  assert.equal(state.held, false);
  assert.equal(state.releaseCalls, 1);

  const rejected = holdingHelper(validFacts({ publisher: 'Different Publisher' }));
  let untrustedExecuted = false;
  await assert.rejects(inspectNativeCliCandidate(BINDING.path, {
    helper: rejected.helper,
    expectedPublisher: BINDING.publisher,
    expectedVersion: BINDING.version,
    runner: { async capture() { untrustedExecuted = true; } },
  }), (error) => error.code === 'CLI_NOT_INSTALLED');
  assert.equal(untrustedExecuted, false);
  assert.equal(rejected.state.held, false);
});

test('dynamic Codex inspection derives a future version from the strict release while held', async () => {
  const facts = validFacts({
    path: FUTURE_BINDING.path,
    reparsePoint: true,
    reparseChain: CODEX_FUTURE_REPARSE_CHAIN,
    sha256: FUTURE_BINDING.sha256,
    fileId: FUTURE_BINDING.fileId,
    fileVersion: '',
  });
  const { helper, state } = holdingHelper(facts, CODEX_LEXICAL_CANDIDATE);
  const inspection = await inspectNativeCliCandidate(CODEX_LEXICAL_CANDIDATE, {
    helper,
    expectedPublisher: FUTURE_BINDING.publisher,
    codexReleasePolicy: CODEX_RELEASE_POLICY,
    runner: {
      async capture(spec) {
        assert.equal(state.held, true);
        assert.equal(spec.command, FUTURE_BINDING.path);
        assert.deepEqual(spec.args, ['--version']);
        return { exitCode: 0, stdout: 'codex-cli 0.146.0\n', stderr: '' };
      },
    },
  });

  assert.equal(inspection.path, FUTURE_BINDING.path);
  assert.equal(inspection.version, FUTURE_BINDING.version);
  assert.deepEqual(inspection.reparseChain, CODEX_FUTURE_REPARSE_CHAIN);
  assert.equal(state.held, false);
  assert.equal(state.releaseCalls, 1);
});

test('dynamic Codex inspection accepts the current single-junction release layout', async () => {
  const facts = validFacts({
    path: CODEX_FUTURE_CANDIDATE,
    reparsePoint: true,
    reparseChain: CODEX_SINGLE_REPARSE_CHAIN_FUTURE,
    sha256: FUTURE_BINDING.sha256,
    fileId: FUTURE_BINDING.fileId,
    fileVersion: '',
  });
  const { helper, state } = holdingHelper(facts, CODEX_LEXICAL_CANDIDATE);
  const inspection = await inspectNativeCliCandidate(CODEX_LEXICAL_CANDIDATE, {
    helper,
    expectedPublisher: FUTURE_BINDING.publisher,
    codexReleasePolicy: CODEX_RELEASE_POLICY,
    runner: {
      async capture(spec) {
        assert.equal(state.held, true);
        assert.equal(spec.command, FUTURE_BINDING.path);
        assert.deepEqual(spec.args, ['--version']);
        return { exitCode: 0, stdout: 'codex-cli 0.146.0\n', stderr: '' };
      },
    },
  });

  assert.equal(inspection.path, FUTURE_BINDING.path);
  assert.equal(inspection.version, FUTURE_BINDING.version);
  assert.equal(state.held, false);
  assert.equal(state.releaseCalls, 1);
});

test('a verified launch lease accepts the future blank-PE Codex identity and exact held version', async () => {
  const facts = validFacts({
    path: FUTURE_BINDING.path,
    sha256: FUTURE_BINDING.sha256,
    fileId: FUTURE_BINDING.fileId,
    fileVersion: '',
  });
  const { helper, state } = holdingHelper(facts, FUTURE_BINDING.path);
  const lease = await openVerifiedNativeCliLaunchLease(FUTURE_BINDING, {
    helper,
    runner: {
      async capture(spec) {
        assert.equal(state.held, true);
        assert.equal(spec.command, FUTURE_BINDING.path);
        return { exitCode: 0, stdout: 'codex-cli 0.146.0\n', stderr: '' };
      },
      async launch() { throw new Error('launch is not part of this proof'); },
    },
  });
  assert.equal(state.held, true);
  await lease.cleanup();
  assert.equal(state.held, false);
});

test('discovery accepts only the exact ordered nested Codex junction chain while its final object is held', async () => {
  const facts = validFacts({
    path: CODEX_FINAL_CANDIDATE,
    reparsePoint: true,
    reparseChain: CODEX_REPARSE_CHAIN,
  });
  const { helper, state } = holdingHelper(facts, CODEX_LEXICAL_CANDIDATE);
  const result = await inspectNativeCliCandidate(CODEX_LEXICAL_CANDIDATE, {
    helper,
    expectedPublisher: BINDING.publisher,
    expectedVersion: BINDING.version,
    expectedReparseChain: CODEX_REPARSE_CHAIN,
    allowedJunction: {
      path: CODEX_LEXICAL_BIN,
      target: `${CODEX_RELEASE}\\bin`,
    },
    environment: { USERPROFILE: CODEX_PROFILE },
    runner: {
      async capture(spec) {
        assert.equal(state.held, true);
        assert.equal(spec.command, CODEX_FINAL_CANDIDATE);
        return { exitCode: 0, stdout: 'codex-cli 0.145.0\n', stderr: '' };
      },
    },
  });

  assert.equal(result.path, CODEX_FINAL_CANDIDATE);
  assert.equal(result.reparsePoint, true);
  assert.deepEqual(result.reparseChain, CODEX_REPARSE_CHAIN);
  assert.equal(result.junctionPath, CODEX_LEXICAL_BIN);
  assert.equal(result.junctionTarget, `${CODEX_RELEASE}\\bin`);
  assert.equal(state.held, false);
  assert.equal(state.releaseCalls, 1);
});

test('discovery rejects arbitrary, partial, extra, reordered, symlink, and mismatched reparse chains before execution', async () => {
  const wrongRelease = CODEX_RELEASE.replace('0.145.0-', '0.145.1-');
  const cases = [
    { actual: [], reparsePoint: true, expected: CODEX_REPARSE_CHAIN },
    { actual: CODEX_REPARSE_CHAIN, reparsePoint: false, expected: CODEX_REPARSE_CHAIN },
    { actual: CODEX_REPARSE_CHAIN.slice(0, 1), expected: CODEX_REPARSE_CHAIN },
    { actual: [...CODEX_REPARSE_CHAIN, CODEX_REPARSE_CHAIN[1]], expected: CODEX_REPARSE_CHAIN },
    { actual: [...CODEX_REPARSE_CHAIN].reverse(), expected: CODEX_REPARSE_CHAIN },
    {
      actual: [
        { ...CODEX_REPARSE_CHAIN[0], path: `${CODEX_PROFILE}\\other` },
        CODEX_REPARSE_CHAIN[1],
      ],
      expected: CODEX_REPARSE_CHAIN,
    },
    {
      actual: [
        CODEX_REPARSE_CHAIN[0],
        { ...CODEX_REPARSE_CHAIN[1], rawTarget: wrongRelease },
      ],
      expected: CODEX_REPARSE_CHAIN,
    },
    {
      actual: [
        { ...CODEX_REPARSE_CHAIN[0], type: 'symbolic-link' },
        CODEX_REPARSE_CHAIN[1],
      ],
      expected: CODEX_REPARSE_CHAIN,
    },
    { actual: CODEX_REPARSE_CHAIN, expected: CODEX_REPARSE_CHAIN.slice(0, 1) },
  ];

  for (const item of cases) {
    const facts = validFacts({
      path: CODEX_FINAL_CANDIDATE,
      reparsePoint: item.reparsePoint ?? true,
      reparseChain: item.actual,
    });
    const { helper, state } = holdingHelper(facts, CODEX_LEXICAL_CANDIDATE);
    let executed = false;
    await assert.rejects(inspectNativeCliCandidate(CODEX_LEXICAL_CANDIDATE, {
      helper,
      expectedPublisher: BINDING.publisher,
      expectedVersion: BINDING.version,
      expectedReparseChain: item.expected,
      runner: { async capture() { executed = true; } },
    }), (error) => error.code === 'CLI_NOT_INSTALLED');
    assert.equal(executed, false);
    assert.equal(state.held, false);
    assert.equal(state.releaseCalls, 1);
  }
});

test('non-reparse discovery and canonical launch leases require an empty chain', async () => {
  const invalidFacts = validFacts({ reparsePoint: false, reparseChain: CODEX_REPARSE_CHAIN });
  {
    const { helper, state } = holdingHelper(invalidFacts);
    let executed = false;
    await assert.rejects(inspectNativeCliCandidate(BINDING.path, {
      helper,
      expectedPublisher: BINDING.publisher,
      expectedVersion: BINDING.version,
      expectedReparseChain: [],
      runner: { async capture() { executed = true; } },
    }), (error) => error.code === 'CLI_NOT_INSTALLED');
    assert.equal(executed, false);
    assert.equal(state.releaseCalls, 1);
  }
  {
    const { helper, state } = holdingHelper(invalidFacts);
    let executed = false;
    await assert.rejects(openVerifiedNativeCliLaunchLease(BINDING, {
      helper,
      runner: {
        async capture() { executed = true; },
        async launch() { executed = true; },
      },
    }), (error) => error.code === 'CLI_NOT_INSTALLED');
    assert.equal(executed, false);
    assert.equal(state.releaseCalls, 1);
  }
});

test('Claude PE 2.1.217.0 normalizes only when held CLI output is exactly 2.1.217', async () => {
  const binding = Object.freeze({
    path: 'C:\\Users\\tester\\.local\\bin\\claude.exe',
    sha256: 'a'.repeat(64),
    volumeSerial: '10203040',
    fileId: 'AABBCCDDEEFF0011',
    version: '2.1.217',
    publisher: 'Anthropic, PBC',
  });
  const facts = Object.freeze({
    path: binding.path,
    regularFile: true,
    reparsePoint: false,
    reparseChain: Object.freeze([]),
    sha256: binding.sha256,
    volumeSerial: binding.volumeSerial,
    fileId: binding.fileId,
    fileVersion: '2.1.217.0',
    publisher: binding.publisher,
    signatureValid: true,
  });
  const { helper, state } = holdingHelper(facts, binding.path);
  const runner = {
    async capture() {
      assert.equal(state.held, true);
      return { exitCode: 0, stdout: '2.1.217 (Claude Code)\n', stderr: '' };
    },
    async launch() { throw new Error('not launched in this test'); },
  };
  const lease = await openVerifiedNativeCliLaunchLease(binding, { helper, runner });
  assert.equal(state.held, true);
  await lease.cleanup();
  assert.equal(state.held, false);
  assert.equal(state.releaseCalls, 1);
});

test('launch rejects a changed command or incomplete/unsafe nested spawn options and releases', async () => {
  const invalidRequests = [
    { ...launchRequest(), command: 'C:\\untrusted\\replacement.exe' },
    { ...launchRequest(), extra: true },
    launchRequest([], { shell: true }),
    launchRequest([], { windowsHide: 'false' }),
    launchRequest([], { stdio: ['ignore', 'pipe', 'pipe'] }),
    launchRequest([], { cwd: '.\\relative' }),
    launchRequest([], { env: { CODEX_HOME: 7 } }),
  ];
  for (const request of invalidRequests) {
    const { helper, state } = holdingHelper();
    let spawned = false;
    const runner = verifiedRunner(state, { async launch() { spawned = true; } });
    const lease = await openVerifiedNativeCliLaunchLease(BINDING, { helper, runner });
    await assert.rejects(lease.launch(request), (error) => (
      error.code === 'COMMAND_FAILED'
      && !error.message.includes(BINDING.path)
      && !error.message.includes(BINDING.sha256)
    ));
    assert.equal(spawned, false);
    assert.equal(state.held, false);
    assert.equal(state.releaseCalls, 1);
  }
});

test('a concurrent final path swap stays blocked until the verified child-created event', async () => {
  const { helper, state } = holdingHelper();
  let pathIdentity = BINDING.fileId;
  let launchedIdentity = null;
  const tryFinalSwap = () => {
    if (state.held) return false;
    pathIdentity = '8899AABBCCDDEEFF';
    return true;
  };
  let child;
  const runner = verifiedRunner(state, {
    async launch(spec) {
      assert.equal(spec.command, BINDING.path);
      launchedIdentity = pathIdentity;
      assert.equal(tryFinalSwap(), false, 'write/delete sharing must still block the final swap');
      child = childProcess();
      return child;
    },
  });

  const lease = await openVerifiedNativeCliLaunchLease(BINDING, { helper, runner });
  const pending = lease.launch(launchRequest(['exec']));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.held, true);
  assert.equal(pathIdentity, BINDING.fileId);
  child.emit('spawn');
  await pending;

  assert.equal(state.held, true);
  assert.equal(tryFinalSwap(), false);
  await lease.cleanup();
  assert.equal(state.held, false);
  assert.equal(tryFinalSwap(), true);
  assert.equal(launchedIdentity, BINDING.fileId);
});

test('synchronous runner installs the child-created listener before a queued spawn event', async () => {
  const { helper, state } = holdingHelper();
  const runner = verifiedRunner(state, {
    launch() {
      const child = childProcess();
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });
  const lease = await openVerifiedNativeCliLaunchLease(BINDING, {
    helper,
    runner,
    launchTimeoutMs: 25,
  });

  const child = await lease.launch(launchRequest());
  assert.equal(child.pid, 4242);
  assert.equal(state.held, true);
  assert.equal(state.releaseCalls, 0);
  await lease.cleanup();
  assert.equal(state.held, false);
  assert.equal(state.releaseCalls, 1);
});

test('a fast child cannot finish before createCliRunner attaches capture listeners', async () => {
  const { helper: immediateHelper, state } = holdingHelper();
  const helper = {
    async open(candidatePath) {
      const session = await immediateHelper.open(candidatePath);
      return Object.freeze({
        facts: session.facts,
        async release() {
          await new Promise((resolve) => setTimeout(resolve, 25));
          await session.release();
        },
      });
    },
  };
  const leaseRunner = verifiedRunner(state, {
    launch() {
      const child = childProcess();
      child.stdin = { end() {} };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.exitCode = null;
      child.signalCode = null;
      setImmediate(() => {
        child.emit('spawn');
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from('codex-cli 0.145.0\r\n'));
          child.exitCode = 0;
          child.emit('close', 0, null);
        });
      });
      return child;
    },
  });
  const lease = await openVerifiedNativeCliLaunchLease(BINDING, {
    helper,
    runner: leaseRunner,
  });
  const runner = createCliRunner();

  try {
    const result = await runner.capture({
      command: BINDING.path,
      launchLease: lease,
      args: ['--version'],
      timeoutMs: 1000,
    });
    assert.equal(result.stdout, 'codex-cli 0.145.0\r\n');
    assert.equal(state.held, true);
    assert.equal(state.releaseCalls, 0);
  } finally {
    await lease.cleanup();
  }
  assert.equal(state.held, false);
  assert.equal(state.releaseCalls, 1);
});

test('releases exactly once on verification failure, launch rejection, child error, timeout, abort, and caller cleanup', async () => {
  {
    const { helper, state } = holdingHelper();
    const runner = verifiedRunner(state, {
      async capture() { assert.equal(state.held, true); throw new Error('version launch failed'); },
    });
    await assert.rejects(openVerifiedNativeCliLaunchLease(BINDING, { helper, runner }));
    assert.deepEqual({ held: state.held, releases: state.releaseCalls }, { held: false, releases: 1 });
  }

  for (const code of ['REQUEST_TIMEOUT', 'RUN_STOPPED']) {
    const { helper, state } = holdingHelper();
    const runner = verifiedRunner(state, {
      async capture() { assert.equal(state.held, true); throw new AgentError(code); },
    });
    await assert.rejects(openVerifiedNativeCliLaunchLease(BINDING, { helper, runner }));
    assert.deepEqual({ held: state.held, releases: state.releaseCalls }, { held: false, releases: 1 });
  }

  {
    const { helper, state } = holdingHelper();
    const runner = verifiedRunner(state, {
      async launch() { assert.equal(state.held, true); throw new Error('spawn rejected'); },
    });
    const lease = await openVerifiedNativeCliLaunchLease(BINDING, { helper, runner });
    await assert.rejects(lease.launch(launchRequest()), (error) => error.code === 'COMMAND_FAILED');
    assert.deepEqual({ held: state.held, releases: state.releaseCalls }, { held: false, releases: 1 });
  }

  {
    const { helper, state } = holdingHelper();
    let child;
    const runner = verifiedRunner(state, {
      async launch() { child = childProcess(); return child; },
    });
    const lease = await openVerifiedNativeCliLaunchLease(BINDING, { helper, runner });
    const pending = lease.launch(launchRequest());
    await new Promise((resolve) => setImmediate(resolve));
    child.emit('error', new Error('CreateProcess failed'));
    await assert.rejects(pending, (error) => error.code === 'COMMAND_FAILED');
    assert.deepEqual({ held: state.held, releases: state.releaseCalls }, { held: false, releases: 1 });
  }

  {
    const { helper, state } = holdingHelper();
    const runner = verifiedRunner(state, {
      async launch() { return childProcess(); },
    });
    const lease = await openVerifiedNativeCliLaunchLease(BINDING, {
      helper, runner, launchTimeoutMs: 1,
    });
    await assert.rejects(
      lease.launch(launchRequest()),
      (error) => error.code === 'REQUEST_TIMEOUT',
    );
    assert.deepEqual({ held: state.held, releases: state.releaseCalls }, { held: false, releases: 1 });
  }

  {
    const { helper, state } = holdingHelper();
    let child;
    const runner = verifiedRunner(state, {
      async launch() { child = childProcess(); return child; },
    });
    const lease = await openVerifiedNativeCliLaunchLease(BINDING, { helper, runner });
    const pending = lease.launch(launchRequest());
    await new Promise((resolve) => setImmediate(resolve));
    await lease.cleanup();
    await assert.rejects(pending, (error) => error.code === 'COMMAND_FAILED');
    assert.deepEqual({ held: state.held, releases: state.releaseCalls }, { held: false, releases: 1 });
  }

  {
    const { helper, state } = holdingHelper();
    const lease = await openVerifiedNativeCliLaunchLease(BINDING, {
      helper,
      runner: verifiedRunner(state),
    });
    await lease.cleanup();
    await lease.cleanup();
    await assert.rejects(lease.launch(launchRequest()), (error) => error.code === 'COMMAND_FAILED');
    assert.deepEqual({ held: state.held, releases: state.releaseCalls }, { held: false, releases: 1 });
  }
});

function runPowerShell(script, environment = {}) {
  const powershell = path.join(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

test('live Codex helper and dynamic inspection bind the installed release and publisher', { skip: process.platform !== 'win32', timeout: 60000 }, async (t) => {
  const localAppData = process.env.LOCALAPPDATA;
  const userProfile = process.env.USERPROFILE;
  if (!localAppData || !userProfile) {
    t.skip('Windows known folders are unavailable.');
    return;
  }
  const lexicalBin = path.win32.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin');
  const lexicalCandidate = path.win32.join(lexicalBin, 'codex.exe');
  try {
    await fs.access(lexicalCandidate);
  } catch {
    t.skip('The pinned Codex Desktop launcher is not installed.');
    return;
  }
  const current = path.win32.join(userProfile, '.codex', 'packages', 'standalone', 'current');
  const releaseRoot = path.win32.join(userProfile, '.codex', 'packages', 'standalone', 'releases');
  const helper = createNativeCliInspectionHelper();
  const session = await helper.open(lexicalCandidate);
  t.after(() => session.release());

  const chain = session.facts.reparseChain;
  assert.ok(chain.length === 1 || chain.length === 2, `unexpected reparse chain length ${chain.length}`);
  // Legacy 2-junction layout: release is the second entry's rawTarget. Current 1-junction
  // layout: the single entry points straight at release\bin.
  const release = chain.length === 2 ? chain[1].rawTarget : path.win32.dirname(chain[0].rawTarget);
  const releaseName = path.win32.basename(release || '');
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-x86_64-pc-windows-msvc$/.exec(releaseName);
  assert.ok(match, releaseName);
  const version = `${match[1]}.${match[2]}.${match[3]}`;
  assert.equal(path.win32.dirname(release).toLowerCase(), releaseRoot.toLowerCase());
  assert.equal(session.facts.path.toLowerCase(), path.win32.join(release, 'bin', 'codex.exe').toLowerCase());
  assert.equal(chain[0].path.toLowerCase(), lexicalBin.toLowerCase());
  if (chain.length === 2) {
    assert.deepEqual(chain.map((entry) => ({
      path: entry.path.toLowerCase(),
      rawTarget: entry.rawTarget.toLowerCase(),
      type: entry.type,
    })), [
      { path: lexicalBin.toLowerCase(), rawTarget: path.win32.join(current, 'bin').toLowerCase(), type: 'junction' },
      { path: current.toLowerCase(), rawTarget: release.toLowerCase(), type: 'junction' },
    ]);
  } else {
    assert.equal(chain[0].rawTarget.toLowerCase(), path.win32.join(release, 'bin').toLowerCase());
    assert.equal(chain[0].type, 'junction');
  }
  assert.equal(session.facts.publisher, 'OpenAI OpCo, LLC');
  await session.release();

  const inspection = await inspectNativeCliCandidate(lexicalCandidate, {
    expectedPublisher: 'OpenAI OpCo, LLC',
    codexReleasePolicy: {
      minimumVersion: '0.145.0',
      blockedVersions: [],
      releaseRoot,
      releaseSuffix: '-x86_64-pc-windows-msvc',
      installerBin: lexicalBin,
      standaloneCurrent: current,
    },
  });
  assert.equal(inspection.version, version);
  assert.equal(inspection.path.toLowerCase(), session.facts.path.toLowerCase());
});

test('Windows helper holds a real FILE_SHARE_READ-only handle that blocks overwrite, rename, and delete until release', { skip: process.platform !== 'win32', timeout: 60000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-native-lease-'));
  const candidatePath = path.join(directory, 'candidate.exe');
  await fs.copyFile(process.execPath, candidatePath);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const helper = createNativeCliInspectionHelper();
  const session = await helper.open(candidatePath);
  t.after(() => session.release());
  assert.equal(session.facts.path.toLowerCase(), candidatePath.toLowerCase());
  assert.equal(session.facts.regularFile, true);

  const mutationProbe = String.raw`
$path = $env:CLAUDE_PET_LEASE_TARGET
$results = [ordered]@{}
try { $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite); $stream.Dispose(); $results.overwrite = $true } catch { $results.overwrite = $false }
try { Rename-Item -LiteralPath $path -NewName 'swapped.exe' -ErrorAction Stop; $results.rename = $true } catch { $results.rename = $false }
try { Remove-Item -LiteralPath $path -Force -ErrorAction Stop; $results.delete = $true } catch { $results.delete = $false }
$results | ConvertTo-Json -Compress
`;
  const held = await runPowerShell(mutationProbe, { CLAUDE_PET_LEASE_TARGET: candidatePath });
  assert.equal(held.exitCode, 0, held.stderr);
  assert.deepEqual(JSON.parse(held.stdout.trim()), { overwrite: false, rename: false, delete: false });

  await session.release();
  const released = await runPowerShell(mutationProbe, { CLAUDE_PET_LEASE_TARGET: candidatePath });
  assert.equal(released.exitCode, 0, released.stderr);
  const releasedResults = JSON.parse(released.stdout.trim());
  assert.equal(releasedResults.overwrite, true);
});
