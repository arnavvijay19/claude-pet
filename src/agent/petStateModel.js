'use strict';

// Pet coupling model — the pure, framework-free brain behind Phase 3 Task 4 ("the pet becomes
// the agent", design §3.4).
//
// The pet window is no longer a toy beside the app. Its nine-state atlas (idle, waiting,
// running, review, waving, jumping, failed, running-right, running-left) now mirrors the SAME
// connection + run state the status ribbon shows, plus two new ambient signals the ribbon does
// not carry:
//   - a thin progress ring (0..1) that advances as run steps complete, and
//   - an `attention` flag for states that must be visible even with the main window closed
//     (sign-in required, terminal connection failure).
//
// This module is intentionally free of Electron, DOM, timers, and async work so it can be unit
// tested without a renderer and reused by both the main process (which drives the existing
// petAnimationController and publishes progress/attention to the pet window) and, later, the
// pet renderer itself (progress ring + attention badge). Keeping the mapping here means the pet
// and the ribbon can never drift: they both derive their truth from the same normalized inputs.

// The finite set of pet visual states. These match the nine rows the validated Banana Baron
// atlas already encodes (Task 15). `running-right`/`running-left` are reserved for drag only.
const PET_STATES = Object.freeze({
  IDLE: 'idle',
  WAITING: 'waiting',
  RUNNING: 'running',
  REVIEW: 'review',
  WAVING: 'waving',
  JUMPING: 'jumping',
  FAILED: 'failed',
  RUNNING_RIGHT: 'running-right',
  RUNNING_LEFT: 'running-left',
});

// The two ambient "something needs you" signals. `sign-in` means a provider-owned sign-in is
// required and `failure` means a terminal connection problem. The pet window renders these as a
// distinct attention state so a blocked run is visible without the main window open.
const ATTENTION = Object.freeze({
  NONE: 'none',
  SIGN_IN: 'sign-in',
  FAILURE: 'failure',
});

const VALID_PET_STATES = Object.freeze(Object.values(PET_STATES));
const VALID_ATTENTION = Object.freeze(Object.values(ATTENTION));

function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// Derive the pet's ambient expression from a normalized view of connection + run state.
// Priority (highest first):
//   1. terminal connection failure -> failed pet + failure attention;
//   2. sign-in required -> waiting pet + sign-in attention;
//   3. a busy run -> running/jumping pet, progress ring from completed steps;
//   4. verifying a connection -> waiting pet;
//   5. otherwise calm idle.
// `run.progress` is a number in [0,1]; when absent a busy run shows 0 and an idle run 0.
// Returns a frozen object the caller maps onto the petAnimationController (visualState) and the
// pet window (progress ring + attention badge).
function derivePetState(input = {}) {
  const connection = input.connection || null;
  const run = input.run || {};

  const failureMessage = connection && connection.state === 'Recoverable failure'
    ? (connection.failureMessage || (connection.failure && connection.failure.message) || null)
    : null;
  const signInRequired = connection && connection.state === 'Sign-in required';
  const verifying = connection
    && (connection.state === 'Verifying installed Codex' || connection.state === 'Verifying');

  const busy = run.busy === true;
  const phase = run.phase || null;
  const progress = clampUnit(run.progress === undefined ? 0 : run.progress);

  if (failureMessage) {
    return Object.freeze({
      visualState: PET_STATES.FAILED,
      progress: 0,
      attention: ATTENTION.FAILURE,
      label: failureMessage,
    });
  }

  if (signInRequired) {
    return Object.freeze({
      visualState: PET_STATES.WAITING,
      progress: 0,
      attention: ATTENTION.SIGN_IN,
      label: connection.oneTime ? 'One-time Codex identity check required' : 'Codex sign-in required',
    });
  }

  if (busy && phase === 'running') {
    return Object.freeze({
      visualState: PET_STATES.RUNNING,
      progress,
      attention: ATTENTION.NONE,
      label: 'Running agent',
    });
  }

  if (busy && phase === 'verifying') {
    return Object.freeze({
      visualState: PET_STATES.WAITING,
      progress,
      attention: ATTENTION.NONE,
      label: 'Verifying Codex connection…',
    });
  }

  if (verifying) {
    return Object.freeze({
      visualState: PET_STATES.WAITING,
      progress: 0,
      attention: ATTENTION.NONE,
      label: 'Verifying Codex connection…',
    });
  }

  return Object.freeze({
    visualState: PET_STATES.IDLE,
    progress: 0,
    attention: ATTENTION.NONE,
    label: 'Ready',
  });
}

// Convenience builder: turn the main-process sources into the normalized input derivePetState
// expects. `managerSnapshot` is runtime.manager.getSnapshot() ({ busy, connectionId, ... });
// `connectionRecord` is the active connection's stored record (may carry needsSignIn /
// authenticated flags); `runProgress` is the normalized [0,1] run progress (see
// `progressFromActivity`). Keeping this here means the wiring in main.js is a one-liner.
function derivePetInput({ managerSnapshot, connectionRecord, runProgress } = {}) {
  const snapshot = managerSnapshot || {};
  const connection = connectionRecord || null;
  const busy = snapshot.busy === true;

  let needsSignIn = false;
  if (connection) {
    if (connection.needsSignIn === true) needsSignIn = true;
    // A stored connection freshly checked as installed-but-unauthenticated is a sign-in gate.
    if (connection.authenticated === false && connection.installed === true) needsSignIn = true;
  }

  return {
    connection: connection
      ? { state: needsSignIn ? 'Sign-in required' : (connection.state || 'Ready'), failureMessage: connection.failureMessage || null, oneTime: connection.oneTime === true }
      : null,
    run: { busy, phase: snapshot.phase || (busy ? 'running' : null), progress: runProgress === undefined ? 0 : runProgress },
  };
}

// Pure run-progress helper for the pet's progress ring. Counts milestone activity events
// (commands, discrete tool actions, usage) as completed steps and derives a fraction in [0,1]
// from the activity store snapshot. A run with no events yet is 0; a finished run is clamped to
// 1 only by derivePetState's caller (the ring is most meaningful mid-run). Returns 0 when the
// snapshot is missing or empty.
function progressFromActivity(activitySnapshot) {
  const events = activitySnapshot && Array.isArray(activitySnapshot.events) ? activitySnapshot.events : [];
  if (events.length === 0) return 0;
  const milestones = events.filter((event) => {
    const kind = event && event.kind;
    return kind === 'command' || kind === 'usage' || kind === 'tool' || kind === 'action';
  }).length;
  // A run is rarely a single step; treat the count as the numerator and at least that many
  // planned steps so the ring never reads as complete until the run ends.
  const total = Math.max(milestones, 1);
  return clampUnit(milestones / total);
}

const petStateModel = Object.freeze({
  PET_STATES,
  ATTENTION,
  derivePetState,
  derivePetInput,
  progressFromActivity,
  clampUnit,
});

module.exports = petStateModel;
