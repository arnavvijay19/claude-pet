'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentError } = require('../src/agent/agentErrors.js');
const { createPromptController, readRunContext } = require('../src/promptController.js');

test('reads only selected public connection metadata for the response shell', async () => {
  const context = await readRunContext({
    getActiveSelection: async () => 'offline',
    getConnection: async () => ({ executorType: 'offline-demo', modelId: 'offline-demo', workspacePath: 'Z:\\work', permissionProfile: 'workspace', secret: 'must not cross the boundary' }),
  });
  assert.deepEqual(context, { executor: 'offline-demo', model: 'offline-demo', workspace: 'Z:\\work', permissionProfile: 'workspace' });
});

test('submits terminal text once and publishes the result', async () => {
  const published = [];
  const begun = [];
  const controller = createPromptController({ manager: { runGoal: async (text) => ({ text, changedFiles: [] }), stop: () => true }, getRunContext: async () => ({ executor: 'offline-demo', model: 'offline-demo', workspace: 'Z:\\work', permissionProfile: 'workspace' }), response: { begin: (value) => begun.push(value), success: (value) => published.push(value), failure: () => {} } });
  await controller.submitText('hello');
  assert.deepEqual(begun, [{ executor: 'offline-demo', model: 'offline-demo', workspace: 'Z:\\work', permissionProfile: 'workspace' }]);
  assert.deepEqual(published, [{ text: 'hello', changedFiles: [] }]);
});

test('publishes a sanitized error before rethrowing it and exposes Stop', async () => {
  const order = [];
  const controller = createPromptController({ manager: { runGoal: async () => { throw new AgentError('AGENT_REQUIRED'); }, stop: () => true }, response: { begin: () => {}, success: () => {}, failure: (error) => order.push(error) } });
  await assert.rejects(controller.submitText('hello'), (error) => error.code === 'AGENT_REQUIRED');
  assert.equal(order[0].message.includes('hello'), false);
  assert.equal(controller.stop(), true);
});
