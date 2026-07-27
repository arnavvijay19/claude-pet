'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSessionCoordinator, neutralPrompt } = require('../src/agent/sessionCoordinator.js');
const { createSessionStore: createPersistentSessionStore } = require('../src/agent/sessionStore.js');

function availableCrypto() {
  return {
    isAvailable: async () => true,
    encrypt: async (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decrypt: async (buffer) => ({ value: Buffer.from(buffer).toString('utf8').replace(/^encrypted:/, ''), shouldReEncrypt: false }),
  };
}

function sequence(prefix) { let number = 0; return () => `${prefix}-${++number}`; }

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

test('uses persisted assistant provenance when the former connection is deleted or edited', async () => {
  for (const former of [null, connection('offline', 'codex-cli', 'gpt-5.6-terra')]) {
    const sessionStore = createSessionStore();
    const confirmations = [];
    const coordinator = createSessionCoordinator({
      sessionStore,
      connectionStore: {
        listConnections: async () => [connection('codex', 'codex-cli', 'gpt-5.6-terra')],
        getConnection: async (id) => id === 'offline' ? former : id === 'codex' ? connection('codex', 'codex-cli', 'gpt-5.6-terra') : null,
        getActiveSelection: async () => 'offline', setActiveSelection: async () => {},
      },
      manager: { getSnapshot: () => ({ busy: false }), runGoal: async () => {}, stop: () => false },
      confirmProviderSwitch: async (value) => { confirmations.push(value); return true; },
    });
    await coordinator.setNextConnection({ sessionId: 'session-a1', connectionId: 'codex' });
    assert.deepEqual(confirmations, [{ sessionId: 'session-a1', fromProvider: 'offline-demo', toProvider: 'codex-cli' }]);
  }
});

test('rejects a provider with a different workspace before disclosure or persistence', async () => {
  const sessionStore = createSessionStore();
  let confirmations = 0;
  let writes = 0;
  const coordinator = createSessionCoordinator({
    sessionStore: { ...sessionStore, setNextConnection: async () => { writes += 1; } },
    connectionStore: {
      listConnections: async () => [], getConnection: async () => ({ ...connection('other', 'codex-cli', 'gpt-5.6-terra'), workspacePath: 'Z:\\other' }),
      getActiveSelection: async () => 'offline', setActiveSelection: async () => { writes += 1; },
    },
    manager: { getSnapshot: () => ({ busy: false }), runGoal: async () => {}, stop: () => false },
    confirmProviderSwitch: async () => { confirmations += 1; return true; },
  });
  await assert.rejects(coordinator.setNextConnection({ sessionId: 'session-a1', connectionId: 'other' }), (error) => error.code === 'UNSUPPORTED_OPTION');
  assert.equal(confirmations, 0);
  assert.equal(writes, 0);
});

test('rejects cross-agent session mutations and every mutation while busy', async () => {
  const sessionStore = createSessionStore();
  const idle = createSessionCoordinator({
    sessionStore, connectionStore: { listConnections: async () => [], getConnection: async () => null, getActiveSelection: async () => null, setActiveSelection: async () => {} },
    manager: { getSnapshot: () => ({ busy: false }), runGoal: async () => {}, stop: () => false },
  });
  await assert.rejects(idle.renameSession('session-b1', 'forged'), (error) => error.code === 'SESSION_SELECTION_EXPIRED');
  await assert.rejects(idle.removeSession('session-b1'), (error) => error.code === 'SESSION_SELECTION_EXPIRED');
  const busy = createSessionCoordinator({
    sessionStore, connectionStore: { listConnections: async () => [], getConnection: async () => null, getActiveSelection: async () => null, setActiveSelection: async () => {} },
    manager: { getSnapshot: () => ({ busy: true }), runGoal: async () => {}, stop: () => false },
  });
  for (const operation of [
    () => busy.createAgent({ name: 'Nope' }), () => busy.renameAgent('agent-a', 'Nope'), () => busy.createSession({ agentId: 'agent-a', title: 'Nope', workspacePath: 'Z:\\workspace' }),
    () => busy.renameSession('session-a1', 'Nope'), () => busy.removeSession('session-a1'), () => busy.select({ agentId: 'agent-a', sessionId: 'session-a1' }),
    () => busy.setNextConnection({ sessionId: 'session-a1', connectionId: 'offline' }),
  ]) await assert.rejects(operation(), (error) => error.code === 'AGENT_BUSY');
});

test('expires a selection race before selection persistence, activity, or provider text', async () => {
  const sessionStore = createSessionStore();
  let activeWrites = 0;
  let providerRuns = 0;
  const coordinator = createSessionCoordinator({
    sessionStore,
    connectionStore: {
      listConnections: async () => [], getConnection: async () => connection('offline', 'offline-demo', 'offline-demo'),
      getRunConnection: async () => { await sessionStore.select({ agentId: 'agent-a', sessionId: 'session-a2' }); return runConnection('offline', 'offline-demo', 'offline-demo'); },
      getActiveSelection: async () => 'offline', setActiveSelection: async () => { activeWrites += 1; },
    },
    manager: { getSnapshot: () => ({ busy: false }), runGoal: async () => { providerRuns += 1; return { text: 'must not run', changedFiles: [], executor: 'offline-demo', model: 'offline-demo' }; }, stop: () => false },
  });
  await assert.rejects(coordinator.runGoal('race'), (error) => error.code === 'SESSION_SELECTION_EXPIRED');
  assert.equal(activeWrites, 0);
  assert.equal(providerRuns, 0);
  assert.equal((await sessionStore.getContextTurns('session-a1')).length, 2);
});

test('keeps same-family switching disclosure-free and neutral context bounded', async () => {
  const sessionStore = createSessionStore();
  const turns = [...await sessionStore.getContextTurns('session-a1')];
  for (let index = 0; index < 30; index += 1) turns.push({ role: 'assistant', text: `old-${index}`, provider: 'offline-demo', model: 'offline-demo', changedFiles: [], createdAt: String(index + 3) });
  const coordinator = createSessionCoordinator({
    sessionStore: { ...sessionStore, getContextTurns: async () => Object.freeze(turns.map((turn) => Object.freeze({ ...turn }))) },
    connectionStore: { listConnections: async () => [], getConnection: async () => connection('offline-2', 'offline-demo', 'offline-demo'), getActiveSelection: async () => 'offline', setActiveSelection: async () => {} },
    manager: { getSnapshot: () => ({ busy: false }), runGoal: async () => {}, stop: () => false },
    confirmProviderSwitch: async () => { throw new Error('same family must not disclose'); },
  });
  await coordinator.setNextConnection({ sessionId: 'session-a1', connectionId: 'offline-2' });
  assert.equal(neutralPrompt(turns, 'now').includes('[Older session turns omitted by Claude Pet.]'), true);
});

test('restores the selected agent, session history, and next provider after a real session-store restart', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-task17-restart-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'sessions.json');
  const buildStore = (randomId) => createPersistentSessionStore({
    filePath, crypto: availableCrypto(), randomId, clock: () => '2026-07-27T00:00:00.000Z',
  });
  const original = buildStore(sequence('id'));
  await original.initialize();
  const agent = await original.createAgent({ name: 'Research' });
  const session = await original.createSession({ agentId: agent.id, title: 'Switching', workspacePath: 'Z:\\workspace' });
  await original.select({ agentId: agent.id, sessionId: session.id });
  await original.setNextConnection(session.id, 'offline');
  await original.appendTurn(session.id, { role: 'user', text: 'Keep context', provider: null, model: null, changedFiles: [] });
  await original.appendTurn(session.id, { role: 'assistant', text: 'Persisted reply', provider: 'offline-demo', model: 'agent-model', changedFiles: [] });

  const restored = buildStore(sequence('unused'));
  await restored.initialize();
  const coordinator = createSessionCoordinator({
    sessionStore: restored,
    connectionStore: {
      listConnections: async () => [connection('offline', 'offline-demo', 'agent-model')],
      getConnection: async () => connection('offline', 'offline-demo', 'agent-model'),
      getRunConnection: async () => runConnection('offline', 'offline-demo', 'agent-model'),
      getActiveSelection: async () => 'offline', setActiveSelection: async () => {},
    },
    manager: { getSnapshot: () => ({ busy: false }), runGoal: async () => {}, stop: () => false },
  });
  const snapshot = await coordinator.snapshot();
  assert.deepEqual(snapshot.selection, { agentId: agent.id, sessionId: session.id });
  assert.equal(snapshot.session.nextConnectionId, 'offline');
  assert.deepEqual(snapshot.turns.map((turn) => [turn.role, turn.text, turn.provider, turn.model]), [
    ['user', 'Keep context', null, null], ['assistant', 'Persisted reply', 'offline-demo', 'agent-model'],
  ]);
});
