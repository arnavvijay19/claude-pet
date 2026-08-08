// Ribbon model — the pure, framework-free brain behind the Phase 3 status ribbon.
//
// This module is intentionally dual-mode so the SAME logic powers two very different
// renderers in this no-bundler Electron app:
//   - the live main window, which loads it as a classic <script> and reads it from
//     globalThis.claudePetRibbonModel (the renderer runs from file:// with no ESM
//     module loader, so Preact/htm cannot be used there yet);
//   - the component library + jsdom tests, which import StatusRibbon.mjs (ESM/Preact+htm),
//     which re-imports deriveRibbonProps and the constants from here.
//
// Keeping the mapping here means the live vanilla-DOM ribbon and the Preact component
// can never drift: they both derive their props from the same function. The live window
// is the near-term target; once the app shell gains an ESM loader (custom protocol),
// the live renderer can swap to the Preact component with zero logic change.

'use strict';

// The finite set of ribbon states. The live renderer keys CSS tones off `kind`; the
// Preact component keys off `tone`. They are kept deliberately small and stable.
const RIBBON_KINDS = Object.freeze({
  IDLE: 'idle',
  READY: 'ready',
  VERIFYING: 'verifying',
  RUNNING: 'running',
  SIGN_IN_REQUIRED: 'sign-in-required',
  BLOCKED: 'blocked',
});

const RIBBON_ACTIONS = Object.freeze({
  CHECK: 'Check now',
  SIGN_IN: 'Sign in to Codex',
  CANCEL: 'Cancel',
  STOP: 'Stop',
});

const RIBBON_ACTION_TYPES = Object.freeze({
  CHECK: 'check',
  SIGN_IN: 'signin',
  CANCEL: 'cancel',
  STOP: 'stop',
});

// Maps a normalized view of run + connection state to exactly the props the ribbon
// renders. Priority is: an in-flight run wins over a stale connection problem, a
// required sign-in beats a generic block, and a terminal block beats a neutral ready
// state. Returns an immutable object; `primaryAction` is null when there is nothing
// actionable (a calm "Ready").
function deriveRibbonProps(input = {}) {
  const run = input.run || {};
  const connection = input.connection || null;
  const busy = run.busy === true;

  if (busy && run.phase === 'verifying') {
    return {
      kind: RIBBON_KINDS.VERIFYING,
      tone: 'info',
      label: 'Verifying Codex connection…',
      detail: 'First identity check runs once per exact identity.',
      primaryAction: RIBBON_ACTIONS.CANCEL,
      primaryType: RIBBON_ACTION_TYPES.CANCEL,
    };
  }
  if (busy && run.phase === 'running') {
    return {
      kind: RIBBON_KINDS.RUNNING,
      tone: 'info',
      label: 'Running agent',
      detail: null,
      primaryAction: RIBBON_ACTIONS.STOP,
      primaryType: RIBBON_ACTION_TYPES.STOP,
    };
  }
  if (connection && connection.state === RIBBON_KINDS.SIGN_IN_REQUIRED) {
    return {
      kind: RIBBON_KINDS.SIGN_IN_REQUIRED,
      tone: 'warning',
      label: connection.oneTime ? 'One-time Codex identity check required' : 'Codex sign-in required',
      detail: connection.oneTime
        ? 'Official sign-in is provider-owned and runs once per identity revision.'
        : 'Official sign-in is provider-owned; Claude Pet never reads credentials.',
      primaryAction: RIBBON_ACTIONS.SIGN_IN,
      primaryType: RIBBON_ACTION_TYPES.SIGN_IN,
    };
  }
  if (connection && (connection.state === RIBBON_KINDS.BLOCKED || connection.failureMessage)) {
    return {
      kind: RIBBON_KINDS.BLOCKED,
      tone: 'danger',
      label: connection.failureMessage || 'Connection blocked',
      detail: null,
      primaryAction: RIBBON_ACTIONS.CHECK,
      primaryType: RIBBON_ACTION_TYPES.CHECK,
    };
  }
  if (connection && connection.state === RIBBON_KINDS.VERIFYING) {
    return {
      kind: RIBBON_KINDS.VERIFYING,
      tone: 'info',
      label: 'Verifying Codex connection…',
      detail: null,
      primaryAction: RIBBON_ACTIONS.CANCEL,
      primaryType: RIBBON_ACTION_TYPES.CANCEL,
    };
  }
  if (connection && connection.state === 'not-checked') {
    return {
      kind: RIBBON_KINDS.IDLE,
      tone: 'muted',
      label: 'Codex connection not checked yet',
      detail: null,
      primaryAction: RIBBON_ACTIONS.CHECK,
      primaryType: RIBBON_ACTION_TYPES.CHECK,
    };
  }
  return {
    kind: RIBBON_KINDS.READY,
    tone: 'success',
    label: 'Ready',
    detail: null,
    primaryAction: null,
    primaryType: null,
  };
}

// Maps a per-connection state-machine view (connectionState.view, from
// src/agent/connectionStateMachine.js) to the connection shape deriveRibbonProps
// understands. Returns null for an unknown/absent view so the ribbon falls back to its
// calm Ready state.
function mapConnectionToRibbon(connectionView) {
  if (!connectionView || typeof connectionView !== 'object') return null;
  const { state, failure, oneTime } = connectionView;
  switch (state) {
    case 'Not checked':
      return { state: 'not-checked' };
    case 'Verifying installed Codex':
      return { state: 'verifying' };
    case 'Sign-in required':
      return { state: 'sign-in-required', oneTime: oneTime === true };
    case 'Ready':
      return { state: 'ready' };
    case 'Starting':
    case 'Running':
      return { state: 'running' };
    case 'Recoverable failure':
      return { state: 'blocked', failureMessage: failure?.message || 'Connection problem' };
    default:
      return { state: 'ready' };
  }
}

// The ribbon speaks to the connection the user is actively working with: the active
// session's participant that matches the active agent. Falls back to the only connection
// when exactly one exists (e.g. first-run Offline Demo), and to null when there is no
// obvious target.
function resolveActiveConnectionId(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const participant = Array.isArray(snapshot.session?.participants)
    ? snapshot.session.participants.find((item) => item.agentId === snapshot.activeAgent?.id)
    : null;
  let connectionId = participant?.connectionId || null;
  if (!connectionId && Array.isArray(snapshot.connections) && snapshot.connections.length === 1) {
    connectionId = snapshot.connections[0].id;
  }
  return connectionId;
}

// The snapshot run object only carries `busy`; it does not distinguish a connection
// verification from an agent run. Derive a phase from the connection context so the
// ribbon labels each busy state correctly (otherwise both would read as one thing).
function deriveRunPhase(run, connectionView) {
  if (run?.busy !== true) return run?.phase || null;
  const state = connectionView?.state;
  if (state === 'Verifying installed Codex' || state === 'Sign-in required' || state === 'Recoverable failure') {
    return 'verifying';
  }
  return 'running';
}

// Pure orchestrator: snapshot + connection-state getter -> ribbon model. `getConnectionState`
// is a (connectionId) => view function supplied by the live window's per-connection store.
function buildRibbonModel(snapshot, getConnectionState = () => null) {
  const run = (snapshot && snapshot.run) || {};
  const connectionId = resolveActiveConnectionId(snapshot);
  const connectionView = connectionId ? getConnectionState(connectionId) : null;
  const connection = mapConnectionToRibbon(connectionView);
  const phase = deriveRunPhase(run, connectionView);
  return {
    connectionId,
    run: { busy: run.busy === true, phase },
    connection,
  };
}

const ribbonModel = Object.freeze({
  RIBBON_KINDS,
  RIBBON_ACTIONS,
  RIBBON_ACTION_TYPES,
  deriveRibbonProps,
  mapConnectionToRibbon,
  resolveActiveConnectionId,
  deriveRunPhase,
  buildRibbonModel,
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ribbonModel;
}
if (typeof globalThis !== 'undefined') {
  globalThis.claudePetRibbonModel = ribbonModel;
}
