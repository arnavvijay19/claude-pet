'use strict';
const path = require('node:path');
function createResponseWindow({ BrowserWindow, screen }) {
  const area = screen.getPrimaryDisplay().workArea;
  const window = new BrowserWindow({ width: 430, height: 320, x: Math.max(area.x, area.x + area.width - 646), y: Math.max(area.y, area.y + area.height - 320), frame: false, transparent: true, alwaysOnTop: true, show: false, webPreferences: { preload: path.join(__dirname, 'response-preload.js'), contextIsolation: true, nodeIntegration: false } });
  window.loadFile(path.join(__dirname, 'response', 'index.html'));
  return window;
}
module.exports = { createResponseWindow };
