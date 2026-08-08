'use strict';

// Live run-card controller tests (Phase 3 Task 3). The live main window renders run
// cards with vanilla DOM (no Preact at runtime), so this exercises the same
// createElement path the browser uses, via jsdom.

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

const snapshot = {
  agents: [{ id: 'a1', name: 'Rex' }],
  connections: [{ executorType: 'codex', modelId: 'codex-latest', label: 'Codex' }],
  turns: [
    { id: 't1', role: 'user', agentId: 'a1', text: 'Fix the bug', createdAt: 't1' },
    {
      id: 't2', role: 'assistant', agentId: 'a1', provider: 'codex', model: 'codex-latest',
      text: 'Fixed it.', changedFiles: ['src/app.js'], createdAt: 't2',
    },
  ],
  activity: {
    events: [
      { kind: 'file', operation: 'modify', path: 'src/app.js', summary: 'Modified src/app.js' },
      { kind: 'command', command: 'git status', exitCode: 0, summary: 'git status' },
      {
        kind: 'file', operation: 'modify', path: 'src/app.js', summary: 'Modified src/app.js',
        diff: '--- a.txt\n+++ b.txt\n@@ -1 +1 @@\n-old\n+new',
      },
    ],
  },
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('createRunCardHost renders a run card with goal, answer, and collapsed trace summary', () => {
  jsdomGlobals();
  const { createRunCardHost, formatTraceSummary } = require('../src/app/runCardController.js');
  const host = document.getElementById('host');
  const controller = createRunCardHost(host, { expandedStore: new Set() });
  controller.update(snapshot);
  // nothing async in vanilla render; tick for safety
  void tick;

  const card = host.querySelector('.run-card');
  assert.ok(card, 'a run card is rendered');
  assert.equal(card.getAttribute('data-run-id'), 't1');
  assert.equal(host.querySelector('.run-card__goal-text').textContent, 'Fix the bug');
  assert.equal(host.querySelector('.run-card__answer-text').textContent, 'Fixed it.');
  assert.equal(host.querySelector('.run-card__byline--agent').textContent, 'Rex · Codex · codex-latest');

  const summary = host.querySelector('.trace-summary');
  assert.ok(summary, 'collapsed trace summary is present');
  assert.equal(summary.getAttribute('aria-expanded'), 'false');
  // 3 steps, 2 file operations (src/app.js is modified twice in the sample)
  assert.equal(summary.querySelector('.trace-summary__label').textContent, '3 steps · 2 files changed');
  // collapsed: no expanded list yet
  assert.equal(host.querySelector('.trace-list'), null);
});

test('expanding a trace summary reveals the command exit code and a colored diff', () => {
  jsdomGlobals();
  const { createRunCardHost } = require('../src/app/runCardController.js');
  const host = document.getElementById('host');
  const store = new Set();
  const controller = createRunCardHost(host, { expandedStore: store });
  controller.update(snapshot);

  const summary = host.querySelector('.trace-summary');
  summary.click();
  assert.equal(store.has('t1'), true, 'expansion state is recorded');
  // The controller re-renders on toggle, so re-query the live summary node.
  const liveSummary = host.querySelector('.trace-summary');
  assert.equal(liveSummary.getAttribute('aria-expanded'), 'true');

  const list = host.querySelector('.trace-list');
  assert.ok(list, 'expanded trace list is rendered');
  const command = host.querySelector('.trace-item--command');
  assert.equal(command.querySelector('.trace-item__command').textContent, 'git status');
  assert.equal(command.querySelector('.trace-item__exit--ok').textContent, 'exit 0');

  const diff = host.querySelector('.diff');
  assert.ok(diff, 'inline diff is rendered');
  assert.equal(diff.querySelector('.diff__line--add').textContent, '+new');
  assert.equal(diff.querySelector('.diff__line--del').textContent, '-old');
});

test('collapsing the trace restores the collapsed summary and clears expansion state', () => {
  jsdomGlobals();
  const { createRunCardHost } = require('../src/app/runCardController.js');
  const host = document.getElementById('host');
  const store = new Set(['t1']);
  const controller = createRunCardHost(host, { expandedStore: store });
  controller.update(snapshot);

  assert.ok(host.querySelector('.trace-list'), 'starts expanded');
  host.querySelector('.trace-summary').click();
  assert.equal(store.has('t1'), false, 'expansion state is cleared');
  assert.equal(host.querySelector('.trace-list'), null, 'list is removed on collapse');
});

test('an empty conversation shows the empty-copy prompt', () => {
  jsdomGlobals();
  const { createRunCardHost } = require('../src/app/runCardController.js');
  const host = document.getElementById('host');
  const controller = createRunCardHost(host, { expandedStore: new Set() });
  controller.update({ agents: [], turns: [], activity: { events: [] } });
  const empty = host.querySelector('.empty-copy');
  assert.ok(empty, 'empty-copy prompt is shown');
  assert.equal(host.querySelector('.run-card'), null);
});
