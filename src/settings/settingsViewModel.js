'use strict';

function createSettingsViewModel({ connections = [], activeId = null } = {}) {
  const safeConnections = connections.map((connection) => ({
    id: connection.id, executorType: connection.executorType, label: connection.label,
    workspacePath: connection.workspacePath, permissionProfile: connection.permissionProfile,
    modelId: connection.modelId, effort: connection.effort || null,
  }));
  const active = safeConnections.find((connection) => connection.id === activeId) || null;
  if (safeConnections.some((connection) => connection.executorType === 'offline-demo' && connection.permissionProfile !== 'workspace')) {
    throw new Error('Offline Demo supports Workspace only.');
  }
  return Object.freeze({
    connections: safeConnections,
    active: active && Object.freeze({ ...active, description: 'Built-in offline agent. No account, key, or network is used.' }),
    workspaceOnly: true,
    fullComputerAvailable: false,
    fileSubmitAvailable: false,
  });
}

module.exports = { createSettingsViewModel };
