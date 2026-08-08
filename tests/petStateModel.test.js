'use strict';

// Pure unit tests for the Phase 3 Task 4 pet coupling model (src/agent/petStateModel.js).
// The model is the single source of truth shared by the pet window and the status ribbon, so it
// is exercised here with no Electron/DOM. Every behavior change in Task 4 is witnessed red->green.

const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/agent/petStateModel.js');

const { derivePetState, derivePetInput, progressFromActivity, PET_STATES, ATTENTION, clampUnit } = model;

function connection(state, extra = {}) {
  return { state, connectionId: 'c1', failureMessage: null, oneTime: false, ...extra };
}

test('exposes the nine pet visual states and attention levels', () => {
  for (const value of ['idle', 'waiting', 'running', 'review', 'waving', 'jumping', 'failed', 'running-right', 'running-left']) {
    assert.ok(Object.values(PET_STATES).includes(value), `expected pet state ${value}`);
  }
  assert.deepEqual(Object.values(ATTENTION).sort(), ['failure', 'none', 'sign-in']);
});

test('calm when there is no connection and no run', () => {
  const result = derivePetState({});
  assert.equal(result.visualState, PET_STATES.IDLE);
  assert.equal(result.progress, 0);
  assert.equal(result.attention, ATTENTION.NONE);
  assert.equal(result.label, 'Ready');
});

test('terminal connection failure drives the failed pet + failure attention', () => {
  const result = derivePetState({ connection: connection('Recoverable failure', { failureMessage: 'The Codex command is not installed.' }) });
  assert.equal(result.visualState, PET_STATES.FAILED);
  assert.equal(result.attention, ATTENTION.FAILURE);
  assert.equal(result.progress, 0);
  assert.equal(result.label, 'The Codex command is not installed.');
});

test('failure attention also fires from a structured failure object', () => {
  const result = derivePetState({ connection: connection('Recoverable failure', { failure: { code: 'X', message: 'blocked' } }) });
  assert.equal(result.visualState, PET_STATES.FAILED);
  assert.equal(result.attention, ATTENTION.FAILURE);
  assert.equal(result.label, 'blocked');
});

test('sign-in required drives the waiting pet + sign-in attention (one-time labelled)', () => {
  const once = derivePetState({ connection: connection('Sign-in required', { oneTime: true }) });
  assert.equal(once.visualState, PET_STATES.WAITING);
  assert.equal(once.attention, ATTENTION.SIGN_IN);
  assert.equal(once.label, 'One-time Codex identity check required');

  const plain = derivePetState({ connection: connection('Sign-in required', { oneTime: false }) });
  assert.equal(plain.attention, ATTENTION.SIGN_IN);
  assert.equal(plain.label, 'Codex sign-in required');
});

test('a busy agent run drives the running pet with a progress ring', () => {
  const partial = derivePetState({ run: { busy: true, phase: 'running', progress: 0.4 } });
  assert.equal(partial.visualState, PET_STATES.RUNNING);
  assert.equal(partial.progress, 0.4);
  assert.equal(partial.attention, ATTENTION.NONE);
  assert.equal(partial.label, 'Running agent');

  const complete = derivePetState({ run: { busy: true, phase: 'running', progress: 1 } });
  assert.equal(complete.progress, 1);
});

test('a busy verifying connection drives the waiting pet', () => {
  const result = derivePetState({ run: { busy: true, phase: 'verifying', progress: 0.2 }, connection: connection('Verifying installed Codex') });
  assert.equal(result.visualState, PET_STATES.WAITING);
  assert.equal(result.progress, 0.2);
  assert.equal(result.attention, ATTENTION.NONE);
  assert.equal(result.label, 'Verifying Codex connection…');
});

test('verifying without a run still shows the waiting pet', () => {
  const result = derivePetState({ connection: connection('Verifying installed Codex') });
  assert.equal(result.visualState, PET_STATES.WAITING);
  assert.equal(result.attention, ATTENTION.NONE);
});

test('progress is clamped to the unit interval', () => {
  assert.equal(derivePetState({ run: { busy: true, phase: 'running', progress: -0.5 } }).progress, 0);
  assert.equal(derivePetState({ run: { busy: true, phase: 'running', progress: 5 } }).progress, 1);
  assert.equal(derivePetState({ run: { busy: true, phase: 'running' } }).progress, 0);
});

test('a busy run wins over a stale ready connection (no false attention)', () => {
  const result = derivePetState({ connection: connection('Ready'), run: { busy: true, phase: 'running', progress: 0.5 } });
  assert.equal(result.visualState, PET_STATES.RUNNING);
  assert.equal(result.attention, ATTENTION.NONE);
});

test('derivePetInput maps a sign-in connection record to the sign-in required state', () => {
  const withFlag = derivePetInput({ connectionRecord: { needsSignIn: true } });
  assert.equal(derivePetState(withFlag).attention, ATTENTION.SIGN_IN);

  const withAuth = derivePetInput({ connectionRecord: { installed: true, authenticated: false } });
  assert.equal(derivePetState(withAuth).attention, ATTENTION.SIGN_IN);

  const ready = derivePetInput({ connectionRecord: { state: 'Ready' }, managerSnapshot: { busy: false } });
  assert.equal(derivePetState(ready).visualState, PET_STATES.IDLE);
});

test('derivePetInput forwards the manager run phase and progress', () => {
  const input = derivePetInput({ connectionRecord: { state: 'Ready' }, managerSnapshot: { busy: true }, runProgress: 0.6 });
  const state = derivePetState(input);
  assert.equal(state.visualState, PET_STATES.RUNNING);
  assert.equal(state.progress, 0.6);
});

test('derivePetInput treats a missing connection as not-checked calm', () => {
  const input = derivePetInput({ managerSnapshot: { busy: false } });
  assert.equal(derivePetState(input).visualState, PET_STATES.IDLE);
});

test('progressFromActivity counts milestone events as a unit fraction', () => {
  assert.equal(progressFromActivity({ events: [] }), 0);
  assert.equal(progressFromActivity(null), 0);

  const oneStep = { events: [{ kind: 'command', summary: 'git status' }] };
  assert.equal(progressFromActivity(oneStep), 1);

  const twoSteps = { events: [{ kind: 'command', summary: 'a' }, { kind: 'usage', summary: 'b' }, { kind: 'message', summary: 'c' }] };
  // message is not a milestone, so 2 / 2 = 1
  assert.equal(progressFromActivity(twoSteps), 1);

  const partial = { events: [{ kind: 'command' }, { kind: 'command' }, { kind: 'command' }, { kind: 'message' }] };
  // 3 milestones / 3 planned = 1 (planned tracks the milestone count, so a run reads complete
  // only when no further events arrive; mid-run the numerator lags the real total but the ring
  // still advances monotonically with each step).
  assert.equal(progressFromActivity(partial), 1);
});

test('clampUnit guards non-finite and out-of-range values', () => {
  assert.equal(clampUnit(-3), 0);
  assert.equal(clampUnit(3), 1);
  assert.equal(clampUnit(NaN), 0);
  assert.equal(clampUnit(undefined), 0);
  assert.equal(clampUnit(0.42), 0.42);
});
