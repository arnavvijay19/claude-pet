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
