'use strict';

const { FULL_COMPUTER, WORKSPACE, defaultPermissionProfile, permissionBadge } = require('../agent/executionModes.js');

function createSettingsViewModel({ connections = [], activeId = null, busy = false } = {}) {
  const safeConnections = connections.map((connection) => {
    const badge = permissionBadge(connection.permissionProfile);
    return {
      id: connection.id, executorType: connection.executorType, label: connection.label,
      workspacePath: connection.workspacePath, permissionProfile: connection.permissionProfile,
      modelId: connection.modelId, effort: connection.effort || null,
      permissionBadge: badge,
      permissionWarning: connection.permissionProfile === FULL_COMPUTER,
    };
  });
  const active = safeConnections.find((connection) => connection.id === activeId) || null;
  if (safeConnections.some((connection) => connection.executorType === 'offline-demo' && connection.permissionProfile !== 'workspace')) {
    throw new Error('Offline Demo supports Workspace only.');
  }
  const hasRealConnection = safeConnections.some((connection) => connection.executorType !== 'offline-demo');
  const selectedExecutor = active?.executorType || (hasRealConnection ? 'codex-cli' : 'offline-demo');
  const realProvider = selectedExecutor !== 'offline-demo';
  return Object.freeze({
    connections: safeConnections,
    active: active && Object.freeze({ ...active, description: 'Built-in offline agent. No account, key, or network is used.' }),
    defaultPermissionProfile: defaultPermissionProfile(selectedExecutor),
    permissionOptions: realProvider ? [
      { value: FULL_COMPUTER, label: 'Default - broad access', available: true, warning: true },
      { value: WORKSPACE, label: 'Workspace - selected project only', available: false, warning: false },
    ] : [
      { value: WORKSPACE, label: 'Workspace - selected project only', available: true, warning: false },
    ],
    workspaceOnly: !realProvider,
    fullComputerAvailable: realProvider,
    fileSubmitAvailable: false,
    mutationsDisabled: busy === true,
  });
}

module.exports = { createSettingsViewModel };
