'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_GOAL_BYTES,
  boundedNoticeRequest,
  validateGoal,
} = require('../src/agent/goalLimits.js');

test('uses one 8192-byte well-formed UTF-8 goal contract', () => {
  const exact = 'é'.repeat(4096);
  assert.equal(MAX_GOAL_BYTES, 8192);
  assert.equal(validateGoal(exact), exact);
  assert.throws(
    () => validateGoal('é'.repeat(4097)),
    (error) => error?.code === 'UNSUPPORTED_OPTION',
  );
  assert.throws(
    () => validateGoal(''),
    (error) => error?.code === 'GOAL_REQUIRED',
  );
  assert.throws(
    () => validateGoal('\0'),
    (error) => error?.code === 'UNSUPPORTED_OPTION',
  );
});

test('omits an invalid optional notice request without blocking publication', () => {
  assert.equal(boundedNoticeRequest('valid'), 'valid');
  assert.equal(boundedNoticeRequest('x'.repeat(MAX_GOAL_BYTES + 1)), undefined);
  assert.equal(boundedNoticeRequest(undefined), undefined);
});
