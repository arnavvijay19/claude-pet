'use strict';

// Pure run-card model tests (Phase 3 Task 3). No DOM: exercises the framework-free
// brain that both the live vanilla-DOM controller and the Preact RunCard/Trace
// components derive their props from.

const {
  TRACE_KINDS,
  mapEventToTrace,
  deriveTraceProps,
  formatDuration,
  formatTraceSummary,
  parseDiffLine,
  providerLabel,
  buildRunCards,
  canReopenForEdits,
} = require('../src/renderer/components/runCardModel.js');

const test = require('node:test');
const assert = require('node:assert/strict');

const FILE_EVENT = { kind: 'file', operation: 'modify', path: 'src/app.js', summary: 'Modified src/app.js' };
const CMD_EVENT = { kind: 'command', command: 'git status', exitCode: 0, summary: 'git status' };
const CMD_FAIL = { kind: 'command', command: 'exit 1', exitCode: 1 };
const TOOL_EVENT = { kind: 'tool', toolName: 'edit', summary: 'Used edit' };
const PERM_EVENT = { kind: 'permission', permission: 'fs.write', decision: 'allowed' };
const NET_EVENT = { kind: 'network', destination: 'https://api.openai.com', summary: 'network' };
const USAGE_EVENT = { kind: 'usage', usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0, totalTokens: 15 } };
const DIFF_EVENT = {
  kind: 'file', operation: 'modify', path: 'a.txt', summary: 'Modified a.txt',
  diff: '--- a.txt\n+++ b.txt\n@@ -1 +1 @@\n-old\n+new',
};

test('mapEventToTrace normalizes a file event with operation label', () => {
  const item = mapEventToTrace(FILE_EVENT, 0);
  assert.equal(item.kind, TRACE_KINDS.FILE);
  assert.equal(item.operation, 'modify');
  assert.equal(item.label, 'Modified src/app.js');
  assert.equal(item.diffLines, null);
});

test('mapEventToTrace normalizes a command event with exit code', () => {
  const ok = mapEventToTrace(CMD_EVENT, 1);
  assert.equal(ok.kind, TRACE_KINDS.COMMAND);
  assert.equal(ok.command, 'git status');
  assert.equal(ok.exitCode, 0);
  const fail = mapEventToTrace(CMD_FAIL, 2);
  assert.equal(fail.exitCode, 1);
});

test('mapEventToTrace parses an inline unified diff into typed lines', () => {
  const item = mapEventToTrace(DIFF_EVENT, 3);
  assert.ok(Array.isArray(item.diffLines));
  assert.deepEqual(item.diffLines.map((line) => line.type), ['meta', 'meta', 'meta', 'del', 'add']);
  assert.equal(item.diffLines[3].text, '-old');
  assert.equal(item.diffLines[4].text, '+new');
});

test('mapEventToTrace tolerates unknown kinds and missing events', () => {
  const unknown = mapEventToTrace({ kind: 'message', summary: 'Hello' }, 4);
  assert.equal(unknown.kind, TRACE_KINDS.MESSAGE);
  const missing = mapEventToTrace(null, 5);
  assert.equal(missing.kind, TRACE_KINDS.UNKNOWN);
});

test('deriveTraceProps counts steps and changed files', () => {
  const trace = deriveTraceProps([FILE_EVENT, CMD_EVENT, TOOL_EVENT, FILE_EVENT]);
  assert.equal(trace.steps, 4);
  assert.equal(trace.filesChanged, 2);
  assert.equal(trace.items.length, 4);
});

test('formatTraceSummary reads "N steps · M files changed · duration"', () => {
  const trace = deriveTraceProps([FILE_EVENT, CMD_EVENT]);
  assert.equal(formatTraceSummary(trace), '2 steps · 1 file changed');
  const withDuration = deriveTraceProps([{ kind: 'command', command: 'x', exitCode: 0, durationMs: 12340 }]);
  assert.equal(formatTraceSummary(withDuration), '1 step · 12s');
});

test('formatDuration rounds seconds and composes minutes', () => {
  assert.equal(formatDuration(0), '');
  assert.equal(formatDuration(5000), '5s');
  assert.equal(formatDuration(60000), '1m');
  assert.equal(formatDuration(95000), '1m 35s');
  assert.equal(formatDuration(-3), '');
});

test('parseDiffLine classifies meta/add/del/ctx rows', () => {
  assert.equal(parseDiffLine('@@ -1 +1 @@').type, 'meta');
  assert.equal(parseDiffLine('+added').type, 'add');
  assert.equal(parseDiffLine('-removed').type, 'del');
  assert.equal(parseDiffLine(' context').type, 'ctx');
});

test('providerLabel resolves the connection label for a turn', () => {
  const snapshot = {
    connections: [{ executorType: 'codex', modelId: 'codex-latest', label: 'Codex' }],
  };
  assert.equal(providerLabel(snapshot, { provider: 'codex', model: 'codex-latest' }), 'Codex');
  assert.equal(providerLabel(snapshot, { provider: 'claude-code-cli' }), 'claude-code-cli');
});

test('buildRunCards groups a user goal + agent answer into one run and attaches the matching file event', () => {
  const snapshot = {
    agents: [{ id: 'a1', name: 'Rex' }],
    connections: [{ executorType: 'codex', modelId: 'codex-latest', label: 'Codex' }],
    turns: [
      { id: 't1', role: 'user', agentId: 'a1', text: 'Fix the bug', createdAt: '2026-01-01T00:00:00Z' },
      {
        id: 't2', role: 'assistant', agentId: 'a1', provider: 'codex', model: 'codex-latest',
        text: 'Fixed it.', changedFiles: ['src/app.js'], createdAt: '2026-01-01T00:01:00Z',
      },
    ],
    activity: { events: [FILE_EVENT, CMD_EVENT] },
  };
  const cards = buildRunCards(snapshot);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].goal.text, 'Fix the bug');
  assert.equal(cards[0].answer.text, 'Fixed it.');
  assert.equal(cards[0].answer.agentName, 'Rex');
  assert.equal(cards[0].answer.providerLabel, 'Codex');
  assert.equal(cards[0].trace.steps, 2);
  assert.equal(cards[0].trace.filesChanged, 1);
});

test('buildRunCards distributes an unmatched event to the most recent run and returns [] for empty input', () => {
  const snapshot = {
    agents: [{ id: 'a1', name: 'Rex' }],
    turns: [
      { id: 't1', role: 'user', agentId: 'a1', text: 'First', createdAt: 't1' },
      { id: 't2', role: 'assistant', agentId: 'a1', text: 'Done', changedFiles: [], createdAt: 't2' },
      { id: 't3', role: 'user', agentId: 'a1', text: 'Second', createdAt: 't3' },
    ],
    activity: { events: [TOOL_EVENT, PERM_EVENT] },
  };
  const cards = buildRunCards(snapshot);
  assert.equal(cards.length, 2);
  // Two events with no path attach to the most recent run (the second one).
  assert.equal(cards[1].trace.steps, 2);
  assert.equal(cards[0].trace.steps, 0);

  assert.deepEqual(buildRunCards(null), []);
  assert.deepEqual(buildRunCards({}), []);
});

test('canReopenForEdits: only a card with a non-empty goal text is reopenable (Phase 3 Task 6)', () => {
  assert.equal(canReopenForEdits(null), false);
  assert.equal(canReopenForEdits({}), false);
  assert.equal(canReopenForEdits({ goal: null }), false);
  assert.equal(canReopenForEdits({ goal: { text: '' } }), false);
  assert.equal(canReopenForEdits({ goal: { text: '   ' } }), false);
  assert.equal(canReopenForEdits({ goal: { text: 'Fix the bug' } }), true);
  // An agent-only turn (no goal) is not reopenable on its own.
  assert.equal(canReopenForEdits({ goal: null, hasAnswer: true }), false);
});
