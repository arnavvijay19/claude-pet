'use strict';

(function exposeResponseViewModel(root) {
  function createResponseViewModel(state = {}) {
    const run = state.run && typeof state.run === 'object' ? state.run : {};
    const events = Array.isArray(state.events) ? state.events : [];
    const latest = events.at(-1) || {};
    const elapsedMs = Number.isFinite(state.elapsedMs) ? Math.max(0, state.elapsedMs) : 0;
    return Object.freeze({
      phase: latest.phase || (state.busy ? 'preparing' : 'ready'),
      summary: run.result?.text || run.error?.message || latest.summary || 'Ready for an Offline Demo goal.',
      executor: run.executor || 'offline-demo',
      model: run.model || 'offline-demo',
      workspace: run.workspace || 'No workspace selected',
      permissionBadge: run.permissionProfile === 'workspace' ? 'Workspace' : 'No permission profile',
      elapsed: `${Math.floor(elapsedMs / 1000)}s`,
      canStop: state.busy === true,
      events,
      activityView: state.activityView === 'comprehensive' ? 'comprehensive' : 'simple',
    });
  }

  const api = Object.freeze({ createResponseViewModel });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.responseViewModel = api;
}(globalThis));
