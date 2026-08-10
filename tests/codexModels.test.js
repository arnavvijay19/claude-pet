'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/agent/executors/codexModels.js');

test('exposes the frozen model + effort constants', () => {
  assert.deepEqual(m.MODEL_IDS, ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  assert.deepEqual(m.EFFORTS, ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(m.MINIMUM_CODEX_VERSION, '0.144.6');
  assert.ok(Object.isFrozen(m.MODEL_IDS));
  assert.ok(Object.isFrozen(m.EFFORTS));
});

test('parseVersion extracts the first semantic triple', () => {
  assert.deepEqual(m.parseVersion('Codex 0.144.6'), [0, 144, 6]);
  assert.deepEqual(m.parseVersion('v2.1.217 (build 9)'), [2, 1, 217]);
  assert.deepEqual(m.parseVersion('no version here'), null);
  assert.deepEqual(m.parseVersion(12345), null);
  assert.deepEqual(m.parseVersion('0.1'), null); // requires three parts
});

test('listCodexModels returns every model with its full effort list', () => {
  const models = m.listCodexModels();
  assert.equal(models.length, 3);
  assert.deepEqual(models.map((x) => x.id), ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  for (const model of models) {
    assert.deepEqual(model.efforts, ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  }
});

test('meetsMinimumVersion compares versions semantically', () => {
  // equal to minimum -> ok
  assert.equal(m.meetsMinimumVersion('Codex 0.144.6'), true);
  // strictly above -> ok
  assert.equal(m.meetsMinimumVersion('0.144.7'), true);
  assert.equal(m.meetsMinimumVersion('0.145.0'), true);
  assert.equal(m.meetsMinimumVersion('1.0.0'), true);
  // strictly below -> not ok
  assert.equal(m.meetsMinimumVersion('0.144.5'), false);
  assert.equal(m.meetsMinimumVersion('0.143.999'), false);
  assert.equal(m.meetsMinimumVersion('0.9.9'), false); // lower major must win
  // garbage / missing -> not ok
  assert.equal(m.meetsMinimumVersion('not a version'), false);
  assert.equal(m.meetsMinimumVersion(null), false);
});
