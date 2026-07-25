'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSettingsViewModel } = require('../src/settings/settingsViewModel.js');

test('presents Offline Demo as a built-in Workspace-only agent without advanced controls', () => {
  const model = createSettingsViewModel({
    connections: [{ id: 'offline', executorType: 'offline-demo', label: 'My demo', workspacePath: 'Z:\\work', permissionProfile: 'workspace', modelId: 'offline-demo', effort: null }],
    activeId: 'offline',
  });
  assert.equal(model.active.id, 'offline');
  assert.match(model.active.description, /built-in offline agent/i);
  assert.equal(model.workspaceOnly, true);
  assert.equal(model.fullComputerAvailable, false);
  assert.equal(model.fileSubmitAvailable, false);
  assert.equal(JSON.stringify(model).includes('options'), false);
  assert.equal(JSON.stringify(model).includes('secret'), false);
});

test('rejects a non-workspace Offline Demo draft', () => {
  assert.throws(() => createSettingsViewModel({ connections: [{ executorType: 'offline-demo', permissionProfile: 'full-computer' }] }), /Workspace/);
});
