'use strict';

const { toPublicError } = require('./agent/agentErrors.js');

function createPromptController({ manager, response, onBusyChange = () => {} }) {
  return Object.freeze({
    async submitText(text) {
      let reserved = false;
      try {
        const result = await manager.runGoal(text, {
          onStart: (context) => response.begin?.(context),
          // The coordinator invokes this only once the Agent Manager has made
          // its real reservation, before executor preflight begins.
          onReserved: () => { reserved = true; onBusyChange(); },
        });
        response.success?.(result);
        return result;
      } catch (error) {
        response.failure?.(toPublicError(error));
        throw error;
      } finally {
        // Agent Manager clears its reservation before the run promise settles.
        if (reserved) onBusyChange();
      }
    },
    stop() {
      const stopped = manager.stop();
      if (stopped) response.stopped?.();
      return stopped;
    },
    dismiss() { response.dismiss?.(); },
  });
}

module.exports = { createPromptController };
