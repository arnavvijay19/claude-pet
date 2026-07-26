'use strict';

const { AgentError } = require('./agentErrors.js');

const WORKSPACE = 'workspace';
const FULL_COMPUTER = 'full-computer';
const EXECUTOR_TYPES = Object.freeze(['offline-demo', 'codex-cli', 'claude-code-cli']);

function unsupported() {
  throw new AgentError('UNSUPPORTED_OPTION');
}

function defaultPermissionProfile(executorType) {
  if (executorType === 'offline-demo') return WORKSPACE;
  if (executorType === 'codex-cli' || executorType === 'claude-code-cli') return FULL_COMPUTER;
  return unsupported();
}

function executorKey(executorType, permissionProfile) {
  if (!EXECUTOR_TYPES.includes(executorType)) return unsupported();
  if (permissionProfile !== WORKSPACE && permissionProfile !== FULL_COMPUTER) return unsupported();
  if (executorType === 'offline-demo' && permissionProfile !== WORKSPACE) return unsupported();
  return `${executorType}:${permissionProfile}`;
}

function permissionBadge(permissionProfile) {
  if (permissionProfile === FULL_COMPUTER) return 'FULL COMPUTER - broad PC access';
  if (permissionProfile === WORKSPACE) return 'WORKSPACE - selected project only';
  return unsupported();
}

module.exports = {
  EXECUTOR_TYPES,
  FULL_COMPUTER,
  WORKSPACE,
  defaultPermissionProfile,
  executorKey,
  permissionBadge,
};
