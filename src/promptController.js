'use strict';
const { toPublicError } = require('./agent/agentErrors.js');

async function readRunContext(store) {
  const selectedId = await store.getActiveSelection();
  const connection = selectedId ? await store.getConnection(selectedId) : null;
  if (!connection) return undefined;
  return Object.freeze({
    executor: connection.executorType,
    model: connection.modelId,
    workspace: connection.workspacePath,
    permissionProfile: connection.permissionProfile,
  });
}

function createPromptController({ manager, response, getRunContext = async () => undefined }) {
  return Object.freeze({
    async submitText(text) {
      response.begin?.(await getRunContext());
      try {
        const result = await manager.runGoal(text);
        response.success?.(result);
        return result;
      } catch (error) {
        response.failure?.(toPublicError(error));
        throw error;
      }
    },
    stop() { const stopped = manager.stop(); if (stopped) response.stopped?.(); return stopped; },
    dismiss() { response.dismiss?.(); },
  });
}
module.exports = { createPromptController, readRunContext };
