'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STATES,
  EVENTS,
  createConnectionStateMachine,
  createConnectionStateStore,
} = require('../src/agent/connectionStateMachine.js');

const FAILURE = {
  code: 'CLI_COMPATIBILITY_CHECK_FAILED',
  message: 'Claude Pet could not finish checking this Codex update.',
};

test('initial state is Not checked with no step, feedback, or failure', () => {
  const machine = createConnectionStateMachine({ connectionId: 'conn-1' });
  const state = machine.getState();
  assert.equal(state.state, STATES.NOT_CHECKED);
  assert.equal(state.connectionId, 'conn-1');
  assert.equal(state.step, null);
  assert.equal(state.feedback, null);
  assert.equal(state.failure, null);
  assert.equal(typeof state.updatedAt, 'number');
});

test('verify moves Not checked to Verifying installed Codex', () => {
  const machine = createConnectionStateMachine({ connectionId: 'conn-1' });
  const next = machine.transition(EVENTS.VERIFY);
  assert.equal(next.state, STATES.VERIFYING);
  assert.equal(next.step, 'Verifying installed Codex');
});

test('Verifying installed Codex resolves to Ready when installed', () => {
  const machine = createConnectionStateMachine({ connectionId: 'conn-1' });
  machine.transition(EVENTS.VERIFY);
  const next = machine.transition(EVENTS.INSTALLED);
  assert.equal(next.state, STATES.READY);
  assert.equal(next.step, null);
});

test('Verifying installed Codex moves to Sign-in required', () => {
  const machine = createConnectionStateMachine({ connectionId: 'conn-1' });
  machine.transition(EVENTS.VERIFY);
  const next = machine.transition(EVENTS.SIGN_IN_REQUIRED);
  assert.equal(next.state, STATES.SIGN_IN_REQUIRED);
  assert.equal(next.step, 'Sign in to Codex');
});

test('a one-time identity check is labelled as one-time', () => {
  const machine = createConnectionStateMachine({ connectionId: 'conn-1' });
  machine.transition(EVENTS.VERIFY);
  const next = machine.transition(EVENTS.SIGN_IN_REQUIRED, { oneTime: true });
  assert.equal(next.state, STATES.SIGN_IN_REQUIRED);
  assert.equal(next.step, 'One-time identity check');
});

test('Sign-in required returns to Ready after sign in', () => {
  const machine = createConnectionStateMachine({ connectionId: 'conn-1' });
  machine.transition(EVENTS.VERIFY);
  machine.transition(EVENTS.SIGN_IN_REQUIRED);
  const next = machine.transition(EVENTS.SIGNED_IN);
  assert.equal(next.state, STATES.READY);
});

test('Verifying installed Codex can be cancelled back to Not checked', () => {
  const machine = createConnectionStateMachine({ connectionId: 'conn-1' });
  machine.transition(EVENTS.VERIFY);
  const next = machine.transition(EVENTS.CANCEL);
  assert.equal(next.state, STATES.NOT_CHECKED);
});

test('a recoverable failure from Verifying carries code, message, and recoverable flag', () => {
  const machine = createConnectionStateMachine({ connectionId: 'conn-1' });
  machine.transition(EVENTS.VERIFY);
  const next = machine.transition(EVENTS.FAILED, FAILURE);
  assert.equal(next.state, STATES.FAILURE);
  assert.deepEqual(next.failure, { code: FAILURE.code, message: FAILURE.message, recoverable: true });
  assert.equal(next.feedback, FAILURE.message);
});

test('Ready starts, then runs, then completes back to Ready', () => {
  const machine = createConnectionStateMachine({ connectionId: 'conn-1' });
  machine.transition(EVENTS.VERIFY);
  machine.transition(EVENTS.INSTALLED);
  const starting = machine.transition(EVENTS.START);
  assert.equal(starting.state, STATES.STARTING);
  assert.equal(starting.step, 'Starting');
  const running = machine.transition(EVENTS.RUNNING);
  assert.equal(running.state, STATES.RUNNING);
  assert.equal(running.step, 'Running');
  const ready = machine.transition(EVENTS.DONE);
  assert.equal(ready.state, STATES.READY);
});

test('a recoverable failure from Running carries code, message, and recoverable flag', () => {
  const machine = createConnectionStateMachine({ connectionId: 'conn-1' });
  machine.transition(EVENTS.VERIFY);
  machine.transition(EVENTS.INSTALLED);
  machine.transition(EVENTS.START);
  machine.transition(EVENTS.RUNNING);
  const next = machine.transition(EVENTS.FAILED, FAILURE);
  assert.equal(next.state, STATES.FAILURE);
  assert.deepEqual(next.failure, { code: FAILURE.code, message: FAILURE.message, recoverable: true });
  assert.equal(next.feedback, FAILURE.message);
});

test('an invalid transition throws a clear error', () => {
  const machine = createConnectionStateMachine({ connectionId: 'conn-1' });
  // INSTALLED is not allowed from Not checked.
  assert.throws(
    () => machine.transition(EVENTS.INSTALLED),
    /not allowed from state/,
  );
  machine.transition(EVENTS.VERIFY);
  machine.transition(EVENTS.INSTALLED);
  // DONE is not allowed from Ready (only START is).
  assert.throws(
    () => machine.transition(EVENTS.DONE),
    /not allowed from state/,
  );
});

test('an unknown event throws a clear error', () => {
  const machine = createConnectionStateMachine({ connectionId: 'conn-1' });
  assert.throws(() => machine.transition('arbitrary'), /Unknown event/);
});

test('two connections are isolated in independent machines', () => {
  const a = createConnectionStateMachine({ connectionId: 'a' });
  const b = createConnectionStateMachine({ connectionId: 'b' });
  a.transition(EVENTS.VERIFY);
  assert.equal(a.getState().state, STATES.VERIFYING);
  assert.equal(b.getState().state, STATES.NOT_CHECKED);
  b.transition(EVENTS.VERIFY);
  b.transition(EVENTS.INSTALLED);
  assert.equal(a.getState().state, STATES.VERIFYING);
  assert.equal(b.getState().state, STATES.READY);
});

test('cancel() during Verifying returns to Not checked and is a no-op otherwise', () => {
  const machine = createConnectionStateMachine({ connectionId: 'conn-1' });
  machine.transition(EVENTS.VERIFY);
  const cancelled = machine.cancel();
  assert.equal(cancelled.state, STATES.NOT_CHECKED);

  const idle = createConnectionStateMachine({ connectionId: 'conn-2' });
  const before = idle.getState();
  const after = idle.cancel();
  assert.equal(after.state, STATES.NOT_CHECKED);
  assert.equal(before.updatedAt, after.updatedAt);
});

test('reset() returns to Not checked from any state', () => {
  const verifying = createConnectionStateMachine({ connectionId: 'v' });
  verifying.transition(EVENTS.VERIFY);
  assert.equal(verifying.reset().state, STATES.NOT_CHECKED);

  const running = createConnectionStateMachine({ connectionId: 'r' });
  running.transition(EVENTS.VERIFY);
  running.transition(EVENTS.INSTALLED);
  running.transition(EVENTS.START);
  running.transition(EVENTS.RUNNING);
  assert.equal(running.reset().state, STATES.NOT_CHECKED);

  const failed = createConnectionStateMachine({ connectionId: 'f' });
  failed.transition(EVENTS.VERIFY);
  failed.transition(EVENTS.FAILED, FAILURE);
  const afterFailure = failed.reset();
  assert.equal(afterFailure.state, STATES.NOT_CHECKED);
  assert.equal(afterFailure.failure, null);
  assert.equal(afterFailure.feedback, null);

  const fresh = createConnectionStateMachine({ connectionId: 'n' });
  assert.equal(fresh.reset().state, STATES.NOT_CHECKED);
});

test('store ensure/get/remove/list manage one machine per connection', () => {
  const store = createConnectionStateStore();
  assert.deepEqual(store.list(), []);

  const a = store.ensure('a');
  const aAgain = store.ensure('a');
  assert.equal(a, aAgain, 'ensure returns the same machine for a connectionId');
  const b = store.ensure('b');
  assert.notEqual(a, b);

  assert.equal(store.get('a'), a);
  assert.equal(store.get('missing'), undefined);
  assert.deepEqual(store.list().sort(), ['a', 'b']);

  assert.equal(store.remove('a'), true);
  assert.equal(store.get('a'), undefined);
  assert.deepEqual(store.list(), ['b']);
  assert.equal(store.remove('a'), false);
});

test('subscribe fires on every change and unsubscribe stops it', () => {
  const machine = createConnectionStateMachine({ connectionId: 'conn-1' });
  const seen = [];
  const unsubscribe = machine.subscribe((snapshot) => seen.push(snapshot.state));
  machine.transition(EVENTS.VERIFY);
  machine.transition(EVENTS.INSTALLED);
  assert.deepEqual(seen, [STATES.VERIFYING, STATES.READY]);
  unsubscribe();
  machine.transition(EVENTS.START);
  assert.deepEqual(seen, [STATES.VERIFYING, STATES.READY]);
});

test('store-level subscribe fires for any connection change', () => {
  const store = createConnectionStateStore();
  const seen = [];
  store.subscribe((snapshot) => seen.push(`${snapshot.connectionId}:${snapshot.state}`));
  const a = store.ensure('a');
  a.transition(EVENTS.VERIFY);
  const b = store.ensure('b');
  b.transition(EVENTS.VERIFY);
  b.transition(EVENTS.INSTALLED);
  assert.deepEqual(seen, [
    'a:Verifying installed Codex',
    'b:Verifying installed Codex',
    'b:Ready',
  ]);
});
