'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentError } = require('../src/agent/agentErrors.js');
const { createPromptController } = require('../src/promptController.js');

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

test('notifies the Settings busy bridge immediately after reserving a run', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const notifications = [];
  const controller = createPromptController({
    manager: {
      runGoal: async () => { await gate; return { text: 'done', changedFiles: [] }; }, stop: () => false,
    },
    response: { success: () => {}, failure: () => {} },
    onBusyChange: () => notifications.push('busy'),
  });
  const pending = controller.submitText('hello');
  assert.deepEqual(notifications, ['busy']);
  release();
  await pending;
});
