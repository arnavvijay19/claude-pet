'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTrayController } = require('../src/trayController.js');

test('creates one tray, publishes public labels, tracks Stop, and destroys it', () => {
  const calls = []; let destroyed = false;
  const Tray = class { setToolTip(value) { calls.push(['tip', value]); } setContextMenu(value) { calls.push(['menu', value]); } destroy() { destroyed = true; } };
  const Menu = { buildFromTemplate: (value) => value };
  const controller = createTrayController({ Tray, Menu, iconPath: 'icon.png', actions: { openApp() {}, hide() {}, settings() {}, stop() {}, quit() {} } });
  controller.update({ connection: { label: 'Offline', permissionProfile: 'workspace' }, busy: true });
  assert.equal(calls.at(-1)[1].some((item) => item.label === 'Open Claude Pet'), true);
  assert.equal(calls.at(-1)[1].some((item) => item.label === 'Stop current run' && item.enabled), true);
  controller.destroy(); assert.equal(destroyed, true);
});
