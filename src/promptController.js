'use strict';

const { toPublicError } = require('./agent/agentErrors.js');

function createPromptController({ manager, response }) {
  return Object.freeze({
    async submitText(text) {
      try {
        const result = await manager.runGoal(text, {
          onStart: (context) => response.begin?.(context),
        });
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
