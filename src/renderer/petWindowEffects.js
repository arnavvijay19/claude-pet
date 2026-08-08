'use strict';

// Pet-window progress ring + attention badge — the unit-testable foundation of
// Phase 3 Task 4 sub-branch 3 ("the pet becomes the agent", design §3.4).
//
// The main process already publishes two IPC channels from the pet coupling
// controller (src/agent/petCouplingController.js):
//   - `pet:progress`   -> { progress }            (run progress fraction 0..1)
//   - `pet:attention`   -> { attention, label }    ('none' | 'sign-in' | 'failure')
// This module turns those messages into pure geometry + badge state so the pet
// window can render a thin progress ring around the pet and a distinct attention
// badge WITHOUT re-deriving any state. Keeping the math here means the ring and
// badge can be unit-tested in Node (no DOM, no canvas, no Electron) while the
// renderer (src/renderer/renderer-main.js) is a thin DOM adapter.
//
// The module is intentionally free of Electron / DOM / timers so it is identical
// in the browser (loaded as a plain <script>, functions become globals) and in
// Node (CommonJS require for tests).

// Tone used by the renderer to color the attention badge. `none` carries no tone.
const ATTENTION_TONE = Object.freeze({
  none: null,
  'sign-in': 'info',
  failure: 'danger',
});

// Geometry of the ring that hugs the 192x208 pet canvas: an inscribed circle
// centered on the sprite, starting at 12 o'clock, sweeping clockwise.
const RING_DEFAULTS = Object.freeze({
  cx: 96,
  cy: 104,
  radius: 92,
  strokeWidth: 4,
  startAngleDeg: -90,
});

function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function polarToCartesian(cx, cy, radius, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

// Build an SVG arc `d` string for a progress fraction in [0,1] of a circle.
// Sweep begins at `startAngleDeg` (default -90 = top) and goes clockwise.
//   - fraction <= 0   -> '' (nothing to draw; renderer hides the ring)
//   - 0 < frac < 1    -> a single arc
//   - frac >= 1       -> a full circle (SVG cannot draw 360deg in one arc, so it
//                        is split into two 180deg arcs)
// Coordinates are rounded to 3 decimals so the output is deterministic and
// directly assertable in unit tests.
function ringArcPath({ progress, cx, cy, radius, startAngleDeg } = {}) {
  const c = cx === undefined ? RING_DEFAULTS.cx : cx;
  const cyy = cy === undefined ? RING_DEFAULTS.cy : cy;
  const r = radius === undefined ? RING_DEFAULTS.radius : radius;
  const start = startAngleDeg === undefined ? RING_DEFAULTS.startAngleDeg : startAngleDeg;
  const fraction = clampUnit(progress);
  if (fraction <= 0) return '';

  const startPoint = polarToCartesian(c, cyy, r, start);
  const endPoint = polarToCartesian(c, cyy, r, start + fraction * 360);
  const r3 = r.toFixed(3);
  const sx = startPoint.x.toFixed(3);
  const sy = startPoint.y.toFixed(3);

  if (fraction >= 1) {
    const mid = polarToCartesian(c, cyy, r, start + 180);
    const mx = mid.x.toFixed(3);
    const my = mid.y.toFixed(3);
    const ex = endPoint.x.toFixed(3);
    const ey = endPoint.y.toFixed(3);
    return `M ${sx} ${sy} A ${r3} ${r3} 0 0 1 ${mx} ${my} A ${r3} ${r3} 0 0 1 ${ex} ${ey}`;
  }

  const largeArc = fraction > 0.5 ? 1 : 0;
  const ex = endPoint.x.toFixed(3);
  const ey = endPoint.y.toFixed(3);
  return `M ${sx} ${sy} A ${r3} ${r3} 0 ${largeArc} 1 ${ex} ${ey}`;
}

// Full progress-ring view model: the computed `path` plus the resolved geometry.
// `visible` is false at fraction 0 so the renderer can hide the ring cheaply.
function ringViewModel({ progress, cx, cy, radius, strokeWidth, startAngleDeg } = {}) {
  const fraction = clampUnit(progress);
  return Object.freeze({
    fraction,
    visible: fraction > 0,
    path: ringArcPath({ progress: fraction, cx, cy, radius, startAngleDeg }),
    cx: cx === undefined ? RING_DEFAULTS.cx : cx,
    cy: cy === undefined ? RING_DEFAULTS.cy : cy,
    radius: radius === undefined ? RING_DEFAULTS.radius : radius,
    strokeWidth: strokeWidth === undefined ? RING_DEFAULTS.strokeWidth : strokeWidth,
  });
}

// Attention-badge view model. `visible` is true only for a real attention state
// (sign-in / failure); `tone` drives the badge color in the renderer and `label`
// is the human-readable reason (falling back to a sane default).
function attentionBadge({ attention, label } = {}) {
  const a = attention || 'none';
  const tone = ATTENTION_TONE[a] || null;
  const visible = tone !== null;
  const fallback = a === 'sign-in' ? 'Sign in required' : 'Connection failed';
  return Object.freeze({
    visible,
    tone: visible ? tone : null,
    attention: a,
    label: visible ? (label || fallback) : null,
  });
}

const petWindowEffects = Object.freeze({
  ATTENTION_TONE,
  RING_DEFAULTS,
  clampUnit,
  polarToCartesian,
  ringArcPath,
  ringViewModel,
  attentionBadge,
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = petWindowEffects;
}
if (typeof window !== 'undefined' && !window.petWindowEffects) {
  window.petWindowEffects = petWindowEffects;
}
