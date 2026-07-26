'use strict';

(function exposeSettingsPresentation(root) {
  const PROVIDERS = Object.freeze({
    'codex-cli': Object.freeze({ label: 'Codex' }),
    'claude-code-cli': Object.freeze({ label: 'Claude Code' }),
  });

  function draftForSelection({
    id,
    executorType,
    workspacePath,
    permissionProfile,
    modelId,
    effort,
  } = {}) {
    const realProvider = Object.hasOwn(PROVIDERS, executorType);
    const draft = {
      executorType,
      label: realProvider ? PROVIDERS[executorType].label : 'Offline Demo',
      workspacePath: typeof workspacePath === 'string' ? workspacePath.trim() : '',
      permissionProfile: realProvider ? (permissionProfile || 'full-computer') : 'workspace',
      modelId: realProvider ? modelId : 'offline-demo',
      effort: realProvider ? effort : null,
      keyHint: null,
    };
    if (typeof id === 'string' && id) return { id, ...draft };
    return draft;
  }

  function connectionSummary(connection = {}) {
    return `${connection.label} - ${connection.workspacePath} - ${connection.permissionBadge}`;
  }

  const api = Object.freeze({ connectionSummary, draftForSelection });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.settingsPresentation = api;
}(globalThis));
