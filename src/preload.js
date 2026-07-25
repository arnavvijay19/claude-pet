const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudePet', {
  // fetch() cannot load file:// resources, so the manifest comes over IPC instead.
  getManifest: () => ipcRenderer.invoke('pet:get-manifest'),
  onPrompt: (callback) => ipcRenderer.on('pet:prompt', (_event, payload) => callback(payload)),
  onResponse: (callback) => ipcRenderer.on('pet:response', (_event, payload) => callback(payload)),
  // Manual window move; file submission is introduced only in Task 14.
  moveWindowBy: (dx, dy) => ipcRenderer.send('pet:move-window', { dx, dy }),
});
