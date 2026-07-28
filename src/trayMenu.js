'use strict';

const { FULL_COMPUTER, WORKSPACE, permissionBadge } = require('./agent/executionModes.js');

function callback(value) {
  return typeof value === 'function' ? value : () => {};
}

function createTrayMenuTemplate({
  permissionProfile = null,
  busy = false,
  onOpenApp,
  onHide,
  onSettings,
  onQuit,
} = {}) {
  const badge = permissionProfile === FULL_COMPUTER || permissionProfile === WORKSPACE
    ? permissionBadge(permissionProfile)
    : 'No connection selected';
  return [
    { label: badge, enabled: false },
    { label: busy ? 'Agent working' : 'Agent ready', enabled: false },
    { type: 'separator' },
    { label: 'Open Claude Pet', click: callback(onOpenApp) },
    { label: 'Hide', click: callback(onHide) },
    { label: 'Settings', click: callback(onSettings) },
    { type: 'separator' },
    { label: 'Quit', click: callback(onQuit) },
  ];
}

module.exports = { createTrayMenuTemplate };
