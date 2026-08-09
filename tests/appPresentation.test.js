'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createAppSnapshot } = require('../src/app/appSnapshot.js');
const { renderSidebar } = require('../src/app/sidebar.js');

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.type = '';
    this.hidden = false;
    this.listeners = new Map();
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  focus() { this.focused = true; }
  setAttribute(name, value) { this[name] = value; }
}

function documentBoundary() {
  return { createElement: (tagName) => new Element(tagName) };
}

function sourceSnapshot({ busy = false, notice = null } = {}) {
  const agents = ['running', 'waiting', 'idle', 'error'].map((id) => ({
    id, name: `${id} agent`, marker: 'amber', createdAt: 'now', updatedAt: 'now', sessionCount: 1,
  }));
  const participants = agents.map((agent) => ({
    agentId: agent.id, connectionId: `connection-${agent.id}`,
  }));
  const session = {
    id: 'shared', title: 'Shared work', workspacePath: 'Z:\\workspace',
    participants, activeAgentId: busy ? 'running' : 'error',
    createdAt: 'now', updatedAt: 'now', turnCount: 0, lastProvider: null,
  };
  return createAppSnapshot({
    coordinator: {
      agents,
      sessions: [session],
      selection: { sessionId: 'shared' },
      activeAgent: agents.find((agent) => agent.id === session.activeAgentId),
      session,
      turns: [],
    },
    connections: agents.map((agent) => ({
      id: `connection-${agent.id}`, executorType: 'offline-demo', label: 'Offline Demo',
      workspacePath: 'Z:\\workspace', permissionProfile: 'workspace',
      modelId: 'offline-demo', effort: null, keyHint: null, hasSecret: false,
    })),
    manager: { busy, connectionId: `connection-${session.activeAgentId}` },
    activity: { run: null, events: [] },
    view: 'conversation',
    notice,
  });
}

test('derives running, waiting, idle, and error agent statuses in main-owned state', () => {
  const running = sourceSnapshot({
    busy: true,
    notice: { status: 'waiting', message: 'Needs attention', agentId: 'waiting' },
  });
  assert.equal(running.agents.find((agent) => agent.id === 'running').status, 'running');
  assert.equal(running.agents.find((agent) => agent.id === 'waiting').status, 'waiting');
  assert.equal(running.agents.find((agent) => agent.id === 'idle').status, 'idle');

  const failed = sourceSnapshot({
    notice: { status: 'error', message: 'Could not complete', agentId: 'error' },
  });
  assert.equal(failed.agents.find((agent) => agent.id === 'error').status, 'error');
});

test('renders agents and shared sessions once with native keyboard-safe controls', () => {
  const root = new Element('aside');
  const dispatches = [];
  renderSidebar(root, sourceSnapshot(), (type, data) => dispatches.push([type, data]), {
    document: documentBoundary(),
  });

  const all = [];
  const visit = (value) => {
    all.push(value);
    value.children.forEach(visit);
  };
  root.children.forEach(visit);
  const text = all.map((item) => item.textContent).filter(Boolean);
  assert.equal(text.filter((value) => value === 'Shared work').length, 1);
  assert.equal(text.includes('Agents'), true);
  assert.equal(text.includes('Shared sessions'), true);
  assert.equal(text.includes('Settings'), true);
  assert.equal(all.some((item) => item.tagName === 'button' && item.textContent === 'New session'), true);
  assert.equal(all.some((item) => item.tagName === 'form'), true);
  assert.equal(all.every((item) => !item.textContent.includes('executor')), true);
  assert.equal(all.every((item) => !item.textContent.includes('permission profile')), true);
  assert.equal(all.every((item) => !item.textContent.includes('bounded visible history')), true);
});

test('does not offer an unusable New session action before the first agent exists', () => {
  const root = new Element('aside');
  renderSidebar(root, {
    agents: [], sessions: [], selection: { sessionId: null },
    activeAgent: null, session: null, connections: [],
  }, () => {}, { document: documentBoundary() });
  const buttons = [];
  const visit = (value) => {
    if (value.tagName === 'button') buttons.push(value);
    value.children.forEach(visit);
  };
  root.children.forEach(visit);
  assert.equal(buttons.find((button) => button.textContent === 'New session').hidden, true);
});

test('creates a session from one selected connection so its workspace cannot drift', async () => {
  const root = new Element('aside');
  const dispatches = [];
  renderSidebar(root, {
    agents: [{ id: 'agent-a', name: 'Agent A' }], sessions: [], selection: { sessionId: null },
    activeAgent: { id: 'agent-a', name: 'Agent A' }, session: null,
    connections: [{
      id: 'codex', label: 'Codex', modelId: 'gpt-5.6-terra',
      workspacePath: 'C:\\Users\\eklip\\Desktop\\a',
    }],
  }, (type, data) => dispatches.push([type, data]), { document: documentBoundary() });
  const findForm = (item) => item.tagName === 'form'
    ? item
    : item.children.map(findForm).find(Boolean) || null;
  const form = findForm(root);
  const [title, connection] = form.children;
  title.value = 'Codex smoke';
  connection.value = 'codex';
  await form.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(dispatches, [[
    'create-session', { agentId: 'agent-a', title: 'Codex smoke', connectionId: 'codex' },
  ]]);
});

test('opens the New session form with the browser children collection', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'sidebar.js'), 'utf8');
  assert.match(source, /Array\.from\(navigation\.children\)\.find/);
});

test('shows one guarded menu only for the selected session', async () => {
  const root = new Element('aside');
  const dispatches = [];
  let opened = null;
  const value = structuredClone(sourceSnapshot());
  value.sessions.push({
    ...value.sessions[0],
    id: 'other',
    title: 'Other work',
  });
  renderSidebar(root, value, (type, data) => {
    dispatches.push([type, data]);
    return Promise.resolve(true);
  }, {
    document: documentBoundary(),
    onOpenSessionSettings: (sessionId) => { opened = sessionId; },
  });
  const all = [];
  const visit = (item) => { all.push(item); item.children.forEach(visit); };
  root.children.forEach(visit);
  assert.equal(all.filter((item) => item.dataset.action === 'selected-session-menu').length, 1);
  await all.find((item) => item.dataset.action === 'rename-selected-session').listeners.get('click')();
  assert.equal(opened, 'shared');
  await all.find((item) => item.dataset.action === 'delete-selected-session').listeners.get('click')();
  assert.deepEqual(dispatches, [[
    'confirm-delete-session',
    { sessionId: 'shared' },
  ]]);
});

test('uses the approved responsive design tokens without decorative effects', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'app.css'), 'utf8');
  assert.match(css, /--bg:\s*#141311/);
  assert.match(css, /--accent:\s*#d99045/);
  assert.match(css, /grid-template-columns:\s*264px\s+minmax\(0,\s*1fr\)/);
  assert.match(css, /min-height:\s*40px/);
  assert.match(css, /@media\s*\(max-width:\s*899px\)/);
  assert.doesNotMatch(css, /gradient|backdrop-filter/i);
});

test('keeps the composer action beside its input at the 900px visual-QA width', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'app.css'), 'utf8');
  assert.match(css, /\.composer\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*150px\s+minmax\(0,\s*1fr\)\s+auto;/);
  assert.match(css, /@media\s*\(max-width:\s*899px\)[\s\S]*?\.composer\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.doesNotMatch(
    css,
    /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.composer-actions\s*\{\s*grid-column:\s*1\s*\/\s*-1;/,
    'the 900px viewport keeps the sidebar, so a stacked composer action clips below the 650px height',
  );
});
