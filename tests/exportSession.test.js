'use strict';

// Pure export-session tests (Phase 3 Task 8 / design 3.8). Exercises the framework-
// free markdown builder, filename sanitization, and workspace derivation. jsdom-free
// so it runs in any Node environment, matching the always-green guard philosophy.

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildExportSession, sanitizeFilename, sessionTitle, sessionWorkspace } = require('../src/renderer/exportSession.js');

const snapshot = {
  agents: [{ id: 'a1', name: 'Atlas' }],
  sessions: [
    { id: 's1', title: 'Refactor Parser', workspacePath: '/proj', participants: [{ agentId: 'a1', connectionId: 'c1' }] },
  ],
  selection: { sessionId: 's1', agentId: 'a1' },
  session: { id: 's1', title: 'Refactor Parser', workspacePath: '/proj' },
  turns: [
    { role: 'user', id: 't1', text: 'Refactor the parser' },
    { role: 'assistant', id: 't2', text: 'Done refactoring the parser.' },
    { role: 'user', id: 't3', text: 'Add a test' },
    { role: 'assistant', id: 't4', text: 'Added parser.test.js.' },
  ],
  activity: {
    events: [
      { kind: 'tool', toolName: 'grep', summary: 'Used grep' },
      { kind: 'command', command: 'git status --short', exitCode: 0, summary: 'Ran git' },
      { kind: 'file', operation: 'modify', path: 'parser.js', diff: '--- a/parser.js\n+++ b/parser.js\n@@ -1 +1 @@\n-old\n+new', summary: 'Modified parser.js' },
      { kind: 'usage', usage: { inputTokens: 12, outputTokens: 8, cachedTokens: 0, totalTokens: 20 } },
    ],
  },
};

test('buildExportSession returns the four-part shape', () => {
  const result = buildExportSession(snapshot);
  assert.equal(typeof result.title, 'string');
  assert.equal(typeof result.filename, 'string');
  assert.equal(result.filename.endsWith('.md'), true);
  assert.equal(typeof result.workspacePath, 'string');
  assert.equal(typeof result.markdown, 'string');
  assert.match(result.markdown, /# Refactor Parser/);
});

test('markdown includes goals, steps, diffs, and answers', () => {
  const md = buildExportSession(snapshot).markdown;
  assert.match(md, /## Goals/);
  assert.match(md, /- Refactor the parser/);
  assert.match(md, /- Add a test/);
  assert.match(md, /## Steps/);
  assert.match(md, /\[tool\] grep/);
  assert.match(md, /\[command\] git status --short \(exit 0\)/);
  assert.match(md, /## Diffs/);
  assert.match(md, /```diff/);
  assert.match(md, /parser\.js/);
  assert.match(md, /## Answers/);
  assert.match(md, /Done refactoring the parser\./);
  assert.match(md, /Added parser\.test\.js\./);
});

test('usage steps render the token breakdown', () => {
  const md = buildExportSession(snapshot).markdown;
  assert.match(md, /input 12 · output 8 · cached 0 · total 20/);
});

test('an exported-at timestamp is embedded and deterministic when passed via now', () => {
  const md = buildExportSession(snapshot, { now: '2026-08-08T12:00:00.000Z' }).markdown;
  assert.match(md, /_Exported 2026-08-08T12:00:00\.000Z_/);
  // Same input + same now => identical output (stable, testable).
  const md2 = buildExportSession(snapshot, { now: '2026-08-08T12:00:00.000Z' }).markdown;
  assert.equal(md, md2);
});

test('empty snapshot yields a header with empty-state notes and a safe fallback filename', () => {
  const result = buildExportSession({});
  assert.match(result.markdown, /# Session/);
  assert.match(result.markdown, /_No goals recorded\._/);
  assert.match(result.markdown, /_No activity recorded\._/);
  assert.equal(result.filename, 'Session.md');
  assert.equal(result.workspacePath, null);
  assert.equal(result.title, 'Session');
});

test('filename sanitization strips path separators and caps length', () => {
  assert.equal(sanitizeFilename('My/Project: Final', 'session'), 'My_Project_Final');
  assert.equal(sanitizeFilename('  ', 'fallback'), 'fallback');
  assert.equal(sanitizeFilename('a/b*c?d<e>f|g', 'session'), 'a_b_c_d_e_f_g');
  const long = 'x'.repeat(200);
  assert.equal(sanitizeFilename(long, 'session').length, 80);
  assert.equal(sanitizeFilename('', 'session'), 'session');
});

test('title and workspace resolve from selection when session is partial', () => {
  const partial = {
    selection: { sessionId: 's2' },
    sessions: [{ id: 's2', title: 'Play', workspacePath: '/play' }],
  };
  assert.equal(sessionTitle(partial), 'Play');
  assert.equal(sessionWorkspace(partial), '/play');
});

test('missing events/diffs do not crash and omit the Diffs section', () => {
  const result = buildExportSession({ session: { title: 'Empty' }, turns: [], activity: { events: [] } });
  assert.match(result.markdown, /_No goals recorded\._/);
  assert.match(result.markdown, /_No activity recorded\._/);
  assert.doesNotMatch(result.markdown, /## Diffs/);
  assert.doesNotMatch(result.markdown, /## Answers/);
});
