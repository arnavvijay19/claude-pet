'use strict';

const path = require('node:path');

const { createCodexCompatibility, createCodexCompatibilityQualifier } = require('../src/agent/codexCompatibility.js');
const { createCodexCompatibilityStore } = require('../src/agent/codexCompatibilityStore.js');
const { discoverSignedNativeCli } = require('../src/agent/nativeCliDiscovery.js');
const { createSafeStorageCrypto } = require('../src/agent/safeStorageCrypto.js');

async function runCodexCompatibilityDiagnostic({ discover, ensureCompatible, workspacePath } = {}) {
  if (typeof discover !== 'function' || typeof ensureCompatible !== 'function'
      || typeof workspacePath !== 'string' || workspacePath.length === 0) {
    throw new TypeError('Codex compatibility diagnostic requires app-owned dependencies');
  }
  const binding = await discover({ provider: 'codex-cli', workspacePath });
  const compatibility = await ensureCompatible(binding);
  if (!binding || binding.publisher !== 'OpenAI OpCo, LLC'
      || typeof binding.version !== 'string'
      || !compatibility || compatibility.compatible !== true
      || compatibility.version !== binding.version) {
    throw new Error('Codex compatibility diagnostic did not complete');
  }
  return Object.freeze({
    publisher: 'OpenAI OpCo, LLC',
    version: binding.version,
    staticIdentity: 'verified',
    compatibility: 'compatible',
    providerEndpoint: 'loopback',
    realCredentialUsed: false,
    realModelRequestUsed: false,
    cleanup: true,
  });
}

async function main() {
  const { app, safeStorage } = require('electron');
  await app.whenReady();
  const userDataPath = app.getPath('userData');
  const workspacePath = path.join(userDataPath, 'codex-compatibility-diagnostic');
  const store = createCodexCompatibilityStore({
    filePath: path.join(userDataPath, 'codex-compatibility.evidence'),
    crypto: createSafeStorageCrypto(safeStorage),
  });
  const qualifier = createCodexCompatibilityQualifier({
    compatibilityRoot: workspacePath,
    fixtureRoot: path.join(__dirname, '..', 'resources', 'probes'),
  });
  const coordinator = createCodexCompatibility({ store, qualify: qualifier });
  const report = await runCodexCompatibilityDiagnostic({
    discover: discoverSignedNativeCli,
    ensureCompatible: coordinator.ensureCompatible,
    workspacePath,
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

module.exports = { main, runCodexCompatibilityDiagnostic };

if (require.main === module) {
  main().catch(() => {
    process.stderr.write('Codex compatibility diagnostic failed.\n');
    process.exitCode = 1;
  });
}
