'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderSettings } = require('../src/app/settings.js');

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.listeners = new Map();
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute(name, value) { this[name] = value; }
}

const documentBoundary = { createElement: (tagName) => new Element(tagName) };

function flatten(root) {
  const result = [];
  const visit = (value) => { result.push(value); value.children.forEach(visit); };
  root.children.forEach(visit);
  return result;
}

function snapshot(busy = false) {
  return {
    agents: [
      { id: 'a', name: 'Agent A', marker: 'amber', status: 'idle' },
      { id: 'b', name: 'Agent B', marker: 'blue', status: 'idle' },
    ],
    activeAgent: { id: 'a', name: 'Agent A', marker: 'amber', status: 'idle' },
    session: {
      id: 'shared', workspacePath: 'Z:\\workspace', activeAgentId: 'a',
      participants: [{ agentId: 'a', connectionId: 'codex' }, { agentId: 'b', connectionId: 'offline' }],
    },
    connections: [
      {
        id: 'codex', label: 'Codex', executorType: 'codex-cli',
        workspacePath: 'Z:\\workspace', permissionProfile: 'full-computer',
        modelId: 'gpt-5.6-terra', effort: 'medium', keyHint: null, hasSecret: false,
      },
      {
        id: 'offline', label: 'Offline Demo', executorType: 'offline-demo',
        workspacePath: 'Z:\\workspace', permissionProfile: 'workspace',
        modelId: 'offline-demo', effort: null, keyHint: null, hasSecret: false,
      },
    ],
    run: { busy, connectionId: busy ? 'codex' : null, permissionProfile: busy ? 'full-computer' : null },
    turns: [{
      role: 'assistant', text: 'Historical answer', agentId: 'b',
      provider: 'offline-demo', model: 'offline-demo', changedFiles: [], createdAt: 'now',
    }],
  };
}

test('groups secondary settings and keeps the Full Computer warning permanent', () => {
  const root = new Element();
  renderSettings(root, snapshot(), () => {}, { document: documentBoundary });
  const text = flatten(root).map((item) => item.textContent);
  for (const heading of ['Connections', 'Access', 'Model', 'Advanced']) {
    assert.equal(text.includes(heading), true);
  }
  assert.equal(text.includes('Full computer access'), true);
  assert.equal(text.includes('This agent can access your whole computer.'), true);
});

test('disables active agent and connection changes while busy', () => {
  const root = new Element();
  renderSettings(root, snapshot(true), () => {}, { document: documentBoundary });
  const mutations = flatten(root).filter((item) => item.dataset.mutation === 'true');
  assert.equal(mutations.length > 0, true);
  assert.equal(mutations.every((item) => item.disabled), true);
});

test('removing a participant does not remove their attributed historical turn', async () => {
  const root = new Element();
  const calls = [];
  const value = snapshot();
  renderSettings(root, value, (type, data) => calls.push([type, data]), {
    document: documentBoundary,
  });
  const remove = flatten(root).find(
    (item) => item.dataset.removeParticipant === 'b',
  );
  await remove.listeners.get('click')();
  assert.deepEqual(calls, [[
    'remove-participant',
    { sessionId: 'shared', agentId: 'b' },
  ]]);
  assert.equal(value.turns[0].text, 'Historical answer');
});

test('creates a named agent and adds an existing agent to the selected session inline', async () => {
  const root = new Element();
  const calls = [];
  const value = snapshot();
  value.session.participants = [{ agentId: 'a', connectionId: 'codex' }];
  const dispatch = async (type, data) => {
    calls.push([type, data]);
    if (type === 'create-agent') return { id: 'new-agent', name: data.name };
    return true;
  };
  renderSettings(root, value, dispatch, { document: documentBoundary });
  const values = flatten(root);
  const name = values.find((item) => item.dataset.field === 'new-agent-name');
  name.value = 'Reviewer';
  await values.find((item) => item.dataset.action === 'create-agent').listeners.get('click')();
  await values.find((item) => item.dataset.action === 'add-participant').listeners.get('click')();
  assert.deepEqual(calls, [
    ['create-agent', { name: 'Reviewer', marker: 'blue', instruction: '' }],
    ['add-participant', { sessionId: 'shared', agentId: 'b', connectionId: 'codex' }],
  ]);
});

test('renders an explicit Codex editor with no Workspace fallback and targets saved connection actions', async () => {
  const root = new Element();
  const calls = [];
  const value = snapshot();
  const connectionAction = async (type, data) => {
    calls.push([type, data]);
    return type === 'save-connection' ? { id: 'codex' } : { started: true };
  };
  renderSettings(root, value, () => {}, {
    document: documentBoundary,
    connectionAction,
    connectionFeedback: 'Codex is installed. Sign in is still required.',
    editingConnectionId: 'codex',
  });
  const values = flatten(root);
  const text = values.map((item) => item.textContent);
  for (const expected of [
    'Set up Codex', 'Full computer access', 'Workspace only is not available yet',
    'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
    'Codex is installed. Sign in is still required.',
  ]) assert.equal(text.includes(expected), true, expected);
  const workspace = values.find((item) => item.dataset.field === 'codex-workspace');
  const model = values.find((item) => item.dataset.field === 'codex-model');
  const effort = values.find((item) => item.dataset.field === 'codex-effort');
  assert.equal(workspace.value, 'Z:\\workspace');
  assert.equal(model.value, 'gpt-5.6-terra');
  assert.equal(effort.value, 'medium');
  await values.find((item) => item.dataset.action === 'save-codex-connection').listeners.get('click')();
  await values.find((item) => item.dataset.action === 'test-codex-connection').listeners.get('click')();
  await values.find((item) => item.dataset.action === 'begin-codex-setup').listeners.get('click')();
  assert.deepEqual(calls, [
    ['save-connection', {
      id: 'codex', executorType: 'codex-cli', label: 'Codex', workspacePath: 'Z:\\workspace',
      permissionProfile: 'full-computer', modelId: 'gpt-5.6-terra', effort: 'medium', keyHint: null,
    }],
    ['test-connection', { connectionId: 'codex' }],
    ['begin-provider-setup', { connectionId: 'codex' }],
  ]);
});
