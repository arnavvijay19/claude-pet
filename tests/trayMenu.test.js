'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTrayMenuTemplate } = require('../src/trayMenu.js');

test('tray template permanently badges the selected mode and rebuilds busy status', () => {
  const calls = [];
  const template = createTrayMenuTemplate({
    permissionProfile: 'full-computer',
    busy: true,
    onShow: () => calls.push('show'),
    onHide: () => calls.push('hide'),
    onSettings: () => calls.push('settings'),
    onQuit: () => calls.push('quit'),
  });
  assert.deepEqual(template.map(({ label, type, enabled }) => ({ label, type, enabled })), [
    { label: 'FULL COMPUTER - broad PC access', type: undefined, enabled: false },
    { label: 'Agent working', type: undefined, enabled: false },
    { label: undefined, type: 'separator', enabled: undefined },
    { label: 'Show', type: undefined, enabled: undefined },
    { label: 'Hide', type: undefined, enabled: undefined },
    { label: 'Settings', type: undefined, enabled: undefined },
    { label: undefined, type: 'separator', enabled: undefined },
    { label: 'Quit', type: undefined, enabled: undefined },
  ]);
  template[3].click(); template[4].click(); template[5].click(); template[7].click();
  assert.deepEqual(calls, ['show', 'hide', 'settings', 'quit']);

  const workspace = createTrayMenuTemplate({ permissionProfile: 'workspace', busy: false });
  assert.equal(workspace[0].label, 'WORKSPACE - selected project only');
  assert.equal(workspace[1].label, 'Agent ready');
});
