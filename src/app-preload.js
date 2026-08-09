'use strict';

const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('claudePetApp', Object.freeze({
  snapshot: () => ipcRenderer.invoke('app:snapshot'),
  subscribe(callback) {
    if (typeof callback !== 'function') throw new TypeError('Snapshot callback required');
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('app:snapshot', listener);
    return () => ipcRenderer.removeListener('app:snapshot', listener);
  },
  intent: (type, data = {}) => ipcRenderer.invoke('app:intent', { type, data }),
  // Phase 3 Task 7: "Open project folder" reveals the session's workspace in the OS
  // file manager. Renderer-only shell call — no main-process IPC, no credential exposure.
  openPath: (targetPath) => {
    if (typeof targetPath !== 'string' || !targetPath) return Promise.resolve(false);
    return Promise.resolve(shell.openPath(targetPath)).then((error) => !error);
  },
}));
