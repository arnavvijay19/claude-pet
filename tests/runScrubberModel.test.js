'use strict';

// Pure run-scrubber model tests (Phase 3 Task 5 / design 3.5). No DOM: exercises the
// framework-free brain that both the live vanilla-DOM controller and the Preact
// RunScrubber component derive their cursor math from.

const {
  isScrubbable,
  buildScrubberState,
  nextStep,
  prevStep,
  goToStep,
  scrubberPosition,
  visibleItems,
  formatScrubberLabel,
} = require('../src/renderer/components/runScrubberModel.js');
const { mapEventToTrace } = require('../src/renderer/components/runCardModel.js');

const test = require('node:test');
const assert = require('node:assert/strict');

const card = {
  id: 't1',
  hasAnswer: true,
  trace: {
    steps: 3,
    filesChanged: 1,
    durationMs: 0,
    items: [
      { id: 'evt-0', kind: 'file', operation: 'modify', path: 'a.js', label: 'Modified a.js' },
      { id: 'evt-1', kind: 'command', command: 'git status', exitCode: 0, label: 'git status' },
      { id: 'evt-2', kind: 'command', command: 'npm test', exitCode: 0, output: '3 passing', label: 'npm test' },
    ],
  },
};

test('isScrubbable is true only for completed runs that carry trace steps', () => {
  assert.equal(isScrubbable(card), true);
  assert.equal(isScrubbable(null), false);
  assert.equal(isScrubbable({ id: 'x', hasAnswer: false, trace: { items: [{}] } }), false);
  assert.equal(isScrubbable({ id: 'x', hasAnswer: true, trace: { items: [] } }), false);
  assert.equal(isScrubbable({ id: 'x', hasAnswer: true }), false);
});

test('buildScrubberState defaults to the final step and records total/runId', () => {
  const state = buildScrubberState(card);
  assert.equal(state.total, 3);
  assert.equal(state.index, 2);
  assert.equal(state.runId, 't1');
});

test('buildScrubberState honors a clamped startIndex option', () => {
  assert.equal(buildScrubberState(card, { startIndex: 0 }).index, 0);
  assert.equal(buildScrubberState(card, { startIndex: 99 }).index, 2, 'over-range clamps to last');
  assert.equal(buildScrubberState(card, { startIndex: -5 }).index, 0, 'under-range clamps to first');
  assert.equal(buildScrubberState({ id: 'x', hasAnswer: true, trace: { items: [] } }), null, 'non-scrubbable returns null');
});

test('nextStep / prevStep move and clamp at the boundaries', () => {
  const atStart = buildScrubberState(card, { startIndex: 0 });
  assert.equal(prevStep(atStart).index, 0, 'prev at start is a no-op');
  const atEnd = buildScrubberState(card);
  assert.equal(nextStep(atEnd).index, 2, 'next at end is a no-op');
  assert.equal(nextStep(atStart).index, 1);
  assert.equal(prevStep(buildScrubberState(card, { startIndex: 1 })).index, 0);
  assert.equal(nextStep(null), null, 'reducers are null-safe');
});

test('goToStep jumps and clamps; NaN leaves the state untouched', () => {
  assert.equal(goToStep(buildScrubberState(card), 1).index, 1);
  assert.equal(goToStep(buildScrubberState(card), 50).index, 2);
  const unchanged = goToStep(buildScrubberState(card), NaN);
  assert.equal(unchanged.index, 2);
});

test('scrubberPosition reports 1-based current/total and boundary flags', () => {
  const end = scrubberPosition(buildScrubberState(card));
  assert.deepEqual(end, { current: 3, total: 3, isStart: false, isEnd: true });
  const start = scrubberPosition(buildScrubberState(card, { startIndex: 0 }));
  assert.deepEqual(start, { current: 1, total: 3, isStart: true, isEnd: false });
  assert.equal(scrubberPosition(null), null);
});

test('visibleItems returns the cumulative items up to and including the cursor', () => {
  assert.equal(visibleItems(buildScrubberState(card, { startIndex: 0 }), card.trace.items).length, 1);
  assert.equal(visibleItems(buildScrubberState(card), card.trace.items).length, 3);
  const mid = visibleItems(buildScrubberState(card, { startIndex: 1 }), card.trace.items);
  assert.equal(mid.length, 2);
  assert.equal(mid[1].id, 'evt-1');
  assert.deepEqual(visibleItems(null, card.trace.items), []);
});

test('formatScrubberLabel reads "All N steps" at the end and "Step k of N" otherwise', () => {
  assert.equal(formatScrubberLabel(buildScrubberState(card)), 'All 3 steps');
  assert.equal(formatScrubberLabel(buildScrubberState(card, { startIndex: 1 })), 'Step 2 of 3');
  assert.equal(formatScrubberLabel(null), '');
});

test('mapEventToTrace carries command output when present and null otherwise', () => {
  const withOutput = mapEventToTrace({ kind: 'command', command: 'npm test', exitCode: 0, output: '3 passing' }, 0);
  assert.equal(withOutput.output, '3 passing');
  const without = mapEventToTrace({ kind: 'command', command: 'ls', exitCode: 0 }, 1);
  assert.equal(without.output, null);
});
