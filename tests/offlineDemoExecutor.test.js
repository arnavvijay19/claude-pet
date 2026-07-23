'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AgentError } = require('../src/agent/agentErrors.js');
const { createOfflineDemoExecutor } = require('../src/agent/executors/offlineDemoExecutor.js');

function request(overrides = {}) {
  return {
    goal: 'write the result',
    workspace: 'Z:\\workspace',
    permissionProfile: 'workspace',
    model: 'offline-demo',
    effort: null,
    options: {},
    ...overrides,
  };
}

function deferredGate() {
  let release;
  return {
    wait: () => new Promise((resolve) => { release = resolve; }),
    release: () => release(),
  };
}

test('reports a ready Workspace-only, credential-free Offline Demo capability', async () => {
  const executor = createOfflineDemoExecutor({ clock: () => 1 });

  assert.deepEqual(Object.keys(executor).sort(), [
    'beginSetup', 'getCapabilities', 'getStatus', 'listModels', 'runGoal', 'verifyPermissionProfile',
  ]);
  assert.deepEqual(await executor.getStatus(), {
    installed: true, authenticated: true, workspaceAvailable: true,
  });
  assert.deepEqual(await executor.beginSetup(), { started: false });
  assert.deepEqual(await executor.listModels(), [{ id: 'offline-demo', efforts: [] }]);
  assert.deepEqual(await executor.getCapabilities(), {
    permissionProfiles: ['workspace'], network: false, authentication: false, efforts: [],
  });
  assert.deepEqual(await executor.verifyPermissionProfile({ permissionProfile: 'workspace' }), {
    available: true, allowed: true,
  });
});

test('emits a deterministic safe activity sequence and stable result', async () => {
  const executor = createOfflineDemoExecutor({ clock: () => 1 });
  const events = [];

  const result = await executor.runGoal(request(), (event) => events.push(event), new AbortController().signal);

  assert.deepEqual(events, [
    { phase: 'preparing', kind: 'status', summary: 'Preparing Offline Demo run', status: 'preparing' },
    { phase: 'inspecting', kind: 'file', summary: 'Inspecting Offline Demo result', path: 'notes/offline-demo-result.txt', operation: 'read' },
    { phase: 'running', kind: 'status', summary: 'Running Offline Demo command', status: 'running' },
    { phase: 'running', kind: 'command', summary: 'Offline Demo command completed', command: 'offline-demo write notes/offline-demo-result.txt', exitCode: 0 },
    { phase: 'responding', kind: 'status', summary: 'Responding with Offline Demo result', status: 'responding' },
    { phase: 'responding', kind: 'usage', summary: 'Offline Demo usage', usage: { inputTokens: 12, outputTokens: 8, cachedTokens: 0, totalTokens: 20 } },
    { phase: 'responding', kind: 'message', summary: 'Offline Demo response ready' },
  ]);
  assert.deepEqual(result, {
    text: 'Banana Baron completed the Offline Demo run.',
    changedFiles: ['notes/offline-demo-result.txt'],
  });
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /(?:secret|password|api[_-]?key)\s*[=:]|process\.env/i);
});

test('waits at the deterministic gate and emits nothing after Stop', async () => {
  const gate = deferredGate();
  const executor = createOfflineDemoExecutor({ clock: () => 1, gate });
  const controller = new AbortController();
  const events = [];
  const run = executor.runGoal(request(), (event) => events.push(event), controller.signal);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 3);
  controller.abort();
  gate.release();
  await assert.rejects(run, { name: 'AbortError' });
  assert.equal(events.length, 3);
});

test('completes only after the deterministic gate releases', async () => {
  const gate = deferredGate();
  const executor = createOfflineDemoExecutor({ clock: () => 1, gate });
  const events = [];
  const run = executor.runGoal(request(), (event) => events.push(event), new AbortController().signal);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 3);
  gate.release();
  assert.deepEqual(await run, {
    text: 'Banana Baron completed the Offline Demo run.',
    changedFiles: ['notes/offline-demo-result.txt'],
  });
  assert.equal(events.length, 7);
});

test('maps the deterministic command failure without exposing the goal', async () => {
  const executor = createOfflineDemoExecutor({ clock: () => 1 });
  const events = [];

  await assert.rejects(
    executor.runGoal(request({ goal: 'fail:COMMAND_FAILED' }), (event) => events.push(event), new AbortController().signal),
    (error) => error instanceof AgentError && error.code === 'COMMAND_FAILED',
  );
  assert.deepEqual(events, []);
});

test('rejects Full Computer and effort as unsupported options', async () => {
  const executor = createOfflineDemoExecutor({ clock: () => 1 });
  const signal = new AbortController().signal;

  await assert.rejects(executor.verifyPermissionProfile({ permissionProfile: 'full-computer' }), (error) => error.code === 'UNSUPPORTED_OPTION');
  await assert.rejects(executor.runGoal(request({ permissionProfile: 'full-computer' }), () => {}, signal), (error) => error.code === 'UNSUPPORTED_OPTION');
  await assert.rejects(executor.runGoal(request({ effort: 'low' }), () => {}, signal), (error) => error.code === 'UNSUPPORTED_OPTION');
  await assert.rejects(executor.runGoal(request({ model: 'unlisted' }), () => {}, signal), (error) => error.code === 'UNSUPPORTED_OPTION');
});
