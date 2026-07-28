'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentError } = require('../src/agent/agentErrors.js');
const { createActivityStore } = require('../src/agent/activityStore.js');
const { createAgentManager } = require('../src/agent/agentManager.js');
const { createSessionCoordinator } = require('../src/agent/sessionCoordinator.js');
const { createPromptController } = require('../src/promptController.js');

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

test('begins the response from the same manager-owned immutable run snapshot', async () => {
  const published = [];
  const begun = [];
  const runContext = Object.freeze({
    connectionId: 'connection-1', executor: 'codex-cli', model: 'gpt-5.6-terra',
    workspace: 'Z:\\first', permissionProfile: 'full-computer',
  });
  const manager = {
    runGoal: async (text, { onStart }) => {
      onStart(runContext);
      return { text, changedFiles: [] };
    },
    stop: () => true,
  };
  const controller = createPromptController({
    manager,
    response: {
      begin: (value) => begun.push(value),
      success: (value) => published.push(value),
      failure: () => {},
    },
  });

  await controller.submitText('hello');
  assert.deepEqual(begun, [runContext]);
  assert.deepEqual(published, [{ text: 'hello', changedFiles: [] }]);
  assert.equal(Object.hasOwn(begun[0], 'revision'), false);
  assert.equal(Object.hasOwn(begun[0], 'fullAccessConfirmed'), false);
});

test('does not start a response when selection or authorization fails before onStart', async () => {
  const begun = [];
  const controller = createPromptController({
    manager: {
      runGoal: async () => { throw new AgentError('FULL_COMPUTER_CONFIRMATION_REQUIRED'); },
      stop: () => false,
    },
    response: { begin: (value) => begun.push(value), failure: () => {} },
  });
  await assert.rejects(
    controller.submitText('hello'),
    (error) => error.code === 'FULL_COMPUTER_CONFIRMATION_REQUIRED',
  );
  assert.deepEqual(begun, []);
});

test('publishes a sanitized error before rethrowing it and exposes Stop', async () => {
  const order = [];
  const controller = createPromptController({
    manager: {
      runGoal: async () => { throw new AgentError('AGENT_REQUIRED'); },
      stop: () => true,
    },
    response: { begin: () => {}, success: () => {}, failure: (error) => order.push(error) },
  });
  await assert.rejects(controller.submitText('hello'), (error) => error.code === 'AGENT_REQUIRED');
  assert.equal(order[0].message.includes('hello'), false);
  assert.equal(controller.stop(), true);
});

test('Stop remains the terminal state when the aborted run rejects afterward', async () => {
  let rejectRun;
  const terminal = [];
  const manager = {
    runGoal: (_text, { onStart }) => {
      onStart({ agentId: 'agent-a' });
      return new Promise((_resolve, reject) => { rejectRun = reject; });
    },
    stop: () => {
      rejectRun(new AgentError('RUN_STOPPED'));
      return true;
    },
  };
  const controller = createPromptController({
    manager,
    response: {
      begin: () => {},
      stopped: () => terminal.push('stopped'),
      failure: () => terminal.push('failure'),
    },
  });
  const pending = controller.submitText('stop me');
  assert.equal(controller.stop(), true);
  await assert.rejects(pending, (error) => error.code === 'RUN_STOPPED');
  assert.deepEqual(terminal, ['stopped']);
});

test('publishes Settings busy only after a real manager reservation and before executor preflight', async () => {
  const preflight = deferred();
  const release = deferred();
  const session = {
    id: 'session-a', agentId: 'agent-a', title: 'Session', workspacePath: 'Z:\\workspace', nextConnectionId: 'offline',
    createdAt: '1', updatedAt: '1', turnCount: 0, lastProvider: null,
  };
  const turns = [];
  const connection = {
    id: 'offline', revision: 1, executorType: 'offline-demo', label: 'Offline', workspacePath: 'Z:\\workspace',
    permissionProfile: 'workspace', fullAccessConfirmed: false, modelId: 'agent-model', effort: null, keyHint: null, hasSecret: false,
  };
  const store = {
    getActiveSelection: async () => 'offline', setActiveSelection: async () => {},
    getConnection: async (id) => id === 'offline' ? connection : null,
    getRunConnection: async (id) => id === 'offline' ? connection : null,
    listConnections: async () => [connection],
  };
  const executor = {
    async getStatus() { preflight.resolve(); await release.promise; return { installed: true, authenticated: true, workspaceAvailable: true }; },
    beginSetup: async () => ({ started: false }), listModels: async () => [{ id: 'agent-model', efforts: [] }],
    getCapabilities: async () => ({ efforts: [] }), verifyPermissionProfile: async () => ({ available: true, allowed: true }),
    runGoal: async () => ({ text: 'done', changedFiles: [] }),
  };
  const manager = createAgentManager({ store, executors: { 'offline-demo:workspace': executor }, activity: createActivityStore({ clock: () => 1 }) });
  const coordinator = createSessionCoordinator({
    connectionStore: store, manager,
    sessionStore: {
      listAgents: async () => [{ id: 'agent-a', name: 'Agent', createdAt: '1', updatedAt: '1', sessionCount: 1 }],
      listSessions: async () => [session], getSelection: async () => ({ agentId: 'agent-a', sessionId: 'session-a' }),
      getSessionView: async (id) => id === 'session-a' ? session : null, getContextTurns: async () => turns,
      appendTurn: async (_id, turn) => { turns.push(turn); }, select: async () => {}, setNextConnection: async () => {},
      createAgent: async () => {}, renameAgent: async () => {}, removeAgent: async () => {}, createSession: async () => {}, renameSession: async () => {}, removeSession: async () => {},
    },
  });
  const notifications = [];
  const controller = createPromptController({
    manager: coordinator,
    response: { success: () => {}, failure: () => {} },
    onBusyChange: () => notifications.push(manager.getSnapshot().busy),
  });
  const pending = controller.submitText('hello');
  await preflight.promise;
  assert.deepEqual(notifications, [true]);
  release.resolve();
  await pending;
  assert.deepEqual(notifications, [true, false]);
});
