'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  promptPortFromArguments,
  promptTokenFromEnvironment,
} = require('../src/runtimeArguments.js');

test('accepts one explicit loopback prompt port for isolated packaged verification only', () => {
  assert.equal(promptPortFromArguments([]), null);
  assert.equal(promptPortFromArguments(['--prompt-port=47777']), 47777);
  for (const value of ['--prompt-port=0', '--prompt-port=65536', '--prompt-port=abc', '--prompt-port=47.7']) {
    assert.equal(promptPortFromArguments([value]), null, value);
  }
  assert.equal(promptPortFromArguments(['--prompt-port=47777', '--prompt-port=47778']), null);
});

test('accepts only a non-persisted prompt token of at least 32 UTF-8 bytes', () => {
  assert.equal(promptTokenFromEnvironment({}), null);
  assert.equal(promptTokenFromEnvironment({ CLAUDE_PET_PROMPT_TOKEN: 'short' }), null);
  assert.equal(promptTokenFromEnvironment({ CLAUDE_PET_PROMPT_TOKEN: 'x'.repeat(32) }), 'x'.repeat(32));
  assert.equal(promptTokenFromEnvironment({ CLAUDE_PET_PROMPT_TOKEN: '\0'.repeat(32) }), null);
});
