'use strict';
const path = require('node:path');
const { createConnectionStore } = require('./agent/connectionStore.js');
const { createSessionStore } = require('./agent/sessionStore.js');
const { createActivityStore } = require('./agent/activityStore.js');
const { createAgentManager } = require('./agent/agentManager.js');
const { createSessionCoordinator } = require('./agent/sessionCoordinator.js');
const { createOfflineDemoExecutor } = require('./agent/executors/offlineDemoExecutor.js');
const { createCodexCliExecutor } = require('./agent/executors/codexCli.js');
const { createClaudeCodeCliExecutor } = require('./agent/executors/claudeCodeCli.js');
const { createCodexNativeFullComputerExecutor } = require('./agent/executors/codexNativeFullComputer.js');
const { createClaudeNativeFullComputerExecutor } = require('./agent/executors/claudeNativeFullComputer.js');
const { AgentError } = require('./agent/agentErrors.js');
const { createCodexCompatibilityStore: defaultCreateCodexCompatibilityStore } = require('./agent/codexCompatibilityStore.js');
const {
  createCodexCompatibility: defaultCreateCodexCompatibility,
  createCodexCompatibilityQualifier: defaultCreateCodexCompatibilityQualifier,
} = require('./agent/codexCompatibility.js');

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

function createUnavailableWorkspaceExecutor(executor) {
  return Object.freeze({
    getStatus: (connection) => executor.getStatus(connection),
    beginSetup: (connection) => executor.beginSetup(connection),
    listModels: (connection) => executor.listModels(connection),
    async getCapabilities(connection, model) {
      const capabilities = await executor.getCapabilities(connection, model);
      return { ...capabilities, permissionProfiles: ['workspace'], network: false };
    },
    async verifyPermissionProfile() { return { available: false, allowed: false }; },
    async runGoal() { throw new AgentError('PERMISSION_PROFILE_UNAVAILABLE'); },
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

function createAgentRuntime({ userDataPath, crypto, randomId, testExecutorEnabled = false, confirmProviderSwitch, dependencies = {} }) {
  const createCodexCompatibilityStore = dependencies.createCodexCompatibilityStore || defaultCreateCodexCompatibilityStore;
  const createCodexCompatibility = dependencies.createCodexCompatibility || defaultCreateCodexCompatibility;
  const createCodexCompatibilityQualifier = dependencies.createCodexCompatibilityQualifier || defaultCreateCodexCompatibilityQualifier;
  const createRuntimeCodexCliExecutor = dependencies.createCodexCliExecutor || createCodexCliExecutor;
  const createRuntimeNativeCodexExecutor = dependencies.createCodexNativeFullComputerExecutor || createCodexNativeFullComputerExecutor;
  const store = createConnectionStore({ filePath: path.join(userDataPath, 'connections.json'), crypto, randomId });
  const sessions = createSessionStore({ filePath: path.join(userDataPath, 'sessions.json'), crypto, randomId, clock: () => new Date().toISOString() });
  const activity = createActivityStore();
  const fixtureRoot = path.join(__dirname, '..', 'resources', 'probes');
  const codexCompatibilityStore = createCodexCompatibilityStore({
    filePath: path.join(userDataPath, 'codex-compatibility.json'), crypto,
  });
  const qualifyCodexCompatibility = createCodexCompatibilityQualifier({
    compatibilityRoot: path.join(userDataPath, 'codex-compatibility-probe'), fixtureRoot,
  });
  const codexCompatibility = createCodexCompatibility({
    store: codexCompatibilityStore, qualify: qualifyCodexCompatibility,
  });
  const ensureCodexCompatibility = codexCompatibility.ensureCompatible.bind(codexCompatibility);
  const codexExecutor = testExecutorEnabled
    ? createDeterministicCodexExecutor()
    : createRuntimeCodexCliExecutor({
      codexHome: path.join(userDataPath, 'codex-home'), ensureCodexCompatibility,
    });
  const claudeExecutor = createClaudeCodeCliExecutor({ claudeConfigDir: path.join(userDataPath, 'claude-config') });
  const nativeCodexExecutor = createRuntimeNativeCodexExecutor({
    codexHome: path.join(userDataPath, 'native-codex-home'), fixtureRoot,
    ensureCodexCompatibility,
  });
  const nativeClaudeExecutor = createClaudeNativeFullComputerExecutor({
    claudeConfigDir: path.join(userDataPath, 'native-claude-config'), fixtureRoot,
  });
  const manager = createAgentManager({
    store,
    activity,
    executors: {
      'offline-demo:workspace': createOfflineDemoExecutor({ gate: createAbortableDelayGate() }),
      'codex-cli:workspace': testExecutorEnabled
        ? codexExecutor
        : createUnavailableWorkspaceExecutor(codexExecutor),
      'claude-code-cli:workspace': createUnavailableWorkspaceExecutor(claudeExecutor),
      'codex-cli:full-computer': nativeCodexExecutor,
      'claude-code-cli:full-computer': nativeClaudeExecutor,
    },
  });
  const coordinator = createSessionCoordinator({ sessionStore: sessions, connectionStore: store, manager, confirmProviderSwitch });
  return Object.freeze({ store, sessions, activity, manager, coordinator, initialize: async () => {
    await Promise.all([store.initialize(), sessions.initialize(), codexCompatibilityStore.initialize()]);
  } });
}
module.exports = {
  createAbortableDelayGate,
  createAgentRuntime,
  createUnavailableWorkspaceExecutor,
  shouldEnableTestExecutor,
};
