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
  // Phase 3 Task 8: export a session to a user-chosen local path. The renderer builds
  // the Markdown + a suggested filename/workspace; the main process shows the save
  // dialog and writes the file. No cloud / network / telemetry.
  saveTextFile: (payload) => {
    if (!payload || typeof payload !== 'object' || typeof payload.content !== 'string') {
      return Promise.reject(new Error('Invalid save payload'));
    }
    return ipcRenderer.invoke('pet:save-text-file', {
      content: payload.content,
      filename: typeof payload.filename === 'string' ? payload.filename : null,
      workspacePath: typeof payload.workspacePath === 'string' ? payload.workspacePath : null,
    });
  },
}));
