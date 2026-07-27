// tests/petStateMachine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetStateMachine } = require('../src/renderer/pet.js');

const manifest = {
  frameWidth: 192,
  frameHeight: 208,
  states: {
    idle: { row: 0, frameCount: 6, frameDurationMs: 180, loop: true },
    'running-right': { row: 1, frameCount: 8, frameDurationMs: 90, loop: true },
    waving: { row: 3, frameCount: 4, frameDurationMs: 140, loop: false, nextState: 'idle' },
    jumping: { row: 4, frameCount: 5, frameDurationMs: 110, loop: false, nextState: 'running' },
    failed: { row: 5, frameCount: 8, frameDurationMs: 130, loop: false, nextState: 'idle' },
    running: { row: 7, frameCount: 6, frameDurationMs: 110, loop: true },
  },
};

test('starts on frame 0 of the idle state', () => {
  const machine = createPetStateMachine(manifest);
  assert.equal(machine.getState(), 'idle');
  assert.deepEqual(machine.getFrame(0), { state: 'idle', row: 0, column: 0 });
});

test('uses each state duration and loops at that state frame count', () => {
  const machine = createPetStateMachine(manifest);
  assert.deepEqual(machine.getFrame(180), { state: 'idle', row: 0, column: 1 });
  machine.setState('running-right', 500);
  assert.deepEqual(machine.getFrame(590), { state: 'running-right', row: 1, column: 1 });
  assert.deepEqual(machine.getFrame(500 + (90 * 8)), { state: 'running-right', row: 1, column: 0 });
});

test('setting the current state is idempotent and does not reset its clock', () => {
  const machine = createPetStateMachine(manifest);
  machine.setState('idle', 360);
  assert.deepEqual(machine.getFrame(360), { state: 'idle', row: 0, column: 2 });
});

test('switching state resets frame timing and reports the new state', () => {
  const machine = createPetStateMachine(manifest);
  machine.setState('waving', 500);
  assert.equal(machine.getState(), 'waving');
  assert.deepEqual(machine.getFrame(500), { state: 'waving', row: 3, column: 0 });
});

test('non-looping states clamp their last frame and transition at the exact boundary', () => {
  const machine = createPetStateMachine(manifest);
  machine.setState('waving', 1000);
  assert.deepEqual(machine.getFrame(1559), { state: 'waving', row: 3, column: 3 });
  assert.deepEqual(machine.getFrame(1560), { state: 'idle', row: 0, column: 0 });
  assert.equal(machine.getState(), 'idle');
});

test('jumping transitions to running and failed transitions to idle', () => {
  const machine = createPetStateMachine(manifest);
  machine.setState('jumping', 100);
  assert.deepEqual(machine.getFrame(100 + (5 * 110)), { state: 'running', row: 7, column: 0 });
  machine.setState('failed', 1000);
  assert.deepEqual(machine.getFrame(1000 + (8 * 130)), { state: 'idle', row: 0, column: 0 });
});

test('rejects unknown states and invalid next-state graphs', () => {
  const machine = createPetStateMachine(manifest);
  assert.throws(() => machine.setState('missing'), /Unknown pet state/);

  const unknownNext = structuredClone(manifest);
  unknownNext.states.failed.nextState = 'missing';
  assert.throws(() => createPetStateMachine(unknownNext), /Invalid pet manifest/);

  const cyclic = structuredClone(manifest);
  cyclic.states.waving.nextState = 'failed';
  cyclic.states.failed.nextState = 'waving';
  assert.throws(() => createPetStateMachine(cyclic), /Invalid pet manifest/);
});
