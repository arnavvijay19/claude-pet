'use strict';

const { AgentError } = require('../agentErrors.js');

const OFFLINE_MODEL = 'offline-demo';
const RESULT = Object.freeze({
  text: 'Banana Baron completed the Offline Demo run.',
  changedFiles: Object.freeze(['notes/offline-demo-result.txt']),
});
const CONTROLLED_FAILURE = 'fail:COMMAND_FAILED';
const WRAPPED_CONTROLLED_FAILURE = [
  '<claude_pet_current_request>',
  CONTROLLED_FAILURE,
  '</claude_pet_current_request>',
].join('\n');

function abortError() {
  const error = new Error('The Offline Demo run was stopped.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function unsupportedFor(request) {
  return request?.permissionProfile !== 'workspace'
    || request?.effort !== null
    || request?.model !== OFFLINE_MODEL;
}

function createOfflineDemoExecutor({ clock, gate } = {}) {
  void clock;

  async function requireWorkspace(connection) {
    if (connection?.permissionProfile !== 'workspace') {
      throw new AgentError('UNSUPPORTED_OPTION');
    }
  }

  return Object.freeze({
    async getStatus(connection, signal) {
      throwIfAborted(signal);
      return { installed: true, authenticated: true, workspaceAvailable: true };
    },

    async beginSetup() {
      return { started: false };
    },

    async listModels() {
      return [{ id: OFFLINE_MODEL, efforts: [] }];
    },

    async getCapabilities() {
      return {
        permissionProfiles: ['workspace'], network: false, authentication: false, efforts: [],
      };
    },

    async verifyPermissionProfile(connection) {
      await requireWorkspace(connection);
      return { available: true, allowed: true };
    },

    async runGoal(request, emitActivity, signal) {
      if (unsupportedFor(request)) throw new AgentError('UNSUPPORTED_OPTION');
      if (request.goal === CONTROLLED_FAILURE
          || request.goal.endsWith(WRAPPED_CONTROLLED_FAILURE)) {
        throw new AgentError('COMMAND_FAILED');
      }

      throwIfAborted(signal);
      emitActivity({ phase: 'preparing', kind: 'status', summary: 'Preparing Offline Demo run', status: 'preparing' });
      throwIfAborted(signal);
      emitActivity({
        phase: 'inspecting', kind: 'file', summary: 'Inspecting Offline Demo result',
        path: 'notes/offline-demo-result.txt', operation: 'read',
      });
      throwIfAborted(signal);
      emitActivity({ phase: 'running', kind: 'status', summary: 'Running Offline Demo command', status: 'running' });
      if (gate?.wait) await gate.wait(signal);
      throwIfAborted(signal);
      emitActivity({
        phase: 'running', kind: 'command', summary: 'Offline Demo command completed',
        command: 'offline-demo write notes/offline-demo-result.txt', exitCode: 0,
      });
      emitActivity({ phase: 'responding', kind: 'status', summary: 'Responding with Offline Demo result', status: 'responding' });
      emitActivity({
        phase: 'responding', kind: 'usage', summary: 'Offline Demo usage',
        usage: { inputTokens: 12, outputTokens: 8, cachedTokens: 0, totalTokens: 20 },
      });
      emitActivity({ phase: 'responding', kind: 'message', summary: 'Offline Demo response ready' });
      return { text: RESULT.text, changedFiles: [...RESULT.changedFiles] };
    },
  });
}

module.exports = { createOfflineDemoExecutor };
