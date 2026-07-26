'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatTestStatus } = require('../src/settings/settingsStatus.js');

test('shows a signed-out Codex diagnostic without exposing command output', () => {
  assert.equal(formatTestStatus({ status: { installed: true, authenticated: false, workspaceAvailable: false } }), 'Codex is not signed in. Select Sign in to Codex.');
  assert.equal(formatTestStatus({ executorType: 'claude-code-cli', status: { installed: true, authenticated: false, workspaceAvailable: false } }), 'Claude Code is not signed in. Select Sign in to Claude Code.');
  assert.equal(formatTestStatus({ executorType: 'claude-code-cli', status: { installed: true, authenticated: false, workspaceAvailable: false }, permission: { available: false, allowed: false } }), 'Claude Code Workspace permission is unavailable on this computer.');
  assert.equal(formatTestStatus({ failure: { message: 'The permission profile is unavailable.' } }), 'The permission profile is unavailable.');
  assert.equal(formatTestStatus({ status: { installed: true, authenticated: true }, permission: { available: true, allowed: true } }), 'Connection diagnostic completed.');
});
