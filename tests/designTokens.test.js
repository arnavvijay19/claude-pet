'use strict';

// Design tokens are an ESM (.mjs) module, so load them with a dynamic import
// from this CommonJS test. (require() of .mjs throws ERR_REQUIRE_ESM.)

const test = require('node:test');
const assert = require('node:assert/strict');

async function loadTokens() {
  return import('../src/renderer/designTokens.mjs');
}

test('exposes a complete, frozen design-token scale', async () => {
  const tokens = (await loadTokens()).default;
  assert.ok(tokens && typeof tokens === 'object');

  for (const key of ['spacing', 'font', 'radius', 'color', 'stateTone']) {
    assert.ok(tokens[key], `token group "${key}" is present`);
    assert.equal(Object.isFrozen(tokens[key]), true, `"${key}" group is frozen`);
  }
  assert.equal(Object.isFrozen(tokens), true, 'top-level token object is frozen');
});

test('carries concrete values the components rely on', async () => {
  const tokens = (await loadTokens()).default;
  assert.equal(tokens.spacing.md, '12px');
  assert.equal(tokens.spacing.xl, '24px');
  assert.equal(tokens.radius.pill, '999px');
  assert.equal(tokens.font.familyMono.includes('monospace'), true);

  // Semantic colors use fixed, safe values (no credentials, no raw paths).
  assert.equal(tokens.color.danger, '#c0392b');
  assert.equal(tokens.color.success, '#1e8e5a');
  assert.equal(tokens.color.accent, '#2f6feb');
});

test('maps connection/run states to a consistent tone vocabulary', async () => {
  const tokens = (await loadTokens()).default;
  assert.equal(tokens.stateTone.idle, 'muted');
  assert.equal(tokens.stateTone.ready, 'success');
  assert.equal(tokens.stateTone.verifying, 'info');
  assert.equal(tokens.stateTone.running, 'info');
  assert.equal(tokens.stateTone['sign-in-required'], 'warning');
  assert.equal(tokens.stateTone.blocked, 'danger');
});

test('provides both named and default exports', async () => {
  const mod = await loadTokens();
  const tokens = mod.default;
  assert.equal(mod.spacing, tokens.spacing);
  assert.equal(mod.designTokens, tokens);
});
