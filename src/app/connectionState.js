'use strict';

// Renderer-side per-connection state for the Phase 2 connection workflow.
//
// The pure machine lives in src/agent/connectionStateMachine.js. The renderer runs with
// nodeIntegration disabled and no module system, so it cannot `require` that module. This
// thin wrapper is loaded as a plain <script> after the machine has been exposed on
// globalThis.claudePetConnectionStateMachine, and gives the orchestrator (app.js) one
// independent, observable state per saved connection plus a small driver that moves a
// connection through verify -> installed / sign-in-required / failure.
//
// The module is dual-mode: it also works under Node (via require) so the renderer wiring is
// unit-testable without a browser.

(function exposeConnectionState(root) {
  const machineApi = (root && root.claudePetConnectionStateMachine)
    || (typeof require !== 'undefined' ? require('../agent/connectionStateMachine.js') : null);
  if (!machineApi || typeof machineApi.createConnectionStateStore !== 'function') {
    throw new Error('connectionStateMachine is required by the renderer connection state');
  }
  const { createConnectionStateStore, STATES } = machineApi;
  const VERIFYING = STATES.VERIFYING;
  const NOT_CHECKED = STATES.NOT_CHECKED;
  const RUNNING = STATES.RUNNING;

  function createRendererConnectionState() {
    const store = createConnectionStateStore();

    function machine(connectionId) {
      return connectionId ? store.get(connectionId) : null;
    }

    function view(connectionId) {
      const m = machine(connectionId);
      return m ? m.getState() : null;
    }

    function ensure(connectionId) {
      return store.ensure(connectionId).getState();
    }

    // A test-connection action begins: mark the connection as verifying while in flight.
    // Re-testing from any state restarts cleanly, so reset first if not already Not checked.
    function verifying(connectionId) {
      const machine = store.ensure(connectionId);
      if (machine.getState().state !== NOT_CHECKED) machine.reset();
      return machine.transition('verify');
    }

    function markInstalled(connectionId) {
      return store.ensure(connectionId).transition('installed');
    }

    function markSignInRequired(connectionId, payload = {}) {
      return store.ensure(connectionId).transition('signInRequired', payload);
    }

    // Store a fixed, safe failure outcome. Only the code and human-readable message cross
    // the boundary; raw errors, causes, credentials, paths, and provider output never do.
    // `failed` is legal from VERIFYING/RUNNING. From any settled state (including Not checked,
    // e.g. a save-connection error), restart the attempt (verify) so the failure is always legal.
    function fail(connectionId, code, message) {
      const machine = store.ensure(connectionId);
      const current = machine.getState().state;
      if (current !== VERIFYING && current !== RUNNING) {
        machine.reset();
        machine.transition('verify');
      }
      return machine.transition('failed', { code, message });
    }

    // Cancel an in-flight verification. No-op (never throws) unless verifying.
    function cancel(connectionId) {
      const m = machine(connectionId);
      return m ? m.cancel() : null;
    }

    // A save clears any prior tested state. Ensures the machine exists first.
    function reset(connectionId) {
      const machine = store.ensure(connectionId);
      return machine.reset();
    }

    function isVerifying(connectionId) {
      return view(connectionId)?.state === VERIFYING;
    }

    return Object.freeze({
      view,
      ensure,
      verifying,
      markInstalled,
      markSignInRequired,
      fail,
      cancel,
      reset,
      isVerifying,
      remove: (connectionId) => store.remove(connectionId),
      subscribe: (listener) => store.subscribe(listener),
    });
  }

  const api = Object.freeze({ createRendererConnectionState, STATES });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.claudePetConnectionState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
