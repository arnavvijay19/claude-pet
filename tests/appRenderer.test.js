'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

class Element {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.classList = { toggle: () => {}, add: () => {}, remove: () => {} };
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.listeners = new Map();
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute() {}
  focus() { this.focused = true; }
}

function rendererHarness() {
  const ids = ['sidebar-root', 'workspace-root', 'first-run', 'first-run-form', 'first-agent-name', 'first-workspace', 'first-goal', 'app-status', 'conversation-root', 'activity-root', 'settings-root'];
  const elements = new Map(ids.map((id) => [id, new Element(id)]));
  elements.get('first-run').textContent = 'Start with Offline Demo';
  const document = {
    querySelector(selector) { return elements.get(selector.slice(1)); },
    createElement(tagName) { return new Element('', tagName); },
  };
  const intents = [];
  let subscriptions = 0;
  let settingsOptions = null;
  const empty = {
    view: 'conversation', agents: [], sessions: [], selection: { sessionId: null, agentId: null },
    activeAgent: null, session: null, turns: [], connections: [],
    run: { busy: false, connectionId: null, permissionProfile: null },
    activity: { run: null, events: [] }, notice: null,
  };
  const window = {
    claudePetApp: {
      snapshot: async () => empty,
      subscribe(callback) { subscriptions += 1; this.callback = callback; return () => {}; },
      intent: async (type, data) => {
        intents.push([type, data]);
        if (type === 'create-agent') return { id: 'agent' };
        return type === 'save-connection' ? { id: 'offline' } : true;
      },
    },
    claudePetSidebar: { renderSidebar: () => {} },
    claudePetConversation: { renderConversation: () => {}, renderActivityDrawer: () => {} },
    claudePetSettings: {
      renderSettings: (_root, _snapshot, _dispatch, options) => { settingsOptions = options; },
    },
  };
  return { document, elements, intents, subscriptions: () => subscriptions, settingsOptions: () => settingsOptions, window };
}

test('keeps Codex setup results visible through the Settings snapshot rerender', async () => {
  const harness = rendererHarness();
  harness.window.claudePetApp.intent = async (type, data) => {
    harness.intents.push([type, data]);
    return {
      status: { installed: true, authenticated: false },
      permission: { available: true, allowed: true },
    };
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'app.js'), 'utf8'),
    { document: harness.document, window: harness.window, console, setTimeout, clearTimeout },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof harness.window.claudePetApp.callback, 'function');
  harness.window.claudePetApp.callback({
    view: 'settings', agents: [{ id: 'agent', name: 'Agent' }], sessions: [{ id: 'session' }],
    selection: { sessionId: 'session', agentId: 'agent' }, activeAgent: { id: 'agent', name: 'Agent' },
    session: { id: 'session' }, turns: [], connections: [],
    run: { busy: false, connectionId: null, permissionProfile: null }, activity: { run: null, events: [] }, notice: null,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof harness.settingsOptions()?.connectionAction, 'function');
  await harness.settingsOptions().connectionAction('test-connection', { connectionId: 'codex' });
  assert.match(harness.settingsOptions().connectionFeedback, /installed.*not signed in/i);
  assert.equal(harness.settingsOptions().connectionActionPending, false);
  assert.deepEqual(harness.intents, [['test-connection', { connectionId: 'codex' }]]);
});

test('shows a plain Full Computer cancellation result instead of Electron IPC error wrapping', async () => {
  const harness = rendererHarness();
  harness.window.claudePetApp.intent = async () => {
    throw new Error('Error invoking remote method \'app:intent\': AgentError: Full Computer was not enabled.');
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'app.js'), 'utf8'),
    { document: harness.document, window: harness.window, console, setTimeout, clearTimeout },
  );
  await new Promise((resolve) => setImmediate(resolve));
  harness.window.claudePetApp.callback({
    view: 'settings', agents: [{ id: 'agent', name: 'Agent' }], sessions: [{ id: 'session' }],
    selection: { sessionId: 'session', agentId: 'agent' }, activeAgent: { id: 'agent', name: 'Agent' },
    session: { id: 'session' }, turns: [], connections: [],
    run: { busy: false, connectionId: null, permissionProfile: null }, activity: { run: null, events: [] }, notice: null,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await harness.settingsOptions().connectionAction('save-connection', {});
  assert.equal(harness.settingsOptions().connectionFeedback, 'Full Computer was not enabled.');
  assert.doesNotMatch(harness.settingsOptions().connectionFeedback, /AgentError|remote method/i);
});

test('clean profile exposes one obvious Offline Demo start action and dispatches onboarding intents', async () => {
  const harness = rendererHarness();
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'app.js'), 'utf8'),
    { document: harness.document, window: harness.window, console, setTimeout, clearTimeout },
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.subscriptions(), 1);
  assert.equal(harness.elements.get('first-run').hidden, false);
  assert.match(harness.elements.get('first-run').textContent, /Start with Offline Demo/);
  harness.elements.get('first-agent-name').value = 'My Agent';
  harness.elements.get('first-workspace').value = 'Z:\\workspace';
  harness.elements.get('first-goal').value = 'Check this folder';
  await harness.elements.get('first-run-form').listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(harness.intents.map(([type]) => type), [
    'create-agent', 'save-connection', 'create-session', 'submit-goal',
  ]);
  assert.equal(harness.intents[2][0], 'create-session');
  assert.deepEqual(JSON.parse(JSON.stringify(harness.intents[2][1])), {
    agentId: 'agent', title: 'My first session', connectionId: 'offline',
  });
});

test('main shell uses semantic landmarks and no native prompt workflow', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'app.js'), 'utf8');
  assert.match(html, /<aside[^>]+id="sidebar-root"/);
  assert.match(html, /<main[^>]+id="workspace-root"/);
  assert.match(html, /Start with Offline Demo/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(source, /window\.prompt|setInterval/);
});
