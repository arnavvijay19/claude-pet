'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAbortableDelayGate, createAgentRuntime, shouldEnableTestExecutor } = require('../src/agentRuntime.js');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('releases the Task 9 Offline Demo delay as soon as Stop aborts the run', async () => {
  const cleared = [];
  let release;
  const gate = createAbortableDelayGate({
    delayMs: 5000,
    setTimeoutFn: (callback) => { release = callback; return 'timer'; },
    clearTimeoutFn: (timer) => cleared.push(timer),
  });
  const controller = new AbortController();
  const waiting = gate.wait(controller.signal);
  controller.abort();
  await waiting;
  assert.deepEqual(cleared, ['timer']);
  release();
});

test('enables deterministic Codex-shaped test activity only for an unpackaged test process', () => {
  assert.equal(shouldEnableTestExecutor({ isPackaged: false, nodeEnv: 'test', value: '1' }), true);
  assert.equal(shouldEnableTestExecutor({ isPackaged: true, nodeEnv: 'test', value: '1' }), false);
  assert.equal(shouldEnableTestExecutor({ isPackaged: false, nodeEnv: 'production', value: '1' }), false);
  assert.equal(shouldEnableTestExecutor({ isPackaged: false, nodeEnv: 'test', value: undefined }), false);
});

test('runtime creates, initializes, and shares one protected Codex compatibility coordinator', async (t) => {
  // Catches separate executor coordinators, wrong app-owned paths, or a store left uninitialized at startup.
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-runtime-compatibility-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const crypto = { isAvailable: async () => true, encrypt: async (value) => Buffer.from(value), decrypt: async (value) => ({ value: String(value), shouldReEncrypt: false }) };
  const calls = { store: [], qualifier: [], compatibility: [], initialized: 0, workspace: [], native: [] };
  const compatibilityStore = {
    initialize: async () => { calls.initialized += 1; },
    hasSuccessful: async () => false,
    rememberSuccessful: async () => {},
  };
  const ensure = async () => ({ compatible: true, version: '0.146.0', cached: false });
  const executor = Object.freeze({
    async getStatus() { return { installed: true, compatible: true, authenticated: true, workspaceAvailable: true }; },
    async beginSetup() { return { started: true }; }, async listModels() { return []; },
    async getCapabilities() { return { permissionProfiles: ['workspace'], network: false, authentication: true, efforts: [] }; },
    async verifyPermissionProfile() { return { available: true, allowed: true }; },
    async runGoal() { return { text: 'ok', changedFiles: [] }; },
  });
  const runtime = createAgentRuntime({
    userDataPath: directory, crypto, randomId: () => 'id',
    dependencies: {
      createCodexCompatibilityStore: (input) => { calls.store.push(input); return compatibilityStore; },
      createCodexCompatibilityQualifier: (input) => { calls.qualifier.push(input); return async () => true; },
      createCodexCompatibility: (input) => { calls.compatibility.push(input); return { ensureCompatible: ensure }; },
      createCodexCliExecutor: (input) => { calls.workspace.push(input); return executor; },
      createCodexNativeFullComputerExecutor: (input) => { calls.native.push(input); return executor; },
    },
  });
  await runtime.initialize();
  assert.deepEqual(calls.store, [{ filePath: path.join(directory, 'codex-compatibility.json'), crypto }]);
  assert.deepEqual(calls.qualifier, [{
    compatibilityRoot: path.join(directory, 'codex-compatibility-probe'),
    fixtureRoot: path.join(__dirname, '..', 'resources', 'probes'),
  }]);
  assert.equal(calls.compatibility[0].store, compatibilityStore);
  assert.equal(typeof calls.compatibility[0].qualify, 'function');
  assert.equal(calls.workspace[0].ensureCodexCompatibility, calls.native[0].ensureCodexCompatibility);
  assert.equal(typeof calls.workspace[0].ensureCodexCompatibility, 'function');
  assert.equal(calls.initialized, 1);
});

test('test mode remains account-free and does not execute compatibility qualification', async (t) => {
  // Catches deterministic test mode accidentally invoking a provider probe or account setup.
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-runtime-test-mode-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const crypto = { isAvailable: async () => true, encrypt: async (value) => Buffer.from(value), decrypt: async (value) => ({ value: String(value), shouldReEncrypt: false }) };
  let qualifications = 0;
  let workspaceExecutors = 0;
  const runtime = createAgentRuntime({
    userDataPath: directory, crypto, randomId: () => 'id', testExecutorEnabled: true,
    dependencies: {
      createCodexCompatibilityStore: () => ({ initialize: async () => {}, hasSuccessful: async () => false, rememberSuccessful: async () => {} }),
      createCodexCompatibilityQualifier: () => async () => { qualifications += 1; return true; },
      createCodexCompatibility: ({ qualify }) => ({ ensureCompatible: (binding, options) => qualify(binding, options) }),
      createCodexCliExecutor: () => { workspaceExecutors += 1; throw new Error('test mode must not construct a real Codex executor'); },
    },
  });
  await runtime.initialize();
  assert.equal(workspaceExecutors, 0);
  assert.equal(qualifications, 0);
});

test('initializes an independent encrypted session service beside connection storage', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-runtime-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const crypto = {
    isAvailable: async () => true,
    encrypt: async (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decrypt: async (buffer) => ({ value: Buffer.from(buffer).toString('utf8').replace(/^encrypted:/, ''), shouldReEncrypt: false }),
  };
  let nextId = 0;
  const runtime = createAgentRuntime({
    userDataPath: directory, crypto, randomId: () => `id-${++nextId}`, testExecutorEnabled: true,
  });
  await runtime.initialize();
  const agent = await runtime.sessions.createAgent({
    name: 'Research', marker: 'amber', instruction: 'Keep evidence bounded.',
  });
  const session = await runtime.sessions.createSession({
    title: 'Context',
    workspacePath: 'Z:\\runtime',
    participant: { agentId: agent.id, connectionId: 'offline-demo' },
  });
  await runtime.sessions.select({ sessionId: session.id });
  await runtime.sessions.appendTurn(session.id, {
    role: 'user', text: 'persist safely', agentId: agent.id,
    provider: null, model: null, changedFiles: [],
  });
  assert.equal((await fs.readFile(path.join(directory, 'sessions.json'), 'utf8')).includes('persist safely'), false);
  assert.equal((await runtime.coordinator.snapshot()).activeAgent.id, agent.id);
});
