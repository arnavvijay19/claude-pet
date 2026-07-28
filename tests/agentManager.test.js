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
const { permissionBadge } = require('../src/agent/executionModes.js');

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

function harness({ connection, executor = fakeExecutor(), getActiveSelection } = {}) {
  let selected = connection === undefined ? {
    id: 'connection-1', executorType: 'offline-demo', modelId: 'agent-model', effort: 'high',
    workspacePath: 'Z:\\workspace', permissionProfile: 'workspace',
    fullAccessConfirmed: false, revision: 1,
  } : connection;
  const store = {
    getActiveSelection: getActiveSelection || (async () => selected?.id || null),
    getConnection: async (id) => (selected?.id === id ? selected : null),
    getRunConnection: async (id) => (selected?.id === id ? selected : null),
    setActiveSelection: async (id) => { selected = id ? { ...selected, id } : null; },
  };
  const activity = createActivityStore({ clock: () => 123 });
  return {
    activity,
    manager: createAgentManager({ store, executors: { 'offline-demo:workspace': executor }, activity }),
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
  const { manager } = harness({ getActiveSelection: () => selection.promise });
  const first = manager.runGoal('first');
  await assert.rejects(manager.runGoal('second'), (error) => error.code === 'AGENT_BUSY');
  selection.resolve('connection-1');
  await first;
});

test('uses the canonical Task 7 connection store and public connection fields', async () => {
  let activeSelection = 'connection-1';
  const connections = new Map([
    ['connection-1', {
      id: 'connection-1', revision: 1, executorType: 'offline-demo', label: 'Demo', workspacePath: 'Z:\\workspace',
      permissionProfile: 'workspace', fullAccessConfirmed: false, modelId: 'agent-model',
      effort: 'high', keyHint: null, hasSecret: false,
    }],
    ['connection-2', {
      id: 'connection-2', revision: 1, executorType: 'offline-demo', label: 'Other', workspacePath: 'Z:\\other',
      permissionProfile: 'workspace', fullAccessConfirmed: false, modelId: 'agent-model',
      effort: 'low', keyHint: null, hasSecret: false,
    }],
  ]);
  const store = {
    getActiveSelection: async () => activeSelection,
    setActiveSelection: async (id) => { activeSelection = id; },
    getConnection: async (id) => connections.get(id) || null,
  };
  let request;
  const executor = fakeExecutor({
    runGoal: async (value) => { request = value; return { text: 'done', changedFiles: [] }; },
  });
  const activity = createActivityStore({ clock: () => 1 });
  store.getRunConnection = store.getConnection;
  const manager = createAgentManager({ store, executors: { 'offline-demo:workspace': executor }, activity });

  await manager.runGoal('work');
  assert.deepEqual(request, {
    goal: 'work', workspace: 'Z:\\workspace', permissionProfile: 'workspace',
    model: 'agent-model', effort: 'high', options: {},
  });
  assert.equal(Object.getPrototypeOf(request.options), Object.prototype);
  assert.equal(Object.isFrozen(request.options), true);
  assert.deepEqual(await manager.select('connection-2'), connections.get('connection-2'));
  assert.equal(activeSelection, 'connection-2');
  assert.equal(await manager.select(null), null);
  assert.equal(activeSelection, null);
});

test('sends only the exact deeply immutable executor request snapshot', async () => {
  const gate = deferred();
  const connection = {
    id: 'connection-1', executorType: 'offline-demo', modelId: 'agent-model', effort: 'high',
    workspacePath: 'Z:\\workspace', permissionProfile: 'workspace',
    fullAccessConfirmed: false, revision: 1,
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
  assert.equal(Object.isFrozen(seenConnection), true);
  assert.deepEqual(Object.keys(request), [
    'goal', 'workspace', 'permissionProfile', 'model', 'effort', 'options',
  ]);
  assert.deepEqual(request, {
    goal: 'work',
    workspace: 'Z:\\workspace',
    permissionProfile: 'workspace',
    model: 'agent-model',
    effort: 'high',
    options: {},
  });
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.options), true);
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

test('rejects non-JSON selected connection values with UNSUPPORTED_OPTION before execution', async () => {
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
      id: 'connection-1', executorType: 'offline-demo', modelId: 'agent-model', effort: 'high',
      workspacePath: 'Z:\\workspace', permissionProfile: 'workspace',
      fullAccessConfirmed: false, revision: 1, internalNote: options,
    };
    const executor = fakeExecutor({
      runGoal: async () => { executions += 1; return { text: '', changedFiles: [] }; },
    });
    const { manager } = harness({ connection, executor });
    await assert.rejects(manager.runGoal('work'), (error) => error.code === 'UNSUPPORTED_OPTION');
    assert.equal(executions, 0);
  }
});

test('rejects non-plain executor preflight snapshots with PROVIDER_OUTPUT_INVALID', async () => {
  const cases = [
    { getStatus: async () => new Date() },
    { getCapabilities: async () => new Map([['efforts', ['high']]]) },
    { listModels: async () => [new Date()] },
    { verifyPermissionProfile: async () => new Date() },
  ];
  for (const overrides of cases) {
    let executions = 0;
    const executor = fakeExecutor({
      ...overrides,
      runGoal: async () => { executions += 1; return { text: 'done', changedFiles: [] }; },
    });
    const { manager } = harness({ executor });
    await assert.rejects(
      manager.runGoal('work'),
      (error) => error.code === 'PROVIDER_OUTPUT_INVALID',
    );
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

test('isolates subscriber exceptions across manager begin, append, and clear', async () => {
  const executor = fakeExecutor({
    runGoal: async (_request, emitActivity) => {
      emitActivity({ phase: 'run', kind: 'status', summary: 'Working' });
      return { text: 'done', changedFiles: [] };
    },
  });
  const { manager, activity } = harness({ executor });
  const observed = [];
  activity.subscribe(() => { throw new Error('subscriber failed'); });
  activity.subscribe((snapshot) => observed.push(snapshot));

  const result = await manager.runGoal('work');
  assert.equal(result.text, 'done');
  assert.equal(observed.length, 2);
  assert.doesNotThrow(() => activity.clear());
  assert.deepEqual(observed.at(-1), { run: null, events: [] });
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
  const { manager } = harness({ executor, getActiveSelection: () => selection.promise });
  const pending = manager.runGoal('work');
  assert.equal(manager.stop(), true);
  selection.resolve('connection-1');
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
    executor: 'offline-demo', model: 'agent-model',
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
    id: 'connection-1', executorType: 'codex-cli', modelId: 'agent-model', effort: 'high',
    workspacePath: 'Z:\\workspace', permissionProfile: 'workspace',
    fullAccessConfirmed: false, revision: 1,
  };
  const primary = fakeExecutor({
    runGoal: async () => { primaryCalls += 1; throw new AgentError('RATE_LIMITED'); },
  });
  const fallback = fakeExecutor({
    runGoal: async () => { fallbackCalls += 1; return { text: 'fallback', changedFiles: [] }; },
  });
  const store = {
    getActiveSelection: async () => selected.id,
    setActiveSelection: async () => {},
    getConnection: async () => selected,
  };
  const activity = createActivityStore({ clock: () => 1 });
  store.getRunConnection = store.getConnection;
  const manager = createAgentManager({
    store,
    executors: { 'codex-cli:workspace': primary, 'claude-code-cli:workspace': fallback },
    activity,
  });
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

test('targets Codex status, permission, and official setup to a saved connection without changing selection', async () => {
  let activeSelection = 'offline';
  const connections = new Map([
    ['offline', {
      id: 'offline', revision: 1, executorType: 'offline-demo', modelId: 'offline-demo', effort: null,
      workspacePath: 'Z:\\workspace', permissionProfile: 'workspace', fullAccessConfirmed: false,
    }],
    ['codex', {
      id: 'codex', revision: 4, executorType: 'codex-cli', modelId: 'gpt-5.6-terra', effort: 'medium',
      workspacePath: 'Z:\\workspace', permissionProfile: 'full-computer', fullAccessConfirmed: true,
    }],
  ]);
  const calls = [];
  const activity = createActivityStore({ clock: () => 1 });
  const manager = createAgentManager({
    store: {
      getActiveSelection: async () => activeSelection,
      setActiveSelection: async (id) => { activeSelection = id; },
      getConnection: async (id) => connections.get(id) || null,
      getRunConnection: async (id) => connections.get(id) || null,
    },
    executors: {
      'offline-demo:workspace': fakeExecutor(),
      'codex-cli:full-computer': fakeExecutor({
        getStatus: async (connection) => { calls.push(['status', connection.id]); return { installed: true, authenticated: false }; },
        verifyPermissionProfile: async (connection) => { calls.push(['permission', connection.id]); return { available: true, allowed: true }; },
        beginSetup: async (connection) => { calls.push(['setup', connection.id]); return { started: true }; },
      }),
    },
    activity,
  });

  assert.deepEqual(await manager.getStatusFor('codex'), { installed: true, authenticated: false });
  assert.deepEqual(await manager.verifyPermissionProfileFor('codex'), { available: true, allowed: true });
  assert.deepEqual(await manager.beginSetupFor('codex'), { started: true });
  assert.deepEqual(calls, [['status', 'codex'], ['permission', 'codex'], ['setup', 'codex']]);
  assert.equal(activeSelection, 'offline');
  await assert.rejects(manager.getStatusFor('missing'), (error) => error.code === 'AGENT_REQUIRED');
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
    assert.equal(args[0].permissionProfile, 'workspace');
  }
});

test('binds executor, request, response context, and activity to one immutable mode snapshot', async () => {
  const enteredPreflight = deferred();
  const releasePreflight = deferred();
  const requests = [];
  let current = {
    id: 'connection-1', revision: 7, executorType: 'codex-cli',
    workspacePath: 'Z:\\first', permissionProfile: 'full-computer',
    fullAccessConfirmed: true, modelId: 'gpt-5.6-terra', effort: 'medium',
    label: 'Codex', keyHint: null, hasSecret: false,
  };
  const fullExecutor = fakeExecutor({
    getStatus: async () => {
      enteredPreflight.resolve();
      await releasePreflight.promise;
      return { installed: true, authenticated: true, workspaceAvailable: true };
    },
    listModels: async () => [{ id: 'gpt-5.6-terra', efforts: ['medium'] }],
    getCapabilities: async () => ({ efforts: ['medium'] }),
    runGoal: async (request, _emit, _signal, run) => {
      requests.push({ key: 'full', request, run });
      return { text: 'first', changedFiles: [] };
    },
  });
  const workspaceExecutor = fakeExecutor({
    listModels: async () => [{ id: 'gpt-5.6-sol', efforts: ['high'] }],
    getCapabilities: async () => ({ efforts: ['high'] }),
    runGoal: async (request, _emit, _signal, run) => {
      requests.push({ key: 'workspace', request, run });
      return { text: 'second', changedFiles: [] };
    },
  });
  const store = {
    getActiveSelection: async () => current.id,
    getRunConnection: async (id) => (id === current.id ? current : null),
    getConnection: async (id) => (id === current.id ? current : null),
    setActiveSelection: async () => {},
  };
  const activity = createActivityStore({ clock: () => 123 });
  const manager = createAgentManager({
    store,
    executors: {
      'codex-cli:full-computer': fullExecutor,
      'codex-cli:workspace': workspaceExecutor,
    },
    activity,
  });
  const starts = [];

  const first = manager.runGoal('first goal', { onStart: (context) => starts.push(context) });
  await enteredPreflight.promise;
  current = {
    ...current,
    revision: 8,
    workspacePath: 'Z:\\second',
    permissionProfile: 'workspace',
    modelId: 'gpt-5.6-sol',
    effort: 'high',
  };
  assert.deepEqual(manager.getSnapshot(), {
    busy: true,
    connectionId: 'connection-1',
    permissionProfile: 'full-computer',
  });
  releasePreflight.resolve();
  await first;

  assert.deepEqual(requests[0], {
    key: 'full',
    request: {
      goal: 'first goal', workspace: 'Z:\\first', permissionProfile: 'full-computer',
      model: 'gpt-5.6-terra', effort: 'medium', options: {},
    },
    run: {
      connectionId: 'connection-1', connectionRevision: 7, executorType: 'codex-cli',
      permissionProfile: 'full-computer', fullAccessConfirmed: true,
      workspace: 'Z:\\first', model: 'gpt-5.6-terra', effort: 'medium',
    },
  });
  assert.deepEqual(starts[0], {
    connectionId: 'connection-1', executor: 'codex-cli', model: 'gpt-5.6-terra',
    workspace: 'Z:\\first', permissionProfile: 'full-computer',
  });
  assert.equal(permissionBadge(starts[0].permissionProfile), 'FULL COMPUTER - broad PC access');
  assert.equal(Object.hasOwn(starts[0], 'revision'), false);
  assert.equal(Object.hasOwn(starts[0], 'fullAccessConfirmed'), false);
  assert.deepEqual(activity.snapshot().run, starts[0]);

  await manager.runGoal('second goal', { onStart: (context) => starts.push(context) });
  assert.deepEqual(requests[1], {
    key: 'workspace',
    request: {
      goal: 'second goal', workspace: 'Z:\\second', permissionProfile: 'workspace',
      model: 'gpt-5.6-sol', effort: 'high', options: {},
    },
    run: {
      connectionId: 'connection-1', connectionRevision: 8, executorType: 'codex-cli',
      permissionProfile: 'workspace', fullAccessConfirmed: true,
      workspace: 'Z:\\second', model: 'gpt-5.6-sol', effort: 'high',
    },
  });
  assert.equal(permissionBadge(starts[1].permissionProfile), 'WORKSPACE - selected project only');
});

test('rejects an unconfirmed Full Computer snapshot before any provider preflight', async () => {
  let statusCalls = 0;
  const connection = {
    id: 'connection-1', revision: 1, executorType: 'codex-cli', modelId: 'agent-model', effort: 'high',
    workspacePath: 'Z:\\workspace', permissionProfile: 'full-computer', fullAccessConfirmed: false,
  };
  const { manager } = harness({
    connection,
    executor: fakeExecutor({ getStatus: async () => { statusCalls += 1; return { installed: true }; } }),
  });
  await assert.rejects(
    manager.runGoal('must not run'),
    (error) => error.code === 'FULL_COMPUTER_CONFIRMATION_REQUIRED',
  );
  assert.equal(statusCalls, 0);
});

test('rejects an expired selected connection before reserving busy state or invoking onStart', async () => {
  const connection = { id: 'connection-1', revision: 2, executorType: 'offline-demo', modelId: 'agent-model', effort: 'high', workspacePath: 'Z:\\workspace', permissionProfile: 'workspace', fullAccessConfirmed: false };
  const { manager } = harness({ connection, executor: fakeExecutor() });
  let starts = 0;
  await assert.rejects(manager.runGoal('expired', { expectedConnectionId: 'connection-1', expectedRevision: 1, onStart: () => { starts += 1; } }), (error) => error.code === 'SESSION_SELECTION_EXPIRED');
  assert.equal(starts, 0);
  assert.equal(manager.getSnapshot().busy, false);
});
