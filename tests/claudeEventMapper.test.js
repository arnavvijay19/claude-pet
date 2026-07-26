'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapClaudeEvent } = require('../src/agent/claudeEventMapper.js');

test('maps safe Claude stream events through the activity sanitizer and preserves only the final response', () => {
  const tool = mapClaudeEvent({
    type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git status --short --token secret=abc' } }] },
  });
  assert.deepEqual(tool.activity, {
    phase: 'running', kind: 'tool', summary: 'Claude used Bash', toolName: 'Bash',
  });

  const result = mapClaudeEvent({ type: 'result', subtype: 'success', result: 'Finished with token=secret-value.' });
  assert.deepEqual(result, {
    activity: { phase: 'responding', kind: 'message', summary: 'Claude response ready' },
    responseText: 'Finished with token=[REDACTED]',
  });
});

test('excludes hidden thinking and maps permission denials without exposing provider text', () => {
  assert.equal(mapClaudeEvent({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hidden reasoning' }] } }), null);
  const denied = mapClaudeEvent({ type: 'result', subtype: 'error', result: 'permission denied: token=abc' });
  assert.deepEqual(denied, {
    activity: { phase: 'running', kind: 'permission', summary: 'Claude reported a permission error', permission: 'workspace', decision: 'blocked' },
    error: 'PERMISSION_BLOCKED',
  });
  assert.throws(() => mapClaudeEvent({ type: 'made.up' }), { code: 'PROVIDER_OUTPUT_INVALID' });
});
