'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetAnimationController } = require('../src/petAnimationController.js');

const manifest = { states: {
  idle: { frameCount: 1, frameDurationMs: 10 }, waving: { frameCount: 2, frameDurationMs: 10 },
  jumping: { frameCount: 2, frameDurationMs: 10 }, failed: { frameCount: 2, frameDurationMs: 10 },
  waiting: { frameCount: 1, frameDurationMs: 10 }, running: { frameCount: 1, frameDurationMs: 10 },
  review: { frameCount: 1, frameDurationMs: 10 }, 'running-right': { frameCount: 1, frameDurationMs: 10 }, 'running-left': { frameCount: 1, frameDurationMs: 10 },
} };

function clock() {
  const jobs = []; let id = 0;
  return { setTimer(fn) { const job = { id: ++id, fn, cancelled: false }; jobs.push(job); return job.id; }, clearTimer(jobId) { const job = jobs.find((item) => item.id === jobId); if (job) job.cancelled = true; }, tick() { const pending = jobs.splice(0); pending.filter((job) => !job.cancelled).forEach((job) => job.fn()); } };
}

test('drives start, success/dismiss, stopped failure, and stale token lifecycle', () => {
  const states = []; const timers = clock();
  const controller = createPetAnimationController({ manifest, publish: (state) => states.push(state), setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  controller.appReady(); assert.equal(states.at(-1), 'waving'); timers.tick(); assert.equal(states.at(-1), 'idle');
  const runA = controller.goalAccepted(); assert.equal(states.at(-1), 'jumping'); controller.runStarted(runA); controller.activity(runA); timers.tick(); assert.equal(states.at(-1), 'running');
  controller.succeeded(runA); assert.equal(states.at(-1), 'review'); controller.dismissed(runA); assert.equal(states.at(-1), 'idle');
  const runB = controller.goalAccepted(); controller.stopped(runB); assert.equal(states.at(-1), 'failed'); timers.tick(); assert.equal(states.at(-1), 'idle');
  controller.activity(runA); controller.dismissed(runA); assert.equal(states.at(-1), 'idle');
});

test('keeps terminal cleanup independent from drag and returns to durable state on release', () => {
  const states = []; const timers = clock();
  const controller = createPetAnimationController({ manifest, publish: (state) => states.push(state), setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  const token = controller.goalAccepted(); controller.failed(token); controller.dragStarted(); controller.dragMoved(3); assert.equal(states.at(-1), 'running-right');
  timers.tick(); assert.equal(controller.currentToken(), null); controller.dragEnded(); assert.equal(states.at(-1), 'idle');
});
