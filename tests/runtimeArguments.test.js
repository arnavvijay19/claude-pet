'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { promptPortFromArguments } = require('../src/runtimeArguments.js');

test('accepts one explicit loopback prompt port for isolated packaged verification only', () => {
  assert.equal(promptPortFromArguments([]), null);
  assert.equal(promptPortFromArguments(['--prompt-port=47777']), 47777);
  for (const value of ['--prompt-port=0', '--prompt-port=65536', '--prompt-port=abc', '--prompt-port=47.7']) {
    assert.equal(promptPortFromArguments([value]), null, value);
  }
  assert.equal(promptPortFromArguments(['--prompt-port=47777', '--prompt-port=47778']), null);
});
