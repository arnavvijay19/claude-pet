'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createResponseViewModel } = require('../src/response/responseViewModel.js');

test('formats every required Simple Offline Demo activity field', () => {
  const view = createResponseViewModel({
    elapsedMs: 12_345,
    busy: true,
    run: { executor: 'offline-demo', model: 'offline-demo', workspace: 'Z:\\work', permissionProfile: 'workspace' },
    events: [{ phase: 'running', summary: 'Running Offline Demo command', kind: 'status' }],
  });
  assert.equal(view.phase, 'running');
  assert.equal(view.summary, 'Running Offline Demo command');
  assert.equal(view.executor, 'offline-demo');
  assert.equal(view.model, 'offline-demo');
  assert.equal(view.workspace, 'Z:\\work');
  assert.equal(view.permissionBadge, 'Workspace');
  assert.equal(view.elapsed, '12s');
  assert.equal(view.canStop, true);
});
