'use strict';

(function exposeSettingsStatus(root) {
  function formatTestStatus(result = {}) {
    if (result.status?.installed === false) return 'Codex is not installed.';
    if (result.status?.authenticated === false) return 'Codex is not signed in. Select Sign in to Codex.';
    if (result.permission?.available === false) return 'Workspace permission is unavailable on this computer.';
    return 'Connection diagnostic completed.';
  }
  const api = Object.freeze({ formatTestStatus });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.settingsStatus = api;
}(globalThis));
