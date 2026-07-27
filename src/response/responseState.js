'use strict';

function createResponseState({ now = Date.now, readPreference = () => null, writePreference = () => {} } = {}) {
  let view = readPreference() === 'comprehensive' ? 'comprehensive' : 'simple';
  let startedAt = null;
  let run = null;
  let events = [];
  let busy = false;
  let stopped = false;
  let sessionSnapshot = { agent: null, session: null, turns: [] };
  const listeners = new Set();
  const snapshot = () => Object.freeze({ activityView: view, busy, stopped, run, events: [...events], elapsedMs: startedAt === null ? 0 : Math.max(0, now() - startedAt), agent: sessionSnapshot.agent, session: sessionSnapshot.session, turns: sessionSnapshot.turns.map((turn) => ({ ...turn, changedFiles: [...turn.changedFiles] })) });
  const publish = () => { const value = snapshot(); listeners.forEach((listener) => listener(value)); return value; };
  return Object.freeze({
    snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setActivityView(value) { if (!['simple', 'comprehensive'].includes(value)) return; view = value; writePreference(value); publish(); },
    begin(value) { run = { ...value }; events = []; busy = true; stopped = false; startedAt = now(); publish(); },
    setActivity(value) { events = Array.isArray(value?.events) ? value.events.map(({ sequence, ...event }) => event) : []; publish(); },
    setSessionSnapshot(value) { sessionSnapshot = { agent: value?.agent ? { ...value.agent } : null, session: value?.session ? { ...value.session } : null, turns: Array.isArray(value?.turns) ? value.turns.map((turn) => ({ ...turn, changedFiles: Array.isArray(turn.changedFiles) ? [...turn.changedFiles] : [] })) : [] }; publish(); },
    success(value) { busy = false; stopped = false; run = { ...(run || {}), result: value }; publish(); },
    failure(value) { busy = false; run = { ...(run || {}), error: value }; publish(); },
    stopped() { busy = false; stopped = true; publish(); },
    dismiss() { busy = false; stopped = false; run = null; events = []; startedAt = null; publish(); },
  });
}

module.exports = { createResponseState };
