'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.classList = { add: () => {}, toggle: () => {} };
    this.disabled = false;
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.listeners = new Map();
  }

  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  get selectedOptions() { return this.children.filter((child) => child.selected); }
}

function createRendererHarness() {
  const ids = [
    'status', 'connections', 'workspace', 'executor', 'permission-profile', 'model', 'effort', 'save', 'active-permission',
    'session-agent', 'session-session', 'next-provider', 'create-agent', 'rename-agent', 'delete-agent',
    'create-session', 'rename-session', 'delete-session', 'model-row', 'effort-row', 'permission-row', 'setup', 'mode-help', 'test', 'goal', 'run-goal',
  ];
  const elements = new Map(ids.map((id) => [id, new Element()]));
  elements.get('executor').value = 'offline-demo';
  const document = {
    querySelector(selector) {
      if (!selector.startsWith('#')) throw new Error(`Unsupported selector: ${selector}`);
      return elements.get(selector.slice(1));
    },
    querySelectorAll(selector) {
      if (selector !== '[data-settings-mutation]') throw new Error(`Unsupported selector: ${selector}`);
      const matches = [];
      const visit = (element) => {
        if (Object.keys(element.dataset).length > 0) matches.push(element);
        element.children.forEach(visit);
      };
      elements.forEach(visit);
      return matches;
    },
    createElement(tagName) { return new Element(tagName); },
  };
  let publishSessionState;
  const submittedGoals = [];
  const sessions = {
    agents: [{ id: 'agent-a', name: 'Agent A' }], sessions: [{ id: 'session-a', title: 'Session A' }],
    selection: { agentId: 'agent-a', sessionId: 'session-a' }, session: { nextConnectionId: 'offline' },
    connections: [{ id: 'offline', label: 'Offline' }, { id: 'codex', label: 'Codex' }], busy: false,
  };
  const legacy = {
    active: { id: 'offline', permissionBadge: 'Workspace', permissionWarning: false }, mutationsDisabled: false,
    connections: [{ id: 'offline', label: 'Offline', permissionBadge: 'Workspace', permissionWarning: false }, { id: 'codex', label: 'Codex', permissionBadge: 'Workspace', permissionWarning: false }],
  };
  const window = {
    prompt: () => null,
    settings: {
      snapshot: async () => legacy,
      sessionSnapshot: async () => sessions,
      onSessionState: (callback) => { publishSessionState = callback; },
      save: async () => legacy, select: async () => legacy, remove: async () => true, test: async () => ({}), setup: async () => ({}),
      createAgent: async () => ({ id: 'agent-a' }), renameAgent: async () => {}, deleteAgent: async () => {}, createSession: async () => ({ id: 'session-a' }), renameSession: async () => {}, deleteSession: async () => {}, selectSession: async () => {}, setNextConnection: async () => {}, submitGoal: async (text) => { submittedGoals.push(text); },
    },
    settingsPresentation: { draftForSelection: () => ({}), connectionSummary: (connection) => connection.label },
    settingsStatus: { formatTestStatus: () => 'ok' },
  };
  return { document, elements, publish: (busy) => publishSessionState({ ...sessions, busy }), window, submittedGoals };
}

function rendererSource() {
  const revision = process.env.SETTINGS_RENDERER_REVISION;
  if (revision) return childProcess.execFileSync('git', ['show', `${revision}:src/settings/settings.js`], { encoding: 'utf8' });
  return fs.readFileSync(path.join(__dirname, '..', 'src', 'settings', 'settings.js'), 'utf8');
}

async function settleRenderer() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('actual Settings renderer disables and restores every busy-sensitive mutation control', async () => {
  const harness = createRendererHarness();
  vm.runInNewContext(rendererSource(), { document: harness.document, window: harness.window, console });
  await settleRenderer();
  const staticIds = [
    'session-agent', 'session-session', 'next-provider', 'create-agent', 'rename-agent', 'delete-agent',
    'create-session', 'rename-session', 'delete-session', 'workspace', 'executor', 'permission-profile', 'model', 'effort', 'save', 'goal', 'run-goal',
  ];
  const connectionButtons = () => harness.elements.get('connections').children.flatMap((item) => item.children.filter((child) => child.tagName === 'button'));
  assert.equal(connectionButtons().length, 4, 'renders Use/Edit and Delete for each legacy connection');

  harness.publish(true);
  assert.equal(staticIds.every((id) => harness.elements.get(id).disabled), true);
  assert.equal(connectionButtons().every((button) => button.disabled), true);

  harness.publish(false);
  assert.equal(staticIds.every((id) => !harness.elements.get(id).disabled), true);
  assert.equal(connectionButtons().every((button) => !button.disabled), true);
});

test('actual Settings renderer submits the visible goal through its narrow bridge', async () => {
  const harness = createRendererHarness();
  vm.runInNewContext(rendererSource(), { document: harness.document, window: harness.window, console });
  await settleRenderer();
  harness.elements.get('goal').value = 'Check the project';
  await harness.elements.get('run-goal').listeners.get('click')();
  assert.deepEqual(harness.submittedGoals, ['Check the project']);
});
