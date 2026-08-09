'use strict';

// Preact CommandPalette component tests (Phase 3 Task 7 / design 3.7). Renders the real
// Preact + htm component into a jsdom document and asserts on the resulting DOM. jsdom is a
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
  ],
  activity: { events: [] },
  run: { busy: false },
};

test('mountCommandPalette renders the derived commands from the shared model', async () => {
  jsdomGlobals();
  const { mountCommandPalette } = await import('../src/renderer/components/CommandPalette.mjs');
  const commandPaletteModelMod = (await import('../src/renderer/components/commandPaletteModel.js')).default;
  const { buildCommands } = commandPaletteModelMod;
  const host = document.getElementById('host');

  const commands = buildCommands(snapshot);
  mountCommandPalette(host, { commands, query: '', selectedIndex: 0 });
  await tick();

  const list = host.querySelector('.command-palette__list');
  assert.ok(list, 'listbox present');
  assert.equal(list.getAttribute('role'), 'listbox');
  const items = host.querySelectorAll('.command-palette__item');
  assert.equal(items.length, commands.length, 'one item per derived command');
  // The first command is the switch-agent target "Nova"; detail states the exact target.
  assert.equal(items[0].querySelector('.command-palette__item-title').textContent, 'Switch agent');
  assert.equal(items[0].querySelector('.command-palette__item-detail').textContent, 'Nova');
  assert.equal(items[0].getAttribute('aria-selected'), 'true', 'first item is selected by default');
});

test('filtering via query narrows the rendered items', async () => {
  jsdomGlobals();
  const { mountCommandPalette } = await import('../src/renderer/components/CommandPalette.mjs');
  const commandPaletteModelMod = (await import('../src/renderer/components/commandPaletteModel.js')).default;
  const { buildCommands, filterCommands } = commandPaletteModelMod;
  const host = document.getElementById('host');

  const commands = buildCommands(snapshot);
  const visible = filterCommands(commands, 'export');
  mountCommandPalette(host, { commands, query: 'export', selectedIndex: 0 });
  await tick();

  assert.equal(host.querySelectorAll('.command-palette__item').length, visible.length);
  assert.equal(host.querySelector('.command-palette__item-title').textContent, 'Export session');
});

test('clicking an item fires onSelect with the command', async () => {
  jsdomGlobals();
  const { mountCommandPalette } = await import('../src/renderer/components/CommandPalette.mjs');
  const commandPaletteModelMod = (await import('../src/renderer/components/commandPaletteModel.js')).default;
  const { buildCommands } = commandPaletteModelMod;
  const host = document.getElementById('host');

  const commands = buildCommands(snapshot);
  const selected = [];
  mountCommandPalette(host, { commands, query: '', selectedIndex: 0, onSelect: (command) => selected.push(command) });
  await tick();

  host.querySelectorAll('.command-palette__item')[1].click();
  assert.equal(selected.length, 1);
  assert.equal(selected[0].kind, 'switch-session');
});
