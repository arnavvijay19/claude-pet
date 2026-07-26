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

test('presents Full Computer as the warned default and Workspace separately as unavailable', () => {
  const model = createSettingsViewModel({
    connections: [{
      id: 'codex', executorType: 'codex-cli', label: 'Codex', workspacePath: 'Z:\\work',
      permissionProfile: 'full-computer', modelId: 'gpt-5.6-terra', effort: 'medium',
      revision: 99, fullAccessConfirmed: true,
    }],
    activeId: 'codex',
  });
  assert.equal(model.active.permissionBadge, 'FULL COMPUTER - broad PC access');
  assert.equal(model.active.permissionWarning, true);
  assert.equal(model.defaultPermissionProfile, 'full-computer');
  assert.deepEqual(model.permissionOptions, [
    { value: 'full-computer', label: 'Default - broad access', available: true, warning: true },
    { value: 'workspace', label: 'Workspace - selected project only', available: false, warning: false },
  ]);
  assert.equal(model.workspaceOnly, false);
  assert.equal(model.fullComputerAvailable, true);
  assert.equal(JSON.stringify(model).includes('fullAccessConfirmed'), false);
  assert.equal(JSON.stringify(model).includes('revision'), false);
});
