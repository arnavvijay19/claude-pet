'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  createPetCouplingController,
  reconcileAnimation,
  PET_STATES,
  ATTENTION,
} = require('../src/agent/petCouplingController.js');

// A fake animation controller that records every method call so we can assert the
// coupling controller only drives the ambient states and never the run-lifecycle
// states owned by promptController.
function fakeAnimation() {
  const calls = [];
  const noop = (name) => () => calls.push(name);
  return {
    calls,
    appReady: noop('appReady'),
    connectionSaved: noop('connectionSaved'),
    actionRequired: noop('actionRequired'),
    actionResolved: noop('actionResolved'),
    setupFailed: noop('setupFailed'),
    goalAccepted: noop('goalAccepted'),
    runStarted: noop('runStarted'),
    activity: noop('activity'),
    succeeded: noop('succeeded'),
    failed: noop('failed'),
    stopped: noop('stopped'),
    dismissed: noop('dismissed'),
  };
}

function fakePublisher() {
  const values = [];
  return { values, publish: (v) => values.push(v) };
}

test('createPetCouplingController throws when publishers are missing', () => {
  assert.throws(() => createPetCouplingController({ publishProgress: null }), TypeError);
  assert.throws(() => createPetCouplingController({ publishAttention: 5 }), TypeError);
});

test('idle input publishes zero progress and no attention, drives no animation', () => {
  const animation = fakeAnimation();
  const progress = fakePublisher();
  const attention = fakePublisher();
  const controller = createPetCouplingController({
    animation, publishProgress: progress.publish, publishAttention: attention.publish,
  });

  const pet = controller.sync({ connection: null, run: { busy: false } });

  assert.strictEqual(pet.visualState, PET_STATES.IDLE);
  assert.strictEqual(pet.progress, 0);
  assert.strictEqual(pet.attention, ATTENTION.NONE);
  assert.deepStrictEqual(animation.calls, []);
  assert.deepStrictEqual(progress.values, [0]);
  assert.deepStrictEqual(attention.values, [{ attention: ATTENTION.NONE, label: 'Ready' }]);
});

test('sign-in-required connection raises attention and drives actionRequired', () => {
  const animation = fakeAnimation();
  const attention = fakePublisher();
  const controller = createPetCouplingController({
    animation, publishAttention: attention.publish,
  });

  const pet = controller.sync({
    connection: { state: 'Sign-in required', oneTime: false },
    run: { busy: false },
  });

  assert.strictEqual(pet.visualState, PET_STATES.WAITING);
  assert.strictEqual(pet.attention, ATTENTION.SIGN_IN);
  assert.deepStrictEqual(animation.calls, ['actionRequired']);
  assert.strictEqual(attention.values.at(-1).attention, ATTENTION.SIGN_IN);
});

test('leaving waiting for idle resolves the action and clears attention', () => {
  const animation = fakeAnimation();
  const attention = fakePublisher();
  const controller = createPetCouplingController({
    animation, publishAttention: attention.publish,
  });

  controller.sync({ connection: { state: 'Sign-in required' }, run: { busy: false } });
  const pet = controller.sync({ connection: null, run: { busy: false } });

  assert.strictEqual(pet.visualState, PET_STATES.IDLE);
  assert.strictEqual(pet.attention, ATTENTION.NONE);
  // actionRequired on enter waiting, actionResolved on leaving to idle.
  assert.deepStrictEqual(animation.calls, ['actionRequired', 'actionResolved']);
});

test('repeated identical state does not re-drive animation or re-publish', () => {
  const animation = fakeAnimation();
  const progress = fakePublisher();
  const attention = fakePublisher();
  const controller = createPetCouplingController({
    animation, publishProgress: progress.publish, publishAttention: attention.publish,
  });

  controller.sync({ connection: { state: 'Sign-in required' }, run: { busy: false } });
  controller.sync({ connection: { state: 'Sign-in required' }, run: { busy: false } });

  assert.deepStrictEqual(animation.calls, ['actionRequired']);
  assert.strictEqual(attention.values.length, 1);
});

test('terminal connection failure raises failure attention and drives setupFailed', () => {
  const animation = fakeAnimation();
  const attention = fakePublisher();
  const controller = createPetCouplingController({
    animation, publishAttention: attention.publish,
  });

  const pet = controller.sync({
    connection: { state: 'Recoverable failure', failureMessage: 'Codex bridge offline' },
    run: { busy: false },
  });

  assert.strictEqual(pet.visualState, PET_STATES.FAILED);
  assert.strictEqual(pet.attention, ATTENTION.FAILURE);
  assert.strictEqual(pet.label, 'Codex bridge offline');
  assert.deepStrictEqual(animation.calls, ['setupFailed']);
  assert.strictEqual(attention.values.at(-1).attention, ATTENTION.FAILURE);
});

test('busy running run publishes progress but never drives the run animation', () => {
  const animation = fakeAnimation();
  const progress = fakePublisher();
  const controller = createPetCouplingController({
    animation, publishProgress: progress.publish,
  });

  const pet = controller.sync({
    connection: null,
    run: { busy: true, phase: 'running', progress: 0.5 },
  });

  // Running is owned by promptController's token flow; the coupling controller must
  // not call goalAccepted/succeeded/failed/activity.
  assert.strictEqual(pet.visualState, PET_STATES.RUNNING);
  assert.strictEqual(pet.progress, 0.5);
  assert.deepStrictEqual(animation.calls, []);
  assert.deepStrictEqual(progress.values, [0.5]);
});

test('verifying connection shows waiting and drives actionRequired', () => {
  const animation = fakeAnimation();
  const controller = createPetCouplingController({ animation });

  const pet = controller.sync({
    connection: { state: 'Verifying installed Codex' },
    run: { busy: false },
  });

  assert.strictEqual(pet.visualState, PET_STATES.WAITING);
  assert.deepStrictEqual(animation.calls, ['actionRequired']);
});

test('controller works with a null animation (main may not have one yet)', () => {
  const progress = fakePublisher();
  const controller = createPetCouplingController({ animation: null, publishProgress: progress.publish });

  assert.doesNotThrow(() => controller.sync({ connection: { state: 'Sign-in required' }, run: { busy: false } }));
  assert.strictEqual(controller.snapshot().visualState, PET_STATES.WAITING);
  assert.deepStrictEqual(progress.values, [0]);
});

test('snapshot reflects the last emitted truth', () => {
  const controller = createPetCouplingController();
  controller.sync({ connection: { state: 'Recoverable failure', failureMessage: 'boom' }, run: { busy: false } });
  assert.deepStrictEqual(controller.snapshot(), {
    visualState: PET_STATES.FAILED,
    progress: 0,
    attention: ATTENTION.FAILURE,
  });
});

test('reset clears the tracked truth', () => {
  const controller = createPetCouplingController();
  controller.sync({ connection: { state: 'Sign-in required' }, run: { busy: false } });
  controller.reset();
  assert.strictEqual(controller.snapshot().visualState, null);
  assert.strictEqual(controller.snapshot().progress, null);
  assert.strictEqual(controller.snapshot().attention, null);
});

test('reconcileAnimation only drives ambient states and only on transition', () => {
  const a = fakeAnimation();
  reconcileAnimation(a, PET_STATES.IDLE, null);
  reconcileAnimation(a, PET_STATES.WAITING, PET_STATES.IDLE);
  reconcileAnimation(a, PET_STATES.WAITING, PET_STATES.WAITING); // no-op
  reconcileAnimation(a, PET_STATES.FAILED, PET_STATES.WAITING);
  reconcileAnimation(a, PET_STATES.IDLE, PET_STATES.FAILED); // setupFailed already settles
  reconcileAnimation(a, PET_STATES.RUNNING, PET_STATES.IDLE); // run owned elsewhere
  reconcileAnimation(a, PET_STATES.REVIEW, PET_STATES.RUNNING);
  assert.deepStrictEqual(a.calls, ['actionRequired', 'setupFailed']);
});

test('reconcileAnimation is a no-op with a null animation', () => {
  assert.doesNotThrow(() => reconcileAnimation(null, PET_STATES.WAITING, PET_STATES.IDLE));
  assert.doesNotThrow(() => reconcileAnimation({}, PET_STATES.WAITING, PET_STATES.IDLE));
});
