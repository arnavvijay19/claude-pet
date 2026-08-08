'use strict';

// Pet coupling controller — the wiring brain of Phase 3 Task 4, sub-branch 2
// ("the pet becomes the agent", design §3.4).
//
// Sub-branch 1 (src/agent/petStateModel.js) derives the pet's ambient truth — a
// visual state, a progress ring (0..1), and an attention flag — from the SAME
// normalized connection + run input the status ribbon uses. This module turns that
// truth into concrete pet-window effects WITHOUT authoring any new animation rows:
//
//   1. It publishes `progress` and `attention` to the pet window (the new IPC
//      channels the pet renderer consumes in sub-branch 3) so the progress ring +
//      attention badge are driven by the exact same source as the ribbon.
//   2. It reconciles the *connection / ambient* pet states into the EXISTING
//      petAnimationController. Run-lifecycle states (running / jumping / review)
//      are owned by promptController's token flow and are deliberately NOT touched
//      here, so the two drivers can never clobber each other. Only the ambient
//      states are driven here: waiting (sign-in / verifying) -> actionRequired,
//      terminal failure -> setupFailed, and a calm idle -> actionResolved when
//      leaving waiting.
//
// The module is framework-free (no Electron, DOM, timers, or async) and injects
// its dependencies, so it is fully unit-testable with fakes. The main process
// (src/main.js) is the only place that knows how to fetch the runtime snapshot; it
// builds the normalized { connection, run } input and hands it to sync().

const { derivePetState, PET_STATES, ATTENTION } = require('./petStateModel.js');

// Pure transition helper: map a normalized visual state onto the existing
// animation controller's connection/ambient methods. `prev` is the last visual
// state this controller emitted (null on first call). A call is emitted only on a
// real transition so the animation controller is never spammed with no-ops.
function reconcileAnimation(animation, visualState, prev) {
  if (!animation || typeof animation !== 'object') return;
  const call = (name) => { if (typeof animation[name] === 'function') animation[name](); };

  if (visualState === PET_STATES.WAITING) {
    if (prev !== PET_STATES.WAITING) call('actionRequired');
  } else if (visualState === PET_STATES.FAILED) {
    if (prev !== PET_STATES.FAILED) call('setupFailed');
  } else if (visualState === PET_STATES.IDLE) {
    if (prev === PET_STATES.WAITING) call('actionResolved');
    // Leaving FAILED: setupFailed already schedules its own settle-to-idle timer,
    // so the controller has nothing further to do here.
  }
  // running / review / jumping / waving / running-right / running-left:
  // owned by promptController's token lifecycle — never touched here.
}

function createPetCouplingController({
  animation = null,
  publishProgress = () => {},
  publishAttention = () => {},
} = {}) {
  if (typeof publishProgress !== 'function' || typeof publishAttention !== 'function') {
    throw new TypeError('publishProgress and publishAttention must be functions');
  }

  let lastVisualState = null;
  let lastProgress = null;
  let lastAttention = null;

  // Push the normalized pet truth into the pet window + animation controller.
  // `input` is the exact shape derivePetState expects: { connection, run }.
  function sync(input = {}) {
    const pet = derivePetState(input);

    if (pet.progress !== lastProgress) {
      publishProgress(pet.progress);
      lastProgress = pet.progress;
    }
    if (pet.attention !== lastAttention) {
      publishAttention({ attention: pet.attention, label: pet.label });
      lastAttention = pet.attention;
    }

    reconcileAnimation(animation, pet.visualState, lastVisualState);
    lastVisualState = pet.visualState;
    return pet;
  }

  function reset() {
    lastVisualState = null;
    lastProgress = null;
    lastAttention = null;
  }

  return Object.freeze({
    sync,
    reset,
    snapshot: () => Object.freeze({
      visualState: lastVisualState,
      progress: lastProgress,
      attention: lastAttention,
    }),
  });
}

module.exports = {
  createPetCouplingController,
  reconcileAnimation,
  PET_STATES,
  ATTENTION,
};
