'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSettingsWindowController, registerSettingsIpc } = require('../src/settingsWindow.js');

function harness() {
  const handlers = new Map();
  const sender = {};
  const selected = [];
  const store = { listConnections: async () => [{ id: 'offline', executorType: 'offline-demo', label: 'Offline Demo', workspacePath: 'Z:\\work', permissionProfile: 'workspace', modelId: 'offline-demo', effort: null }], getActiveSelection: async () => selected.at(-1) || 'offline', saveConnection: async (value) => ({ ...value, id: 'saved' }), setActiveSelection: async (id) => { selected.push(id); }, removeConnection: async () => true };
  registerSettingsIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, sender, store, manager: { getStatus: async () => ({ installed: true }), verifyPermissionProfile: async () => ({ available: true, allowed: true }), beginSetup: async () => ({ started: false }) } });
  return { handlers, sender, selected };
}

test('serves only public Settings snapshots to the expected sender', async () => {
  const { handlers, sender } = harness();
  const snapshot = await handlers.get('settings:snapshot')({ sender });
  assert.equal(snapshot.connections[0].executorType, 'offline-demo');
  assert.equal(JSON.stringify(snapshot).includes('secret'), false);
  await assert.rejects(handlers.get('settings:snapshot')({ sender: {} }));
});

test('rejects Full Computer and unknown save fields', async () => {
  const { handlers, sender } = harness();
  await assert.rejects(handlers.get('settings:save')({ sender }, { executorType: 'offline-demo', label: 'Demo', workspacePath: 'Z:\\work', permissionProfile: 'full-computer', modelId: 'offline-demo', effort: null, keyHint: null }));
  await assert.rejects(handlers.get('settings:save')({ sender }, { executorType: 'offline-demo', label: 'Demo', workspacePath: 'Z:\\work', permissionProfile: 'workspace', modelId: 'offline-demo', effort: null, keyHint: null, options: {} }));
});

test('requires a non-empty workspace and selects a newly saved Offline Demo connection', async () => {
  const { handlers, sender, selected } = harness();
  const save = handlers.get('settings:save');
  const draft = { executorType: 'offline-demo', label: 'Demo', workspacePath: 'Z:\\work', permissionProfile: 'workspace', modelId: 'offline-demo', effort: null, keyHint: null };
  await assert.rejects(save({ sender }, { ...draft, workspacePath: '   ' }));
  await save({ sender }, draft);
  assert.deepEqual(selected, ['saved']);
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
  assert.equal(handlers.size, 6);
});
