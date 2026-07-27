'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionCoordinator } = require('../src/agent/sessionCoordinator.js');

const connection = (id, executorType, modelId) => Object.freeze({
  id, executorType, label: id, workspacePath: 'Z:\\workspace', permissionProfile: 'workspace',
  modelId, effort: null, keyHint: null, hasSecret: false,
});

function createSessionStore() {
  const agents = [{ id: 'agent-a', name: 'Agent A', createdAt: '1', updatedAt: '1', sessionCount: 2 }, { id: 'agent-b', name: 'Agent B', createdAt: '1', updatedAt: '1', sessionCount: 1 }];
  const sessions = new Map([
    ['session-a1', { id: 'session-a1', agentId: 'agent-a', title: 'Session 1', workspacePath: 'Z:\\workspace', nextConnectionId: 'offline', createdAt: '1', updatedAt: '1', turnCount: 2, lastProvider: 'offline-demo' }],
    ['session-a2', { id: 'session-a2', agentId: 'agent-a', title: 'Session 2', workspacePath: 'Z:\\workspace', nextConnectionId: null, createdAt: '1', updatedAt: '1', turnCount: 0, lastProvider: null }],
    ['session-b1', { id: 'session-b1', agentId: 'agent-b', title: 'Session 3', workspacePath: 'Z:\\workspace', nextConnectionId: null, createdAt: '1', updatedAt: '1', turnCount: 0, lastProvider: null }],
  ]);
  let selection = { agentId: 'agent-a', sessionId: 'session-a1' };
  const turns = new Map([['session-a1', [
    { role: 'user', text: 'First goal', provider: null, model: null, changedFiles: [], createdAt: '1' },
    { role: 'assistant', text: 'Offline reply', provider: 'offline-demo', model: 'offline-demo', changedFiles: [], createdAt: '1' },
  ]]]);
  return {
    listAgents: async () => agents.map((agent) => Object.freeze({ ...agent })),
    listSessions: async (agentId) => [...sessions.values()].filter((session) => session.agentId === agentId).map((session) => Object.freeze({ ...session })),
    getSelection: async () => Object.freeze({ ...selection }),
    getSessionView: async (id) => sessions.has(id) ? Object.freeze({ ...sessions.get(id) }) : null,
    getContextTurns: async (id) => Object.freeze((turns.get(id) || []).map((turn) => Object.freeze({ ...turn }))),
    select: async (next) => { selection = { ...next }; return Object.freeze({ ...selection }); },
    setNextConnection: async (id, connectionId) => { const session = sessions.get(id); session.nextConnectionId = connectionId; session.updatedAt = String(Number(session.updatedAt) + 1); return Object.freeze({ ...session }); },
    appendTurn: async (id, turn) => { const value = { ...turn, createdAt: '2' }; const entries = turns.get(id) || []; entries.push(value); turns.set(id, entries); const session = sessions.get(id); session.turnCount = entries.length; session.lastProvider = turn.role === 'assistant' ? turn.provider : session.lastProvider; return Object.freeze(value); },
    createAgent: async () => { throw new Error('not needed'); }, renameAgent: async () => {}, removeAgent: async () => {},
    createSession: async () => { throw new Error('not needed'); }, renameSession: async () => {}, removeSession: async () => {},
  };
}

function runConnection(id, executorType, modelId) { return { ...connection(id, executorType, modelId), revision: 1, fullAccessConfirmed: false }; }

test('requires disclosure only for a cross-provider same-session switch and keeps cancel atomic', async () => {
  const sessionStore = createSessionStore();
  const selections = [];
  const confirmations = [];
  let accept = false;
  const coordinator = createSessionCoordinator({
    sessionStore,
    connectionStore: {
      listConnections: async () => [connection('offline', 'offline-demo', 'offline-demo'), connection('codex', 'codex-cli', 'gpt-5.6-terra')],
      getConnection: async (id) => [connection('offline', 'offline-demo', 'offline-demo'), connection('codex', 'codex-cli', 'gpt-5.6-terra')].find((item) => item.id === id) || null,
      getRunConnection: async (id) => [runConnection('offline', 'offline-demo', 'offline-demo'), runConnection('codex', 'codex-cli', 'gpt-5.6-terra')].find((item) => item.id === id) || null,
      getActiveSelection: async () => 'offline',
      setActiveSelection: async (id) => selections.push(id),
    },
    manager: { getSnapshot: () => ({ busy: false }), runGoal: async () => { throw new Error('not needed'); }, stop: () => false },
    confirmProviderSwitch: async (value) => { confirmations.push(value); return accept; },
  });

  await assert.rejects(coordinator.setNextConnection({ sessionId: 'session-a1', connectionId: 'codex' }), /Provider switch cancelled/);
  assert.equal((await coordinator.snapshot()).session.nextConnectionId, 'offline');
  assert.deepEqual(selections, []);
  assert.deepEqual(confirmations[0], { sessionId: 'session-a1', fromProvider: 'offline-demo', toProvider: 'codex-cli' });

  accept = true;
  await coordinator.setNextConnection({ sessionId: 'session-a1', connectionId: 'codex' });
  const snapshot = await coordinator.snapshot();
  assert.equal(snapshot.session.id, 'session-a1');
  assert.equal(snapshot.session.nextConnectionId, 'codex');
  assert.equal(snapshot.turns.length, 2);
  assert.deepEqual(selections, ['codex']);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(JSON.stringify(snapshot).includes('encryptedTurns'), false);
});

test('runs the selected provider once with neutral bounded attributed context', async () => {
  const sessionStore = createSessionStore();
  const requests = [];
  const coordinator = createSessionCoordinator({
    sessionStore,
    connectionStore: {
      listConnections: async () => [connection('offline', 'offline-demo', 'offline-demo'), connection('codex', 'codex-cli', 'gpt-5.6-terra')],
      getConnection: async (id) => [connection('offline', 'offline-demo', 'offline-demo'), connection('codex', 'codex-cli', 'gpt-5.6-terra')].find((item) => item.id === id) || null,
      getRunConnection: async (id) => [runConnection('offline', 'offline-demo', 'offline-demo'), runConnection('codex', 'codex-cli', 'gpt-5.6-terra')].find((item) => item.id === id) || null,
      getActiveSelection: async () => 'codex',
      setActiveSelection: async () => {},
    },
    manager: {
      getSnapshot: () => ({ busy: false }),
      async runGoal(text, { onStart, expectedConnectionId, expectedRevision }) {
        requests.push({ text, expectedConnectionId, expectedRevision });
        await onStart({ connectionId: 'codex', executor: 'codex-cli', model: 'gpt-5.6-terra', workspace: 'Z:\\workspace', permissionProfile: 'workspace' });
        return { text: 'Codex reply', changedFiles: ['notes/result.txt'], connectionId: 'codex', executor: 'codex-cli', model: 'gpt-5.6-terra' };
      },
      stop: () => false,
    },
    confirmProviderSwitch: async () => true,
  });
  await coordinator.setNextConnection({ sessionId: 'session-a1', connectionId: 'codex' });
  await coordinator.runGoal('Second goal');
  assert.equal(requests.length, 1);
  assert.match(requests[0].text, /First goal/);
  assert.match(requests[0].text, /offline-demo/);
  assert.match(requests[0].text, /Second goal/);
  assert.equal(/native resume|auth directory|config directory|raw activity/i.test(requests[0].text), false);
  const snapshot = await coordinator.snapshot();
  assert.deepEqual(snapshot.turns.slice(-2).map((turn) => [turn.role, turn.provider, turn.model]), [
    ['user', null, null], ['assistant', 'codex-cli', 'gpt-5.6-terra'],
  ]);
});

test('synchronizes the selected session provider and rolls it back when the session write fails', async () => {
  const base = createSessionStore();
  const active = [];
  let selectedConnection = 'codex';
  const connections = [connection('offline', 'offline-demo', 'offline-demo'), connection('codex', 'codex-cli', 'gpt-5.6-terra')];
  const coordinator = createSessionCoordinator({
    sessionStore: { ...base, setNextConnection: async () => { throw new Error('disk write failed'); } },
    connectionStore: {
      listConnections: async () => connections, getConnection: async (id) => connections.find((item) => item.id === id) || null,
      getActiveSelection: async () => selectedConnection,
      setActiveSelection: async (id) => { active.push(id); selectedConnection = id; },
    },
    manager: { getSnapshot: () => ({ busy: false }), runGoal: async () => {}, stop: () => false },
    confirmProviderSwitch: async () => true,
  });
  await coordinator.select({ agentId: 'agent-a', sessionId: 'session-a1' });
  assert.equal(active.at(-1), 'offline');
  selectedConnection = 'offline';
  await assert.rejects(coordinator.setNextConnection({ sessionId: 'session-a1', connectionId: 'codex' }));
  assert.deepEqual(active.slice(-2), ['codex', 'offline']);
});
