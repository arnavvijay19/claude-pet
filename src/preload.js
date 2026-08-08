const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('claudePet', {
  // fetch() cannot load file:// resources, so the manifest comes over IPC instead.
  getManifest: () => ipcRenderer.invoke('pet:get-manifest'),
  openApp: () => ipcRenderer.invoke('pet:open-app'),
  onState: (callback) => { ipcRenderer.on('pet:state', (_event, envelope) => { if (envelope && typeof envelope.state === 'string') callback(envelope.state); }); return ipcRenderer.invoke('pet:ready').then((envelope) => callback(envelope.state)); },
  // Phase 3 Task 4 sub-branch 3: the pet window consumes the run progress ring
  // and the sign-in / failure attention badge published by petCouplingController.
  onProgress: (callback) => { if (typeof callback !== 'function') return; ipcRenderer.on('pet:progress', (_event, payload) => { if (payload && Number.isFinite(payload.progress)) callback(payload.progress); }); },
  onAttention: (callback) => { if (typeof callback !== 'function') return; ipcRenderer.on('pet:attention', (_event, payload) => { if (payload && typeof payload.attention === 'string') callback({ attention: payload.attention, label: typeof payload.label === 'string' ? payload.label : null }); }); },
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('pet:drag-move', { dx, dy }),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  submitTextFile: (file) => { if (!file || typeof file !== 'object') return Promise.reject(new Error('Invalid file')); return ipcRenderer.invoke('pet:submit-text-file', webUtils.getPathForFile(file)); },
});
