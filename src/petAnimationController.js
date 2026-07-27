'use strict';

const STATES = new Set(['idle', 'waiting', 'running', 'review', 'waving', 'jumping', 'failed', 'running-right', 'running-left']);

function createPetAnimationController({ manifest, publish, setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (!manifest?.states || typeof publish !== 'function') throw new TypeError('A pet manifest and publisher are required.');
  for (const state of STATES) if (!manifest.states[state]) throw new TypeError('Invalid pet manifest.');
  let durable = 'idle'; let visual = 'idle'; let token = 0; let active = null; let transient = null; let cleanup = null; let dragging = false; let direction = null;
  const cycle = (state) => manifest.states[state].frameCount * manifest.states[state].frameDurationMs;
  const show = (state) => { visual = state; publish(state); };
  const clearTransient = () => { if (transient) clearTimer(transient); transient = null; };
  const clearCleanup = () => { if (cleanup) clearTimer(cleanup); cleanup = null; };
  const showDurable = () => { if (!dragging) show(durable); };
  const timed = (state, after) => { clearTransient(); show(state); transient = setTimer(() => { transient = null; after(); }, cycle(state)); };
  const owns = (value) => active?.token === value;
  const settleFailure = (value) => {
    if (!owns(value) || active.phase !== 'failure-settling') return;
    active.phase = 'settled'; active = null; cleanup = null; durable = 'idle'; showDurable();
  };
  return Object.freeze({
    appReady() { if (token === 0 && !active) timed('waving', () => { durable = 'idle'; showDurable(); }); },
    connectionSaved() { if (!active) timed('waving', () => showDurable()); },
    actionRequired() { if (!active) { durable = 'waiting'; showDurable(); } },
    actionResolved() { if (!active && durable === 'waiting') { durable = 'idle'; showDurable(); } },
    setupFailed() { if (!active) timed('failed', () => { durable = 'idle'; showDurable(); }); },
    goalAccepted() { clearTransient(); clearCleanup(); token += 1; active = { token, phase: 'active' }; durable = 'running'; timed('jumping', () => { if (owns(token) && active.phase === 'active') showDurable(); }); return token; },
    runStarted(value) { if (owns(value) && active.phase === 'active') { durable = 'running'; } },
    activity(value) { if (owns(value) && active.phase === 'active') durable = 'running'; },
    succeeded(value) { if (!owns(value) || active.phase !== 'active') return; clearTransient(); active.phase = 'review'; durable = 'review'; showDurable(); },
    failed(value) { if (!owns(value) || active.phase !== 'active') return; clearTransient(); active.phase = 'failure-settling'; durable = 'idle'; timed('failed', () => {}); clearCleanup(); cleanup = setTimer(() => settleFailure(value), cycle('failed')); },
    stopped(value) { this.failed(value); },
    dismissed(value) { if (!owns(value) || active.phase !== 'review') return; active.phase = 'settled'; active = null; durable = 'idle'; showDurable(); },
    dragStarted() { dragging = true; clearTransient(); },
    dragMoved(dx) { if (!dragging || !Number.isFinite(dx) || dx === 0) return; direction = dx > 0 ? 'running-right' : 'running-left'; show(direction); },
    dragEnded() { dragging = false; direction = null; showDurable(); },
    currentToken() { return active?.token ?? null; },
    snapshot() { return Object.freeze({ state: visual, durableState: durable, token: active?.token ?? null, phase: active?.phase ?? 'settled', dragging, direction }); },
  });
}

module.exports = { createPetAnimationController };
