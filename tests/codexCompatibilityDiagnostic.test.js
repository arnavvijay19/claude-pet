'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  main,
  runCodexCompatibilityDiagnostic,
} = require('../scripts/diagnose-codex-compatibility.js');

const BINDING = Object.freeze({
  path: 'C:\\private\\codex.exe',
  sha256: 'a'.repeat(64),
  volumeSerial: 'private-volume',
  fileId: 'private-file-id',
  version: '0.146.0',
  publisher: 'OpenAI OpCo, LLC',
});

test('imports a diagnostic module without running it and exposes an explicit main', () => {
  assert.equal(typeof main, 'function');
  assert.equal(typeof runCodexCompatibilityDiagnostic, 'function');
});

test('emits only the bounded compatible diagnostic contract', async () => {
  const result = await runCodexCompatibilityDiagnostic({
    discover: async () => BINDING,
    ensureCompatible: async () => ({ compatible: true, version: '0.146.0', cached: false }),
    workspacePath: 'C:\\app-owned\\codex-compatibility-diagnostic',
  });
  assert.deepEqual(result, {
    publisher: 'OpenAI OpCo, LLC',
    version: '0.146.0',
    staticIdentity: 'verified',
    compatibility: 'compatible',
    providerEndpoint: 'loopback',
    realCredentialUsed: false,
    realModelRequestUsed: false,
    cleanup: true,
  });
  assert.deepEqual(Object.keys(result), [
    'publisher', 'version', 'staticIdentity', 'compatibility', 'providerEndpoint',
    'realCredentialUsed', 'realModelRequestUsed', 'cleanup',
  ]);
  const serialized = JSON.stringify(result);
  for (const forbidden of ['path', 'hash', 'file', 'junction', 'environment', 'bearer', 'stdout', 'stderr', 'cause', 'private']) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false, forbidden);
  }
});
