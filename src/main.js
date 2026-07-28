const { app, BrowserWindow, Tray, Menu, screen, ipcMain, dialog } = require('electron');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { safeStorage } = require('electron');
const { start: startPromptServer } = require('./bridge/promptServer.js');
const { createAgentRuntime, shouldEnableTestExecutor } = require('./agentRuntime.js');
const { createPromptController } = require('./promptController.js');
const { createAppWindowController, createVisibleRequestTracker } = require('./appWindow.js');
const { createFullComputerAuthorization } = require('./agent/fullComputerAuthorization.js');
const { createTrayMenuTemplate } = require('./trayMenu.js');
const { loadPetManifestWithDataUrl } = require('./petAssets.js');
const { createPetAnimationController } = require('./petAnimationController.js');
const { authorizeTextAttachment } = require('./bridge/attachmentAuthorization.js');
const { claimSingleInstance } = require('./singleInstance.js');
const { promptPortFromArguments } = require('./runtimeArguments.js');

const userDataArgument = process.argv.find((value) => value.startsWith('--user-data-dir='));
const promptPort = promptPortFromArguments(process.argv);
if (userDataArgument) {
  const requestedUserData = userDataArgument.slice('--user-data-dir='.length);
  if (requestedUserData && !requestedUserData.includes('\0')) {
    app.setPath('userData', path.resolve(requestedUserData));
  }
}

let petWindow = null;
let tray = null;
let appWindowController = null;
let runtime = null;
let promptController = null;
let authorization = null;
let trayRefreshGeneration = 0;
let animation = null;
let animationSequence = 0;
let requestTracker = null;
function publishPetState(state) { const envelope = { animationSequence: ++animationSequence, state }; petWindow?.webContents.send('pet:state', envelope); return envelope; }

function createPetWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = 192;
  const windowHeight = 208;

  petWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: screenWidth - windowWidth - 24,
    y: screenHeight - windowHeight - 24,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  petWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  return petWindow;
}

function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'assets', 'tray-icon.png'));
  tray.setToolTip('Claude Pet — Post-Hoc Banana Baron');
  void refreshTray();
}

async function refreshTray() {
  if (!tray || !runtime) return;
  const generation = ++trayRefreshGeneration;
  const managerState = runtime.manager.getSnapshot();
  let permissionProfile = managerState.permissionProfile || null;
  let connectionId = managerState.connectionId || null;
  if (!managerState.busy) connectionId = await runtime.store.getActiveSelection();
  if (!permissionProfile && connectionId) {
    permissionProfile = (await runtime.store.getConnection(connectionId))?.permissionProfile || null;
  }
  if (generation !== trayRefreshGeneration || !tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(createTrayMenuTemplate({
    permissionProfile,
    busy: managerState.busy,
    onOpenApp: () => appWindowController?.show({ view: 'conversation' }),
    onHide: () => petWindow?.hide(),
    onSettings: () => appWindowController?.show({ view: 'settings' }),
    onQuit: () => app.quit(),
  })));
}

// Renderer can't fetch() file:// URLs, so main validates the manifest and
// inlines the matching PNG/WebP bytes before handing it over IPC.
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

ipcMain.handle('pet:get-manifest', (event) => {
  if (event.sender !== petWindow?.webContents) throw new Error('Invalid pet sender');
  return loadPetManifestWithDataUrl({ assetsDir: ASSETS_DIR, readFileSync: fs.readFileSync });
});

ipcMain.handle('pet:ready', (event) => {
  if (event.sender !== petWindow?.webContents) throw new Error('Invalid pet sender');
  animation?.appReady(); return { animationSequence, state: animation?.snapshot().state || 'idle' };
});
ipcMain.handle('pet:open-app', (event) => {
  if (event.sender !== petWindow?.webContents) throw new Error('Invalid pet sender');
  return appWindowController?.show({ view: 'conversation' }) !== undefined;
});
ipcMain.on('pet:drag-start', (event) => { if (event.sender !== petWindow?.webContents) throw new Error('Invalid pet sender'); animation?.dragStarted(); });
ipcMain.on('pet:drag-move', (event, { dx, dy }) => {
  if (event.sender !== petWindow?.webContents) throw new Error('Invalid pet sender');
  if (!petWindow || !Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) > 500 || Math.abs(dy) > 500) return;
  const [x, y] = petWindow.getPosition();
  petWindow.setPosition(x + dx, y + dy);
  animation?.dragMoved(dx);
});
ipcMain.on('pet:drag-end', (event) => { if (event.sender !== petWindow?.webContents) throw new Error('Invalid pet sender'); animation?.dragEnded(); });

const isPrimaryInstance = claimSingleInstance(app, () => {
  if (appWindowController) {
    appWindowController.show({ view: 'conversation' });
    return;
  }
  void app.whenReady().then(() => appWindowController?.show({ view: 'conversation' }));
});

if (isPrimaryInstance) app.whenReady().then(async () => {
  if (app.isPackaged && process.env.CLAUDE_PET_TEST_EXECUTOR) throw new Error('CLAUDE_PET_TEST_EXECUTOR is unavailable in packaged builds.');
  createPetWindow();
  runtime = createAgentRuntime({ userDataPath: app.getPath('userData'), crypto: {
    isAvailable: async () => safeStorage.isEncryptionAvailable(), encrypt: async (value) => safeStorage.encryptString(value), decrypt: async (value) => ({ value: safeStorage.decryptString(value), shouldReEncrypt: false }),
  }, randomId: () => crypto.randomUUID(), testExecutorEnabled: shouldEnableTestExecutor({ isPackaged: app.isPackaged, nodeEnv: process.env.NODE_ENV, value: process.env.CLAUDE_PET_TEST_EXECUTOR }), confirmProviderSwitch: async () => {
    const result = await dialog.showMessageBox(petWindow, { type: 'warning', buttons: ['Continue', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Share bounded session history?', message: 'This provider will receive the bounded visible history from this Claude Pet session', detail: 'No provider sign-in state, native resume ID, hidden state, or raw activity history is shared.' });
    return result.response === 0;
  } });
  await runtime.initialize();
  const activeConnectionId = await runtime.store.getActiveSelection();
  if (activeConnectionId) await runtime.coordinator.ensureSessionForConnection(activeConnectionId);
  const manifest = loadPetManifestWithDataUrl({ assetsDir: ASSETS_DIR, readFileSync: fs.readFileSync });
  animation = createPetAnimationController({ manifest, publish: publishPetState });
  authorization = createFullComputerAuthorization({
    store: runtime.store,
    showMessageBox: (window, options) => dialog.showMessageBox(window, options),
    randomBytes: crypto.randomBytes,
  });
  runtime.activity.subscribe(() => { animation?.activity(animation.currentToken()); });
  const afterRunStateChange = () => {
    void refreshTray();
    void appWindowController?.publish();
  };
  promptController = createPromptController({ manager: runtime.coordinator, animation, response: {
    begin: (context) => {
      void appWindowController?.setNotice({
        status: 'waiting',
        message: 'Claude Pet is working.',
        agentId: context.agentId,
        request: requestTracker?.visibleRequest() || '',
      });
      afterRunStateChange();
    },
    success: () => {
      void appWindowController?.setNotice({
        status: 'success',
        message: 'Task completed.',
        action: 'Continue',
        request: requestTracker?.visibleRequest() || '',
      });
      afterRunStateChange();
    },
    failure: (value) => {
      void appWindowController?.setNotice({
        status: 'error',
        message: value?.message || 'The task could not be completed.',
        action: 'Retry',
        request: requestTracker?.visibleRequest() || '',
      });
      afterRunStateChange();
    },
    stopped: () => {
      void appWindowController?.setNotice({
        status: 'stopped',
        message: 'Task stopped.',
        action: 'Retry',
        request: requestTracker?.visibleRequest() || '',
      });
      afterRunStateChange();
    },
    dismiss: () => {
      void appWindowController?.setNotice(null);
      afterRunStateChange();
    },
  }, onBusyChange: afterRunStateChange });
  requestTracker = createVisibleRequestTracker({
    submit: (text) => promptController.submitText(text),
  });
  const submitAttachment = async (filePath) => {
    const attachmentAuthorization = await authorizeTextAttachment({ filePath });
    try {
      const attachment = await attachmentAuthorization.consume();
      requestTracker.noteAttachment();
      return promptController.submitText(
        require('./bridge/fileContext.js').buildAttachmentPrompt(attachment),
      );
    } finally {
      await attachmentAuthorization.cancel();
    }
  };
  appWindowController = createAppWindowController({
    BrowserWindow,
    ipcMain,
    coordinator: runtime.coordinator,
    connections: runtime.store,
    manager: runtime.manager,
    activity: runtime.activity,
    updateAgent: ({ agentId, name, marker, instruction }) => runtime.sessions.updateAgent(
      agentId,
      { name, marker, instruction },
    ),
    saveConnection: async (draft) => {
      const saved = await authorization.save(appWindowController?.getWindow() || petWindow, draft);
      await refreshTray();
      return saved;
    },
    submitGoal: (text) => requestTracker.submit(text),
    stopRun: () => promptController.stop(),
    retryGoal: () => requestTracker.retry(),
    chooseTextFile: async () => {
      const result = await dialog.showOpenDialog(appWindowController?.getWindow() || petWindow, {
        title: 'Attach one text file',
        properties: ['openFile'],
        filters: [{ name: 'Text files', extensions: ['txt', 'md', 'json', 'csv', 'log'] }],
      });
      if (result.canceled || result.filePaths.length !== 1) return null;
      return submitAttachment(result.filePaths[0]);
    },
  });
  appWindowController.show({ view: 'conversation' });
  try {
    await startPromptServer(
      (text) => requestTracker.submit(text).catch(() => {}),
      promptPort === null ? {} : { port: promptPort },
    );
  } catch (error) {
    const occupied = error?.code === 'EADDRINUSE';
    await dialog.showMessageBox(appWindowController?.getWindow() || petWindow, {
      type: 'error',
      buttons: ['Close'],
      title: 'Claude Pet could not start',
      message: occupied
        ? 'Claude Pet is already running, or its local prompt connection is busy.'
        : 'Claude Pet could not open its local prompt connection.',
      detail: occupied
        ? 'Close the other Claude Pet window and try again.'
        : 'Close Claude Pet and try again.',
    });
    app.quit();
    return;
  }
  ipcMain.handle('pet:submit-text-file', async (event, filePath) => {
    if (event.sender !== petWindow?.webContents) throw new Error('Invalid pet sender');
    return submitAttachment(filePath);
  });
  createTray();
});

app.on('window-all-closed', (event) => {
  // Tray-resident app: do not quit when the window closes.
  event.preventDefault();
});

module.exports = { getPetWindow: () => petWindow };
