'use strict';
const path = require('node:path');
const { createConnectionStore } = require('./agent/connectionStore.js');
const { createActivityStore } = require('./agent/activityStore.js');
const { createAgentManager } = require('./agent/agentManager.js');
const { createOfflineDemoExecutor } = require('./agent/executors/offlineDemoExecutor.js');
const { createCodexCliExecutor } = require('./agent/executors/codexCli.js');
const { createClaudeCodeCliExecutor } = require('./agent/executors/claudeCodeCli.js');

function shouldEnableTestExecutor({ isPackaged, nodeEnv, value } = {}) {
  return isPackaged !== true && nodeEnv === 'test' && value === '1';
}

function createDeterministicCodexExecutor() {
  return Object.freeze({
    async getStatus() { return { installed: true, authenticated: true, workspaceAvailable: true }; },
    async beginSetup() { return { started: false }; },
    async listModels() { return [{ id: 'gpt-5.6-terra', efforts: ['medium'] }]; },
    async getCapabilities() { return { permissionProfiles: ['workspace'], network: false, authentication: false, efforts: ['medium'] }; },
    async verifyPermissionProfile() { return { available: true, allowed: true }; },
    async runGoal(_request, emitActivity) {
      emitActivity({ phase: 'running', kind: 'command', summary: 'Codex test command completed', command: 'git status --short', exitCode: 0 });
      emitActivity({ phase: 'responding', kind: 'usage', summary: 'Codex test usage', usage: { inputTokens: 12, outputTokens: 8, cachedTokens: 0, totalTokens: 20 } });
      emitActivity({ phase: 'responding', kind: 'message', summary: 'Codex test response ready' });
      return { text: 'Deterministic Codex test response.', changedFiles: ['notes/codex-test-result.txt'] };
    },
  });
}

function createAbortableDelayGate({ delayMs = 3000, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  return Object.freeze({
    wait(signal) {
      if (signal?.aborted) return Promise.resolve();
      return new Promise((resolve) => {
        let settled = false;
        let timer = null;
        const finish = (cancelTimer) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          if (cancelTimer && timer !== null) clearTimeoutFn(timer);
          resolve();
        };
        const onAbort = () => finish(true);
        timer = setTimeoutFn(() => finish(false), delayMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
    },
  });
}

function createAgentRuntime({ userDataPath, crypto, randomId, testExecutorEnabled = false }) {
  const store = createConnectionStore({ filePath: path.join(userDataPath, 'connections.json'), crypto, randomId });
  const activity = createActivityStore();
  const codexExecutor = testExecutorEnabled
    ? createDeterministicCodexExecutor()
    : createCodexCliExecutor({ codexHome: path.join(userDataPath, 'codex-home') });
  const claudeExecutor = createClaudeCodeCliExecutor({ claudeConfigDir: path.join(userDataPath, 'claude-config') });
  const manager = createAgentManager({ store, activity, executors: { 'offline-demo': createOfflineDemoExecutor({ gate: createAbortableDelayGate() }), 'codex-cli': codexExecutor, 'claude-code-cli': claudeExecutor } });
  return Object.freeze({ store, activity, manager, initialize: () => store.initialize() });
}
module.exports = { createAbortableDelayGate, createAgentRuntime, shouldEnableTestExecutor };
