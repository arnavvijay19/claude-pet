'use strict';

const { permissionBadge } = require('./agent/executionModes.js');

function createTrayController({ Tray, Menu, iconPath, actions = {} }) {
  const tray = new Tray(iconPath);
  tray.setToolTip('Claude Pet — Post-Hoc Banana Baron');
  const callback = (name) => typeof actions[name] === 'function' ? actions[name] : () => {};
  return Object.freeze({
    update(snapshot = {}) {
      const connection = snapshot.connection || null; const busy = snapshot.busy === true;
      const mode = connection?.permissionProfile ? permissionBadge(connection.permissionProfile) : 'No connection selected';
      const label = connection?.label || 'No connection selected';
      tray.setContextMenu(Menu.buildFromTemplate([
        { label, enabled: false }, { label: mode, enabled: false }, { label: busy ? 'Agent working' : 'Agent ready', enabled: false },
        { type: 'separator' }, { label: 'Open Claude Pet', click: callback('openApp') }, { label: 'Hide', click: callback('hide') }, { label: 'Settings', click: callback('settings') },
        { label: 'Stop current run', enabled: busy, click: callback('stop') }, { type: 'separator' }, { label: 'Quit', click: callback('quit') },
      ]));
    },
    destroy() { tray.destroy(); },
  });
}

module.exports = { createTrayController };
