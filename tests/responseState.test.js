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

test('keeps the same timestamped activity snapshot when switching Simple and Comprehensive views', () => {
  const state = createResponseState();
  state.begin({ executor: 'codex-cli', model: 'gpt-5.6-terra', workspace: 'Z:\\work', permissionProfile: 'workspace' });
  state.setActivity({ events: [{ sequence: 7, timestamp: 1234, phase: 'running', kind: 'command', summary: 'Codex command completed', command: 'git status', exitCode: 0 }] });
  const simple = state.snapshot().events;
  state.setActivityView('comprehensive');
  assert.deepEqual(state.snapshot().events, simple);
  assert.deepEqual(state.snapshot().events[0], { timestamp: 1234, phase: 'running', kind: 'command', summary: 'Codex command completed', command: 'git status', exitCode: 0 });
});

test('retains the selected agent, session, and visible provider-attributed turns without ciphertext', () => {
  const state = createResponseState();
  state.setSessionSnapshot({ agent: { id: 'a', name: 'Agent A' }, session: { id: 's', title: 'Session 1', workspacePath: 'Z:\\work' }, turns: [{ role: 'assistant', text: 'reply', provider: 'codex-cli', model: 'gpt-5.6-terra', changedFiles: [] }], connections: [] });
  const snapshot = state.snapshot();
  assert.equal(snapshot.agent.name, 'Agent A');
  assert.equal(snapshot.session.title, 'Session 1');
  assert.equal(snapshot.turns[0].provider, 'codex-cli');
  assert.equal(JSON.stringify(snapshot).includes('encryptedTurns'), false);
});
