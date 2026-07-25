'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('settings', Object.freeze({ snapshot: () => ipcRenderer.invoke('settings:snapshot'), save: (value) => ipcRenderer.invoke('settings:save', value), select: (id) => ipcRenderer.invoke('settings:select', id), remove: (id) => ipcRenderer.invoke('settings:remove', id), test: () => ipcRenderer.invoke('settings:test') }));
