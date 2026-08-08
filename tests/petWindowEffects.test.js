'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  ringArcPath,
  ringViewModel,
  attentionBadge,
  polarToCartesian,
  clampUnit,
  RING_DEFAULTS,
  ATTENTION_TONE,
} = require('../src/renderer/petWindowEffects.js');

// --- ringArcPath: pure SVG arc geometry -------------------------------------

test('ringArcPath at 0 progress is empty (renderer hides the ring)', () => {
  assert.strictEqual(ringArcPath({ progress: 0 }), '');
  assert.strictEqual(ringArcPath({ progress: -0.3 }), '');
  assert.strictEqual(ringArcPath({ progress: NaN }), '');
});

test('ringArcPath at 0.25 is a quarter arc from top to right', () => {
  assert.strictEqual(
    ringArcPath({ progress: 0.25 }),
    'M 96.000 12.000 A 92.000 92.000 0 0 1 188.000 104.000',
  );
});

test('ringArcPath at 0.5 is a semicircle (large-arc flag 0)', () => {
  assert.strictEqual(
    ringArcPath({ progress: 0.5 }),
    'M 96.000 12.000 A 92.000 92.000 0 0 1 96.000 196.000',
  );
});

test('ringArcPath at 0.75 sets the large-arc flag', () => {
  assert.strictEqual(
    ringArcPath({ progress: 0.75 }),
    'M 96.000 12.000 A 92.000 92.000 0 1 1 4.000 104.000',
  );
});

test('ringArcPath at 1 is a full circle (two 180deg arcs)', () => {
  assert.strictEqual(
    ringArcPath({ progress: 1 }),
    'M 96.000 12.000 A 92.000 92.000 0 0 1 96.000 196.000 A 92.000 92.000 0 0 1 96.000 12.000',
  );
});

test('ringArcPath clamps overshoot to a full circle', () => {
  assert.strictEqual(
    ringArcPath({ progress: 2 }),
    ringArcPath({ progress: 1 }),
  );
});

test('ringArcPath honors custom geometry', () => {
  assert.strictEqual(
    ringArcPath({ progress: 0.5, cx: 10, cy: 10, radius: 5, startAngleDeg: 0 }),
    'M 15.000 10.000 A 5.000 5.000 0 0 1 5.000 10.000',
  );
});

// --- ringViewModel: resolved view model -------------------------------------

test('ringViewModel is invisible at 0 and resolves defaults', () => {
  const vm = ringViewModel({ progress: 0 });
  assert.strictEqual(vm.fraction, 0);
  assert.strictEqual(vm.visible, false);
  assert.strictEqual(vm.path, '');
  assert.deepStrictEqual(
    { cx: vm.cx, cy: vm.cy, radius: vm.radius, strokeWidth: vm.strokeWidth },
    {
      cx: RING_DEFAULTS.cx, cy: RING_DEFAULTS.cy,
      radius: RING_DEFAULTS.radius, strokeWidth: RING_DEFAULTS.strokeWidth,
    },
  );
});

test('ringViewModel exposes geometry for a live fraction', () => {
  const vm = ringViewModel({ progress: 0.4 });
  assert.strictEqual(vm.fraction, 0.4);
  assert.strictEqual(vm.visible, true);
  assert.ok(vm.path.startsWith('M 96.000 12.000'));
});

// --- attentionBadge: visible attention state --------------------------------

test('attentionBadge is hidden for none', () => {
  assert.deepStrictEqual(attentionBadge({ attention: 'none' }), {
    visible: false, tone: null, attention: 'none', label: null,
  });
  assert.deepStrictEqual(attentionBadge({}), {
    visible: false, tone: null, attention: 'none', label: null,
  });
});

test('attentionBadge maps sign-in to the info tone with a default label', () => {
  assert.deepStrictEqual(attentionBadge({ attention: 'sign-in' }), {
    visible: true, tone: 'info', attention: 'sign-in', label: 'Sign in required',
  });
});

test('attentionBadge maps failure to the danger tone with a default label', () => {
  assert.deepStrictEqual(attentionBadge({ attention: 'failure' }), {
    visible: true, tone: 'danger', attention: 'failure', label: 'Connection failed',
  });
});

test('attentionBadge keeps an explicit label', () => {
  const signIn = attentionBadge({ attention: 'sign-in', label: 'One-time identity check' });
  assert.strictEqual(signIn.label, 'One-time identity check');
  const failure = attentionBadge({ attention: 'failure', label: 'Codex bridge offline' });
  assert.strictEqual(failure.label, 'Codex bridge offline');
});

test('ATTENTION_TONE has no tone for none and a tone for the two alerts', () => {
  assert.strictEqual(ATTENTION_TONE.none, null);
  assert.strictEqual(ATTENTION_TONE['sign-in'], 'info');
  assert.strictEqual(ATTENTION_TONE.failure, 'danger');
});

// --- helpers ----------------------------------------------------------------

test('clampUnit clamps to [0,1] and treats non-finite as 0', () => {
  assert.strictEqual(clampUnit(-1), 0);
  assert.strictEqual(clampUnit(0.5), 0.5);
  assert.strictEqual(clampUnit(2), 1);
  assert.strictEqual(clampUnit(NaN), 0);
  assert.strictEqual(clampUnit('x'), 0);
});

test('polarToCartesian places the top of the ring at 12 oclock', () => {
  const top = polarToCartesian(96, 104, 92, -90);
  assert.deepStrictEqual({ x: Math.round(top.x), y: Math.round(top.y) }, { x: 96, y: 12 });
  const right = polarToCartesian(96, 104, 92, 0);
  assert.deepStrictEqual({ x: Math.round(right.x), y: Math.round(right.y) }, { x: 188, y: 104 });
});
