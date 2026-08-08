'use strict';

// Renderer test migration proof: instead of the hand-written fake-DOM stub used
// by the older app tests, this file renders the real Preact + htm StatusRibbon
// component into a jsdom document and asserts on the resulting DOM. jsdom is a
// devDependency only (pruned from the package). This establishes the Phase 3
// renderer testing pattern for the later ribbon/run-card and pet-coupling PRs.

const { JSDOM } = require('jsdom');
const test = require('node:test');
const assert = require('node:assert/strict');

// Build a fresh jsdom world and expose the globals preact expects at render time.
function jsdomGlobals() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>', {
    pretendToBeVisual: true,
  });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.HTMLElement = window.HTMLElement;
  global.Node = window.Node;
  global.requestAnimationFrame = window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
  global.cancelAnimationFrame = window.cancelAnimationFrame || ((id) => clearTimeout(id));
  return dom;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('deriveRibbonProps names a verifying run and offers Cancel', async () => {
  const { deriveRibbonProps, RIBBON_ACTIONS, RIBBON_KINDS } = await import(
    '../src/renderer/components/StatusRibbon.mjs'
  );
  const props = deriveRibbonProps({ run: { busy: true, phase: 'verifying' } });
  assert.equal(props.kind, RIBBON_KINDS.VERIFYING);
  assert.equal(props.label, 'Verifying Codex connection…');
  assert.equal(props.primaryAction, RIBBON_ACTIONS.CANCEL);
  assert.equal(props.primaryType, 'cancel');
});

test('deriveRibbonProps names a running run and offers Stop', async () => {
  const { deriveRibbonProps, RIBBON_ACTIONS } = await import(
    '../src/renderer/components/StatusRibbon.mjs'
  );
  const props = deriveRibbonProps({ run: { busy: true, phase: 'running' } });
  assert.equal(props.label, 'Running agent');
  assert.equal(props.primaryAction, RIBBON_ACTIONS.STOP);
});

test('deriveRibbonProps promotes sign-in-required with one-time labelling', async () => {
  const { deriveRibbonProps, RIBBON_ACTIONS } = await import(
    '../src/renderer/components/StatusRibbon.mjs'
  );
  const plain = deriveRibbonProps({ connection: { state: 'sign-in-required', oneTime: false } });
  assert.equal(plain.primaryAction, RIBBON_ACTIONS.SIGN_IN);
  assert.equal(plain.label, 'Codex sign-in required');

  const oneTime = deriveRibbonProps({ connection: { state: 'sign-in-required', oneTime: true } });
  assert.equal(oneTime.label, 'One-time Codex identity check required');
  assert.equal(oneTime.detail.includes('once per identity'), true);
});

test('deriveRibbonProps turns a blocked connection into Check now', async () => {
  const { deriveRibbonProps, RIBBON_ACTIONS, RIBBON_KINDS } = await import(
    '../src/renderer/components/StatusRibbon.mjs'
  );
  const props = deriveRibbonProps({
    connection: { state: 'blocked', failureMessage: 'The Codex command is not installed.' },
  });
  assert.equal(props.kind, RIBBON_KINDS.BLOCKED);
  assert.equal(props.label, 'The Codex command is not installed.');
  assert.equal(props.primaryAction, RIBBON_ACTIONS.CHECK);
});

test('deriveRibbonProps offers Check now for an unchecked connection and stays calm when ready', async () => {
  const { deriveRibbonProps, RIBBON_ACTIONS, RIBBON_KINDS } = await import(
    '../src/renderer/components/StatusRibbon.mjs'
  );
  const unchecked = deriveRibbonProps({ connection: { state: 'not-checked' } });
  assert.equal(unchecked.primaryAction, RIBBON_ACTIONS.CHECK);

  const ready = deriveRibbonProps({ connection: { state: 'ready' } });
  assert.equal(ready.kind, RIBBON_KINDS.READY);
  assert.equal(ready.label, 'Ready');
  assert.equal(ready.primaryAction, null);
});

test('renders the ribbon into a real jsdom document and fires the action', async () => {
  jsdomGlobals();
  const { mountStatusRibbon, RIBBON_ACTIONS } = await import(
    '../src/renderer/components/StatusRibbon.mjs'
  );
  const host = document.getElementById('host');
  let fired = null;
  mountStatusRibbon(host, {
    kind: 'sign-in-required',
    tone: 'warning',
    label: 'Codex sign-in required',
    detail: 'Official sign-in is provider-owned.',
    primaryAction: RIBBON_ACTIONS.SIGN_IN,
    primaryType: 'signin',
    onPrimaryAction: () => { fired = RIBBON_ACTIONS.SIGN_IN; },
  });
  await tick();

  const ribbon = host.querySelector('.status-ribbon');
  assert.ok(ribbon, 'ribbon element is mounted');
  assert.equal(ribbon.getAttribute('data-tone'), 'warning');
  assert.equal(ribbon.getAttribute('role'), 'status');

  const label = host.querySelector('.status-ribbon__label');
  assert.equal(label.textContent, 'Codex sign-in required');

  const detail = host.querySelector('.status-ribbon__detail');
  assert.equal(detail.textContent, 'Official sign-in is provider-owned.');

  const action = host.querySelector('.status-ribbon__action');
  assert.equal(action.textContent, RIBBON_ACTIONS.SIGN_IN);
  assert.equal(action.getAttribute('data-action-type'), 'signin');

  action.click();
  assert.equal(fired, RIBBON_ACTIONS.SIGN_IN, 'clicking the action invokes the handler');
});

test('omits the action button when there is nothing actionable', async () => {
  jsdomGlobals();
  const { mountStatusRibbon } = await import('../src/renderer/components/StatusRibbon.mjs');
  const host = document.getElementById('host');
  mountStatusRibbon(host, {
    kind: 'ready',
    tone: 'success',
    label: 'Ready',
    primaryAction: null,
    primaryType: null,
  });
  await tick();
  assert.equal(host.querySelector('.status-ribbon__action'), null);
  assert.equal(host.querySelector('.status-ribbon__label').textContent, 'Ready');
});
