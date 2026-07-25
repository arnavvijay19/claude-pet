'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('response', Object.freeze({
  state: () => ipcRenderer.invoke('response:state'),
  onState: (callback) => ipcRenderer.on('response:state', (_event, value) => callback(value)),
  onActivity: (callback) => ipcRenderer.on('response:activity', (_event, value) => callback(value)),
  stop: () => ipcRenderer.invoke('response:stop'),
  dismiss: () => ipcRenderer.invoke('response:dismiss'),
  openSettings: () => ipcRenderer.invoke('response:open-settings'),
  setActivityView: (value) => ipcRenderer.invoke('response:set-activity-view', value),
}));
