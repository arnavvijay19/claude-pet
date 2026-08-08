'use strict';

// Preact RunScrubber component tests (Phase 3 Task 5). Renders the real Preact +
// htm component into a jsdom document and asserts on the resulting DOM. jsdom is a
// devDependency only (pruned from the package).

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
  global.requestAnimationFrame = window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
  global.cancelAnimationFrame = window.cancelAnimationFrame || ((id) => clearTimeout(id));
  return dom;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

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

test('mountRunScrubber renders at the final step with all steps and command output', async () => {
  jsdomGlobals();
  const { mountRunScrubber } = await import('../src/renderer/components/RunScrubber.mjs');
  const host = document.getElementById('host');
  mountRunScrubber(host, { card });
  await tick();

  const group = host.querySelector('.scrubber');
  assert.ok(group, 'scrubber group is mounted');
  assert.equal(group.getAttribute('role'), 'group');
  assert.equal(host.querySelector('.scrubber__position').textContent, 'All 3 steps');
  assert.equal(host.querySelectorAll('.trace-item').length, 3, 'all steps visible at the end');
  assert.equal(host.querySelector('.scrubber__btn--next').disabled, true);
  const out = host.querySelector('.trace-item__output');
  assert.ok(out, 'command output is rendered');
  assert.equal(out.textContent, '3 passing');
});

test('clicking Prev scrubs backward to fewer cumulative steps', async () => {
  jsdomGlobals();
  const { mountRunScrubber } = await import('../src/renderer/components/RunScrubber.mjs');
  const host = document.getElementById('host');
  mountRunScrubber(host, { card });
  await tick();

  host.querySelector('.scrubber__btn--prev').click();
  await tick();

  assert.equal(host.querySelector('.scrubber__position').textContent, 'Step 2 of 3');
  assert.equal(host.querySelectorAll('.trace-item').length, 2);
  assert.equal(host.querySelector('.scrubber__btn--next').disabled, false);
});

test('a null or non-scrubbable card renders nothing', async () => {
  jsdomGlobals();
  const { mountRunScrubber } = await import('../src/renderer/components/RunScrubber.mjs');
  const host = document.getElementById('host');
  mountRunScrubber(host, { card: { id: 'x', hasAnswer: false, trace: { items: [] } } });
  await tick();
  assert.equal(host.querySelector('.scrubber'), null);
});
