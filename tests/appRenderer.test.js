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
  const ids = ['sidebar-root', 'workspace-root', 'first-run', 'first-run-form', 'first-agent-name', 'first-workspace', 'first-goal', 'app-status'];
  const elements = new Map(ids.map((id) => [id, new Element(id)]));
  elements.get('first-run').textContent = 'Start with Offline Demo';
  const document = {
    querySelector(selector) { return elements.get(selector.slice(1)); },
    createElement(tagName) { return new Element('', tagName); },
  };
  const intents = [];
  let subscriptions = 0;
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
      intent: async (type, data) => { intents.push([type, data]); return true; },
    },
    claudePetSidebar: { renderSidebar: () => {} },
  };
  return { document, elements, intents, subscriptions: () => subscriptions, window };
}

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
