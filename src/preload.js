const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('claudePet', {
  // fetch() cannot load file:// resources, so the manifest comes over IPC instead.
  getManifest: () => ipcRenderer.invoke('pet:get-manifest'),
  onState: (callback) => { ipcRenderer.on('pet:state', (_event, envelope) => { if (envelope && typeof envelope.state === 'string') callback(envelope.state); }); return ipcRenderer.invoke('pet:ready').then((envelope) => callback(envelope.state)); },
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('pet:drag-move', { dx, dy }),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  submitTextFile: (file) => { if (!file || typeof file !== 'object') return Promise.reject(new Error('Invalid file')); return ipcRenderer.invoke('pet:submit-text-file', webUtils.getPathForFile(file)); },
});
