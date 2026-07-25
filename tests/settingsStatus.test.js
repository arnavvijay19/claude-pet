'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatTestStatus } = require('../src/settings/settingsStatus.js');

test('shows a signed-out Codex diagnostic without exposing command output', () => {
  assert.equal(formatTestStatus({ status: { installed: true, authenticated: false, workspaceAvailable: false } }), 'Codex is not signed in. Select Sign in to Codex.');
  assert.equal(formatTestStatus({ status: { installed: true, authenticated: true }, permission: { available: true, allowed: true } }), 'Connection diagnostic completed.');
});
