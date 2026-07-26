'use strict';
const path = require('node:path');
const { createSettingsViewModel } = require('./settings/settingsViewModel.js');
const { AgentError, toPublicError } = require('./agent/agentErrors.js');
const { EFFORTS, MODEL_IDS } = require('./agent/executors/codexModels.js');
const { EFFORTS: CLAUDE_EFFORTS, MODEL_IDS: CLAUDE_MODEL_IDS } = require('./agent/executors/claudeModels.js');

const SETTINGS_CHANNELS = Object.freeze([
  'settings:snapshot', 'settings:save', 'settings:select', 'settings:remove', 'settings:test', 'settings:setup',
]);

function validDraft(value) {
  const required = ['executorType', 'label', 'workspacePath', 'permissionProfile', 'modelId', 'effort', 'keyHint'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype
      || !Object.keys(value).every((key) => required.includes(key) || key === 'id')
      || !required.every((key) => Object.hasOwn(value, key))) return false;
  if (value.executorType === 'offline-demo') return value.permissionProfile === 'workspace'
    && value.modelId === 'offline-demo' && value.effort === null;
  if (!['workspace', 'full-computer'].includes(value.permissionProfile)) return false;
  if (value.executorType === 'codex-cli') return MODEL_IDS.includes(value.modelId) && EFFORTS.includes(value.effort);
  return value.executorType === 'claude-code-cli' && CLAUDE_MODEL_IDS.includes(value.modelId) && CLAUDE_EFFORTS.includes(value.effort);
}
function registerSettingsIpc({
  ipcMain, sender, settingsWindow, store, manager, authorization, onStateChange = () => {},
}) {
  const assertSender = (event) => { if (event.sender !== sender) throw new Error('Invalid Settings sender'); };
  const assertNoPendingAuthorization = () => {
    if (authorization?.isPending?.()) throw new AgentError('FULL_COMPUTER_CONFIRMATION_REQUIRED');
  };
  const snapshot = async () => createSettingsViewModel({ connections: await store.listConnections(), activeId: await store.getActiveSelection() });
  ipcMain.handle('settings:snapshot', async (event) => { assertSender(event); return snapshot(); });
  ipcMain.handle('settings:save', async (event, draft) => {
    assertSender(event);
    assertNoPendingAuthorization();
    if (!validDraft(draft) || typeof draft.workspacePath !== 'string'
        || draft.workspacePath.trim().length === 0) {
      throw new AgentError('UNSUPPORTED_OPTION');
    }
    if (!authorization || typeof authorization.save !== 'function') {
      throw new AgentError('FULL_COMPUTER_CONFIRMATION_REQUIRED');
    }
    await authorization.save(settingsWindow, draft);
    await onStateChange();
    return snapshot();
  });
  ipcMain.handle('settings:select', async (event, id) => {
    assertSender(event); assertNoPendingAuthorization();
    if (id !== null && typeof id !== 'string') throw new AgentError('UNSUPPORTED_OPTION');
    await store.setActiveSelection(id); await onStateChange(); return snapshot();
  });
  ipcMain.handle('settings:remove', async (event, id) => {
    assertSender(event); assertNoPendingAuthorization();
    if (typeof id !== 'string' || !id) throw new AgentError('UNSUPPORTED_OPTION');
    const removed = await store.removeConnection(id); await onStateChange(); return removed;
  });
  ipcMain.handle('settings:test', async (event) => {
    assertSender(event);
    const activeId = await store.getActiveSelection();
    const active = (await store.listConnections()).find((connection) => connection.id === activeId);
    const executorType = active?.executorType || null;
    try {
      return { executorType, status: await manager.getStatus(), permission: await manager.verifyPermissionProfile() };
    } catch (error) {
      return { executorType, failure: toPublicError(error) };
    }
  });
  ipcMain.handle('settings:setup', async (event) => { assertSender(event); return manager.beginSetup(); });
}

function unregisterSettingsIpc(ipcMain) {
  if (typeof ipcMain.removeHandler !== 'function') return;
  for (const channel of SETTINGS_CHANNELS) ipcMain.removeHandler(channel);
}

function createSettingsWindow({ BrowserWindow, ipcMain, store, manager, authorization, onStateChange }) {
  const window = new BrowserWindow({ width: 900, height: 680, show: false, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'settings-preload.js'), contextIsolation: true, nodeIntegration: false } });
  unregisterSettingsIpc(ipcMain);
  registerSettingsIpc({
    ipcMain, sender: window.webContents, settingsWindow: window,
    store, manager, authorization, onStateChange,
  });
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
