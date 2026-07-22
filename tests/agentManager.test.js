const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REQUIRED_METHODS,
  validateExecutor,
} = require('../src/agent/agentContract.js');
const {
  AgentError,
  ERROR_CODES,
  PUBLIC_ERROR_BY_CODE,
  toPublicError,
} = require('../src/agent/agentErrors.js');
const { createActivityStore } = require('../src/agent/activityStore.js');
const { createAgentManager } = require('../src/agent/agentManager.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function fakeExecutor(overrides = {}) {
  return {
    getStatus: async () => ({ installed: true, authenticated: true, workspaceAvailable: true }),
    beginSetup: async () => ({ started: true }),
    listModels: async () => [{ id: 'agent-model', efforts: ['low', 'high'] }],
    getCapabilities: async () => ({ efforts: ['low', 'high'] }),
    verifyPermissionProfile: async () => ({ available: true, allowed: true }),
    runGoal: async () => ({ text: 'done', changedFiles: ['src/main.js'] }),
    ...overrides,
  };
}

function harness({ connection, executor = fakeExecutor(), getSelected } = {}) {
  let selected = connection === undefined ? {
    id: 'connection-1', executor: 'demo', model: 'agent-model', effort: 'high',
    permissionProfile: { mode: 'workspace', nested: { level: 1 } },
  } : connection;
  const store = {
    getSelected: getSelected || (async () => selected),
    select: async (id) => { selected = { ...selected, id }; return selected; },
  };
  const activity = createActivityStore({ clock: () => 123 });
  return {
    activity,
    manager: createAgentManager({ store, executors: { demo: executor }, activity }),
  };
}

test('requires all six executor methods', () => {
  assert.deepEqual(REQUIRED_METHODS, [
    'getStatus', 'beginSetup', 'listModels', 'getCapabilities',
    'verifyPermissionProfile', 'runGoal',
  ]);
  for (const method of REQUIRED_METHODS) {
    const executor = fakeExecutor();
    delete executor[method];
    assert.throws(() => validateExecutor(executor), {
      name: 'TypeError', message: `Agent executor is missing method: ${method}`,
    });
  }
  assert.equal(validateExecutor(fakeExecutor()).runGoal instanceof Function, true);
});

test('publishes stable allowlisted public errors for every code', () => {
  assert.equal(Object.isFrozen(ERROR_CODES), true);
  assert.equal(Object.isFrozen(PUBLIC_ERROR_BY_CODE), true);
  for (const code of ERROR_CODES) {
    const value = toPublicError(new AgentError(code, { requestId: 'request-1', message: 'secret=abc' }));
    assert.deepEqual(Object.keys(value), ['code', 'message', 'action', 'requestId']);
    assert.deepEqual(value, { code, ...PUBLIC_ERROR_BY_CODE[code], requestId: 'request-1' });
    assert.equal(JSON.stringify(value).includes('secret=abc'), false);
  }
  for (const error of [new Error('secret=abc'), { code: 'NOT_REAL', message: 'secret=abc' }]) {
    assert.deepEqual(toPublicError(error), {
      code: 'COMMAND_FAILED', ...PUBLIC_ERROR_BY_CODE.COMMAND_FAILED, requestId: null,
    });
  }
});

test('returns AGENT_REQUIRED when no connection is selected', async () => {
  const { manager } = harness({ connection: null });
  await assert.rejects(manager.runGoal('hello'), (error) => error.code === 'AGENT_REQUIRED');
});

test('reserves busy before awaiting selected connection lookup', async () => {
  const selection = deferred();
  const { manager } = harness({ getSelected: () => selection.promise });
  const first = manager.runGoal('first');
  await assert.rejects(manager.runGoal('second'), (error) => error.code === 'AGENT_BUSY');
  selection.resolve({
    id: 'connection-1', executor: 'demo', model: 'agent-model', effort: 'high',
    permissionProfile: { mode: 'workspace' },
  });
  await first;
});

test('sends only the exact deeply immutable executor request snapshot', async () => {
  const gate = deferred();
  const connection = {
    id: 'connection-1', executor: 'demo',
    model: { id: 'agent-model', internalMetadata: 'must-not-leak' }, effort: 'high',
    workspace: { path: 'Z:\\workspace', nested: { trusted: true } },
    permissionProfile: { mode: 'workspace', nested: { level: 1 } },
    options: { retries: 0, nested: { colors: ['blue'] } },
    internalToken: 'must-not-leak',
  };
  let request;
  let seenConnection;
  const executor = fakeExecutor({
    listModels: async (selected) => {
      seenConnection = selected;
      return [{ id: 'agent-model', capabilities: { efforts: ['high'] } }];
    },
    getCapabilities: async () => ({ efforts: ['high'], nested: { tools: ['write'] } }),
    runGoal: async (value) => { request = value; await gate.promise; return { text: 'done', changedFiles: [] }; },
  });
  const { manager } = harness({ connection, executor });
  const pending = manager.runGoal('work');
  await new Promise((resolve) => setImmediate(resolve));
  connection.permissionProfile.nested.level = 9;
  connection.workspace.nested.trusted = false;
  connection.options.nested.colors.push('red');
  assert.equal(Object.isFrozen(seenConnection), true);
  assert.equal(Object.isFrozen(seenConnection.permissionProfile.nested), true);
  assert.deepEqual(Object.keys(request), [
    'goal', 'workspace', 'permissionProfile', 'model', 'effort', 'options',
  ]);
  assert.deepEqual(request, {
    goal: 'work',
    workspace: { path: 'Z:\\workspace', nested: { trusted: true } },
    permissionProfile: { mode: 'workspace', nested: { level: 1 } },
    model: 'agent-model',
    effort: 'high',
    options: { retries: 0, nested: { colors: ['blue'] } },
  });
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.workspace.nested), true);
  assert.equal(Object.isFrozen(request.permissionProfile.nested), true);
  assert.equal(Object.isFrozen(request.options.nested.colors), true);
  assert.equal(JSON.stringify(request).includes('must-not-leak'), false);
  gate.resolve();
  await pending;
});

test('rejects unsupported effort before execution', async () => {
  let executions = 0;
  const executor = fakeExecutor({
    getCapabilities: async () => ({ efforts: ['low'] }),
    runGoal: async () => { executions += 1; return { text: '', changedFiles: [] }; },
  });
  const { manager } = harness({ executor });
  await assert.rejects(manager.runGoal('work'), (error) => error.code === 'UNSUPPORTED_OPTION');
  assert.equal(executions, 0);
});

test('rejects non-JSON option values with UNSUPPORTED_OPTION before execution', async () => {
  const unsupported = [
    new Date(),
    Infinity,
    () => {},
    new Map([['key', 'value']]),
    { nested: undefined },
    Array(1),
  ];
  for (const options of unsupported) {
    let executions = 0;
    const connection = {
      id: 'connection-1', executor: 'demo', model: 'agent-model', effort: 'high',
      permissionProfile: { mode: 'workspace' }, options,
    };
    const executor = fakeExecutor({
      runGoal: async () => { executions += 1; return { text: '', changedFiles: [] }; },
    });
    const { manager } = harness({ connection, executor });
    await assert.rejects(manager.runGoal('work'), (error) => error.code === 'UNSUPPORTED_OPTION');
    assert.equal(executions, 0);
  }
});

test('sanitizes and validates every executor activity event before publication', async () => {
  const executor = fakeExecutor({
    runGoal: async (_request, emitActivity) => {
      emitActivity({ phase: 'run', kind: 'command', summary: 'Executing', command: 'TOKEN=secret node x.js', exitCode: 0 });
      assert.throws(
        () => emitActivity({ phase: 'run', kind: 'status', summary: 'bad', unexpected: 'secret' }),
        (error) => error.code === 'ACTIVITY_INVALID',
      );
      return { text: 'done', changedFiles: [] };
    },
  });
  const { manager, activity } = harness({ executor });
  await manager.runGoal('work');
  const serialized = JSON.stringify(activity.snapshot());
  assert.equal(serialized.includes('secret'), false);
  assert.equal(activity.snapshot().events.length, 1);
});

test('ignores delayed activity from a settled run after the next run begins', async () => {
  let runNumber = 0;
  let emitFromRunA;
  const runBStarted = deferred();
  const finishRunB = deferred();
  const executor = fakeExecutor({
    runGoal: async (_request, emitActivity) => {
      runNumber += 1;
      if (runNumber === 1) {
        emitFromRunA = emitActivity;
        return { text: 'A done', changedFiles: [] };
      }
      emitActivity({ phase: 'run', kind: 'status', summary: 'B live' });
      runBStarted.resolve();
      await finishRunB.promise;
      return { text: 'B done', changedFiles: [] };
    },
  });
  const { manager, activity } = harness({ executor });

  await manager.runGoal('A');
  const runB = manager.runGoal('B');
  await runBStarted.promise;
  emitFromRunA({ phase: 'run', kind: 'status', summary: 'late A' });

  assert.deepEqual(activity.snapshot().events.map((event) => event.summary), ['B live']);
  finishRunB.resolve();
  await runB;
});

test('returns AGENT_BUSY for a second goal and Stop aborts with RUN_STOPPED', async () => {
  const started = deferred();
  const executor = fakeExecutor({
    runGoal: (_request, _emit, signal) => new Promise((_resolve, reject) => {
      started.resolve(signal);
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted secret'), { name: 'AbortError' })), { once: true });
    }),
  });
  const { manager } = harness({ executor });
  const first = manager.runGoal('first');
  const signal = await started.promise;
  await assert.rejects(manager.runGoal('second'), (error) => error.code === 'AGENT_BUSY');
  assert.equal(manager.stop(), true);
  assert.equal(signal.aborted, true);
  await assert.rejects(first, (error) => error.code === 'RUN_STOPPED');
  assert.equal(manager.getSnapshot().busy, false);
});

test('Stop during asynchronous selection prevents preflight and returns RUN_STOPPED', async () => {
  const selection = deferred();
  let statusCalls = 0;
  const executor = fakeExecutor({
    getStatus: async () => { statusCalls += 1; return { installed: true }; },
  });
  const { manager } = harness({ executor, getSelected: () => selection.promise });
  const pending = manager.runGoal('work');
  assert.equal(manager.stop(), true);
  selection.resolve({
    id: 'connection-1', executor: 'demo', model: 'agent-model', effort: 'high',
    permissionProfile: { mode: 'workspace' },
  });
  await assert.rejects(pending, (error) => error.code === 'RUN_STOPPED');
  assert.equal(statusCalls, 0);
  assert.equal(manager.getSnapshot().busy, false);
});

test('workspace, permission, and model preflight failures reject before execution', async () => {
  const cases = [
    ['WORKSPACE_UNAVAILABLE', { getStatus: async () => ({ workspaceAvailable: false }) }],
    ['PERMISSION_PROFILE_UNAVAILABLE', { verifyPermissionProfile: async () => ({ available: false }) }],
    ['PERMISSION_BLOCKED', { verifyPermissionProfile: async () => ({ available: true, allowed: false }) }],
    ['MODEL_UNAVAILABLE', { listModels: async () => [{ id: 'different-model' }] }],
  ];
  for (const [code, overrides] of cases) {
    let executions = 0;
    const executor = fakeExecutor({
      ...overrides,
      runGoal: async () => { executions += 1; return { text: '', changedFiles: [] }; },
    });
    const { manager } = harness({ executor });
    await assert.rejects(manager.runGoal('work'), (error) => error.code === code, code);
    assert.equal(executions, 0, code);
  }
});

test('success and failure clear busy and unknown failures are normalized', async () => {
  const success = harness();
  const result = await success.manager.runGoal('work');
  assert.deepEqual(result, {
    text: 'done', changedFiles: ['src/main.js'], connectionId: 'connection-1',
    executor: 'demo', model: 'agent-model',
  });
  assert.equal(success.manager.getSnapshot().busy, false);

  const failure = harness({ executor: fakeExecutor({ runGoal: async () => { throw new Error('secret=abc'); } }) });
  await assert.rejects(failure.manager.runGoal('work'), (error) => {
    assert.equal(error.code, 'COMMAND_FAILED');
    assert.equal(error.message.includes('secret=abc'), false);
    return true;
  });
  assert.equal(failure.manager.getSnapshot().busy, false);
});

test('does not retry or fall back after an executor failure', async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const selected = {
    id: 'connection-1', executor: 'primary', model: 'agent-model', effort: 'high',
    permissionProfile: { mode: 'workspace' },
  };
  const primary = fakeExecutor({
    runGoal: async () => { primaryCalls += 1; throw new AgentError('RATE_LIMITED'); },
  });
  const fallback = fakeExecutor({
    runGoal: async () => { fallbackCalls += 1; return { text: 'fallback', changedFiles: [] }; },
  });
  const store = { getSelected: async () => selected, select: async () => selected };
  const activity = createActivityStore({ clock: () => 1 });
  const manager = createAgentManager({ store, executors: { primary, fallback }, activity });
  await assert.rejects(manager.runGoal('work'), (error) => error.code === 'RATE_LIMITED');
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 0);
});

test('delegates selection and status/setup methods through the selected executor', async () => {
  const calls = [];
  const executor = fakeExecutor({
    getStatus: async () => { calls.push('getStatus'); return { installed: true }; },
    beginSetup: async () => { calls.push('beginSetup'); return { started: true }; },
    listModels: async () => { calls.push('listModels'); return []; },
    getCapabilities: async () => { calls.push('getCapabilities'); return {}; },
    verifyPermissionProfile: async () => { calls.push('verifyPermissionProfile'); return { available: true, allowed: true }; },
  });
  const { manager } = harness({ executor });
  assert.equal((await manager.select('connection-2')).id, 'connection-2');
  await manager.getStatus();
  await manager.beginSetup();
  await manager.listModels();
  await manager.getCapabilities();
  await manager.verifyPermissionProfile();
  assert.deepEqual(calls, ['getStatus', 'beginSetup', 'listModels', 'getCapabilities', 'verifyPermissionProfile']);
});

test('passes exact capability and permission arguments through run and delegate paths', async () => {
  const capabilityCalls = [];
  const permissionCalls = [];
  const executor = fakeExecutor({
    getCapabilities: async (...args) => {
      capabilityCalls.push(args);
      return { efforts: ['high'] };
    },
    verifyPermissionProfile: async (...args) => {
      permissionCalls.push(args);
      return { available: true, allowed: true };
    },
  });
  const { manager } = harness({ executor });

  await manager.runGoal('work');
  await manager.getCapabilities();
  await manager.verifyPermissionProfile();

  assert.equal(capabilityCalls.length, 2);
  assert.equal(permissionCalls.length, 2);
  for (const args of capabilityCalls) {
    assert.equal(args.length, 2);
    assert.equal(args[0].id, 'connection-1');
    assert.equal(args[1], 'agent-model');
  }
  for (const args of permissionCalls) {
    assert.equal(args.length, 1);
    assert.equal(args[0].id, 'connection-1');
    assert.deepEqual(args[0].permissionProfile, { mode: 'workspace', nested: { level: 1 } });
  }
});
