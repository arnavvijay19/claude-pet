'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudePetApp', Object.freeze({
  snapshot: () => ipcRenderer.invoke('app:snapshot'),
  subscribe(callback) {
    if (typeof callback !== 'function') throw new TypeError('Snapshot callback required');
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('app:snapshot', listener);
    return () => ipcRenderer.removeListener('app:snapshot', listener);
  },
  intent: (type, data = {}) => ipcRenderer.invoke('app:intent', { type, data }),
}));
