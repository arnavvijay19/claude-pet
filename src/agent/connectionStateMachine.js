'use strict';

// Per-connection connection workflow state machine.
//
// Replaces the app's previous global `connectionActionPending` boolean and global
// `connectionFeedback` string with one independent, pure, synchronous machine per saved
// connection (keyed by connectionId). A machine models the workflow of a single saved Codex
// connection through these states:
//
//   Not checked -> Verifying installed Codex -> Ready -> Starting -> Running -> Ready
//                                    |
//                                    +-> Sign-in required -> Ready
//   Any state (except the failure state itself) -> (failure) Recoverable failure
//   Any state -> Not checked (reset / cancel)
//
// The module has no DOM, Electron, network, timers, or async work, and no new dependencies.

const STATES = Object.freeze({
  NOT_CHECKED: 'Not checked',
  VERIFYING: 'Verifying installed Codex',
  SIGN_IN_REQUIRED: 'Sign-in required',
  READY: 'Ready',
  STARTING: 'Starting',
  RUNNING: 'Running',
  // A single recoverable failure state. The specific fixed outcome (code + message) is carried
  // in the machine's `failure` field, never raw errors or credentials.
  FAILURE: 'Recoverable failure',
});

const EVENTS = Object.freeze({
  VERIFY: 'verify',
  INSTALLED: 'installed',
  SIGN_IN_REQUIRED: 'signInRequired',
  SIGNED_IN: 'signedIn',
  CANCEL: 'cancel',
  FAILED: 'failed',
  START: 'start',
  RUNNING: 'running',
  DONE: 'done',
  RESET: 'reset',
});

// Allowed transitions keyed by current state then event. `undefined` means the transition is
// not allowed from that state. RESET is allowed from every state and always returns to Not
// checked. FAILED is resolved to the single failure state by the transition function.
const TRANSITIONS = Object.freeze({
  [STATES.NOT_CHECKED]: {
    [EVENTS.VERIFY]: STATES.VERIFYING,
    [EVENTS.RESET]: STATES.NOT_CHECKED,
  },
  [STATES.VERIFYING]: {
    [EVENTS.INSTALLED]: STATES.READY,
    [EVENTS.SIGN_IN_REQUIRED]: STATES.SIGN_IN_REQUIRED,
    [EVENTS.CANCEL]: STATES.NOT_CHECKED,
    [EVENTS.FAILED]: STATES.FAILURE,
    [EVENTS.RESET]: STATES.NOT_CHECKED,
  },
  [STATES.SIGN_IN_REQUIRED]: {
    [EVENTS.SIGNED_IN]: STATES.READY,
    [EVENTS.RESET]: STATES.NOT_CHECKED,
  },
  [STATES.READY]: {
    [EVENTS.START]: STATES.STARTING,
    [EVENTS.RESET]: STATES.NOT_CHECKED,
  },
  [STATES.STARTING]: {
    [EVENTS.RUNNING]: STATES.RUNNING,
    [EVENTS.RESET]: STATES.NOT_CHECKED,
  },
  [STATES.RUNNING]: {
    [EVENTS.DONE]: STATES.READY,
    [EVENTS.FAILED]: STATES.FAILURE,
    [EVENTS.RESET]: STATES.NOT_CHECKED,
  },
  [STATES.FAILURE]: {
    [EVENTS.RESET]: STATES.NOT_CHECKED,
  },
});

const STATE_VALUES = Object.freeze(Object.values(STATES));
const EVENT_VALUES = Object.freeze(Object.values(EVENTS));

// The failure state cannot be an initial state: it requires a fixed outcome payload that is
// only available through the FAILED event.
const ALLOWED_INITIAL_STATES = Object.freeze(
  STATE_VALUES.filter((value) => value !== STATES.FAILURE),
);

function now() {
  return Date.now();
}

// Name the active step for a state. Only in-flight workflow steps are named; idle states
// (Not checked, Ready, failure) have no active step. A one-time identity check is labelled as
// one-time so the UI can reflect it.
function deriveStep(state, payload = {}) {
  switch (state) {
    case STATES.VERIFYING:
      return 'Verifying installed Codex';
    case STATES.STARTING:
      return 'Starting';
    case STATES.RUNNING:
      return 'Running';
    case STATES.SIGN_IN_REQUIRED:
      return payload.oneTime === true ? 'One-time identity check' : 'Sign in to Codex';
    default:
      return null;
  }
}

// Build a fixed, safe, recoverable failure outcome from caller-supplied safe copy. Only the
// code and human-readable message are kept; raw errors, causes, credentials, paths, and
// provider output are never stored.
function buildFailure(payload = {}) {
  const { code, message } = payload;
  if (typeof code !== 'string' || code.length === 0) {
    throw new TypeError('failure requires a non-empty string code');
  }
  if (typeof message !== 'string' || message.length === 0) {
    throw new TypeError('failure requires a non-empty string message');
  }
  return Object.freeze({ code, message, recoverable: true });
}

function initialStateFor(initialState) {
  if (initialState === undefined) return STATES.NOT_CHECKED;
  if (!STATE_VALUES.includes(initialState)) {
    throw new TypeError(`Unknown initial state: ${String(initialState)}`);
  }
  if (initialState === STATES.FAILURE) {
    throw new TypeError('Cannot initialize a connection in the failure state');
  }
  return initialState;
}

/**
 * Create a pure, synchronous state machine for a single saved connection.
 * @param {{connectionId: string, initialState?: string}} options
 * @returns {{
 *   getState: () => {state: string, connectionId: string, step: (string|null),
 *     feedback: (string|null), failure: ({code: string, message: string, recoverable: boolean}|null),
 *     updatedAt: number},
 *   transition: (event: string, payload?: object) => object,
 *   cancel: () => object,
 *   reset: () => object,
 *   subscribe: (listener: (snapshot: object) => void) => (() => void),
 * }}
 */
function createConnectionStateMachine({ connectionId, initialState } = {}) {
  if (typeof connectionId !== 'string' || connectionId.length === 0) {
    throw new TypeError('connectionId is required and must be a non-empty string');
  }

  let current = initialStateFor(initialState);
  let step = deriveStep(current);
  let feedback = null;
  let failure = null;
  let updatedAt = now();
  const listeners = new Set();

  function snapshot() {
    return Object.freeze({
      state: current,
      connectionId,
      step,
      feedback,
      failure: failure ? Object.freeze({ ...failure }) : null,
      updatedAt,
    });
  }

  function emit() {
    const snap = snapshot();
    for (const listener of listeners) listener(snap);
  }

  // Apply a target state, recomputing derived fields. `nextFailure` (when set) implies a
  // failure outcome and drives both the `failure` and `feedback` fields.
  function apply(nextState, { nextFailure = null, stepPayload = {} } = {}) {
    current = nextState;
    step = deriveStep(nextState, stepPayload);
    failure = nextFailure;
    feedback = nextFailure ? nextFailure.message : null;
    updatedAt = now();
    emit();
  }

  function transition(event, payload = {}) {
    if (!EVENT_VALUES.includes(event)) {
      throw new Error(`Unknown event: ${String(event)}`);
    }
    if (event === EVENTS.RESET) {
      apply(STATES.NOT_CHECKED);
      return snapshot();
    }
    const nextState = TRANSITIONS[current]?.[event];
    if (nextState === undefined) {
      throw new Error(`Transition '${event}' is not allowed from state '${current}'`);
    }
    if (event === EVENTS.FAILED) {
      const nextFailure = buildFailure(payload);
      apply(STATES.FAILURE, { nextFailure });
      return snapshot();
    }
    apply(nextState, { stepPayload: payload });
    return snapshot();
  }

  // Cancel an in-flight verification. Only meaningful during Verifying installed Codex; a
  // no-op otherwise (does not throw, does not emit).
  function cancel() {
    if (current === STATES.VERIFYING) {
      apply(STATES.NOT_CHECKED);
    }
    return snapshot();
  }

  // Return to Not checked from any state, clearing step, feedback, and failure.
  function reset() {
    apply(STATES.NOT_CHECKED);
    return snapshot();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getState() {
    return snapshot();
  }

  return Object.freeze({ getState, transition, cancel, reset, subscribe });
}

/**
 * Manage one independent connection state machine per connectionId.
 * @returns {{
 *   get: (connectionId: string) => object|undefined,
 *   ensure: (connectionId: string) => object,
 *   remove: (connectionId: string) => boolean,
 *   list: () => string[],
 *   subscribe: (listener: (snapshot: object) => void) => (() => void),
 * }}
 */
function createConnectionStateStore() {
  const machines = new Map();
  const forwarders = new Map();
  const storeListeners = new Set();

  function forward(machine) {
    const { connectionId } = machine.getState();
    if (forwarders.has(connectionId)) return;
    const unsubscribe = machine.subscribe((snapshot) => {
      for (const listener of storeListeners) listener(snapshot);
    });
    forwarders.set(connectionId, unsubscribe);
  }

  function get(connectionId) {
    return machines.get(connectionId);
  }

  function ensure(connectionId) {
    const existing = machines.get(connectionId);
    if (existing) return existing;
    const machine = createConnectionStateMachine({ connectionId });
    machines.set(connectionId, machine);
    forward(machine);
    return machine;
  }

  function remove(connectionId) {
    if (!machines.has(connectionId)) return false;
    const unsubscribe = forwarders.get(connectionId);
    if (unsubscribe) unsubscribe();
    forwarders.delete(connectionId);
    machines.delete(connectionId);
    return true;
  }

  function list() {
    return [...machines.keys()];
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    storeListeners.add(listener);
    return () => storeListeners.delete(listener);
  }

  return Object.freeze({ get, ensure, remove, list, subscribe });
}

const connectionStateMachineApi = Object.freeze({
  STATES,
  EVENTS,
  createConnectionStateMachine,
  createConnectionStateStore,
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = connectionStateMachineApi;
}

// Expose to the Electron renderer. The renderer runs with nodeIntegration disabled and
// no module system, so it cannot `require` this module; a plain <script> tag loads it and
// the renderer's own thin wrapper (src/app/connectionState.js) reuses the same pure machine.
if (typeof globalThis !== 'undefined') {
  globalThis.claudePetConnectionStateMachine = connectionStateMachineApi;
}
