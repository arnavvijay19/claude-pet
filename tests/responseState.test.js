'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createResponseState } = require('../src/response/responseState.js');

test('defaults to Simple and retains the selected activity view', () => {
  const saved = [];
  const state = createResponseState({ readPreference: () => null, writePreference: (value) => saved.push(value), now: () => 20 });
  assert.equal(state.snapshot().activityView, 'simple');
  state.setActivityView('comprehensive');
  assert.equal(state.snapshot().activityView, 'comprehensive');
  assert.deepEqual(saved, ['comprehensive']);
});

test('publishes normalized activity, busy state, elapsed time, and Stop state', () => {
  let now = 100;
  const state = createResponseState({ now: () => now });
  state.begin({ executor: 'offline-demo', model: 'offline-demo', workspace: 'Z:\\work', permissionProfile: 'workspace' });
  state.setActivity({ events: [{ phase: 'preparing', kind: 'status', summary: 'Preparing' }] });
  now = 125;
  assert.deepEqual(state.snapshot().events, [{ phase: 'preparing', kind: 'status', summary: 'Preparing' }]);
  assert.equal(state.snapshot().busy, true);
  assert.equal(state.snapshot().elapsedMs, 25);
  state.stopped();
  assert.equal(state.snapshot().busy, false);
  assert.equal(state.snapshot().stopped, true);
});
