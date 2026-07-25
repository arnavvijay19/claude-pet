'use strict';

(function exposeResponseViewModel(root) {
  function detailFor(event) {
    if (typeof event.detail === 'string') return event.detail;
    if (event.kind === 'file') return `${event.operation} ${event.path}`;
    if (event.kind === 'command') return `${event.command} (exit ${event.exitCode})`;
    if (event.kind === 'network') return event.destination;
    if (event.kind === 'permission') return `${event.decision} ${event.permission}`;
    if (event.kind === 'usage') {
      const usage = event.usage || {};
      return `input ${usage.inputTokens}, output ${usage.outputTokens}, cached ${usage.cachedTokens}, total ${usage.totalTokens}`;
    }
    if (event.kind === 'tool') return event.toolName;
    return '';
  }
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
      events: events.map((event) => ({ ...event, detail: detailFor(event) })),
      changedFiles: Array.isArray(run.result?.changedFiles) ? [...run.result.changedFiles] : [],
      activityView: state.activityView === 'comprehensive' ? 'comprehensive' : 'simple',
    });
  }

  const api = Object.freeze({ createResponseViewModel });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.responseViewModel = api;
}(globalThis));
