'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAbortableDelayGate } = require('../src/agentRuntime.js');

test('releases the Task 9 Offline Demo delay as soon as Stop aborts the run', async () => {
  const cleared = [];
  let release;
  const gate = createAbortableDelayGate({
    delayMs: 5000,
    setTimeoutFn: (callback) => { release = callback; return 'timer'; },
    clearTimeoutFn: (timer) => cleared.push(timer),
  });
  const controller = new AbortController();
  const waiting = gate.wait(controller.signal);
  controller.abort();
  await waiting;
  assert.deepEqual(cleared, ['timer']);
  release();
});
