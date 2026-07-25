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

test('formats timestamped Comprehensive rows from the shared activity snapshot', () => {
  const view = createResponseViewModel({
    activityView: 'comprehensive',
    events: [
      { timestamp: 1234, phase: 'running', kind: 'file', summary: 'Codex modified notes/result.txt', path: 'notes/result.txt', operation: 'modify' },
      { timestamp: 2345, phase: 'running', kind: 'command', summary: 'Codex command completed', command: 'git status', exitCode: 0 },
      { timestamp: 3456, phase: 'responding', kind: 'usage', summary: 'Codex usage', usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 1, totalTokens: 12 } },
    ],
  });
  assert.equal(view.activityView, 'comprehensive');
  assert.deepEqual(view.events.map((event) => event.detail), [
    'modify notes/result.txt', 'git status (exit 0)', 'input 10, output 2, cached 1, total 12',
  ]);
  assert.deepEqual(view.events.map((event) => event.timestamp), [1234, 2345, 3456]);
});
