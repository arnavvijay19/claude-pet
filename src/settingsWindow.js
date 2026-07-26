'use strict';
const path = require('node:path');
const { createSettingsViewModel } = require('./settings/settingsViewModel.js');
const { EFFORTS, MODEL_IDS } = require('./agent/executors/codexModels.js');
const { EFFORTS: CLAUDE_EFFORTS, MODEL_IDS: CLAUDE_MODEL_IDS } = require('./agent/executors/claudeModels.js');

const SETTINGS_CHANNELS = Object.freeze([
  'settings:snapshot', 'settings:save', 'settings:select', 'settings:remove', 'settings:test', 'settings:setup',
]);

function validDraft(value) {
  const required = ['executorType', 'label', 'workspacePath', 'permissionProfile', 'modelId', 'effort', 'keyHint'];
  if (!value || !Object.keys(value).every((key) => required.includes(key) || key === 'id') || !required.every((key) => Object.hasOwn(value, key)) || value.permissionProfile !== 'workspace') return false;
  if (value.executorType === 'offline-demo') return value.modelId === 'offline-demo' && value.effort === null;
  if (value.executorType === 'codex-cli') return MODEL_IDS.includes(value.modelId) && EFFORTS.includes(value.effort);
  return value.executorType === 'claude-code-cli' && CLAUDE_MODEL_IDS.includes(value.modelId) && CLAUDE_EFFORTS.includes(value.effort);
}
function registerSettingsIpc({ ipcMain, sender, store, manager }) {
  const assertSender = (event) => { if (event.sender !== sender) throw new Error('Invalid Settings sender'); };
  const snapshot = async () => createSettingsViewModel({ connections: await store.listConnections(), activeId: await store.getActiveSelection() });
  ipcMain.handle('settings:snapshot', async (event) => { assertSender(event); return snapshot(); });
  ipcMain.handle('settings:save', async (event, draft) => {
    assertSender(event);
    if (!validDraft(draft) || draft.workspacePath.trim().length === 0) {
      throw new Error('Invalid Workspace-only Offline Demo connection');
    }
    const saved = await store.saveConnection(draft);
    await store.setActiveSelection(saved.id);
    return snapshot();
  });
  ipcMain.handle('settings:select', async (event, id) => { assertSender(event); await store.setActiveSelection(id); return snapshot(); });
  ipcMain.handle('settings:remove', async (event, id) => { assertSender(event); return store.removeConnection(id); });
  ipcMain.handle('settings:test', async (event) => {
    assertSender(event);
    const activeId = await store.getActiveSelection();
    const active = (await store.listConnections()).find((connection) => connection.id === activeId);
    return { executorType: active?.executorType || null, status: await manager.getStatus(), permission: await manager.verifyPermissionProfile() };
  });
  ipcMain.handle('settings:setup', async (event) => { assertSender(event); return manager.beginSetup(); });
}

function unregisterSettingsIpc(ipcMain) {
  if (typeof ipcMain.removeHandler !== 'function') return;
  for (const channel of SETTINGS_CHANNELS) ipcMain.removeHandler(channel);
}

function createSettingsWindow({ BrowserWindow, ipcMain, store, manager }) {
  const window = new BrowserWindow({ width: 900, height: 680, show: false, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'settings-preload.js'), contextIsolation: true, nodeIntegration: false } });
  unregisterSettingsIpc(ipcMain);
  registerSettingsIpc({ ipcMain, sender: window.webContents, store, manager });
  window.loadFile(path.join(__dirname, 'settings', 'index.html'));
  return window;
}

function createSettingsWindowController(options) {
  let window = null;
  return Object.freeze({
    show() {
      if (!window || window.isDestroyed()) window = createSettingsWindow(options);
      window.show();
      window.focus();
      return window;
    },
  });
}

module.exports = { createSettingsWindow, createSettingsWindowController, registerSettingsIpc };
