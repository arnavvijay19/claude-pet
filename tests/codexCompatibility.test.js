'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  createCodexCompatibility,
  createCodexCompatibilityQualifier,
} = require('../src/agent/codexCompatibility.js');

const BINDING = Object.freeze({
  path: 'C:\\Users\\Tester\\.codex\\packages\\standalone\\releases\\0.146.0-x86_64-pc-windows-msvc\\bin\\codex.exe',
  sha256: 'a'.repeat(64),
  volumeSerial: 'A1B2C3D4',
  fileId: '0011223344556677',
  version: '0.146.0',
  publisher: 'OpenAI OpCo, LLC',
});

function changedBinding(field, value) {
  return Object.freeze({ ...BINDING, [field]: value });
}

function storeHarness({ successful = false, remember = async () => true } = {}) {
  const calls = { has: 0, remember: 0 };
  return {
    calls,
    store: {
      hasSuccessful: async () => { calls.has += 1; return successful; },
      rememberSuccessful: async () => { calls.remember += 1; return remember(); },
    },
  };
}

async function temporaryRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-compatibility-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('qualifies a first identity once and remembers its success in process and protected storage', async () => {
  const { store, calls } = storeHarness();
  let qualifications = 0;
  const compatibility = createCodexCompatibility({
    store,
    qualify: async () => { qualifications += 1; return true; },
    policyRevision: 'codex-probe-v1',
  });

  assert.deepEqual(await compatibility.ensureCompatible(BINDING), {
    compatible: true, version: '0.146.0', cached: false,
  });
  const cached = await compatibility.ensureCompatible(BINDING);
  assert.deepEqual(cached, { compatible: true, version: '0.146.0', cached: true });
  assert.equal(Object.isFrozen(cached), true);
  assert.equal(qualifications, 1);
  assert.equal(calls.remember, 1);
});

test('uses a protected success from a fresh coordinator without qualifying', async () => {
  const { store, calls } = storeHarness({ successful: true });
  const compatibility = createCodexCompatibility({
    store,
    qualify: async () => { throw new Error('must not qualify'); },
  });
  assert.deepEqual(await compatibility.ensureCompatible(BINDING), {
    compatible: true, version: '0.146.0', cached: true,
  });
  assert.equal(calls.has, 1);
  assert.equal(calls.remember, 0);
});

test('requalifies when a protected identity component or policy changes', async () => {
  const { store } = storeHarness();
  let qualifications = 0;
  const qualify = async () => { qualifications += 1; return true; };
  const first = createCodexCompatibility({ store, qualify, policyRevision: 1 });
  await first.ensureCompatible(BINDING);
  for (const binding of [
    changedBinding('fileId', 'FEDCBA9876543210'),
    changedBinding('sha256', 'b'.repeat(64)),
    changedBinding('version', '0.146.1'),
  ]) await first.ensureCompatible(binding);
  const changedPolicy = createCodexCompatibility({ store, qualify, policyRevision: 2 });
  await changedPolicy.ensureCompatible(BINDING);
  assert.equal(qualifications, 5);
});

test('shares one pending qualification for concurrent checks of one identity', async () => {
  const { store } = storeHarness();
  let release;
  let qualifications = 0;
  const compatibility = createCodexCompatibility({
    store,
    qualify: () => new Promise((resolve) => { qualifications += 1; release = () => resolve(true); }),
  });
  const attempts = Array.from({ length: 5 }, () => compatibility.ensureCompatible(BINDING));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(qualifications, 1);
  release();
  const values = await Promise.all(attempts);
  assert.deepEqual(values, Array.from({ length: 5 }, () => ({
    compatible: true, version: '0.146.0', cached: false,
  })));
});

test('maps deterministic incompatibility to CLI_VERSION_UNSUPPORTED without storing evidence', async () => {
  const { store, calls } = storeHarness();
  const compatibility = createCodexCompatibility({ store, qualify: async () => false });
  await assert.rejects(compatibility.ensureCompatible(BINDING), (error) => error.code === 'CLI_VERSION_UNSUPPORTED');
  assert.equal(calls.remember, 0);
});

test('maps uncertain qualification failures to CLI_COMPATIBILITY_CHECK_FAILED without storing', async () => {
  for (const failure of ['timeout', 'abort', 'fixture', 'cleanup']) {
    const { store, calls } = storeHarness();
    const compatibility = createCodexCompatibility({
      store,
      qualify: async () => { throw new Error(`${failure} C:\\private\\raw-output`); },
    });
    await assert.rejects(compatibility.ensureCompatible(BINDING), (error) => (
      error.code === 'CLI_COMPATIBILITY_CHECK_FAILED'
      && !error.message.includes('private')
      && !Object.hasOwn(error, 'cause')
    ), failure);
    assert.equal(calls.remember, 0, failure);
  }
});

test('removes a failed pending qualification so Retry starts a new one', async () => {
  const { store } = storeHarness();
  let attempts = 0;
  const compatibility = createCodexCompatibility({
    store,
    qualify: async () => { attempts += 1; if (attempts === 1) throw new Error('temporary'); return true; },
  });
  await assert.rejects(compatibility.ensureCompatible(BINDING), (error) => error.code === 'CLI_COMPATIBILITY_CHECK_FAILED');
  await compatibility.ensureCompatible(BINDING);
  assert.equal(attempts, 2);
});

test('keeps a successful qualification in memory when protected storage fails', async () => {
  const { store, calls } = storeHarness({ remember: async () => false });
  let qualifications = 0;
  const compatibility = createCodexCompatibility({
    store, qualify: async () => { qualifications += 1; return true; },
  });
  await compatibility.ensureCompatible(BINDING);
  assert.deepEqual(await compatibility.ensureCompatible(BINDING), {
    compatible: true, version: '0.146.0', cached: true,
  });
  assert.equal(qualifications, 1);
  assert.equal(calls.remember, 1);
});

test('creates an app-owned account-free workspace, passes the complete probe contract, and cleans it', async (t) => {
  const appRoot = await temporaryRoot(t);
  const fixtureRoot = path.join(appRoot, 'fixtures');
  const userWorkspace = path.join(appRoot, 'user-workspace');
  let received;
  const qualifier = createCodexCompatibilityQualifier({
    compatibilityRoot: appRoot,
    fixtureRoot,
    verifyNativeToolSurface: async (input) => {
      received = input;
      assert.equal(await fs.stat(input.workspacePath).then(() => true), true);
      return { available: true, allowed: true, cleanup: true, credentialScrubbed: true };
    },
  });
  const signal = new AbortController().signal;
  assert.equal(await qualifier(BINDING, { signal, workspacePath: userWorkspace }), true);
  assert.deepEqual(received, {
    provider: 'codex-cli', purpose: 'compatibility', cliBinding: BINDING,
    workspacePath: received.workspacePath, fixtureRoot, signal,
  });
  assert.equal(received.workspacePath === userWorkspace, false);
  assert.equal(path.relative(appRoot, received.workspacePath).startsWith('..'), false);
  assert.deepEqual(await fs.readdir(appRoot), []);
});

test('cleans its app-owned workspace on incompatibility and every uncertain probe failure', async (t) => {
  for (const outcome of [false, 'error', 'abort', 'timeout']) {
    const appRoot = await temporaryRoot(t);
    const qualifier = createCodexCompatibilityQualifier({
      compatibilityRoot: appRoot,
      fixtureRoot: path.join(appRoot, 'fixtures'),
      verifyNativeToolSurface: async () => {
        if (outcome === false) return { compatible: false };
        throw new Error(outcome);
      },
    });
    if (outcome === false) assert.equal(await qualifier(BINDING), false);
    else await assert.rejects(qualifier(BINDING), Error, outcome);
    assert.deepEqual(await fs.readdir(appRoot), [], String(outcome));
  }
});

test('rejects incomplete positive probe output as retryable uncertainty', async (t) => {
  const appRoot = await temporaryRoot(t);
  const qualifier = createCodexCompatibilityQualifier({
    compatibilityRoot: appRoot,
    fixtureRoot: path.join(appRoot, 'fixtures'),
    verifyNativeToolSurface: async () => ({ available: true, allowed: true, cleanup: true }),
  });
  await assert.rejects(qualifier(BINDING));
  assert.deepEqual(await fs.readdir(appRoot), []);
});
