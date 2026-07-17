const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('claudePet', {
  // fetch() can't load file:// resources, so the manifest comes over IPC instead.
  getManifest: () => ipcRenderer.invoke('pet:get-manifest'),
  onPrompt: (callback) => ipcRenderer.on('pet:prompt', (_event, payload) => callback(payload)),
  onResponse: (callback) => ipcRenderer.on('pet:response', (_event, payload) => callback(payload)),
  // Electron 32+ removed File.prototype.path; webUtils.getPathForFile is the
  // supported way to resolve a dropped File to a filesystem path.
  sendDroppedFile: (file, promptText) =>
    ipcRenderer.send('pet:file-dropped', { filePath: webUtils.getPathForFile(file), promptText }),
  // Manual window-move (no -webkit-app-region — see index.html).
  moveWindowBy: (dx, dy) => ipcRenderer.send('pet:move-window', { dx, dy }),
});
