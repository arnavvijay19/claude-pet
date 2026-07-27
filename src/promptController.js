'use strict';

const { toPublicError } = require('./agent/agentErrors.js');

function createPromptController({ manager, response, onBusyChange = () => {} }) {
  return Object.freeze({
    async submitText(text) {
      try {
        const pending = manager.runGoal(text, {
          onStart: (context) => response.begin?.(context),
        });
        onBusyChange();
        const result = await pending;
        response.success?.(result);
        return result;
      } catch (error) {
        response.failure?.(toPublicError(error));
        throw error;
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
