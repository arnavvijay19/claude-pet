'use strict';

// Pure command-palette model tests (Phase 3 Task 7 / design 3.7). Exercises the
// framework-free derivation, filtering, navigation, and markdown-export helpers.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCommands,
  filterCommands,
  moveSelection,
  exportSessionMarkdown,
  latestRunDiff,
  activeSessionId,
  activeAgentId,
} = require('../src/renderer/components/commandPaletteModel.js');

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

test('buildCommands derives every action group with exact-target details', () => {
  const commands = buildCommands(snapshot);
  const kinds = commands.map((command) => command.kind);
  assert.deepEqual(
    kinds,
    ['switch-agent', 'switch-session', 'switch-connection', 're-run', 're-run', 'open-folder', 'copy-diff', 'export-session'],
    'all command groups appear in order',
  );
  for (const command of commands) {
    assert.ok(command.id && command.title && command.detail && command.action, 'every command has id/title/detail/action');
  }
});

test('switch-agent targets only other session participants and resolves select-participant', () => {
  const command = buildCommands(snapshot).find((item) => item.kind === 'switch-agent');
  assert.equal(command.detail, 'Nova');
  assert.equal(command.action.kind, 'intent');
  assert.deepEqual(command.action.intent, { type: 'select-participant', data: { sessionId: 's1', agentId: 'a2' } });
});

test('switch-connection uses set-participant-connection for the active participant', () => {
  const command = buildCommands(snapshot).find((item) => item.kind === 'switch-connection');
  assert.equal(command.detail, 'Claude Code · opus');
  assert.deepEqual(command.action.intent, { type: 'set-participant-connection', data: { sessionId: 's1', agentId: 'a1', connectionId: 'c2' } });
});

test('switch-session offers the non-active session', () => {
  const command = buildCommands(snapshot).find((item) => item.kind === 'switch-session');
  assert.equal(command.detail, 'Play');
  assert.deepEqual(command.action.intent, { type: 'select-session', data: { sessionId: 's2' } });
});

test('re-run with edits carries the exact past goal text, most recent first', () => {
  const reruns = buildCommands(snapshot).filter((item) => item.kind === 're-run');
  assert.deepEqual(reruns.map((item) => item.action.text), ['Add a test', 'Refactor the parser']);
  assert.equal(reruns[0].action.kind, 'reopen-goal');
});

test('open-folder, copy-diff, and export-session commands are present with resolved targets', () => {
  const byKind = {};
  for (const command of buildCommands(snapshot)) byKind[command.kind] = command;
  assert.equal(byKind['open-folder'].action.kind, 'open-folder');
  assert.equal(byKind['open-folder'].action.path, '/proj');
  assert.equal(byKind['copy-diff'].action.kind, 'copy-diff');
  assert.match(byKind['copy-diff'].action.text, /parser\.js/);
  assert.equal(byKind['export-session'].action.kind, 'export-session');
  assert.equal(byKind['export-session'].action.sessionId, 's1');
});

test('filterCommands ranks title prefix above substring, and empty query keeps order', () => {
  const commands = buildCommands(snapshot);
  const exported = filterCommands(commands, 'export');
  assert.equal(exported.length, 1);
  assert.equal(exported[0].kind, 'export-session');

  const switches = filterCommands(commands, 'switch');
  assert.deepEqual(switches.map((item) => item.kind), ['switch-agent', 'switch-session', 'switch-connection']);

  assert.equal(filterCommands(commands, '').length, commands.length, 'empty query returns all');
  assert.equal(filterCommands(commands, 'zzz').length, 0, 'no match returns empty');
});

test('moveSelection wraps around both ends and returns -1 for empty', () => {
  const items = ['a', 'b', 'c'];
  assert.equal(moveSelection(items, 0, 1), 1);
  assert.equal(moveSelection(items, 2, 1), 0, 'wraps past the end');
  assert.equal(moveSelection(items, 0, -1), 2, 'wraps before the start');
  assert.equal(moveSelection([], 0, 1), -1, 'empty list has no selection');
});

test('exportSessionMarkdown includes goals, answers, and diffs', () => {
  const md = exportSessionMarkdown(snapshot);
  assert.match(md, /# Work/);
  assert.match(md, /## Goal/);
  assert.match(md, /Refactor the parser/);
  assert.match(md, /### Answer/);
  assert.match(md, /Done\./);
  assert.match(md, /diff/);
  assert.match(md, /parser\.js/);
});

test('latestRunDiff concatenates file diffs from activity events', () => {
  assert.match(latestRunDiff(snapshot), /parser\.js/);
  assert.equal(latestRunDiff({ activity: { events: [] } }), '', 'no diffs yields empty string');
});

test('active accessor helpers resolve from selection and agent', () => {
  assert.equal(activeSessionId(snapshot), 's1');
  assert.equal(activeAgentId(snapshot), 'a1');
  assert.equal(activeSessionId({}), null);
});
