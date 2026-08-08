'use strict';

// Live ribbon controller tests (Phase 3 Task 2). The live main window renders the ribbon with
// vanilla DOM (no Preact at runtime, because the renderer loads from file:// with no ESM
// loader), so this file exercises the same createElement path the browser uses, via jsdom.

const { JSDOM } = require('jsdom');
const test = require('node:test');
const assert = require('node:assert/strict');

function jsdomGlobals() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>', {
    pretendToBeVisual: true,
  });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.HTMLElement = window.HTMLElement;
  global.Node = window.Node;
  return dom;
}

function machineView(state, extra = {}) {
  return { state, connectionId: 'c1', step: null, feedback: null, failure: null, updatedAt: 0, ...extra };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('renderRibbon mounts label, tone, and an action button that fires its handler', () => {
  jsdomGlobals();
  const { renderRibbon, RIBBON_ACTIONS } = require('../src/app/ribbonController.js');
  const host = document.getElementById('host');
  let fired = false;
  renderRibbon(host, {
    tone: 'warning',
    label: 'Codex sign-in required',
    detail: 'Official sign-in is provider-owned.',
    primaryAction: RIBBON_ACTIONS.SIGN_IN,
    primaryType: 'signin',
  }, () => { fired = true; });

  const ribbon = host.querySelector('.status-ribbon');
  assert.ok(ribbon, 'ribbon element is mounted');
  assert.equal(ribbon.getAttribute('data-tone'), 'warning');
  assert.equal(ribbon.getAttribute('role'), 'status');
  assert.equal(ribbon.querySelector('.status-ribbon__label').textContent, 'Codex sign-in required');
  assert.equal(ribbon.querySelector('.status-ribbon__detail').textContent, 'Official sign-in is provider-owned.');

  const action = ribbon.querySelector('.status-ribbon__action');
  assert.equal(action.textContent, RIBBON_ACTIONS.SIGN_IN);
  assert.equal(action.getAttribute('data-action-type'), 'signin');
  action.click();
  assert.equal(fired, true, 'clicking the action invokes the handler');
});

test('renderRibbon omits the action button when there is nothing actionable', () => {
  jsdomGlobals();
  const { renderRibbon } = require('../src/app/ribbonController.js');
  const host = document.getElementById('host');
  renderRibbon(host, { tone: 'success', label: 'Ready', primaryAction: null, primaryType: null });
  assert.equal(host.querySelector('.status-ribbon__action'), null);
  assert.equal(host.querySelector('.status-ribbon__label').textContent, 'Ready');
});

test('createRibbonHost renders from a snapshot and routes the active connection action', async () => {
  jsdomGlobals();
  const { createRibbonHost, RIBBON_ACTIONS } = require('../src/app/ribbonController.js');
  const host = document.getElementById('host');

  const snapshot = {
    run: { busy: false },
    connections: [{ id: 'c1' }],
    session: { participants: [{ agentId: 'a1', connectionId: 'c1' }] },
    activeAgent: { id: 'a1' },
  };
  const actions = { calls: [] };
  const controller = createRibbonHost(host, {
    getConnectionState: () => machineView('Sign-in required'),
    actions: {
      signIn: (id) => actions.calls.push(['signIn', id]),
    },
  });

  controller.update(snapshot);
  await tick();

  const ribbon = host.querySelector('.status-ribbon');
  assert.equal(ribbon.querySelector('.status-ribbon__label').textContent, 'Codex sign-in required');
  const action = ribbon.querySelector('.status-ribbon__action');
  assert.equal(action.textContent, RIBBON_ACTIONS.SIGN_IN);

  action.click();
  assert.deepEqual(actions.calls, [['signIn', 'c1']], 'the action targets the active connection');
});

test('createRibbonHost shows Running agent + Stop during a busy run', async () => {
  jsdomGlobals();
  const { createRibbonHost, RIBBON_ACTIONS } = require('../src/app/ribbonController.js');
  const host = document.getElementById('host');

  const snapshot = {
    run: { busy: true },
    connections: [],
    session: null,
    activeAgent: { id: 'a1' },
  };
  const actions = { calls: [] };
  const controller = createRibbonHost(host, {
    getConnectionState: () => null,
    actions: { stop: () => actions.calls.push('stop') },
  });

  controller.update(snapshot);
  await tick();

  const ribbon = host.querySelector('.status-ribbon');
  assert.equal(ribbon.querySelector('.status-ribbon__label').textContent, 'Running agent');
  assert.equal(ribbon.querySelector('.status-ribbon__action').textContent, RIBBON_ACTIONS.STOP);
  ribbon.querySelector('.status-ribbon__action').click();
  assert.deepEqual(actions.calls, ['stop']);
});
