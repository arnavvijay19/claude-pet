'use strict';

// Pure unit tests for the framework-free ribbon model (Phase 3 Task 2). The model is the
// single source of truth shared by the live vanilla-DOM ribbon and the Preact StatusRibbon
// component, so it is exercised here without any DOM.

const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/renderer/components/ribbonModel.js');

const { deriveRibbonProps, mapConnectionToRibbon, resolveActiveConnectionId, buildRibbonModel, RIBBON_KINDS, RIBBON_ACTIONS, RIBBON_ACTION_TYPES } = model;

function machineView(state, extra = {}) {
  return { state, connectionId: 'c1', step: null, feedback: null, failure: null, updatedAt: 0, ...extra };
}

test('deriveRibbonProps keeps the full state machine (kinds, actions, types)', () => {
  assert.equal(deriveRibbonProps({ run: { busy: true, phase: 'verifying' } }).kind, RIBBON_KINDS.VERIFYING);
  assert.equal(deriveRibbonProps({ run: { busy: true, phase: 'running' } }).primaryAction, RIBBON_ACTIONS.STOP);
  const signIn = deriveRibbonProps({ connection: { state: 'sign-in-required' } });
  assert.equal(signIn.primaryType, RIBBON_ACTION_TYPES.SIGN_IN);
  const blocked = deriveRibbonProps({ connection: { state: 'blocked', failureMessage: 'x' } });
  assert.equal(blocked.primaryType, RIBBON_ACTION_TYPES.CHECK);
  assert.equal(deriveRibbonProps({}).primaryAction, null);
});

test('mapConnectionToRibbon maps every machine state to a ribbon connection', () => {
  assert.deepEqual(mapConnectionToRibbon(machineView('Not checked')), { state: 'not-checked' });
  assert.deepEqual(mapConnectionToRibbon(machineView('Verifying installed Codex')), { state: 'verifying' });
  assert.deepEqual(mapConnectionToRibbon(machineView('Sign-in required', { oneTime: true })), { state: 'sign-in-required', oneTime: true });
  assert.deepEqual(mapConnectionToRibbon(machineView('Ready')), { state: 'ready' });
  assert.deepEqual(mapConnectionToRibbon(machineView('Starting')), { state: 'running' });
  assert.deepEqual(mapConnectionToRibbon(machineView('Running')), { state: 'running' });
  assert.deepEqual(
    mapConnectionToRibbon(machineView('Recoverable failure', { failure: { code: 'X', message: 'nope' } })),
    { state: 'blocked', failureMessage: 'nope' },
  );
});

test('mapConnectionToRibbon treats an unknown or absent view as calm/ready', () => {
  assert.deepEqual(mapConnectionToRibbon(null), null);
  assert.deepEqual(mapConnectionToRibbon({ state: 'Mystery' }), { state: 'ready' });
});

test('resolveActiveConnectionId prefers the active agent participant, then the single connection', () => {
  const withParticipant = {
    activeAgent: { id: 'a1' },
    session: { participants: [{ agentId: 'a1', connectionId: 'c1' }, { agentId: 'a2', connectionId: 'c2' }] },
    connections: [{ id: 'c1' }, { id: 'c2' }],
  };
  assert.equal(resolveActiveConnectionId(withParticipant), 'c1');

  const single = { activeAgent: { id: 'a1' }, session: null, connections: [{ id: 'only' }] };
  assert.equal(resolveActiveConnectionId(single), 'only');

  const none = { activeAgent: null, session: null, connections: [] };
  assert.equal(resolveActiveConnectionId(none), null);
});

test('buildRibbonModel labels a busy run as Running agent with Stop, even with no connection', () => {
  const snapshot = { run: { busy: true, connectionId: null }, connections: [], session: null, activeAgent: null };
  const built = buildRibbonModel(snapshot, () => null);
  const props = deriveRibbonProps(built);
  assert.equal(props.label, 'Running agent');
  assert.equal(props.primaryAction, RIBBON_ACTIONS.STOP);
  assert.equal(props.primaryType, RIBBON_ACTION_TYPES.STOP);
});

test('buildRibbonModel shows Verifying and Cancel while a connection is being checked', () => {
  const snapshot = {
    run: { busy: false },
    connections: [{ id: 'c1' }],
    session: { participants: [{ agentId: 'a1', connectionId: 'c1' }] },
    activeAgent: { id: 'a1' },
  };
  const built = buildRibbonModel(snapshot, () => machineView('Verifying installed Codex'));
  const props = deriveRibbonProps(built);
  assert.equal(props.label, 'Verifying Codex connection…');
  assert.equal(props.primaryAction, RIBBON_ACTIONS.CANCEL);
});

test('buildRibbonModel keeps Verifying while a run is busy and the connection is mid-check', () => {
  const snapshot = {
    run: { busy: true },
    connections: [{ id: 'c1' }],
    session: { participants: [{ agentId: 'a1', connectionId: 'c1' }] },
    activeAgent: { id: 'a1' },
  };
  const built = buildRibbonModel(snapshot, () => machineView('Verifying installed Codex'));
  const props = deriveRibbonProps(built);
  assert.equal(props.primaryAction, RIBBON_ACTIONS.CANCEL);
});

test('buildRibbonModel promotes sign-in-required and a blocked failure', () => {
  const base = {
    run: { busy: false },
    connections: [{ id: 'c1' }],
    session: { participants: [{ agentId: 'a1', connectionId: 'c1' }] },
    activeAgent: { id: 'a1' },
  };
  const signIn = deriveRibbonProps(buildRibbonModel(base, () => machineView('Sign-in required', { oneTime: false })));
  assert.equal(signIn.label, 'Codex sign-in required');
  assert.equal(signIn.primaryType, RIBBON_ACTION_TYPES.SIGN_IN);

  const blocked = deriveRibbonProps(buildRibbonModel(base, () => machineView('Recoverable failure', { failure: { code: 'X', message: 'The Codex command is not installed.' } })));
  assert.equal(blocked.kind, RIBBON_KINDS.BLOCKED);
  assert.equal(blocked.label, 'The Codex command is not installed.');
  assert.equal(blocked.primaryAction, RIBBON_ACTIONS.CHECK);
});

test('buildRibbonModel is calm when ready and offers Check now when not checked', () => {
  const base = {
    run: { busy: false },
    connections: [{ id: 'c1' }],
    session: { participants: [{ agentId: 'a1', connectionId: 'c1' }] },
    activeAgent: { id: 'a1' },
  };
  const ready = deriveRibbonProps(buildRibbonModel(base, () => machineView('Ready')));
  assert.equal(ready.label, 'Ready');
  assert.equal(ready.primaryAction, null);

  const unchecked = deriveRibbonProps(buildRibbonModel(base, () => machineView('Not checked')));
  assert.equal(unchecked.label, 'Codex connection not checked yet');
  assert.equal(unchecked.primaryType, RIBBON_ACTION_TYPES.CHECK);
});
