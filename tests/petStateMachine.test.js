// tests/petStateMachine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetStateMachine } = require('../src/renderer/pet.js');

const manifest = {
  frameWidth: 192,
  frameHeight: 208,
  frameDurationMs: 180,
  states: { idle: { row: 0, frameCount: 6 } },
};

test('starts on frame 0 of the idle state', () => {
  const machine = createPetStateMachine(manifest);
  assert.deepEqual(machine.getFrame(0), { row: 0, column: 0 });
});

test('advances frames based on elapsed time', () => {
  const machine = createPetStateMachine(manifest);
  assert.deepEqual(machine.getFrame(180), { row: 0, column: 1 });
  assert.deepEqual(machine.getFrame(360), { row: 0, column: 2 });
});

test('wraps around after the last frame', () => {
  const machine = createPetStateMachine(manifest);
  assert.deepEqual(machine.getFrame(180 * 6), { row: 0, column: 0 });
});

test('setState switches row and resets frame timing', () => {
  const bigManifest = {
    ...manifest,
    states: { idle: { row: 0, frameCount: 6 }, waving: { row: 1, frameCount: 4 } },
  };
  const machine = createPetStateMachine(bigManifest);
  machine.setState('waving');
  assert.deepEqual(machine.getFrame(0), { row: 1, column: 0 });
});
