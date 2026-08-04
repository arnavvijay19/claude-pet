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

test('formats fixed safe compatibility diagnostics before signed-out status', () => {
  assert.equal(
    formatTestStatus({ status: { installed: true, compatible: false, authenticated: false } }),
    'This Codex update is not compatible with Claude Pet yet. Update Claude Pet or install a compatible Codex version.',
  );
  assert.equal(
    formatTestStatus({ failure: {
      code: 'CLI_COMPATIBILITY_CHECK_FAILED',
      message: 'Claude Pet could not finish checking this Codex update.',
      action: 'Retry the compatibility check.',
      cause: 'C:\\Users\\test\\codex-0.200.1.exe sha256=secret publisher=untrusted raw output',
    } }),
    'Claude Pet could not finish checking this Codex update. Retry the compatibility check.',
  );
});
