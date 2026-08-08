'use strict';

// Live run-scrubber controller tests (Phase 3 Task 5). Exercises the same
// createElement path the no-bundler Electron renderer uses, via jsdom.

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

const card = {
  id: 't1',
  hasAnswer: true,
  trace: {
    steps: 3,
    filesChanged: 1,
    durationMs: 0,
    items: [
      { id: 'evt-0', kind: 'file', operation: 'modify', path: 'a.js', label: 'Modified a.js' },
      { id: 'evt-1', kind: 'command', command: 'git status', exitCode: 0, label: 'git status' },
      { id: 'evt-2', kind: 'command', command: 'npm test', exitCode: 0, output: '3 passing', label: 'npm test' },
    ],
  },
};

test('createScrubberHost renders the scrubber at the final step with all steps visible', () => {
  jsdomGlobals();
  const { createScrubberHost, isScrubbable } = require('../src/app/runScrubberController.js');
  assert.equal(isScrubbable(card), true);

  const host = document.getElementById('host');
  createScrubberHost(host, card);

  const group = host.querySelector('.scrubber');
  assert.ok(group, 'scrubber group exists');
  assert.equal(group.getAttribute('role'), 'group');
  assert.equal(group.getAttribute('aria-label'), 'Run step scrubber');

  const position = host.querySelector('.scrubber__position');
  assert.equal(position.textContent, 'All 3 steps');
  assert.equal(position.getAttribute('aria-live'), 'polite');

  assert.equal(host.querySelectorAll('.scrubber__list .trace-item').length, 3, 'all steps visible at the end');
  // At the final step, Next is disabled and Prev is enabled.
  assert.equal(host.querySelector('.scrubber__btn--next').disabled, true);
  assert.equal(host.querySelector('.scrubber__btn--prev').disabled, false);
  // Command output is surfaced for the third step.
  const out = host.querySelector('.trace-item__output');
  assert.ok(out, 'command output is rendered');
  assert.equal(out.textContent, '3 passing');
});

test('clicking Prev scrubs backward, shrinking the visible steps and enabling Next', () => {
  jsdomGlobals();
  const { createScrubberHost } = require('../src/app/runScrubberController.js');
  const host = document.getElementById('host');
  createScrubberHost(host, card);

  host.querySelector('.scrubber__btn--prev').click();
  assert.equal(host.querySelector('.scrubber__position').textContent, 'Step 2 of 3');
  assert.equal(host.querySelectorAll('.scrubber__list .trace-item').length, 2, 'one fewer step visible');
  assert.equal(host.querySelector('.scrubber__btn--next').disabled, false, 'Next enabled once not at the end');

  host.querySelector('.scrubber__btn--prev').click();
  assert.equal(host.querySelector('.scrubber__position').textContent, 'Step 1 of 3');
  assert.equal(host.querySelectorAll('.scrubber__list .trace-item').length, 1);
  assert.equal(host.querySelector('.scrubber__btn--prev').disabled, true, 'Prev disabled at the first step');
});

test('arrow keys scrub and update the live position label', () => {
  jsdomGlobals();
  const { createScrubberHost } = require('../src/app/runScrubberController.js');
  const host = document.getElementById('host');
  createScrubberHost(host, card);

  const group = host.querySelector('.scrubber');
  group.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  assert.equal(host.querySelector('.scrubber__position').textContent, 'Step 2 of 3');

  // Focus + ArrowRight moves forward again.
  const groupAfter = host.querySelector('.scrubber');
  groupAfter.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  assert.equal(host.querySelector('.scrubber__position').textContent, 'All 3 steps');
});

test('the scrubber store persists the cursor across re-creations', () => {
  jsdomGlobals();
  const { createScrubberHost } = require('../src/app/runScrubberController.js');
  const store = new Map();
  const host = document.getElementById('host');

  createScrubberHost(host, card, { store });
  host.querySelector('.scrubber__btn--prev').click();
  assert.equal(store.get('t1'), 1, 'cursor is persisted in the store');

  // A second host bound to the same store resumes at the persisted cursor.
  const host2 = document.getElementById('host');
  host2.replaceChildren();
  createScrubberHost(host2, card, { store });
  assert.equal(host2.querySelector('.scrubber__position').textContent, 'Step 2 of 3');
});

test('createScrubberHost throws without a host element', () => {
  jsdomGlobals();
  const { createScrubberHost } = require('../src/app/runScrubberController.js');
  assert.throws(() => createScrubberHost(null, card), TypeError);
});
