'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSettingsWindowController, registerSettingsIpc } = require('../src/settingsWindow.js');
const { AgentError } = require('../src/agent/agentErrors.js');

function harness(managerOverrides = {}, authorizationOverrides = {}) {
  const handlers = new Map();
  const sender = {};
  const selected = [];
  const authorizationCalls = [];
  const store = {
    listConnections: async () => [{
      id: 'offline', executorType: 'offline-demo', label: 'Offline Demo',
      workspacePath: 'Z:\\work', permissionProfile: 'workspace',
      modelId: 'offline-demo', effort: null,
    }],
    getActiveSelection: async () => selected.at(-1) || 'offline',
    setActiveSelection: async (id) => { selected.push(id); },
    removeConnection: async () => true,
  };
  const settingsWindow = { webContents: sender };
  const authorization = {
    save: async (window, value) => {
      authorizationCalls.push({ window, value });
      selected.push('saved');
      return { ...value, id: 'saved' };
    },
    isPending: () => false,
    ...authorizationOverrides,
  };
  registerSettingsIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    sender, settingsWindow, store, authorization,
    manager: {
      getStatus: async () => ({ installed: true }),
      verifyPermissionProfile: async () => ({ available: true, allowed: true }),
      beginSetup: async () => ({ started: false }),
      ...managerOverrides,
    },
  });
  return { authorizationCalls, handlers, sender, selected, settingsWindow };
}

test('serves only public Settings snapshots to the expected sender', async () => {
  const { handlers, sender } = harness();
  const snapshot = await handlers.get('settings:snapshot')({ sender });
  assert.equal(snapshot.connections[0].executorType, 'offline-demo');
  assert.equal(JSON.stringify(snapshot).includes('secret'), false);
  await assert.rejects(handlers.get('settings:snapshot')({ sender: {} }));
});

test('accepts Full Computer only through main authorization and rejects unknown save fields', async () => {
  const { authorizationCalls, handlers, sender, settingsWindow } = harness();
  const full = { executorType: 'codex-cli', label: 'Codex', workspacePath: 'Z:\\work', permissionProfile: 'full-computer', modelId: 'gpt-5.6-terra', effort: 'medium', keyHint: null };
  await handlers.get('settings:save')({ sender }, full);
  assert.deepEqual(authorizationCalls, [{ window: settingsWindow, value: full }]);
  await assert.rejects(handlers.get('settings:save')({ sender }, { executorType: 'offline-demo', label: 'Demo', workspacePath: 'Z:\\work', permissionProfile: 'full-computer', modelId: 'offline-demo', effort: null, keyHint: null }));
  await assert.rejects(handlers.get('settings:save')({ sender }, { executorType: 'offline-demo', label: 'Demo', workspacePath: 'Z:\\work', permissionProfile: 'workspace', modelId: 'offline-demo', effort: null, keyHint: null, options: {} }));
  for (const forged of [
    { fullAccessConfirmed: true }, { revision: 1 }, { nonce: 'forged' },
    { confirmation: { accepted: true } }, { reservedId: 'forged' },
  ]) {
    await assert.rejects(handlers.get('settings:save')({ sender }, { ...full, ...forged }));
  }
  assert.equal(authorizationCalls.length, 1);
});

test('requires a non-empty workspace and selects a newly saved Offline Demo connection', async () => {
  const { handlers, sender, selected } = harness();
  const save = handlers.get('settings:save');
  const draft = { executorType: 'offline-demo', label: 'Demo', workspacePath: 'Z:\\work', permissionProfile: 'workspace', modelId: 'offline-demo', effort: null, keyHint: null };
  await assert.rejects(save({ sender }, { ...draft, workspacePath: '   ' }));
  await save({ sender }, draft);
  assert.deepEqual(selected, ['saved']);
});

test('fails closed while a Full Computer dialog is already pending', async () => {
  const { handlers, sender } = harness({}, { isPending: () => true });
  await assert.rejects(
    handlers.get('settings:save')({ sender }, {
      executorType: 'codex-cli', label: 'Codex', workspacePath: 'Z:\\work',
      permissionProfile: 'full-computer', modelId: 'gpt-5.6-terra', effort: 'medium', keyHint: null,
    }),
    (error) => error.code === 'FULL_COMPUTER_CONFIRMATION_REQUIRED',
  );
  await assert.rejects(
    handlers.get('settings:select')({ sender }, 'offline'),
    (error) => error.code === 'FULL_COMPUTER_CONFIRMATION_REQUIRED',
  );
  await assert.rejects(
    handlers.get('settings:remove')({ sender }, 'offline'),
    (error) => error.code === 'FULL_COMPUTER_CONFIRMATION_REQUIRED',
  );
});

test('validates the sender on every Settings IPC channel', async () => {
  const { handlers } = harness();
  const argumentsByChannel = {
    'settings:snapshot': [],
    'settings:save': [{
      executorType: 'offline-demo', label: 'Demo', workspacePath: 'Z:\\work',
      permissionProfile: 'workspace', modelId: 'offline-demo', effort: null, keyHint: null,
    }],
    'settings:select': ['offline'],
    'settings:remove': ['offline'],
    'settings:test': [],
    'settings:setup': [],
  };
  for (const [channel, args] of Object.entries(argumentsByChannel)) {
    await assert.rejects(handlers.get(channel)({ sender: {} }, ...args), /Invalid Settings sender/);
  }
});

test('accepts only registered Workspace Codex models and can begin official setup', async () => {
  const { handlers, sender, selected } = harness();
  const draft = { executorType: 'codex-cli', label: 'Codex Workspace', workspacePath: 'Z:\\work', permissionProfile: 'workspace', modelId: 'gpt-5.6-terra', effort: 'medium', keyHint: null };
  await handlers.get('settings:save')({ sender }, draft);
  assert.deepEqual(selected, ['saved']);
  await assert.rejects(handlers.get('settings:save')({ sender }, { ...draft, modelId: 'not-listed' }));
  await assert.rejects(handlers.get('settings:save')({ sender }, { ...draft, effort: 'unsupported' }));
  assert.deepEqual(await handlers.get('settings:setup')({ sender }), { started: false });
});

test('accepts only registered Workspace Claude models and starts the selected official setup', async () => {
  const { handlers, sender, selected } = harness();
  const draft = { executorType: 'claude-code-cli', label: 'Claude Code Workspace', workspacePath: 'Z:\\work', permissionProfile: 'workspace', modelId: 'sonnet', effort: 'high', keyHint: null };
  await handlers.get('settings:save')({ sender }, draft);
  assert.deepEqual(selected, ['saved']);
  await assert.rejects(handlers.get('settings:save')({ sender }, { ...draft, modelId: 'not-listed' }));
  await assert.rejects(handlers.get('settings:save')({ sender }, { ...draft, effort: 'unsupported' }));
  assert.deepEqual(await handlers.get('settings:setup')({ sender }), { started: false });
});

test('returns a safe permission diagnostic instead of throwing for a saved Codex connection', async () => {
  const { handlers, sender } = harness({ verifyPermissionProfile: async () => { throw new AgentError('PERMISSION_PROFILE_UNAVAILABLE'); } });
  const result = await handlers.get('settings:test')({ sender });
  assert.deepEqual(result.failure, {
    code: 'PERMISSION_PROFILE_UNAVAILABLE',
    message: 'The permission profile is unavailable.',
    action: 'Choose an available permission profile.',
    requestId: null,
  });
});

test('recreates Settings after the user closes its previous window', () => {
  const windows = [];
  const handlers = new Map();
  class FakeBrowserWindow {
    constructor() { this.webContents = {}; this.destroyed = false; this.shown = 0; this.focused = 0; windows.push(this); }
    loadFile() {}
    isDestroyed() { return this.destroyed; }
    show() { this.shown += 1; }
    focus() { this.focused += 1; }
  }
  const ipcMain = {
    handle(channel, handler) {
      if (handlers.has(channel)) throw new Error(`duplicate handler: ${channel}`);
      handlers.set(channel, handler);
    },
    removeHandler(channel) { handlers.delete(channel); },
  };
  const controller = createSettingsWindowController({ BrowserWindow: FakeBrowserWindow, ipcMain, store: {}, manager: {} });
  const first = controller.show();
  first.destroyed = true;
  const second = controller.show();
  assert.notEqual(second, first);
  assert.equal(windows.length, 2);
  assert.equal(second.shown, 1);
  assert.equal(second.focused, 1);
  assert.equal(handlers.size, 15);
});

test('publishes coordinator snapshots to Settings when the main run state changes', async () => {
  const windows = [];
  class FakeBrowserWindow {
    constructor() { this.destroyed = false; this.webContents = { send: (...args) => this.sent.push(args) }; this.sent = []; windows.push(this); }
    loadFile() {} isDestroyed() { return this.destroyed; } show() {} focus() {}
  }
  const handlers = new Map();
  const controller = createSettingsWindowController({
    BrowserWindow: FakeBrowserWindow, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: () => {} },
    store: {}, manager: {}, coordinator: { snapshot: async () => ({ busy: true, turns: [] }) },
  });
  controller.show();
  await controller.refresh();
  assert.deepEqual(windows[0].sent, [['settings:session-state', { busy: true, turns: [] }]]);
});

test('exposes only payload-free session snapshots and name/title/id mutations', async () => {
  const { handlers, sender } = harness();
  assert.equal(typeof handlers.get('settings:session-snapshot'), 'function');
  for (const channel of ['settings:create-agent', 'settings:rename-agent', 'settings:delete-agent', 'settings:create-session', 'settings:rename-session', 'settings:delete-session', 'settings:select-session', 'settings:set-next-connection']) {
    assert.equal(typeof handlers.get(channel), 'function', channel);
  }
  await assert.rejects(handlers.get('settings:create-agent')({ sender }, { name: 'A', encryptedTurns: 'forged' }));
});
