'use strict';

// Tests for the renderer-side per-connection state wrapper (src/app/connectionState.js) and
// for the settings renderer wiring that consumes per-connection state instead of the old
// global `connectionActionPending` / `connectionFeedback`.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRendererConnectionState } = require('../src/app/connectionState.js');
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

function flatten(root) {
  const result = [];
  const visit = (value) => { result.push(value); value.children.forEach(visit); };
  root.children.forEach(visit);
  return result;
}

const documentBoundary = { createElement: (tagName) => new Element(tagName) };

function snapshot(connections) {
  return {
    agents: [{ id: 'a', name: 'Agent A', marker: 'amber', status: 'idle' }],
    activeAgent: { id: 'a', name: 'Agent A', marker: 'amber', status: 'idle' },
    activeAgentProfile: { id: 'a', name: 'Agent A', marker: 'amber', instruction: '' },
    session: {
      id: 'shared', title: 'Shared work', workspacePath: 'Z:\\workspace',
      updatedAt: '2026-07-29T00:00:00.000Z', activeAgentId: 'a',
      participants: [{ agentId: 'a', connectionId: 'codex' }],
    },
    connections,
    run: { busy: false, connectionId: null, permissionProfile: null },
    turns: [],
  };
}

test('per-connection state moves through verify, installed, sign-in-required, and failure', () => {
  const state = createRendererConnectionState();
  assert.equal(state.view('codex'), null, 'unknown connection has no view');

  state.verifying('codex');
  assert.equal(state.isVerifying('codex'), true);
  assert.equal(state.view('codex').state, 'Verifying installed Codex');

  // installed path
  state.markInstalled('codex');
  assert.equal(state.isVerifying('codex'), false);
  assert.equal(state.view('codex').state, 'Ready');

  // A second connection is independent and never affected by the first.
  state.verifying('claude');
  assert.equal(state.view('claude').state, 'Verifying installed Codex');
  assert.equal(state.view('codex').state, 'Ready');

  state.markSignInRequired('claude', { oneTime: true });
  assert.equal(state.view('claude').state, 'Sign-in required');
  assert.equal(state.view('claude').step, 'One-time identity check');

  // Re-testing a connection from a settled state restarts and can land in failure.
  state.verifying('codex');
  state.fail('codex', 'CLI_NOT_INSTALLED', 'The Codex command is not installed.');
  const failure = state.view('codex');
  assert.equal(failure.state, 'Recoverable failure');
  assert.equal(failure.failure.code, 'CLI_NOT_INSTALLED');
  assert.equal(failure.feedback, 'The Codex command is not installed.');
  assert.equal(state.view('claude').state, 'Sign-in required', 'claude is unaffected');
});

test('cancel only ends an in-flight verification and never throws otherwise', () => {
  const state = createRendererConnectionState();
  assert.equal(state.cancel('codex'), null, 'cancel of an unknown connection is a no-op');

  state.verifying('codex');
  assert.equal(state.cancel('codex').state, 'Not checked');
  assert.equal(state.isVerifying('codex'), false);

  state.verifying('codex');
  state.markInstalled('codex');
  assert.equal(state.cancel('codex').state, 'Ready', 'cancel outside verifying does nothing');
});

test('save resets a connection back to Not checked', () => {
  const state = createRendererConnectionState();
  state.verifying('codex');
  state.markInstalled('codex');
  assert.equal(state.view('codex').state, 'Ready');
  state.reset('codex');
  assert.equal(state.view('codex').state, 'Not checked');
});

test('settings renders each connection card with its own status, not a global banner', () => {
  const state = createRendererConnectionState();
  state.verifying('codex');
  state.verifying('claude');
  state.markSignInRequired('claude', { oneTime: false });
  state.verifying('offline');
  state.fail('offline', 'CLI_NOT_INSTALLED', 'The Offline Demo command is not installed.');

  const root = new Element();
  renderSettings(root, snapshot([
    { id: 'codex', label: 'Codex', executorType: 'codex-cli', workspacePath: 'Z:\\w', modelId: 'gpt-5.6-terra', effort: 'medium' },
    { id: 'claude', label: 'Claude Code', executorType: 'claude-code-cli', workspacePath: 'Z:\\w', modelId: 'sonnet', effort: 'high' },
    { id: 'offline', label: 'Offline Demo', executorType: 'offline-demo', workspacePath: 'Z:\\w', modelId: 'offline-demo', effort: null },
  ]), () => {}, {
    document: documentBoundary,
    getConnectionState: (id) => state.view(id),
  });
  const text = flatten(root).map((item) => item.textContent);
  assert.equal(text.includes('Verifying installed Codex'), true);
  assert.equal(text.includes('Sign in to Codex'), true);
  assert.equal(text.includes('The Offline Demo command is not installed.'), true);
  // A connection with no tested state shows nothing.
  assert.equal(text.filter((value) => value === 'Ready').length, 0);
});

test('a verifying connection shows Cancel instead of Test and only its own controls are busy', async () => {
  const state = createRendererConnectionState();
  state.verifying('codex');
  const cancels = [];
  const actions = [];
  const root = new Element();
  renderSettings(root, snapshot([
    { id: 'codex', label: 'Codex', executorType: 'codex-cli', workspacePath: 'Z:\\w', modelId: 'gpt-5.6-terra', effort: 'medium' },
    { id: 'claude', label: 'Claude Code', executorType: 'claude-code-cli', workspacePath: 'Z:\\w', modelId: 'sonnet', effort: 'high' },
  ]), (type, data) => actions.push([type, data]), {
    document: documentBoundary,
    getConnectionState: (id) => state.view(id),
    connectionCancel: (id) => { cancels.push(id); state.cancel(id); },
  });
  const values = flatten(root);
  const codexCancel = values.find((item) => item.dataset.action === 'cancel-codex-cli');
  assert.ok(codexCancel, 'verifying Codex card shows Cancel');
  assert.equal(codexCancel.disabled, false, 'Cancel itself is enabled');
  assert.equal(values.some((item) => item.dataset.action === 'test-codex-cli'), false, 'Test hidden while verifying');

  const claudeTest = values.find((item) => item.dataset.action === 'test-claude-code-cli');
  assert.ok(claudeTest, 'unrelated connection still shows Test');
  assert.equal(claudeTest.disabled, false, 'unrelated connection stays usable while another verifies');

  await codexCancel.listeners.get('click')();
  assert.deepEqual(cancels, ['codex']);
  assert.equal(state.view('codex').state, 'Not checked');
});

test('editing connection surfaces its tested failure in the editor', () => {
  const state = createRendererConnectionState();
  state.fail('codex', 'CLI_VERSION_UNSUPPORTED', 'This Codex update is not compatible with Claude Pet yet.');
  const root = new Element();
  renderSettings(root, snapshot([
    { id: 'codex', label: 'Codex', executorType: 'codex-cli', workspacePath: 'Z:\\w', modelId: 'gpt-5.6-terra', effort: 'medium' },
  ]), () => {}, {
    document: documentBoundary,
    getConnectionState: (id) => state.view(id),
    editingConnectionId: 'codex',
  });
  const text = flatten(root).map((item) => item.textContent);
  assert.equal(text.includes('This Codex update is not compatible with Claude Pet yet.'), true);
  assert.equal(text.includes('Edit Codex connection'), true);
});
