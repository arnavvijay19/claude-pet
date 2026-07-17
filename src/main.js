const { app, BrowserWindow, Tray, Menu, screen, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

let petWindow = null;
let tray = null;

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

app.whenReady().then(() => {
  createPetWindow();
  createTray();
  // promptServer wiring is added in Task 7 (the module doesn't exist yet).
});

app.on('window-all-closed', (event) => {
  // Tray-resident app: do not quit when the window closes.
  event.preventDefault();
});

module.exports = { getPetWindow: () => petWindow };
