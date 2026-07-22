'use strict';

const { sanitizeActivityValue } = require('./activitySanitizer.js');
const { validateActivityEvent } = require('./activitySchema.js');

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function createActivityStore({ clock = Date.now } = {}) {
  let run = null;
  let events = [];
  let sequence = 0;
  const listeners = new Set();

  function snapshot() {
    return deepFreeze({ run, events: [...events] });
  }

  function publish() {
    const current = snapshot();
    for (const listener of listeners) listener(current);
  }

  function begin(value) {
    run = deepFreeze(sanitizeActivityValue(value));
    events = [];
    sequence = 0;
    publish();
    return snapshot();
  }

  function append(value) {
    const sanitized = sanitizeActivityValue(value);
    const validated = validateActivityEvent(sanitized);
    const stored = deepFreeze({ ...validated, sequence: ++sequence, timestamp: clock() });
    events = [...events, stored].slice(-1000);
    publish();
    return stored;
  }

  function clear() {
    run = null;
    events = [];
    sequence = 0;
    publish();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Activity listener must be a function.');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return Object.freeze({ begin, append, snapshot, clear, subscribe });
}

module.exports = { createActivityStore, deepFreeze };
