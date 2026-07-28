'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAppSnapshot } = require('../src/app/appSnapshot.js');

function coordinatorSnapshot() {
  return {
    agents: [{ id: 'agent-a', name: 'Researcher', marker: 'amber', createdAt: 'now', updatedAt: 'now', sessionCount: 1 }],
    sessions: [{
      id: 'session-a', title: 'Shared', workspacePath: 'Z:\\workspace',
      participants: [{ agentId: 'agent-a', connectionId: 'connection-a' }],
      activeAgentId: 'agent-a', createdAt: 'now', updatedAt: 'now', turnCount: 1, lastProvider: 'offline-demo',
    }],
    selection: { sessionId: 'session-a', agentId: 'agent-a' },
    activeAgent: { id: 'agent-a', name: 'Researcher', marker: 'amber', createdAt: 'now', updatedAt: 'now', sessionCount: 1 },
    session: {
      id: 'session-a', title: 'Shared', workspacePath: 'Z:\\workspace',
      participants: [{ agentId: 'agent-a', connectionId: 'connection-a' }],
      activeAgentId: 'agent-a', createdAt: 'now', updatedAt: 'now', turnCount: 1,
      lastProvider: 'offline-demo', agentId: 'agent-a', nextConnectionId: 'connection-a',
    },
    turns: [{
      role: 'user', text: 'hello', agentId: 'agent-a', provider: null, model: null,
      changedFiles: [], createdAt: 'now',
    }],
    connections: [],
    busy: false,
    persistence: { available: true },
  };
}

test('composes the exact deeply frozen public application snapshot', () => {
  const snapshot = createAppSnapshot({
    coordinator: coordinatorSnapshot(),
    connections: [{
      id: 'connection-a', executorType: 'offline-demo', label: 'Offline Demo',
      workspacePath: 'Z:\\workspace', permissionProfile: 'workspace',
      modelId: 'offline-demo', effort: null, keyHint: null, hasSecret: false,
      encryptedKey: 'must-not-copy',
    }],
    manager: { busy: false, connectionId: 'connection-a', dismissCapability: 'must-not-copy' },
    activity: {
      run: null,
      events: [{ phase: 'reading', kind: 'file', summary: 'Read notes', operation: 'read', path: 'notes.txt', sequence: 1, timestamp: 10 }],
    },
    view: 'conversation',
    notice: null,
  });

  assert.deepEqual(Object.keys(snapshot), [
    'view', 'agents', 'sessions', 'selection', 'activeAgent', 'session',
    'turns', 'connections', 'run', 'activity', 'notice',
  ]);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.sessions[0].participants), true);
  assert.equal(Object.isFrozen(snapshot.activity.events[0]), true);
  assert.equal(JSON.stringify(snapshot).includes('encrypted'), false);
  assert.equal(JSON.stringify(snapshot).includes('dismissCapability'), false);
  assert.deepEqual(snapshot.run, { busy: false, connectionId: 'connection-a', permissionProfile: null });
});

test('rejects secret-shaped or malformed source snapshots instead of guessing', () => {
  const base = {
    coordinator: coordinatorSnapshot(),
    connections: [],
    manager: { busy: false, connectionId: null },
    activity: { run: null, events: [] },
    view: 'conversation',
    notice: null,
  };
  assert.throws(() => createAppSnapshot({
    ...base,
    coordinator: { ...base.coordinator, encryptedTurns: 'secret' },
  }));
  assert.throws(() => createAppSnapshot({
    ...base,
    connections: [{ id: 'x', executorType: 'offline-demo', label: 'x' }],
  }));
  assert.throws(() => createAppSnapshot({ ...base, view: 'unknown' }));
  assert.throws(() => createAppSnapshot({
    ...base,
    notice: { status: 'error', message: 'x', rawStderr: 'secret' },
  }));
});
