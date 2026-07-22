'use strict';

const REQUIRED_METHODS = Object.freeze([
  'getStatus', 'beginSetup', 'listModels', 'getCapabilities',
  'verifyPermissionProfile', 'runGoal',
]);

function validateExecutor(executor) {
  for (const method of REQUIRED_METHODS) {
    if (!executor || typeof executor[method] !== 'function') {
      throw new TypeError('Agent executor is missing method: ' + method);
    }
  }
  return executor;
}

module.exports = { REQUIRED_METHODS, validateExecutor };
