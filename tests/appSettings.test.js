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
  focus() { this.focused = true; }
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
    activeAgentProfile: {
      id: 'a', name: 'Agent A', marker: 'amber', instruction: 'Review carefully.',
    },
    session: {
      id: 'shared', title: 'Shared work', workspacePath: 'Z:\\workspace',
      updatedAt: '2026-07-29T00:00:00.000Z', activeAgentId: 'a',
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

test('opens with keyboard-accessible Agent and Session settings tabs', () => {
  const root = new Element();
  renderSettings(root, snapshot(), () => {}, { document: documentBoundary });
  const values = flatten(root);
  const text = values.map((item) => item.textContent);
  for (const heading of [
    'Agent settings', 'Session settings', 'Active agent profile',
    'Assigned connection', 'Provider connections', 'Agent library',
  ]) {
    assert.equal(text.includes(heading), true);
  }
  const tabs = values.filter((item) => item.role === 'tab');
  assert.deepEqual(tabs.map((item) => item['aria-selected']), ['true', 'false']);
  assert.equal(text.includes('Full computer access'), true);
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
    settingsTab: 'session',
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

test('saves the active agent profile and creates a named agent', async () => {
  const root = new Element();
  const calls = [];
  const value = snapshot();
  const dispatch = async (type, data) => {
    calls.push([type, data]);
    if (type === 'create-agent') return { id: 'new-agent', name: data.name };
    return true;
  };
  renderSettings(root, value, dispatch, { document: documentBoundary });
  const values = flatten(root);
  const agentName = values.find((item) => item.dataset.field === 'agent-name');
  const instruction = values.find((item) => item.dataset.field === 'agent-instruction');
  agentName.value = 'Lead researcher';
  instruction.value = 'Check sources.';
  await values.find((item) => item.dataset.action === 'save-agent-profile').listeners.get('click')();
  const name = values.find((item) => item.dataset.field === 'new-agent-name');
  name.value = 'Reviewer';
  await values.find((item) => item.dataset.action === 'create-agent').listeners.get('click')();
  assert.deepEqual(calls, [
    ['update-agent', {
      agentId: 'a', name: 'Lead researcher', marker: 'amber', instruction: 'Check sources.',
    }],
    ['create-agent', { name: 'Reviewer', marker: 'blue', instruction: '' }],
  ]);
});

test('does not render obsolete active-connection controls that no longer carry a connection id', () => {
  const root = new Element();
  renderSettings(root, snapshot(), () => {}, { document: documentBoundary });
  const text = flatten(root).map((item) => item.textContent).join(' ');
  assert.doesNotMatch(text, /Test active connection/);
  assert.doesNotMatch(text, /Provider sign-in/);
});

test('renders provider-aware Codex and Claude editors with no Workspace fallback', async () => {
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
    getConnectionState: (id) => (id === 'codex'
      ? {
        state: 'Sign-in required', connectionId: 'codex', step: 'Sign in to Codex',
        feedback: null, failure: null, updatedAt: 0,
      }
      : null),
    editingConnectionId: 'codex',
  });
  const values = flatten(root);
  const text = values.map((item) => item.textContent);
  for (const expected of [
    'Edit Codex connection', 'Full computer access', 'Workspace only is not available yet',
    'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
    'Sign in to Codex',
  ]) assert.equal(text.includes(expected), true, expected);
  const workspace = values.find((item) => item.dataset.field === 'connection-workspace');
  const model = values.find((item) => item.dataset.field === 'connection-model');
  const effort = values.find((item) => item.dataset.field === 'connection-effort');
  assert.equal(workspace.value, 'Z:\\workspace');
  assert.equal(model.value, 'gpt-5.6-terra');
  assert.equal(effort.value, 'medium');
  await values.find((item) => item.dataset.action === 'save-provider-connection').listeners.get('click')();
  await values.find((item) => item.dataset.action === 'test-codex-cli').listeners.get('click')();
  await values.find((item) => item.dataset.action === 'setup-codex-cli').listeners.get('click')();
  assert.deepEqual(calls, [
    ['save-connection', {
      id: 'codex', executorType: 'codex-cli', label: 'Codex', workspacePath: 'Z:\\workspace',
      permissionProfile: 'full-computer', modelId: 'gpt-5.6-terra', effort: 'medium', keyHint: null,
    }],
    ['test-connection', { connectionId: 'codex' }],
    ['begin-provider-setup', { connectionId: 'codex' }],
  ]);

  const claudeRoot = new Element();
  value.connections.push({
    id: 'claude', label: 'Claude Code', executorType: 'claude-code-cli',
    workspacePath: 'Z:\\workspace', permissionProfile: 'full-computer',
    modelId: 'sonnet', effort: 'high', keyHint: null, hasSecret: false,
  });
  renderSettings(claudeRoot, value, () => {}, {
    document: documentBoundary,
    editingConnectionId: 'claude',
  });
  const claudeText = flatten(claudeRoot).map((item) => item.textContent);
  for (const expected of ['fable', 'opus', 'sonnet']) {
    assert.equal(claudeText.includes(expected), true);
  }
  assert.equal(
    claudeText.some((textValue) => textValue.includes('gpt-5.6-terra')),
    true,
    'saved Codex card remains visible',
  );
});

test('Session settings rename and delete only through main-owned confirmation', async () => {
  const root = new Element();
  const calls = [];
  renderSettings(root, snapshot(), (type, data) => {
    calls.push([type, data]);
    return Promise.resolve(true);
  }, { document: documentBoundary, settingsTab: 'session' });
  const values = flatten(root);
  const title = values.find((item) => item.dataset.field === 'session-title');
  title.value = 'Renamed work';
  await values.find((item) => item.dataset.action === 'rename-session').listeners.get('click')();
  await values.find((item) => item.dataset.action === 'delete-session').listeners.get('click')();
  assert.deepEqual(calls, [
    ['rename-session', { sessionId: 'shared', title: 'Renamed work' }],
    ['confirm-delete-session', { sessionId: 'shared' }],
  ]);
});

test('Session settings preserves an unsaved name across snapshot renders', () => {
  const root = new Element();
  const drafts = new Map();
  const draftState = {
    settings: (key) => ({ ...(drafts.get(key) || {}) }),
    patchSettings: (key, patch) => drafts.set(key, { ...(drafts.get(key) || {}), ...patch }),
    clearSettings: (key) => drafts.delete(key),
  };
  renderSettings(root, snapshot(), () => Promise.resolve(true), {
    document: documentBoundary,
    settingsTab: 'session',
    draftState,
  });
  let title = flatten(root).find((item) => item.dataset.field === 'session-title');
  title.value = 'Unsent session name';
  title.listeners.get('input')();

  renderSettings(root, snapshot(), () => Promise.resolve(true), {
    document: documentBoundary,
    settingsTab: 'session',
    draftState,
  });
  title = flatten(root).find((item) => item.dataset.field === 'session-title');
  assert.equal(title.value, 'Unsent session name');
});
