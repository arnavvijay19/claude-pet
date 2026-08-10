'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/agent/executors/claudeModels.js');

test('exposes the frozen model + effort constants', () => {
  assert.deepEqual(m.MODEL_IDS, ['fable', 'opus', 'sonnet']);
  assert.deepEqual(m.EFFORTS, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(m.MINIMUM_CLAUDE_VERSION, '2.1.217');
  assert.ok(Object.isFrozen(m.MODEL_IDS));
  assert.ok(Object.isFrozen(m.EFFORTS));
});

test('parseVersion extracts the first semantic triple', () => {
  assert.deepEqual(m.parseVersion('Claude Code 2.1.217'), [2, 1, 217]);
  assert.deepEqual(m.parseVersion('v0.144.6 (build 12)'), [0, 144, 6]);
  assert.deepEqual(m.parseVersion('no version here'), null);
  assert.deepEqual(m.parseVersion(12345), null);
  assert.deepEqual(m.parseVersion('1.2'), null); // requires three parts
});

test('listClaudeModels returns every model with its full effort list', () => {
  const models = m.listClaudeModels();
  assert.equal(models.length, 3);
  assert.deepEqual(models.map((x) => x.id), ['fable', 'opus', 'sonnet']);
  for (const model of models) {
    assert.deepEqual(model.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  }
});

test('meetsMinimumVersion compares versions semantically', () => {
  // equal to minimum -> ok
  assert.equal(m.meetsMinimumVersion('Claude Code 2.1.217'), true);
  // strictly above -> ok
  assert.equal(m.meetsMinimumVersion('2.1.218'), true);
  assert.equal(m.meetsMinimumVersion('2.2.0'), true);
  assert.equal(m.meetsMinimumVersion('3.0.0'), true);
  // strictly below -> not ok
  assert.equal(m.meetsMinimumVersion('2.1.216'), false);
  assert.equal(m.meetsMinimumVersion('2.0.999'), false);
  assert.equal(m.meetsMinimumVersion('1.9.9'), false); // lower major must win
  // garbage / missing -> not ok
  assert.equal(m.meetsMinimumVersion('not a version'), false);
  assert.equal(m.meetsMinimumVersion(null), false);
});
