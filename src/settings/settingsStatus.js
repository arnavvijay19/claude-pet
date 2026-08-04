'use strict';

(function exposeSettingsStatus(root) {
  function formatTestStatus(result = {}) {
    if (result.failure?.code === 'CLI_VERSION_UNSUPPORTED') return 'This Codex update is not compatible with Claude Pet yet. Update Claude Pet or install a compatible Codex version.';
    if (result.failure?.code === 'CLI_COMPATIBILITY_CHECK_FAILED') return 'Claude Pet could not finish checking this Codex update. Retry the compatibility check.';
    if (typeof result.failure?.message === 'string') return result.failure.message;
    const name = result.executorType === 'claude-code-cli' ? 'Claude Code' : 'Codex';
    if (result.executorType === 'claude-code-cli' && result.permission?.available === false) return 'Claude Code Workspace permission is unavailable on this computer.';
    if (result.status?.installed === false) return `${name} is not installed.`;
    if (result.status?.compatible === false) return 'This Codex update is not compatible with Claude Pet yet. Update Claude Pet or install a compatible Codex version.';
    if (result.status?.authenticated === false) return `${name} is not signed in. Select Sign in to ${name}.`;
    if (result.permission?.available === false) return 'Workspace permission is unavailable on this computer.';
    return 'Connection diagnostic completed.';
  }
  const api = Object.freeze({ formatTestStatus });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.settingsStatus = api;
}(globalThis));
