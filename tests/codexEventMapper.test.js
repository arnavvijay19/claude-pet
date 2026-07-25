'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapCodexEvent } = require('../src/agent/codexEventMapper.js');

test('maps documented completed Codex items to bounded public activity and a final agent response', () => {
  const command = mapCodexEvent({
    type: 'item.completed',
    item: { type: 'command_execution', command: 'git status --short', exit_code: 0, aggregated_output: 'secret=should-not-leak' },
  });
  assert.deepEqual(command.activity, {
    phase: 'running', kind: 'command', summary: 'Codex command completed',
    detail: 'secret=[REDACTED]', command: 'git status --short', exitCode: 0,
  });

  const file = mapCodexEvent({
    type: 'item.completed',
    item: { type: 'file_change', changes: [{ path: 'notes/result.txt', kind: 'update' }] },
  });
  assert.deepEqual(file.activity, {
    phase: 'running', kind: 'file', summary: 'Codex modified notes/result.txt', path: 'notes/result.txt', operation: 'modify',
  });

  const message = mapCodexEvent({ type: 'item.completed', item: { type: 'agent_message', text: 'Finished safely.' } });
  assert.deepEqual(message, {
    activity: { phase: 'responding', kind: 'message', summary: 'Codex response ready' }, responseText: 'Finished safely.',
  });
});

test('excludes hidden reasoning and rejects malformed or unknown Codex events', () => {
  assert.equal(mapCodexEvent({ type: 'item.completed', item: { type: 'reasoning', text: 'hidden chain of thought' } }), null);
  assert.equal(mapCodexEvent({ type: 'thread.started', thread_id: 'thread_1' }).activity.kind, 'status');
  assert.throws(() => mapCodexEvent({ type: 'item.completed', item: { type: 'command_execution', command: 'x' } }), { code: 'PROVIDER_OUTPUT_INVALID' });
  assert.throws(() => mapCodexEvent({ type: 'made.up' }), { code: 'PROVIDER_OUTPUT_INVALID' });
});
