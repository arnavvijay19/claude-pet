'use strict';

const path = require('node:path');

const { AgentError, toPublicError } = require('./agent/agentErrors.js');
const { validateGoal } = require('./agent/goalLimits.js');
const {
  MAX_ATTACHMENT_BYTES,
  validateAttachmentName,
} = require('./bridge/attachmentPolicy.js');
const { createAppSnapshot, VIEWS } = require('./app/appSnapshot.js');

const APP_INTENTS = Object.freeze([
  'select-session', 'create-session', 'rename-session', 'delete-session',
  'create-agent', 'update-agent', 'delete-agent',
  'add-participant', 'remove-participant', 'select-participant',
  'set-participant-connection', 'submit-goal', 'stop-run', 'retry-run',
  'choose-text-file', 'choose-attachment', 'clear-attachment', 'choose-directory',
  'confirm-delete-session', 'save-connection', 'delete-connection',
  'test-connection', 'begin-provider-setup', 'set-view',
]);
const APP_CHANNELS = Object.freeze(['app:snapshot', 'app:intent']);
const BUSY_ALLOWED = new Set(['stop-run', 'set-view']);
const CONNECTION_KEYS = Object.freeze([
  'id', 'executorType', 'label', 'workspacePath', 'permissionProfile',
  'modelId', 'effort', 'keyHint', 'secret',
]);
const CONNECTION_REQUIRED = Object.freeze([
  'executorType', 'label', 'workspacePath', 'permissionProfile',
  'modelId', 'effort', 'keyHint',
]);

function unsupported() {
  return new AgentError('UNSUPPORTED_OPTION');
}

function plain(value) {
  return value !== null && typeof value === 'object'
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, keys) {
  return plain(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function string(value, { empty = false, maximum = 32767 } = {}) {
  return typeof value === 'string'
    && (empty || value.trim().length > 0)
    && value.length <= maximum
    && !value.includes('\0')
    && (typeof value.isWellFormed !== 'function' || value.isWellFormed());
}

function id(value) {
  return string(value, { maximum: 200 });
}

function noData(value) {
  return exact(value, []);
}

function connectionDraft(value) {
  if (!plain(value)
      || !Object.keys(value).every((key) => CONNECTION_KEYS.includes(key))
      || !CONNECTION_REQUIRED.every((key) => Object.hasOwn(value, key))
      || (Object.hasOwn(value, 'id') && !id(value.id))
      || !string(value.executorType, { maximum: 200 })
      || !string(value.label, { empty: true, maximum: 80 })
      || !string(value.workspacePath)
      || !['workspace', 'full-computer'].includes(value.permissionProfile)
      || !string(value.modelId, { maximum: 200 })
      || (value.effort !== null && !string(value.effort, { maximum: 80 }))
      || (value.keyHint !== null && !string(value.keyHint, { empty: true, maximum: 200 }))
      || (Object.hasOwn(value, 'secret')
        && value.secret !== null && !string(value.secret, { empty: true, maximum: 8192 }))) {
    throw unsupported();
  }
  return { ...value };
}

async function assertCurrentSession(coordinator, sessionId) {
  const snapshot = await coordinator.snapshot();
  if (snapshot.selection?.sessionId !== sessionId) {
    throw new AgentError('SESSION_SELECTION_EXPIRED');
  }
}

function unregisterAppIpc(ipcMain) {
  if (typeof ipcMain.removeHandler !== 'function') return;
  for (const channel of APP_CHANNELS) ipcMain.removeHandler(channel);
}

function createVisibleRequestTracker({ submit }) {
  if (typeof submit !== 'function') throw new TypeError('Request submitter required');
  let request = null;
  const normalizeAttachment = (value) => {
    if (value === undefined || value === null) return null;
    const keys = ['name', 'extension', 'size', 'text'];
    if (!exact(value, keys)
        || !Number.isSafeInteger(value.size) || value.size < 0
        || value.size > MAX_ATTACHMENT_BYTES
        || typeof value.text !== 'string' || value.text.includes('\0')
        || Buffer.byteLength(value.text, 'utf8') !== value.size) throw unsupported();
    const name = validateAttachmentName(value.name);
    if (name.extension !== value.extension) throw unsupported();
    return Object.freeze({ ...value });
  };
  const visible = (value) => value.attachment
    ? `${value.text}\n\n[Attached file: ${value.attachment.name}]`
    : value.text;
  return Object.freeze({
    async submit(text, attachment = null) {
      const next = Object.freeze({
        text: validateGoal(text),
        attachment: normalizeAttachment(attachment),
      });
      validateGoal(visible(next));
      request = next;
      return submit(next.text, { attachment: next.attachment });
    },
    retry() {
      if (!request) throw new AgentError('GOAL_REQUIRED');
      return submit(request.text, { attachment: request.attachment });
    },
    visibleRequest: () => request ? visible(request) : '',
  });
}

function registerAppIpc({
  ipcMain,
  sender,
  coordinator,
  connections,
  manager,
  updateAgent,
  saveConnection,
  submitGoal,
  stopRun,
  retryGoal,
  chooseTextFile,
  chooseAttachment,
  clearAttachment,
  chooseDirectory,
  confirmDeleteSession,
  publish,
  setView,
}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || !sender
      || !coordinator || !connections || !manager
      || typeof publish !== 'function' || typeof setView !== 'function') {
    throw new TypeError('Application IPC requires main-owned dependencies');
  }
  unregisterAppIpc(ipcMain);
  const assertSender = (event) => {
    if (event.sender !== sender) throw new Error('Invalid app sender');
  };
  const assertIdle = (type) => {
    if (!BUSY_ALLOWED.has(type)
        && (coordinator.busy?.() === true || manager.getSnapshot?.().busy === true)) {
      throw new AgentError('AGENT_BUSY');
    }
  };

  const execute = async (type, data) => {
    assertIdle(type);
    switch (type) {
      case 'select-session':
        if (!exact(data, ['sessionId']) || (data.sessionId !== null && !id(data.sessionId))) throw unsupported();
        return coordinator.select({ sessionId: data.sessionId });
      case 'create-session':
        if (!exact(data, ['agentId', 'title', 'connectionId'])
            || !id(data.agentId) || !string(data.title, { maximum: 80 })
            || !id(data.connectionId)) throw unsupported();
        {
          const created = await coordinator.createSession(data);
          if (created?.id) await coordinator.select({ sessionId: created.id });
          return created;
        }
      case 'rename-session':
        if (!exact(data, ['sessionId', 'title']) || !id(data.sessionId)
            || !string(data.title, { maximum: 80 })) throw unsupported();
        await assertCurrentSession(coordinator, data.sessionId);
        return coordinator.renameSession(data.sessionId, data.title);
      case 'delete-session':
        if (!exact(data, ['sessionId']) || !id(data.sessionId)) throw unsupported();
        await assertCurrentSession(coordinator, data.sessionId);
        return coordinator.removeSession(data.sessionId);
      case 'create-agent':
        if (!exact(data, ['name', 'marker', 'instruction'])
            || !string(data.name, { maximum: 80 })
            || !string(data.marker, { maximum: 40 })
            || !string(data.instruction, { empty: true, maximum: 2000 })
            || Buffer.byteLength(data.instruction, 'utf8') > 2000) throw unsupported();
        return coordinator.createAgent(data);
      case 'update-agent':
        if (!exact(data, ['agentId', 'name', 'marker', 'instruction'])
            || !id(data.agentId) || !string(data.name, { maximum: 80 })
            || !string(data.marker, { maximum: 40 })
            || !string(data.instruction, { empty: true, maximum: 2000 })
            || Buffer.byteLength(data.instruction, 'utf8') > 2000
            || typeof updateAgent !== 'function') throw unsupported();
        return updateAgent(data);
      case 'delete-agent':
        if (!exact(data, ['agentId']) || !id(data.agentId)) throw unsupported();
        return coordinator.removeAgent(data.agentId);
      case 'add-participant':
        if (!exact(data, ['sessionId', 'agentId', 'connectionId'])
            || !id(data.sessionId) || !id(data.agentId) || !id(data.connectionId)) throw unsupported();
        await assertCurrentSession(coordinator, data.sessionId);
        return coordinator.addParticipant(data);
      case 'remove-participant':
        if (!exact(data, ['sessionId', 'agentId'])
            || !id(data.sessionId) || !id(data.agentId)) throw unsupported();
        await assertCurrentSession(coordinator, data.sessionId);
        return coordinator.removeParticipant(data);
      case 'select-participant':
        if (!exact(data, ['sessionId', 'agentId'])
            || !id(data.sessionId) || !id(data.agentId)) throw unsupported();
        await assertCurrentSession(coordinator, data.sessionId);
        return coordinator.selectParticipant(data);
      case 'set-participant-connection':
        if (!exact(data, ['sessionId', 'agentId', 'connectionId'])
            || !id(data.sessionId) || !id(data.agentId) || !id(data.connectionId)) throw unsupported();
        await assertCurrentSession(coordinator, data.sessionId);
        return coordinator.setParticipantConnection(data);
      case 'submit-goal':
        if (!exact(data, ['text'])
            || typeof submitGoal !== 'function') throw unsupported();
        return submitGoal(validateGoal(data.text));
      case 'stop-run':
        if (!noData(data) || typeof stopRun !== 'function') throw unsupported();
        return stopRun();
      case 'retry-run':
        if (!noData(data) || typeof retryGoal !== 'function') throw unsupported();
        return retryGoal();
      case 'choose-text-file':
        if (!noData(data) || typeof chooseTextFile !== 'function') throw unsupported();
        return chooseTextFile();
      case 'choose-attachment':
        if (!noData(data) || typeof chooseAttachment !== 'function') throw unsupported();
        return chooseAttachment();
      case 'clear-attachment':
        if (!noData(data) || typeof clearAttachment !== 'function') throw unsupported();
        return clearAttachment();
      case 'choose-directory':
        if (!noData(data) || typeof chooseDirectory !== 'function') throw unsupported();
        return chooseDirectory();
      case 'confirm-delete-session':
        if (!exact(data, ['sessionId']) || !id(data.sessionId)
            || typeof confirmDeleteSession !== 'function') throw unsupported();
        await assertCurrentSession(coordinator, data.sessionId);
        if (!await confirmDeleteSession(data.sessionId)) return false;
        return coordinator.removeSession(data.sessionId);
      case 'save-connection':
        if (typeof saveConnection !== 'function') throw unsupported();
        return saveConnection(connectionDraft(data));
      case 'delete-connection':
        if (!exact(data, ['connectionId']) || !id(data.connectionId)) throw unsupported();
        return connections.removeConnection(data.connectionId);
      case 'test-connection':
        if (!exact(data, ['connectionId']) || !id(data.connectionId)
            || typeof manager.getStatusFor !== 'function'
            || typeof connections.getConnection !== 'function'
            || !await connections.getConnection(data.connectionId)) throw unsupported();
        try {
          return {
            status: await manager.getStatusFor(data.connectionId),
          };
        } catch (error) {
          return { failure: toPublicError(error) };
        }
      case 'begin-provider-setup':
        if (!exact(data, ['connectionId']) || !id(data.connectionId)
            || typeof manager.beginSetupFor !== 'function'
            || typeof connections.getConnection !== 'function'
            || !await connections.getConnection(data.connectionId)) throw unsupported();
        return manager.beginSetupFor(data.connectionId);
      case 'set-view':
        if (!exact(data, ['view']) || !VIEWS.includes(data.view)) throw unsupported();
        setView(data.view);
        return data.view;
      default:
        throw unsupported();
    }
  };

  ipcMain.handle('app:snapshot', async (event) => {
    assertSender(event);
    return publish();
  });
  ipcMain.handle('app:intent', async (event, request) => {
    assertSender(event);
    if (!exact(request, ['type', 'data']) || !APP_INTENTS.includes(request.type)
        || !plain(request.data)) throw unsupported();
    const result = await execute(request.type, request.data);
    await publish();
    return result;
  });
  return Object.freeze({ unregister: () => unregisterAppIpc(ipcMain) });
}

function createAppWindowController({
  BrowserWindow,
  ipcMain,
  coordinator,
  connections,
  manager,
  activity,
  updateAgent,
  saveConnection,
  submitGoal,
  stopRun,
  retryGoal,
  chooseTextFile,
  chooseAttachment,
  clearAttachment,
  chooseDirectory,
  confirmDeleteSession,
  pendingAttachment,
  shouldHideOnClose = () => true,
}) {
  if (typeof BrowserWindow !== 'function' || !activity
      || typeof activity.snapshot !== 'function' || typeof activity.subscribe !== 'function') {
    throw new TypeError('Application window requires Electron and activity boundaries');
  }
  let window = null;
  let view = 'conversation';
  let notice = null;
  let registration = null;
  let publishing = Promise.resolve();

  const compose = async () => createAppSnapshot({
    coordinator: await coordinator.snapshot(),
    connections: await connections.listConnections(),
    manager: manager.getSnapshot(),
    activity: activity.snapshot(),
    view,
    notice,
    pendingAttachment: pendingAttachment?.snapshot?.() || null,
  });

  const publish = () => {
    const pending = publishing.then(async () => {
      const snapshot = await compose();
      if (window && !window.isDestroyed()) window.webContents.send('app:snapshot', snapshot);
      return snapshot;
    });
    publishing = pending.catch(() => {});
    return pending;
  };

  const activityUnsubscribe = activity.subscribe(() => {
    void publish();
  });

  function createWindow() {
    window = new BrowserWindow({
      width: 1080,
      height: 720,
      minWidth: 900,
      minHeight: 650,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'app-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    registration?.unregister();
    registration = registerAppIpc({
      ipcMain,
      sender: window.webContents,
      coordinator,
      connections,
      manager,
      updateAgent,
      saveConnection,
      submitGoal,
      stopRun,
      retryGoal,
      chooseTextFile,
      chooseAttachment,
      clearAttachment,
      chooseDirectory,
      confirmDeleteSession,
      publish,
      setView(value) { view = value; },
    });
    window.on?.('close', (event) => {
      if (!window || window.isDestroyed()) return;
      if (!shouldHideOnClose()) return;
      event?.preventDefault?.();
      window.hide?.();
    });
    window.on?.('closed', () => {
      registration?.unregister();
      registration = null;
      window = null;
    });
    window.loadFile(path.join(__dirname, 'app', 'index.html'));
    return window;
  }

  return Object.freeze({
    show({ view: nextView = 'conversation' } = {}) {
      if (!VIEWS.includes(nextView)) throw unsupported();
      view = nextView;
      if (!window || window.isDestroyed()) createWindow();
      window.show();
      window.focus();
      void publish();
      return window;
    },
    publish,
    setNotice(value) {
      notice = value;
      return publish();
    },
    hide() { window?.hide?.(); },
    destroy() {
      activityUnsubscribe();
      registration?.unregister();
      registration = null;
      window?.destroy?.();
      window = null;
    },
    getWindow: () => window,
  });
}

module.exports = {
  APP_INTENTS,
  createVisibleRequestTracker,
  createAppWindowController,
  registerAppIpc,
  unregisterAppIpc,
};
