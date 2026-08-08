'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createStageTimer } = require('../src/agent/stageTiming.js');

test('disabled timer records nothing and still returns the value', async () => {
  const timer = createStageTimer({ enabled: false });
  assert.equal(await timer.stage('discovery', async () => 7), 7);
  assert.deepEqual(timer.report(), []);
});

test('enabled timer records fixed stage names and outcomes only', async () => {
  const timer = createStageTimer({ enabled: true });
  await timer.stage('discovery', async () => 'binding');
  await assert.rejects(timer.stage('qualification', async () => { throw new Error('C:\\secret\\path'); }));
  const report = timer.report();
  assert.deepEqual(report.map((row) => row.name), ['discovery', 'qualification']);
  assert.deepEqual(report.map((row) => row.outcome), ['ok', 'failed']);
  assert.equal(report.every((row) => Number.isInteger(row.ms)), true);
  assert.equal(JSON.stringify(report).includes('secret'), false);
});

test('unknown stage names are rejected', () => {
  const timer = createStageTimer({ enabled: true });
  assert.rejects(() => timer.stage('arbitrary', async () => 1));
});
