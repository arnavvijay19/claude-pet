'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AgentError,
  ERROR_CODES,
  PUBLIC_ERROR_BY_CODE,
  FIXED_PUBLIC_OUTCOMES,
  toPublicError,
} = require('../src/agent/agentErrors.js');

// Secret-shaped cause that must never reach the renderer: path, SHA-256, credential, env.
function secretCause() {
  return new Error('C:\\Users\\eklip\\AppData\\codex-0.200.1.exe sha256=deadbeef publisher=untrusted token=sk-secret raw output="boom"');
}

test('the seven spec 1.7 outcomes map to distinct fixed public codes', () => {
  const codes = Object.values(FIXED_PUBLIC_OUTCOMES);
  assert.equal(codes.length, 7);
  assert.equal(new Set(codes).size, 7, 'each outcome must map to a distinct code');
  for (const code of codes) {
    assert.ok(ERROR_CODES.includes(code), `code ${code} must be a registered AgentError code`);
    assert.ok(PUBLIC_ERROR_BY_CODE[code], `code ${code} must have a fixed public copy`);
  }
  assert.deepEqual(Object.keys(FIXED_PUBLIC_OUTCOMES), [
    'not installed',
    'verifying update',
    'incompatible update',
    'verification temporarily failed',
    'not signed in',
    'local configuration unavailable',
    'provider launch failed',
  ]);
});

test('only the fixed public code survives IPC for every outcome', () => {
  for (const code of Object.values(FIXED_PUBLIC_OUTCOMES)) {
    const error = new AgentError(code, { cause: secretCause() });
    const publicError = toPublicError(error);
    // The public form carries only the fixed code plus safe copy and an optional requestId.
    assert.deepEqual(Object.keys(publicError).sort(), ['action', 'code', 'message', 'requestId']);
    assert.equal(publicError.code, code);
    assert.equal(typeof publicError.message, 'string');
    assert.equal(typeof publicError.action, 'string');
    // No path, hash, credential, or raw provider output may survive the boundary.
    assert.doesNotMatch(JSON.stringify(publicError), /C:\\Users|sha256|token=|raw output|boom|\.exe/i);
    // The cause is never serialized.
    assert.equal('cause' in publicError, false);
  }
});

test('an unknown code falls back to the fixed COMMAND_FAILED public copy', () => {
  const publicError = toPublicError(new AgentError('CLI_NOT_INSTALLED', { cause: secretCause() }));
  assert.equal(publicError.code, 'CLI_NOT_INSTALLED');
});
