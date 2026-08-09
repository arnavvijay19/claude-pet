const { app, BrowserWindow, Tray, Menu, screen, ipcMain, dialog } = require('electron');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { safeStorage } = require('electron');
const { start: startPromptServer } = require('./bridge/promptServer.js');
const { createAgentRuntime, shouldEnableTestExecutor, shouldEnableStageTiming } = require('./agentRuntime.js');
const { createPromptController } = require('./promptController.js');
const { createAppWindowController, createVisibleRequestTracker } = require('./appWindow.js');
const { createFullComputerAuthorization } = require('./agent/fullComputerAuthorization.js');
const { createTrayMenuTemplate } = require('./trayMenu.js');
const { loadPetManifestWithDataUrl } = require('./petAssets.js');
const { createPetAnimationController } = require('./petAnimationController.js');
const { createPetCouplingController } = require('./agent/petCouplingController.js');
const { derivePetInput, progressFromActivity } = require('./agent/petStateModel.js');
const { authorizeTextAttachment } = require('./bridge/attachmentAuthorization.js');
const { claimSingleInstance } = require('./singleInstance.js');
const { createSafeStorageCrypto } = require('./agent/safeStorageCrypto.js');
const { createPendingAttachment } = require('./bridge/pendingAttachment.js');
const { TEXT_ATTACHMENT_EXTENSIONS } = require('./bridge/attachmentPolicy.js');
const { validateGoal } = require('./agent/goalLimits.js');
const {
  promptPortFromArguments,
  promptTokenFromEnvironment,
} = require('./runtimeArguments.js');

const userDataArgument = process.argv.find((value) => value.startsWith('--user-data-dir='));
const promptPort = promptPortFromArguments(process.argv);
const promptToken = promptTokenFromEnvironment(process.env);
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
let pendingAttachment = null;
let isQuitting = false;
function publishPetState(state) { const envelope = { animationSequence: ++animationSequence, state }; petWindow?.webContents.send('pet:state', envelope); return envelope; }

app.on('before-quit', () => { isQuitting = true; });

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
  if (app.isPackaged && process.env.CLAUDE_PET_STAGE_TIMING) throw new Error('CLAUDE_PET_STAGE_TIMING is unavailable in packaged builds.');
  createPetWindow();
  runtime = createAgentRuntime({ userDataPath: app.getPath('userData'), crypto: createSafeStorageCrypto(safeStorage), randomId: () => crypto.randomUUID(), testExecutorEnabled: shouldEnableTestExecutor({ isPackaged: app.isPackaged, nodeEnv: process.env.NODE_ENV, value: process.env.CLAUDE_PET_TEST_EXECUTOR }), stageTimingEnabled: shouldEnableStageTiming({ isPackaged: app.isPackaged, value: process.env.CLAUDE_PET_STAGE_TIMING }), confirmProviderSwitch: async () => {
    const result = await dialog.showMessageBox(petWindow, { type: 'warning', buttons: ['Continue', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Share bounded session history?', message: 'This provider will receive the bounded visible history from this Claude Pet session', detail: 'No provider sign-in state, native resume ID, hidden state, or raw activity history is shared.' });
    return result.response === 0;
  } });
  await runtime.initialize();
  const activeConnectionId = await runtime.store.getActiveSelection();
  if (activeConnectionId) await runtime.coordinator.ensureSessionForConnection(activeConnectionId);
  const manifest = loadPetManifestWithDataUrl({ assetsDir: ASSETS_DIR, readFileSync: fs.readFileSync });
  animation = createPetAnimationController({ manifest, publish: publishPetState });
  // Phase 3 Task 4 (sub-branch 2): couple the pet to the SAME connection + run state
  // the ribbon shows. The controller publishes the progress ring + attention to the
  // pet window and reconciles the connection/ambient animation states; the
  // run-lifecycle animation stays with promptController's token flow.
  const petCoupling = createPetCouplingController({
    animation,
    publishProgress: (progress) => petWindow?.webContents.send('pet:progress', { progress }),
    publishAttention: ({ attention, label }) => petWindow?.webContents.send('pet:attention', { attention, label }),
  });
  // Build the normalized { connection, run } input the coupling controller expects
  // from the runtime snapshot, the active connection record, and the activity store.
  async function buildPetInput() {
    const managerState = runtime.manager.getSnapshot();
    const connectionId = managerState.connectionId
      || (managerState.busy ? null : await runtime.store.getActiveSelection());
    const connectionRecord = connectionId ? await runtime.store.getConnection(connectionId) : null;
    const activitySnapshot = runtime.activity.snapshot();
    return derivePetInput({
      managerSnapshot: managerState,
      connectionRecord,
      runProgress: progressFromActivity(activitySnapshot),
    });
  }
  // Reflect the current pet truth into the pet window + animation. Defensive: a
  // failure here must never break the existing activity/run flow it piggybacks on.
  async function petSync() {
    try {
      petCoupling.sync(await buildPetInput());
    } catch {
      // Observers must not affect runtime or run state.
    }
  }
  void petSync();
  authorization = createFullComputerAuthorization({
    store: runtime.store,
    showMessageBox: (window, options) => dialog.showMessageBox(window, options),
    randomBytes: crypto.randomBytes,
  });
  runtime.activity.subscribe(() => { animation?.activity(animation.currentToken()); void petSync(); });
  const afterRunStateChange = () => {
    void refreshTray();
    void appWindowController?.publish();
    void petSync();
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
    submit: (text, { attachment }) => promptController.submitText(text, { attachment }),
  });
  pendingAttachment = createPendingAttachment({
    authorize: authorizeTextAttachment,
    confirm: async ({ name, size }) => {
      const result = await dialog.showMessageBox(
        appWindowController?.getWindow() || petWindow,
        {
          type: 'question',
          buttons: ['Attach file', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
          title: 'Attach this file?',
          message: name,
          detail: `${size.toLocaleString()} bytes · The file will be staged for your next message.`,
        },
      );
      return result.response === 0;
    },
  });
  const chooseAttachment = async () => {
    const result = await dialog.showOpenDialog(appWindowController?.getWindow() || petWindow, {
      title: 'Attach one readable file',
      properties: ['openFile'],
      filters: [{
        name: 'Readable text and code',
        extensions: [...TEXT_ATTACHMENT_EXTENSIONS].map((extension) => extension.slice(1)),
      }],
    });
    if (result.canceled || result.filePaths.length !== 1) return null;
    return pendingAttachment.stage(result.filePaths[0]);
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
    submitGoal: (text) => {
      const metadata = pendingAttachment.snapshot();
      if (metadata) validateGoal(`${text}\n\n[Attached file: ${metadata.name}]`);
      return requestTracker.submit(text, pendingAttachment.take());
    },
    stopRun: () => promptController.stop(),
    retryGoal: () => requestTracker.retry(),
    shouldHideOnClose: () => !isQuitting,
    chooseTextFile: chooseAttachment,
    chooseAttachment,
    clearAttachment: () => pendingAttachment.clear(),
    chooseDirectory: async () => {
      const result = await dialog.showOpenDialog(appWindowController?.getWindow() || petWindow, {
        title: 'Choose project folder',
        properties: ['openDirectory'],
      });
      return result.canceled || result.filePaths.length !== 1 ? null : result.filePaths[0];
    },
    confirmDeleteSession: async () => {
      const result = await dialog.showMessageBox(
        appWindowController?.getWindow() || petWindow,
        {
          type: 'warning',
          buttons: ['Delete session', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          title: 'Delete this session?',
          message: 'Delete the selected session and its saved conversation?',
          detail: 'Agents and provider connections will not be deleted.',
        },
      );
      return result.response === 0;
    },
    pendingAttachment,
  });
  appWindowController.show({ view: 'conversation' });
  try {
    if (promptPort !== null && !promptToken) {
      throw Object.assign(new Error('Prompt token required'), { code: 'PROMPT_TOKEN_REQUIRED' });
    }
    if (promptPort !== null && promptToken) {
      await startPromptServer(
        (text) => requestTracker.submit(text).catch(() => {}),
        { port: promptPort, token: promptToken },
      );
    }
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
    const staged = await pendingAttachment.stage(filePath);
    if (staged) appWindowController.show({ view: 'conversation' });
    return staged;
  });
  // Phase 3 Task 8: export a session to a user-chosen local path. Only our own renderer
  // windows may trigger a file write; the user picks the destination via the native
  // save dialog. No cloud / network / telemetry.
  ipcMain.handle('pet:save-text-file', async (event, payload) => {
    const knownSender = (petWindow && event.sender === petWindow.webContents)
      || (appWindowController && appWindowController.getWindow && event.sender === appWindowController.getWindow()?.webContents);
    if (!knownSender) throw new Error('Invalid sender');
    const content = payload && typeof payload.content === 'string' ? payload.content : '';
    if (!content) return { saved: false, error: 'empty' };
    const safeName = (payload.filename && typeof payload.filename === 'string')
      ? payload.filename.replace(/[\\/:*?"<>|]/g, '_')
      : 'session.md';
    const defaultPath = (payload.workspacePath && typeof payload.workspacePath === 'string')
      ? path.join(payload.workspacePath, safeName)
      : safeName;
    const ownerWindow = appWindowController?.getWindow() || petWindow;
    const { canceled, filePath: chosenPath } = await dialog.showSaveDialog(ownerWindow, {
      title: 'Export session',
      defaultPath,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || !chosenPath) return { saved: false };
    await fs.promises.writeFile(chosenPath, content, 'utf8');
    return { saved: true, filePath: chosenPath };
  });
  createTray();
});

app.on('window-all-closed', (event) => {
  // Tray-resident app: do not quit when the window closes.
  if (!isQuitting) event.preventDefault();
});

module.exports = { getPetWindow: () => petWindow };
