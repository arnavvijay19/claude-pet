'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createSessionCoordinator } = require('../src/agent/sessionCoordinator.js');
const { createSessionStore: createPersistentSessionStore } = require('../src/agent/sessionStore.js');

function availableCrypto() {
  return {
    isAvailable: async () => true,
    encrypt: async (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decrypt: async (buffer) => ({
      value: Buffer.from(buffer).toString('utf8').replace(/^encrypted:/, ''),
      shouldReEncrypt: false,
    }),
  };
}

function sequence(prefix) {
  let number = 0;
  return () => `${prefix}-${++number}`;
}

function connection(id, executorType, modelId, workspacePath = 'Z:\\workspace') {
  return Object.freeze({
    id, executorType, label: id, workspacePath, permissionProfile: 'workspace',
    modelId, effort: null, keyHint: null, hasSecret: false,
  });
}

function runConnection(id, executorType, modelId, workspacePath = 'Z:\\workspace') {
  return Object.freeze({
    ...connection(id, executorType, modelId, workspacePath),
    revision: 1,
    fullAccessConfirmed: false,
    nativeResumeId: 'must-not-disclose',
    authDirectory: 'must-not-disclose',
    configDirectory: 'must-not-disclose',
  });
}

function sharedSessionStore({ activeAgentId = 'researcher' } = {}) {
  const agents = [
    {
      id: 'researcher', name: 'Researcher', marker: 'amber',
      createdAt: '1', updatedAt: '1', sessionCount: 1,
    },
    {
      id: 'reviewer', name: 'Reviewer', marker: 'blue',
      createdAt: '1', updatedAt: '1', sessionCount: 1,
    },
  ];
  const profiles = new Map([
    ['researcher', {
      id: 'researcher', name: 'Researcher', marker: 'amber',
      instruction: 'Find primary evidence.',
    }],
    ['reviewer', {
      id: 'reviewer', name: 'Reviewer', marker: 'blue',
      instruction: 'Check completed work for concrete defects.',
    }],
  ]);
  const sessions = new Map([['shared', {
    id: 'shared',
    title: 'Investigate issue',
    workspacePath: 'Z:\\workspace',
    participants: [
      { agentId: 'researcher', connectionId: 'offline' },
      { agentId: 'reviewer', connectionId: 'codex-reviewer' },
    ],
    activeAgentId,
    createdAt: '1',
    updatedAt: '1',
    turnCount: 2,
    lastProvider: 'offline-demo',
  }]]);
  const turns = new Map([['shared', [
    {
      role: 'user', text: 'Investigate the issue', agentId: 'researcher',
      provider: null, model: null, changedFiles: [], createdAt: '1',
    },
    {
      role: 'assistant', text: 'Initial evidence', agentId: 'researcher',
      provider: 'offline-demo', model: 'offline-demo', changedFiles: [], createdAt: '1',
    },
  ]]]);
  let selection = { sessionId: 'shared' };

  function view(session) {
    return Object.freeze({
      ...structuredClone(session),
      participants: Object.freeze(session.participants.map((participant) => Object.freeze({
        ...participant,
      }))),
    });
  }

  return {
    listAgents: async () => Object.freeze(agents.map((agent) => Object.freeze({ ...agent }))),
    getAgentProfile: async (id) => profiles.has(id) ? Object.freeze({ ...profiles.get(id) }) : null,
    listSessions: async () => Object.freeze([...sessions.values()].map(view)),
    getSelection: async () => Object.freeze({ ...selection }),
    getSessionView: async (id) => sessions.has(id) ? view(sessions.get(id)) : null,
    getContextTurns: async (id) => Object.freeze((turns.get(id) || []).map(
      (turn) => Object.freeze({ ...turn, changedFiles: Object.freeze([...turn.changedFiles]) }),
    )),
    select: async (next) => {
      selection = { ...next };
      return Object.freeze({ ...selection });
    },
    selectParticipant: async ({ sessionId, agentId }) => {
      const session = sessions.get(sessionId);
      session.activeAgentId = agentId;
      session.updatedAt = String(Number(session.updatedAt) + 1);
      return view(session);
    },
    setNextConnection: async (sessionId, connectionId) => {
      const session = sessions.get(sessionId);
      const participant = session.participants.find(
        (item) => item.agentId === session.activeAgentId,
      );
      participant.connectionId = connectionId;
      session.updatedAt = String(Number(session.updatedAt) + 1);
      return view(session);
    },
    appendTurn: async (id, turn) => {
      const value = Object.freeze({ ...turn, changedFiles: [...turn.changedFiles], createdAt: '2' });
      const entries = turns.get(id) || [];
      entries.push(value);
      turns.set(id, entries);
      const session = sessions.get(id);
      session.turnCount = entries.length;
      session.lastProvider = turn.role === 'assistant' ? turn.provider : session.lastProvider;
      return value;
    },
    createAgent: async () => { throw new Error('not needed'); },
    updateAgent: async () => { throw new Error('not needed'); },
    renameAgent: async () => {},
    removeAgent: async () => {},
    createSession: async () => { throw new Error('not needed'); },
    renameSession: async () => {},
    removeSession: async () => {},
    addParticipant: async () => {},
    removeParticipant: async () => {},
  };
}

function connectionBoundary({ onRunLookup } = {}) {
  const publicConnections = [
    connection('offline', 'offline-demo', 'offline-demo'),
    connection('codex-reviewer', 'codex-cli', 'gpt-5.6-terra'),
    connection('codex-other', 'codex-cli', 'gpt-5.6-terra', 'Z:\\other'),
  ];
  const runs = new Map([
    ['offline', runConnection('offline', 'offline-demo', 'offline-demo')],
    ['codex-reviewer', runConnection('codex-reviewer', 'codex-cli', 'gpt-5.6-terra')],
    ['codex-other', runConnection('codex-other', 'codex-cli', 'gpt-5.6-terra', 'Z:\\other')],
  ]);
  let active = 'offline';
  const activeWrites = [];
  return {
    listConnections: async () => publicConnections,
    getConnection: async (id) => publicConnections.find((item) => item.id === id) || null,
    getRunConnection: async (id) => {
      await onRunLookup?.(id);
      return runs.get(id) || null;
    },
    getActiveSelection: async () => active,
    setActiveSelection: async (id) => {
      active = id;
      activeWrites.push(id);
    },
    activeWrites,
  };
}

function managerBoundary({ busy = false } = {}) {
  const runs = [];
  return {
    runs,
    getSnapshot: () => ({ busy }),
    async runGoal(text, { expectedConnectionId, expectedRevision, onStart }) {
      runs.push({ text, connectionId: expectedConnectionId, revision: expectedRevision });
      await onStart({
        connectionId: expectedConnectionId,
        executor: expectedConnectionId === 'offline' ? 'offline-demo' : 'codex-cli',
        model: expectedConnectionId === 'offline' ? 'offline-demo' : 'gpt-5.6-terra',
        workspace: 'Z:\\workspace',
        permissionProfile: 'workspace',
      });
      return {
        text: 'Reviewed result',
        changedFiles: ['notes/review.txt'],
        connectionId: expectedConnectionId,
        executor: expectedConnectionId === 'offline' ? 'offline-demo' : 'codex-cli',
        model: expectedConnectionId === 'offline' ? 'offline-demo' : 'gpt-5.6-terra',
      };
    },
    stop: () => false,
  };
}

test('routes one turn through only the selected participant', async () => {
  const sessionStore = sharedSessionStore();
  const connections = connectionBoundary();
  const manager = managerBoundary();
  const coordinator = createSessionCoordinator({
    sessionStore,
    connectionStore: connections,
    manager,
    confirmProviderSwitch: async () => true,
  });

  await coordinator.selectParticipant({ sessionId: 'shared', agentId: 'reviewer' });
  await coordinator.runGoal('Review the result');

  assert.deepEqual(manager.runs.map((run) => run.connectionId), ['codex-reviewer']);
  const snapshot = await coordinator.snapshot();
  assert.equal(snapshot.activeAgent.id, 'reviewer');
  assert.deepEqual(snapshot.activeAgentProfile, {
    id: 'reviewer',
    name: 'Reviewer',
    marker: 'blue',
    instruction: 'Check completed work for concrete defects.',
  });
  assert.deepEqual(snapshot.turns.slice(-2).map((turn) => turn.agentId), [
    'reviewer', 'reviewer',
  ]);
  assert.equal(manager.runs[0].text.includes('Check completed work for concrete defects.'), true);
  assert.equal(/nativeResumeId|authDirectory|configDirectory|must-not-disclose/.test(manager.runs[0].text), false);
});

test('cross-provider agent switching asks once with both names and cancel is atomic', async () => {
  const sessionStore = sharedSessionStore();
  const connections = connectionBoundary();
  const manager = managerBoundary();
  const confirmations = [];
  const coordinator = createSessionCoordinator({
    sessionStore,
    connectionStore: connections,
    manager,
    confirmProviderSwitch: async (request) => {
      confirmations.push(request);
      return false;
    },
  });

  await assert.rejects(
    coordinator.selectParticipant({ sessionId: 'shared', agentId: 'reviewer' }),
    (error) => error.code === 'PROVIDER_SWITCH_CANCELLED',
  );

  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].fromAgent.name, 'Researcher');
  assert.equal(confirmations[0].toAgent.name, 'Reviewer');
  assert.equal((await coordinator.snapshot()).activeAgent.id, 'researcher');
  assert.deepEqual(connections.activeWrites, []);
});

test('rejects a different-workspace participant connection before disclosure or persistence', async () => {
  const sessionStore = sharedSessionStore();
  const connections = connectionBoundary();
  let confirmations = 0;
  const coordinator = createSessionCoordinator({
    sessionStore,
    connectionStore: connections,
    manager: managerBoundary(),
    confirmProviderSwitch: async () => {
      confirmations += 1;
      return true;
    },
  });

  await assert.rejects(
    coordinator.setParticipantConnection({
      sessionId: 'shared', agentId: 'researcher', connectionId: 'codex-other',
    }),
    (error) => error.code === 'UNSUPPORTED_OPTION',
  );

  assert.equal(confirmations, 0);
  assert.deepEqual(connections.activeWrites, []);
  assert.equal(
    (await sessionStore.getSessionView('shared')).participants[0].connectionId,
    'offline',
  );
});

test('sends attachment contents only in the current provider prompt and persists metadata', async () => {
  const sessionStore = sharedSessionStore();
  const connections = connectionBoundary();
  const manager = managerBoundary();
  const coordinator = createSessionCoordinator({
    sessionStore,
    connectionStore: connections,
    manager,
    confirmProviderSwitch: async () => true,
  });
  await coordinator.selectParticipant({ sessionId: 'shared', agentId: 'reviewer' });
  await coordinator.runGoal('Review this', {
    attachment: {
      name: 'notes.md', extension: '.md',
      size: Buffer.byteLength('private details'), text: 'private details',
    },
  });

  assert.match(manager.runs[0].text, /private details/);
  const snapshot = await coordinator.snapshot();
  const userTurn = snapshot.turns.at(-2);
  assert.equal(userTurn.text, 'Review this\n\n[Attached file: notes.md]');
  assert.doesNotMatch(JSON.stringify(snapshot), /private details/);
});

test('creates a session from the selected connection workspace and participant', async () => {
  const sessionStore = sharedSessionStore();
  const connections = connectionBoundary();
  let created = null;
  sessionStore.createSession = async (input) => {
    created = input;
    return { id: 'new-session', ...input };
  };
  const coordinator = createSessionCoordinator({
    sessionStore,
    connectionStore: connections,
    manager: managerBoundary(),
  });

  await coordinator.createSession({
    agentId: 'researcher', title: 'Codex workspace', connectionId: 'codex-other',
  });

  assert.deepEqual(created, {
    title: 'Codex workspace',
    workspacePath: 'Z:\\other',
    participant: { agentId: 'researcher', connectionId: 'codex-other' },
  });
});

test('rejects participant changes while a run is busy', async () => {
  const coordinator = createSessionCoordinator({
    sessionStore: sharedSessionStore(),
    connectionStore: connectionBoundary(),
    manager: managerBoundary({ busy: true }),
  });
  for (const operation of [
    () => coordinator.selectParticipant({ sessionId: 'shared', agentId: 'reviewer' }),
    () => coordinator.setParticipantConnection({
      sessionId: 'shared', agentId: 'researcher', connectionId: 'offline',
    }),
  ]) {
    await assert.rejects(operation(), (error) => error.code === 'AGENT_BUSY');
  }
});

test('expires a stale participant selection before the provider runs', async () => {
  const sessionStore = sharedSessionStore();
  let providerRuns = 0;
  const connections = connectionBoundary({
    onRunLookup: async () => {
      await sessionStore.selectParticipant({ sessionId: 'shared', agentId: 'reviewer' });
    },
  });
  const manager = managerBoundary();
  const coordinator = createSessionCoordinator({
    sessionStore,
    connectionStore: connections,
    manager: {
      ...manager,
      runGoal: async () => {
        providerRuns += 1;
        throw new Error('must not run');
      },
    },
  });

  await assert.rejects(
    coordinator.runGoal('race'),
    (error) => error.code === 'SESSION_SELECTION_EXPIRED',
  );
  assert.equal(providerRuns, 0);
  assert.equal((await sessionStore.getContextTurns('shared')).length, 2);
});

test('restores selected shared-session participants and attributed turns after restart', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-ux2-restart-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'sessions.json');
  const buildStore = (randomId) => createPersistentSessionStore({
    filePath,
    crypto: availableCrypto(),
    randomId,
    clock: () => '2026-07-28T00:00:00.000Z',
  });
  const original = buildStore(sequence('id'));
  await original.initialize();
  const researcher = await original.createAgent({
    name: 'Researcher', marker: 'amber', instruction: 'Find evidence.',
  });
  const reviewer = await original.createAgent({
    name: 'Reviewer', marker: 'blue', instruction: 'Review evidence.',
  });
  const session = await original.createSession({
    title: 'Shared',
    workspacePath: 'Z:\\workspace',
    participant: { agentId: researcher.id, connectionId: 'offline' },
  });
  await original.addParticipant({
    sessionId: session.id, agentId: reviewer.id, connectionId: 'codex-reviewer',
  });
  await original.selectParticipant({ sessionId: session.id, agentId: reviewer.id });
  await original.select({ sessionId: session.id });
  await original.appendTurn(session.id, {
    role: 'user', text: 'Review this', agentId: reviewer.id,
    provider: null, model: null, changedFiles: [],
  });

  const restored = buildStore(sequence('unused'));
  await restored.initialize();
  const coordinator = createSessionCoordinator({
    sessionStore: restored,
    connectionStore: connectionBoundary(),
    manager: managerBoundary(),
  });
  const snapshot = await coordinator.snapshot();

  assert.equal(snapshot.selection.sessionId, session.id);
  assert.equal(snapshot.activeAgent.id, reviewer.id);
  assert.equal(snapshot.session.participants.length, 2);
  assert.deepEqual(snapshot.turns.map((turn) => turn.agentId), [reviewer.id]);
});
