'use strict';

// Live command-palette controller tests (Phase 3 Task 7). Exercises the same
// createElement path the no-bundler Electron renderer uses, via jsdom.

const { JSDOM } = require('jsdom');
const test = require('node:test');
const assert = require('node:assert/strict');

function jsdomGlobals() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.HTMLElement = window.HTMLElement;
  global.Node = window.Node;
  return dom;
}

const snapshot = {
  agents: [
    { id: 'a1', name: 'Atlas', status: 'idle' },
    { id: 'a2', name: 'Nova', status: 'idle' },
  ],
  sessions: [
    { id: 's1', title: 'Work', workspacePath: '/proj', participants: [{ agentId: 'a1', connectionId: 'c1' }, { agentId: 'a2', connectionId: 'c1' }] },
    { id: 's2', title: 'Play', workspacePath: '/play', participants: [{ agentId: 'a1', connectionId: 'c1' }] },
  ],
  connections: [
    { id: 'c1', executorType: 'codex', label: 'Codex', workspacePath: '/proj', permissionProfile: 'workspace', modelId: 'gpt' },
    { id: 'c2', executorType: 'claude-code-cli', label: 'Claude Code', workspacePath: '/proj2', permissionProfile: 'workspace', modelId: 'opus' },
  ],
  selection: { sessionId: 's1', agentId: 'a1' },
  activeAgent: { id: 'a1', name: 'Atlas' },
  activeAgentProfile: null,
  session: { id: 's1', title: 'Work', workspacePath: '/proj', participants: [{ agentId: 'a1', connectionId: 'c1' }, { agentId: 'a2', connectionId: 'c1' }], activeAgentId: 'a1' },
  turns: [
    { role: 'user', id: 't1', text: 'Refactor the parser', agentId: 'a1', provider: 'codex', model: 'gpt', changedFiles: [], createdAt: 'now' },
    { role: 'assistant', id: 't2', text: 'Done.', agentId: 'a1', provider: 'codex', model: 'gpt', changedFiles: [], createdAt: 'now' },
    { role: 'user', id: 't3', text: 'Add a test', agentId: 'a1', provider: 'codex', model: 'gpt', changedFiles: [], createdAt: 'now' },
  ],
  activity: { events: [{ kind: 'file', operation: 'modify', path: 'parser.js', diff: '--- a/parser.js\n+++ b/parser.js\n@@ -1 +1 @@\n-old\n+new' }] },
  run: { busy: false },
};

test('open reveals the overlay, populates the list, and focuses the input', () => {
  jsdomGlobals();
  const { createCommandPalette } = require('../src/app/commandPaletteController.js');
  const executed = [];
  const palette = createCommandPalette({ mount: document.body, onExecute: (command) => executed.push(command) });

  assert.equal(palette.isOpen(), false);
  palette.open(snapshot);
  assert.equal(palette.isOpen(), true);

  const overlay = document.querySelector('.command-palette-overlay');
  assert.equal(overlay.hidden, false);
  const items = document.querySelectorAll('.command-palette__item');
  assert.equal(items.length, 8, 'all derived commands render');
  assert.equal(document.activeElement, document.querySelector('.command-palette__input'), 'input is focused');

  palette.close();
  assert.equal(palette.isOpen(), false);
  assert.equal(document.querySelector('.command-palette-overlay').hidden, true);
});

test('typing filters, and Enter executes the selected command then closes', () => {
  jsdomGlobals();
  const { createCommandPalette } = require('../src/app/commandPaletteController.js');
  const executed = [];
  const palette = createCommandPalette({ mount: document.body, onExecute: (command) => executed.push(command) });
  palette.open(snapshot);

  const input = document.querySelector('.command-palette__input');
  input.value = 'export';
  input.dispatchEvent(new window.Event('input'));

  const items = document.querySelectorAll('.command-palette__item');
  assert.equal(items.length, 1, 'query narrows the list');
  assert.equal(items[0].dataset.commandId, 'export-session', 'only the export command remains');

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.equal(executed.length, 1, 'Enter executed exactly one command');
  assert.equal(executed[0].id, 'export-session');
  assert.equal(palette.isOpen(), false, 'palette closed after execution');
});

test('Arrow / j / k navigate with wrap-around', () => {
  jsdomGlobals();
  const { createCommandPalette } = require('../src/app/commandPaletteController.js');
  const palette = createCommandPalette({ mount: document.body, onExecute: () => {} });
  palette.open(snapshot);

  assert.equal(palette._getSelectedIndex(), 0);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'j' }));
  assert.equal(palette._getSelectedIndex(), 1, 'j moves down');

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp' }));
  assert.equal(palette._getSelectedIndex(), 0, 'ArrowUp moves back');

  // From the first item, ArrowUp wraps to the last.
  const last = palette._getVisible().length - 1;
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp' }));
  assert.equal(palette._getSelectedIndex(), last, 'ArrowUp wraps to the last item');

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
  assert.equal(palette._getSelectedIndex(), 0, 'ArrowDown wraps to the first item');
});

test('Escape closes the palette without executing', () => {
  jsdomGlobals();
  const { createCommandPalette } = require('../src/app/commandPaletteController.js');
  const executed = [];
  const palette = createCommandPalette({ mount: document.body, onExecute: (command) => executed.push(command) });
  palette.open(snapshot);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(palette.isOpen(), false);
  assert.equal(executed.length, 0, 'Escape does not execute a command');
});

test('clicking an item executes that command', () => {
  jsdomGlobals();
  const { createCommandPalette } = require('../src/app/commandPaletteController.js');
  const executed = [];
  const palette = createCommandPalette({ mount: document.body, onExecute: (command) => executed.push(command) });
  palette.open(snapshot);
  document.querySelectorAll('.command-palette__item')[2].click();
  assert.equal(executed.length, 1);
  assert.equal(executed[0].kind, 'switch-connection');
});

test('createCommandPalette throws without an onExecute callback', () => {
  jsdomGlobals();
  const { createCommandPalette } = require('../src/app/commandPaletteController.js');
  assert.throws(() => createCommandPalette({ mount: document.body }), TypeError);
});
