const { app, BrowserWindow, Tray, Menu, screen, ipcMain, dialog } = require('electron');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { safeStorage } = require('electron');
const { start: startPromptServer } = require('./bridge/promptServer.js');
const { createAgentRuntime, shouldEnableTestExecutor } = require('./agentRuntime.js');
const { createPromptController } = require('./promptController.js');
const { createSettingsWindowController } = require('./settingsWindow.js');
const { createResponseWindow } = require('./responseWindow.js');
const { createResponsePreferences } = require('./response/responsePreferences.js');
const { createFullComputerAuthorization } = require('./agent/fullComputerAuthorization.js');
const { createTrayMenuTemplate } = require('./trayMenu.js');
const { loadPetManifestWithDataUrl } = require('./petAssets.js');
const { createPetAnimationController } = require('./petAnimationController.js');
const { authorizeTextAttachment } = require('./bridge/attachmentAuthorization.js');

let petWindow = null;
let tray = null;
let settingsWindowController = null;
let responseWindow = null;
let runtime = null;
let promptController = null;
let authorization = null;
let trayRefreshGeneration = 0;
let refreshSessionState = async () => {};
let animation = null;
let animationSequence = 0;
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
    onShow: () => petWindow?.show(),
    onHide: () => petWindow?.hide(),
    onSettings: () => settingsWindowController?.show(),
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
ipcMain.on('pet:drag-start', (event) => { if (event.sender !== petWindow?.webContents) throw new Error('Invalid pet sender'); animation?.dragStarted(); });
ipcMain.on('pet:drag-move', (event, { dx, dy }) => {
  if (event.sender !== petWindow?.webContents) throw new Error('Invalid pet sender');
  if (!petWindow || !Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) > 500 || Math.abs(dy) > 500) return;
  const [x, y] = petWindow.getPosition();
  petWindow.setPosition(x + dx, y + dy);
  animation?.dragMoved(dx);
});
ipcMain.on('pet:drag-end', (event) => { if (event.sender !== petWindow?.webContents) throw new Error('Invalid pet sender'); animation?.dragEnded(); });

app.whenReady().then(async () => {
  if (app.isPackaged && process.env.CLAUDE_PET_TEST_EXECUTOR) throw new Error('CLAUDE_PET_TEST_EXECUTOR is unavailable in packaged builds.');
  createPetWindow();
  runtime = createAgentRuntime({ userDataPath: app.getPath('userData'), crypto: {
    isAvailable: async () => safeStorage.isEncryptionAvailable(), encrypt: async (value) => safeStorage.encryptString(value), decrypt: async (value) => ({ value: safeStorage.decryptString(value), shouldReEncrypt: false }),
  }, randomId: () => crypto.randomUUID(), testExecutorEnabled: shouldEnableTestExecutor({ isPackaged: app.isPackaged, nodeEnv: process.env.NODE_ENV, value: process.env.CLAUDE_PET_TEST_EXECUTOR }), confirmProviderSwitch: async () => {
    const result = await dialog.showMessageBox(petWindow, { type: 'warning', buttons: ['Continue', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Share bounded session history?', message: 'This provider will receive the bounded visible history from this Claude Pet session', detail: 'No provider sign-in state, native resume ID, hidden state, or raw activity history is shared.' });
    return result.response === 0;
  } });
  await runtime.initialize();
  const manifest = loadPetManifestWithDataUrl({ assetsDir: ASSETS_DIR, readFileSync: fs.readFileSync });
  animation = createPetAnimationController({ manifest, publish: publishPetState });
  authorization = createFullComputerAuthorization({
    store: runtime.store,
    showMessageBox: (window, options) => dialog.showMessageBox(window, options),
    randomBytes: crypto.randomBytes,
  });
  responseWindow = createResponseWindow({ BrowserWindow, screen });
  settingsWindowController = createSettingsWindowController({
    BrowserWindow, ipcMain, store: runtime.store, manager: runtime.manager, coordinator: runtime.coordinator,
    authorization, onStateChange: async () => { await refreshSessionState(); await refreshTray(); },
  });
  settingsWindowController.show();
  const responsePreferences = createResponsePreferences({ filePath: path.join(app.getPath('userData'), 'response-preferences.json') });
  const responseState = require('./response/responseState.js').createResponseState({ readPreference: responsePreferences.read, writePreference: responsePreferences.write });
  const publish = () => { const state = responseState.snapshot(); responseWindow?.webContents.send('response:state', state); responseWindow?.webContents.send('response:activity', state); };
  refreshSessionState = async () => { responseState.setSessionSnapshot(await runtime.coordinator.snapshot()); publish(); };
  await refreshSessionState();
  runtime.activity.subscribe((activity) => { responseState.setActivity(activity); animation?.activity(animation.currentToken()); publish(); });
  const afterRunStateChange = () => { void refreshSessionState(); void refreshTray(); void settingsWindowController?.refresh(); };
  promptController = createPromptController({ manager: runtime.coordinator, animation, response: {
    begin: (context) => { responseState.begin(context); responseWindow?.showInactive(); afterRunStateChange(); },
    success: (value) => { responseState.success(value); afterRunStateChange(); },
    failure: (value) => { responseState.failure(value); afterRunStateChange(); },
    stopped: () => { responseState.stopped(); afterRunStateChange(); },
    dismiss: () => { responseState.dismiss(); afterRunStateChange(); },
  }, onBusyChange: () => { void settingsWindowController?.refresh(); } });
  const assertResponseSender = (event) => {
    if (event.sender !== responseWindow?.webContents) throw new Error('Invalid response sender');
  };
  ipcMain.handle('response:stop', (event) => { assertResponseSender(event); return promptController.stop(); });
  ipcMain.handle('response:state', (event) => { assertResponseSender(event); return responseState.snapshot(); });
  ipcMain.handle('response:dismiss', (event) => { assertResponseSender(event); return promptController.dismiss(); });
  ipcMain.handle('response:open-settings', (event) => { assertResponseSender(event); return settingsWindowController?.show(); });
  ipcMain.handle('response:set-activity-view', (event, value) => { assertResponseSender(event); responseState.setActivityView(value); publish(); return responseState.snapshot(); });
  startPromptServer((text) => promptController.submitText(text).catch(() => {}));
  ipcMain.handle('pet:submit-text-file', async (event, filePath) => {
    if (event.sender !== petWindow?.webContents) throw new Error('Invalid pet sender');
    const authorization = await authorizeTextAttachment({ filePath });
    try { const attachment = await authorization.consume(); return promptController.submitText(require('./bridge/fileContext.js').buildAttachmentPrompt(attachment)); } finally { await authorization.cancel(); }
  });
  createTray();
});

app.on('window-all-closed', (event) => {
  // Tray-resident app: do not quit when the window closes.
  event.preventDefault();
});

module.exports = { getPetWindow: () => petWindow };
