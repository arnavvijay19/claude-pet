'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  APP_INTENTS,
  createAppWindowController,
  registerAppIpc,
} = require('../src/appWindow.js');

function fakeIpc() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      if (handlers.has(channel)) throw new Error(`duplicate ${channel}`);
      handlers.set(channel, handler);
    },
    removeHandler(channel) { handlers.delete(channel); },
  };
}

function dependencies({ busy = false } = {}) {
  const calls = [];
  const coordinatorState = {
    agents: [{ id: 'agent-a', name: 'Agent A', marker: 'amber', createdAt: 'now', updatedAt: 'now', sessionCount: 1 }],
    sessions: [{
      id: 'session-a', title: 'Session A', workspacePath: 'Z:\\workspace',
      participants: [{ agentId: 'agent-a', connectionId: 'connection-a' }],
      activeAgentId: 'agent-a', createdAt: 'now', updatedAt: 'now', turnCount: 0, lastProvider: null,
    }],
    selection: { sessionId: 'session-a', agentId: 'agent-a' },
    activeAgent: { id: 'agent-a', name: 'Agent A', marker: 'amber', createdAt: 'now', updatedAt: 'now', sessionCount: 1 },
    session: {
      id: 'session-a', title: 'Session A', workspacePath: 'Z:\\workspace',
      participants: [{ agentId: 'agent-a', connectionId: 'connection-a' }],
      activeAgentId: 'agent-a', createdAt: 'now', updatedAt: 'now', turnCount: 0,
      lastProvider: null, agentId: 'agent-a', nextConnectionId: 'connection-a',
    },
    turns: [], connections: [], persistence: { available: true }, busy,
  };
  const coordinator = {
    snapshot: async () => coordinatorState,
    busy: () => busy,
  };
  for (const method of [
    'select', 'createSession', 'renameSession', 'removeSession', 'createAgent', 'renameAgent',
    'removeAgent', 'addParticipant', 'removeParticipant', 'selectParticipant',
    'setParticipantConnection',
  ]) coordinator[method] = async (...args) => { calls.push([method, ...args]); return true; };
  const connections = {
    listConnections: async () => [{
      id: 'connection-a', executorType: 'offline-demo', label: 'Offline Demo',
      workspacePath: 'Z:\\workspace', permissionProfile: 'workspace',
      modelId: 'offline-demo', effort: null, keyHint: null, hasSecret: false,
    }],
    removeConnection: async (id) => { calls.push(['removeConnection', id]); return true; },
  };
  const manager = {
    getSnapshot: () => ({ busy, connectionId: 'connection-a' }),
    stop: () => { calls.push(['managerStop']); return true; },
    getStatus: async () => ({ installed: true }),
    verifyPermissionProfile: async () => ({ available: true, allowed: true }),
    beginSetup: async () => { calls.push(['beginSetup']); return { started: true }; },
  };
  const activity = {
    snapshot: () => ({ run: null, events: [] }),
    subscribe(listener) { this.listener = listener; return () => { this.listener = null; }; },
  };
  return {
    calls, coordinator, connections, manager, activity,
    updateAgent: async (value) => { calls.push(['updateAgent', value]); return true; },
    saveConnection: async (value) => { calls.push(['saveConnection', value]); return true; },
    submitGoal: async (text) => { calls.push(['submitGoal', text]); return true; },
    stopRun: async () => { calls.push(['stopRun']); return true; },
    retryGoal: async () => { calls.push(['retryGoal']); return true; },
    chooseTextFile: async () => { calls.push(['chooseTextFile']); return true; },
  };
}

test('registers one sender-validated IPC boundary for every allowlisted intent', async () => {
  assert.deepEqual(APP_INTENTS, [
    'select-session', 'create-session', 'rename-session', 'delete-session',
    'create-agent', 'update-agent', 'delete-agent',
    'add-participant', 'remove-participant', 'select-participant',
    'set-participant-connection', 'submit-goal', 'stop-run', 'retry-run',
    'choose-text-file', 'save-connection', 'delete-connection',
    'test-connection', 'begin-provider-setup', 'set-view',
  ]);
  const ipcMain = fakeIpc();
  const sender = {};
  const deps = dependencies();
  const sent = [];
  const registered = registerAppIpc({
    ipcMain,
    sender,
    publish: async () => sent.push('published'),
    setView: (view) => { sent.push(view); },
    ...deps,
  });

  const invoke = (intent) => ipcMain.handlers.get('app:intent')({ sender }, intent);
  await invoke({ type: 'select-session', data: { sessionId: 'session-a' } });
  await invoke({ type: 'create-session', data: { agentId: 'agent-a', title: 'New', workspacePath: 'Z:\\workspace' } });
  await invoke({ type: 'rename-session', data: { sessionId: 'session-a', title: 'Renamed' } });
  await invoke({ type: 'delete-session', data: { sessionId: 'session-a' } });
  await invoke({ type: 'create-agent', data: { name: 'New agent', marker: 'blue', instruction: 'Review.' } });
  await invoke({ type: 'update-agent', data: { agentId: 'agent-a', name: 'A', marker: 'blue', instruction: 'Review.' } });
  await invoke({ type: 'delete-agent', data: { agentId: 'agent-a' } });
  await invoke({ type: 'add-participant', data: { sessionId: 'session-a', agentId: 'agent-a', connectionId: 'connection-a' } });
  await invoke({ type: 'remove-participant', data: { sessionId: 'session-a', agentId: 'agent-a' } });
  await invoke({ type: 'select-participant', data: { sessionId: 'session-a', agentId: 'agent-a' } });
  await invoke({ type: 'set-participant-connection', data: { sessionId: 'session-a', agentId: 'agent-a', connectionId: 'connection-a' } });
  await invoke({ type: 'submit-goal', data: { text: 'Do the task' } });
  await invoke({ type: 'stop-run', data: {} });
  await invoke({ type: 'retry-run', data: {} });
  await invoke({ type: 'choose-text-file', data: {} });
  await invoke({ type: 'save-connection', data: {
    executorType: 'offline-demo', label: 'Offline Demo', workspacePath: 'Z:\\workspace',
    permissionProfile: 'workspace', modelId: 'offline-demo', effort: null, keyHint: null,
  } });
  await invoke({ type: 'delete-connection', data: { connectionId: 'connection-a' } });
  await invoke({ type: 'test-connection', data: {} });
  await invoke({ type: 'begin-provider-setup', data: {} });
  await invoke({ type: 'set-view', data: { view: 'settings' } });

  assert.equal(sent.filter((value) => value === 'published').length, APP_INTENTS.length);
  assert.equal(sent.includes('settings'), true);
  assert.equal(deps.calls.some(([name]) => name === 'stopRun'), true);
  assert.equal(deps.calls.some(([name]) => name === 'managerStop'), false);
  await assert.rejects(
    ipcMain.handlers.get('app:intent')({ sender: {} }, { type: 'stop-run', data: {} }),
    /Invalid app sender/,
  );
  await assert.rejects(invoke({ type: 'unknown', data: {} }));
  registered.unregister();
  assert.equal(ipcMain.handlers.size, 0);
});

test('rejects malformed, secret-bearing, cross-session, and busy mutations before side effects', async () => {
  for (const busy of [false, true]) {
    const ipcMain = fakeIpc();
    const sender = {};
    const deps = dependencies({ busy });
    registerAppIpc({ ipcMain, sender, publish: async () => {}, setView: () => {}, ...deps });
    const invoke = (intent) => ipcMain.handlers.get('app:intent')({ sender }, intent);
    await assert.rejects(invoke({ type: 'submit-goal', data: { text: 'bad\0text' } }));
    await assert.rejects(invoke({
      type: 'save-connection',
      data: {
        executorType: 'offline-demo', label: 'x', workspacePath: 'Z:\\workspace',
        permissionProfile: 'workspace', modelId: 'offline-demo', effort: null, keyHint: null,
        fullAccessConfirmed: true,
      },
    }));
    await assert.rejects(invoke({
      type: 'add-participant',
      data: { sessionId: 'other-session', agentId: 'agent-a', connectionId: 'connection-a' },
    }));
    if (busy) {
      await assert.rejects(invoke({ type: 'delete-agent', data: { agentId: 'agent-a' } }),
        (error) => error.code === 'AGENT_BUSY');
    }
    assert.deepEqual(deps.calls, []);
  }
});

test('creates one reusable native window and publishes once per activity update', async () => {
  const instances = [];
  function BrowserWindow(options) {
    const sent = [];
    const window = {
      options, sent, destroyed: false,
      webContents: { send: (...args) => sent.push(args) },
      loadFile: (value) => { window.loaded = value; },
      show: () => { window.shown = true; },
      focus: () => { window.focused = true; },
      isDestroyed: () => window.destroyed,
      on: () => {},
    };
    instances.push(window);
    return window;
  }
  const ipcMain = fakeIpc();
  const deps = dependencies();
  const controller = createAppWindowController({ BrowserWindow, ipcMain, ...deps });
  const first = controller.show();
  const second = controller.show({ view: 'settings' });
  assert.equal(first, second);
  assert.equal(instances.length, 1);
  assert.equal(first.options.width, 1080);
  assert.equal(first.options.height, 720);
  assert.equal(first.options.minWidth, 900);
  assert.equal(first.options.minHeight, 650);
  await new Promise((resolve) => setImmediate(resolve));
  const before = first.sent.filter(([channel]) => channel === 'app:snapshot').length;
  await controller.publish();
  const afterPublish = first.sent.filter(([channel]) => channel === 'app:snapshot').length;
  assert.equal(afterPublish, before + 1);
  deps.activity.listener(deps.activity.snapshot());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    first.sent.filter(([channel]) => channel === 'app:snapshot').length,
    afterPublish + 1,
  );
});
