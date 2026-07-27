'use strict';
const path = require('node:path');
const { createSettingsViewModel } = require('./settings/settingsViewModel.js');
const { AgentError, toPublicError } = require('./agent/agentErrors.js');
const { EFFORTS, MODEL_IDS } = require('./agent/executors/codexModels.js');
const { EFFORTS: CLAUDE_EFFORTS, MODEL_IDS: CLAUDE_MODEL_IDS } = require('./agent/executors/claudeModels.js');

const SETTINGS_CHANNELS = Object.freeze([
  'settings:snapshot', 'settings:save', 'settings:select', 'settings:remove', 'settings:test', 'settings:setup',
  'settings:session-snapshot', 'settings:create-agent', 'settings:rename-agent', 'settings:delete-agent',
  'settings:create-session', 'settings:rename-session', 'settings:delete-session', 'settings:select-session', 'settings:set-next-connection',
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
  ipcMain, sender, settingsWindow, store, manager, coordinator, authorization, onStateChange = () => {},
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
  const session = (method, validate) => async (event, value) => {
    assertSender(event); assertNoPendingAuthorization();
    if (!coordinator || typeof coordinator[method] !== 'function' || !validate(value)) throw new AgentError('UNSUPPORTED_OPTION');
    const result = await coordinator[method](...(Array.isArray(value) ? value : [value])); await onStateChange(); return result;
  };
  ipcMain.handle('settings:session-snapshot', async (event) => { assertSender(event); if (!coordinator) throw new AgentError('UNSUPPORTED_OPTION'); return coordinator.snapshot(); });
  ipcMain.handle('settings:create-agent', session('createAgent', (value) => value && Object.keys(value).length === 1 && typeof value.name === 'string'));
  ipcMain.handle('settings:rename-agent', session('renameAgent', (value) => Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'string')));
  ipcMain.handle('settings:delete-agent', session('removeAgent', (value) => typeof value === 'string'));
  ipcMain.handle('settings:create-session', session('createSession', (value) => value && ['agentId', 'title', 'workspacePath'].every((key) => typeof value[key] === 'string') && Object.keys(value).length === 3));
  ipcMain.handle('settings:rename-session', session('renameSession', (value) => Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'string')));
  ipcMain.handle('settings:delete-session', session('removeSession', (value) => typeof value === 'string'));
  ipcMain.handle('settings:select-session', session('select', (value) => value && typeof value.agentId === 'string' && (value.sessionId === null || typeof value.sessionId === 'string') && Object.keys(value).length === 2));
  ipcMain.handle('settings:set-next-connection', session('setNextConnection', (value) => value && typeof value.sessionId === 'string' && typeof value.connectionId === 'string' && Object.keys(value).length === 2));
}

function unregisterSettingsIpc(ipcMain) {
  if (typeof ipcMain.removeHandler !== 'function') return;
  for (const channel of SETTINGS_CHANNELS) ipcMain.removeHandler(channel);
}

function createSettingsWindow({ BrowserWindow, ipcMain, store, manager, coordinator, authorization, onStateChange }) {
  const window = new BrowserWindow({ width: 900, height: 680, show: false, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'settings-preload.js'), contextIsolation: true, nodeIntegration: false } });
  unregisterSettingsIpc(ipcMain);
  registerSettingsIpc({
    ipcMain, sender: window.webContents, settingsWindow: window,
    store, manager, coordinator, authorization, onStateChange,
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
    async refresh() {
      if (!window || window.isDestroyed() || !options.coordinator) return;
      window.webContents.send('settings:session-state', await options.coordinator.snapshot());
    },
  });
}

module.exports = { createSettingsWindow, createSettingsWindowController, registerSettingsIpc };
