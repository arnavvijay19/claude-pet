'use strict';

// Preact RunCard / Trace component tests (Phase 3 Task 3). Renders the real
// Preact + htm components into a jsdom document and asserts on the resulting DOM.
// jsdom is a devDependency only (pruned from the package).

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
  goal: { id: 't1', text: 'Fix the bug', createdAt: 't1', role: 'user' },
  answer: {
    id: 't2', text: 'Fixed it.', createdAt: 't2', role: 'agent',
    agentName: 'Rex', providerLabel: 'Codex', model: 'codex-latest',
  },
  trace: {
    steps: 3,
    filesChanged: 2,
    durationMs: 0,
    items: [
      { id: 'evt-0', kind: 'file', operation: 'modify', path: 'src/app.js', label: 'Modified src/app.js' },
      { id: 'evt-1', kind: 'command', command: 'git status', exitCode: 0, label: 'git status' },
      {
        id: 'evt-2', kind: 'file', operation: 'modify', path: 'a.txt', label: 'Modified a.txt',
        diffLines: [
          { type: 'meta', text: '--- a.txt' },
          { type: 'add', text: '+new' },
          { type: 'del', text: '-old' },
        ],
      },
    ],
  },
};

test('mountRunCard renders goal, answer, and a collapsed trace summary', async () => {
  jsdomGlobals();
  const { mountRunCard } = await import('../src/renderer/components/RunCard.mjs');
  const host = document.getElementById('host');
  mountRunCard(host, { ...card, expanded: false });
  await tick();

  const el = host.querySelector('.run-card');
  assert.ok(el, 'run card is mounted');
  assert.equal(el.getAttribute('data-run-id'), 't1');
  assert.equal(host.querySelector('.run-card__goal-text').textContent, 'Fix the bug');
  assert.equal(host.querySelector('.run-card__answer-text').textContent, 'Fixed it.');
  assert.equal(host.querySelector('.run-card__byline--agent').textContent, 'Rex · Codex · codex-latest');

  const summary = host.querySelector('.trace-summary');
  assert.ok(summary, 'collapsed trace summary present');
  assert.equal(summary.getAttribute('aria-expanded'), 'false');
  assert.equal(summary.querySelector('.trace-summary__label').textContent, '3 steps · 2 files changed');
  assert.equal(host.querySelector('.trace-list'), null, 'trace list hidden while collapsed');
});

test('mountRunCard reveals the trace list, exit code, and diff lines when expanded', async () => {
  jsdomGlobals();
  const { mountRunCard } = await import('../src/renderer/components/RunCard.mjs');
  const host = document.getElementById('host');
  mountRunCard(host, { ...card, expanded: true });
  await tick();

  assert.equal(host.querySelector('.trace-summary').getAttribute('aria-expanded'), 'true');
  const list = host.querySelector('.trace-list');
  assert.ok(list, 'expanded trace list present');
  const command = host.querySelector('.trace-item--command');
  assert.equal(command.querySelector('.trace-item__command').textContent, 'git status');
  assert.equal(command.querySelector('.trace-item__exit--ok').textContent, 'exit 0');
  assert.equal(host.querySelector('.diff__line--add').textContent, '+new');
  assert.equal(host.querySelector('.diff__line--del').textContent, '-old');
});

test('clicking the trace summary fires the toggle handler', async () => {
  jsdomGlobals();
  const { mountRunCard } = await import('../src/renderer/components/RunCard.mjs');
  const host = document.getElementById('host');
  let fired = 0;
  mountRunCard(host, { ...card, expanded: false, onToggleTrace: () => { fired += 1; } });
  await tick();
  host.querySelector('.trace-summary').click();
  assert.equal(fired, 1, 'toggle handler invoked on summary click');
});

test('TraceSummary and TraceList render standalone', async () => {
  jsdomGlobals();
  const { h } = await import('../src/renderer/vendor/preact.mjs');
  const { render } = await import('../src/renderer/vendor/preact.mjs');
  const htm = (await import('../src/renderer/vendor/htm.mjs')).default;
  const { TraceSummary, TraceList } = await import('../src/renderer/components/Trace.mjs');
  const html = htm.bind(h);
  const host = document.getElementById('host');

  render(html`<${TraceSummary} summary="2 steps" expanded=${false} />`, host);
  await tick();
  assert.equal(host.querySelector('.trace-summary__label').textContent, '2 steps');
  assert.equal(host.querySelector('.trace-summary').getAttribute('aria-expanded'), 'false');

  render(html`<${TraceList} items=${card.trace.items} />`, host);
  await tick();
  assert.equal(host.querySelectorAll('.trace-item').length, 3);
});
