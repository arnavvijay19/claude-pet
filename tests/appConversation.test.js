'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  activityLabel,
  renderActivityDrawer,
  renderConversation,
} = require('../src/app/conversation.js');

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

function snapshot({ busy = false, notice = null, long = false } = {}) {
  return {
    view: 'conversation',
    agents: [
      { id: 'researcher', name: 'Researcher', status: 'idle' },
      { id: 'reviewer', name: 'Reviewer', status: busy ? 'running' : 'idle' },
    ],
    sessions: [],
    selection: { sessionId: 'shared', agentId: 'reviewer' },
    activeAgent: { id: 'reviewer', name: 'Reviewer', status: busy ? 'running' : 'idle' },
    session: {
      id: 'shared', title: 'Shared work', workspacePath: 'Z:\\workspace',
      participants: [
        { agentId: 'researcher', connectionId: 'offline' },
        { agentId: 'reviewer', connectionId: 'codex' },
      ],
      activeAgentId: 'reviewer',
    },
    turns: [
      {
        role: 'user', text: 'Investigate', agentId: 'researcher',
        provider: null, model: null, changedFiles: [], createdAt: 'now',
      },
      {
        role: 'assistant', text: long ? 'x'.repeat(20000) : '<b>Evidence</b>',
        agentId: 'reviewer', provider: 'codex-cli', model: 'gpt-5.6-terra',
        changedFiles: ['notes.txt'], createdAt: 'now',
      },
    ],
    connections: [
      {
        id: 'offline', label: 'Offline Demo', executorType: 'offline-demo',
        permissionProfile: 'workspace', modelId: 'offline-demo', workspacePath: 'Z:\\workspace',
      },
      {
        id: 'codex', label: 'Codex', executorType: 'codex-cli',
        permissionProfile: 'full-computer', modelId: 'gpt-5.6-terra', workspacePath: 'Z:\\workspace',
      },
    ],
    run: { busy, connectionId: 'codex', permissionProfile: 'full-computer' },
    activity: {
      run: null,
      events: [
        { kind: 'file', operation: 'write', path: 'notes.txt', summary: 'safe' },
        { kind: 'command', command: 'npm test', exitCode: 0, summary: 'safe' },
        { kind: 'tool', toolName: 'Read', summary: 'safe' },
        { kind: 'permission', decision: 'deny', permission: 'camera', summary: 'safe' },
        { kind: 'network', destination: 'https://example.com', summary: 'safe' },
        { kind: 'usage', usage: { totalTokens: 10 }, summary: 'safe' },
      ],
    },
    notice,
    pendingAttachment: { name: 'notes.md', extension: '.md', size: 12288 },
  };
}

function flatten(root) {
  const values = [];
  const visit = (item) => {
    values.push(item);
    item.children.forEach(visit);
  };
  root.children.forEach(visit);
  return values;
}

test('renders attributed turns as text and limits the composer to session participants', () => {
  const root = new Element();
  renderConversation(root, snapshot(), () => {}, { document: documentBoundary });
  const values = flatten(root);
  const text = values.map((item) => item.textContent);
  assert.equal(text.includes('You → Researcher'), true);
  assert.equal(text.includes('Reviewer · Codex · gpt-5.6-terra'), true);
  assert.equal(text.includes('<b>Evidence</b>'), true);
  const selector = values.find((item) => item.tagName === 'select');
  assert.deepEqual(selector.children.map((option) => option.textContent), ['Researcher', 'Reviewer']);
  assert.equal(values.some((item) => item.textContent === 'Full computer access'), true);
});

test('summarizes every activity kind in one collapsed card', () => {
  assert.equal(activityLabel({ kind: 'file', operation: 'write', path: 'notes.txt' }), 'Updated notes.txt');
  assert.equal(activityLabel({ kind: 'command', exitCode: 1 }), 'Command failed');
  assert.equal(activityLabel({ kind: 'tool', toolName: 'Read' }), 'Used Read');
  assert.equal(activityLabel({ kind: 'permission', decision: 'allow', permission: 'files' }), 'Allowed files');
  assert.equal(activityLabel({ kind: 'network' }), 'Used network access');
  assert.equal(activityLabel({ kind: 'usage' }), 'Updated token usage');
  const root = new Element();
  renderActivityDrawer(root, snapshot(), () => {}, { document: documentBoundary });
  const details = flatten(root).filter((item) => item.tagName === 'details');
  assert.equal(details.length, 6);
  assert.equal(details.every((item) => item.open !== true), true);
});

test('switches Send to Stop while busy and keeps terminal recovery actions usable', () => {
  const busyRoot = new Element();
  renderConversation(busyRoot, snapshot({ busy: true }), () => {}, { document: documentBoundary });
  const busyText = flatten(busyRoot).map((item) => item.textContent);
  assert.equal(busyText.includes('Stop'), true);
  assert.equal(busyText.includes('Send'), false);

  for (const notice of [
    { status: 'success', message: 'Task completed.', action: 'Continue' },
    { status: 'error', message: 'Task failed.', action: 'Retry', request: 'Investigate' },
    { status: 'stopped', message: 'Task stopped.', action: 'Retry', request: 'Investigate' },
  ]) {
    const root = new Element();
    renderConversation(root, snapshot({ notice }), () => {}, { document: documentBoundary });
    const text = flatten(root).map((item) => item.textContent);
    assert.equal(text.includes(notice.action), true);
  }
});

test('contains a 20000-character response and 100 activity events in scroll regions', () => {
  const value = snapshot({ long: true });
  value.activity.events = Array.from({ length: 100 }, (_, index) => ({
    kind: 'tool', toolName: `Tool ${index}`, summary: `Safe ${index}`,
  }));
  const root = new Element();
  renderConversation(root, value, () => {}, { document: documentBoundary });
  const values = flatten(root);
  assert.equal(values.some((item) => item.className.includes('conversation-scroll')
    && item.textContent === ''), true);
  assert.equal(values.some((item) => item.textContent.length === 20000), true);
  const drawer = new Element();
  renderActivityDrawer(drawer, value, () => {}, { document: documentBoundary });
  assert.equal(flatten(drawer).filter((item) => item.tagName === 'details').length, 100);
});

test('opens and closes the activity drawer through the single view intent', async () => {
  const calls = [];
  const root = new Element();
  renderConversation(root, snapshot(), (type, data) => calls.push([type, data]), {
    document: documentBoundary,
  });
  await flatten(root).find((item) => item.textContent === 'Activity').listeners.get('click')();
  const drawer = new Element();
  renderActivityDrawer(drawer, snapshot(), (type, data) => calls.push([type, data]), {
    document: documentBoundary,
  });
  await flatten(drawer).find((item) => item.textContent === 'Close').listeners.get('click')();
  assert.deepEqual(calls, [
    ['set-view', { view: 'activity' }],
    ['set-view', { view: 'conversation' }],
  ]);
});

test('preserves an unsent draft across snapshots and renders safe attachment metadata', async () => {
  const calls = [];
  const draftValues = new Map();
  const drafts = {
    composer: (id) => draftValues.get(id) || '',
    setComposer: (id, text) => draftValues.set(id, text),
    clearComposer: (id) => draftValues.delete(id),
  };
  const root = new Element();
  renderConversation(root, snapshot(), (type, data) => {
    calls.push([type, data]);
    return Promise.resolve(true);
  }, { document: documentBoundary, draftState: drafts });
  let values = flatten(root);
  const textarea = values.find((item) => item.tagName === 'textarea');
  textarea.value = 'unsent draft';
  textarea.listeners.get('input')();

  renderConversation(root, snapshot(), (type, data) => {
    calls.push([type, data]);
    return Promise.resolve(true);
  }, { document: documentBoundary, draftState: drafts });
  values = flatten(root);
  assert.equal(values.find((item) => item.tagName === 'textarea').value, 'unsent draft');
  assert.equal(values.some((item) => item.textContent === 'notes.md · 12 KB'), true);
  assert.equal(JSON.stringify(values).includes('private'), false);
  await values.find((item) => item.textContent === 'Remove').listeners.get('click')();
  assert.deepEqual(calls.at(-1), ['clear-attachment', {}]);
});
