'use strict';

const { AgentError } = require('./agentErrors.js');

const MAX_GOAL_BYTES = 8192;

function validateGoal(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AgentError('GOAL_REQUIRED');
  }
  if (value.includes('\0')
      || (typeof value.isWellFormed === 'function' && !value.isWellFormed())
      || Buffer.byteLength(value, 'utf8') > MAX_GOAL_BYTES) {
    throw new AgentError('UNSUPPORTED_OPTION');
  }
  return value;
}

function boundedNoticeRequest(value) {
  if (value === undefined) return undefined;
  try {
    return validateGoal(value);
  } catch {
    return undefined;
  }
}

module.exports = {
  MAX_GOAL_BYTES,
  boundedNoticeRequest,
  validateGoal,
};
