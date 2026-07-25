const { app, BrowserWindow, Tray, Menu, screen, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { safeStorage } = require('electron');
const { start: startPromptServer } = require('./bridge/promptServer.js');
const { createAgentRuntime } = require('./agentRuntime.js');
const { createPromptController, readRunContext } = require('./promptController.js');
const { createSettingsWindowController } = require('./settingsWindow.js');
const { createResponseWindow } = require('./responseWindow.js');
const { createResponsePreferences } = require('./response/responsePreferences.js');

let petWindow = null;
let tray = null;
let settingsWindowController = null;
let responseWindow = null;
let runtime = null;
let promptController = null;

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
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => petWindow?.show() },
    { label: 'Hide', click: () => petWindow?.hide() },
    { label: 'Settings', click: () => settingsWindowController?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

// Renderer can't fetch() file:// URLs, so the manifest is read here and
// handed over IPC. spritesheetDataUrl inlines the PNG for the same reason.
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

ipcMain.handle('pet:get-manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'pet.json'), 'utf-8'));
  const png = fs.readFileSync(path.join(ASSETS_DIR, manifest.spritesheetPath));
  manifest.spritesheetDataUrl = `data:image/png;base64,${png.toString('base64')}`;
  return manifest;
});

ipcMain.on('pet:move-window', (_event, { dx, dy }) => {
  if (!petWindow) return;
  const [x, y] = petWindow.getPosition();
  petWindow.setPosition(x + dx, y + dy);
});

app.whenReady().then(async () => {
  createPetWindow();
  runtime = createAgentRuntime({ userDataPath: app.getPath('userData'), crypto: {
    isAvailable: async () => safeStorage.isEncryptionAvailable(), encrypt: async (value) => safeStorage.encryptString(value), decrypt: async (value) => ({ value: safeStorage.decryptString(value), shouldReEncrypt: false }),
  }, randomId: () => crypto.randomUUID() });
  await runtime.initialize();
  responseWindow = createResponseWindow({ BrowserWindow, screen });
  settingsWindowController = createSettingsWindowController({ BrowserWindow, ipcMain, store: runtime.store, manager: runtime.manager });
  settingsWindowController.show();
  const responsePreferences = createResponsePreferences({ filePath: path.join(app.getPath('userData'), 'response-preferences.json') });
  const responseState = require('./response/responseState.js').createResponseState({ readPreference: responsePreferences.read, writePreference: responsePreferences.write });
  const publish = () => { const state = responseState.snapshot(); responseWindow?.webContents.send('response:state', state); responseWindow?.webContents.send('response:activity', state); };
  runtime.activity.subscribe((activity) => { responseState.setActivity(activity); publish(); });
  promptController = createPromptController({ manager: runtime.manager, getRunContext: () => readRunContext(runtime.store), response: { begin: (context) => { responseState.begin(context); responseWindow?.showInactive(); publish(); }, success: (value) => { responseState.success(value); publish(); }, failure: (value) => { responseState.failure(value); publish(); }, stopped: () => { responseState.stopped(); publish(); }, dismiss: () => { responseState.dismiss(); publish(); } } });
  ipcMain.handle('response:stop', () => promptController.stop());
  ipcMain.handle('response:state', () => responseState.snapshot());
  ipcMain.handle('response:dismiss', () => promptController.dismiss());
  ipcMain.handle('response:open-settings', () => settingsWindowController?.show());
  ipcMain.handle('response:set-activity-view', (_event, value) => { responseState.setActivityView(value); publish(); return responseState.snapshot(); });
  startPromptServer((text) => promptController.submitText(text).catch(() => {}));
  createTray();
});

app.on('window-all-closed', (event) => {
  // Tray-resident app: do not quit when the window closes.
  event.preventDefault();
});

module.exports = { getPetWindow: () => petWindow };
