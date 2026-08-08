'use strict';

// Run-scrubber model — the pure, framework-free brain behind the Phase 3 run
// scrubber (design 3.5: "Run scrubber"). A completed run card can be scrubbed
// step by step: moving through the steps shows the trace, command output, and
// diff as they stood at that point. This is a strictly READ-ONLY replay over the
// run's existing discriminated activity events — it adds no data collection and
// no provider calls.
//
// Like runCardModel, this is dual-mode: the live vanilla-DOM controller reads it
// from globalThis.claudePetRunScrubberModel (the renderer runs from file:// with
// no ESM loader), and the Preact RunScrubber component + jsdom tests import it as
// a module. Keeping the cursor math here means the live scrubber and the Preact
// component can never drift.

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

// A run is scrubbable only when it is completed (has an agent answer) and carries
// at least one trace step. In-progress runs have nothing to replay yet.
function isScrubbable(card) {
  if (!card || typeof card !== 'object') return false;
  const items = (card.trace && Array.isArray(card.trace.items)) ? card.trace.items : [];
  return Boolean(card.hasAnswer) && items.length > 0;
}

// Builds the immutable scrubber cursor state for a run card. Starts at the final
// step (index = total - 1) so the scrubber initially shows the complete run, and
// the user scrubs BACK to reconstruct intermediate states. A startIndex option
// (used to persist the cursor across re-renders) can override the default.
function buildScrubberState(card, options = {}) {
  if (!isScrubbable(card)) return null;
  const items = card.trace.items;
  const total = items.length;
  const hasStart = typeof options.startIndex === 'number' && Number.isFinite(options.startIndex);
  const index = hasStart ? clamp(Math.trunc(options.startIndex), 0, total - 1) : total - 1;
  return { runId: card.id || null, total, index };
}

// Pure cursor reducers — each returns a NEW state (never mutates), clamped to the
// valid [0, total-1] range. All are no-ops that return null on a null state.
function nextStep(state) {
  if (!state) return null;
  return { ...state, index: clamp(state.index + 1, 0, state.total - 1) };
}

function prevStep(state) {
  if (!state) return null;
  return { ...state, index: clamp(state.index - 1, 0, state.total - 1) };
}

function goToStep(state, value) {
  if (!state) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return { ...state };
  return { ...state, index: clamp(Math.trunc(n), 0, state.total - 1) };
}

// The human position: 1-based current step and total, plus boundary flags. At the
// final step isEnd is true; at the first step isStart is true.
function scrubberPosition(state) {
  if (!state) return null;
  return {
    current: state.index + 1,
    total: state.total,
    isStart: state.index <= 0,
    isEnd: state.index >= state.total - 1,
  };
}

// The cumulative trace items visible "as they stood at that point" — everything
// from the first step up to and including the current cursor. READ-ONLY; does not
// mutate the input array.
function visibleItems(state, items) {
  if (!state || !Array.isArray(items)) return [];
  return items.slice(0, state.index + 1);
}

// A status label the UI can show: "Step 3 of 7" while scrubbing, or
// "All 7 steps" once the cursor reaches the final step.
function formatScrubberLabel(state) {
  const position = scrubberPosition(state);
  if (!position) return '';
  if (position.isEnd) return `All ${position.total} steps`;
  return `Step ${position.current} of ${position.total}`;
}

const runScrubberModel = Object.freeze({
  isScrubbable,
  buildScrubberState,
  nextStep,
  prevStep,
  goToStep,
  scrubberPosition,
  visibleItems,
  formatScrubberLabel,
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = runScrubberModel;
}
if (typeof globalThis !== 'undefined') {
  globalThis.claudePetRunScrubberModel = runScrubberModel;
}
