'use strict';
const path = require('node:path');
function createResponseWindow({ BrowserWindow, screen }) {
  const area = screen.getPrimaryDisplay().workArea;
  const window = new BrowserWindow({ width: 380, height: 240, x: Math.max(area.x, area.x + area.width - 596), y: Math.max(area.y, area.y + area.height - 240), frame: false, transparent: true, alwaysOnTop: true, show: false, webPreferences: { preload: path.join(__dirname, 'response-preload.js'), contextIsolation: true, nodeIntegration: false } });
  window.loadFile(path.join(__dirname, 'response', 'index.html'));
  return window;
}
module.exports = { createResponseWindow };
