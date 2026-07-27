'use strict';

const { toPublicError } = require('./agent/agentErrors.js');

function createPromptController({ manager, response, animation = null, onBusyChange = () => {} }) {
  let token = null;
  return Object.freeze({
    async submitText(text) {
      let reserved = false;
      try {
        const result = await manager.runGoal(text, {
          onStart: (context) => { token = animation?.goalAccepted?.() ?? null; animation?.runStarted?.(token); response.begin?.(context, token); },
          // The coordinator invokes this only once the Agent Manager has made
          // its real reservation, before executor preflight begins.
          onReserved: () => { reserved = true; onBusyChange(); },
        });
        response.success?.(result, token); animation?.succeeded?.(token);
        return result;
      } catch (error) {
        response.failure?.(toPublicError(error), token); animation?.failed?.(token);
        throw error;
      } finally {
        // Agent Manager clears its reservation before the run promise settles.
        if (reserved) onBusyChange();
      }
    },
    stop() {
      const stopped = manager.stop();
      if (stopped) { response.stopped?.(); animation?.stopped?.(token); }
      return stopped;
    },
    dismiss() { response.dismiss?.(); animation?.dismissed?.(token); },
  });
}

module.exports = { createPromptController };
