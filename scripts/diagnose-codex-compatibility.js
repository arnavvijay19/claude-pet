'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
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

async function relaunchThroughElectron(electronPath) {
  const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-codex-compatibility-'));
  try {
    const appPath = path.join(profilePath, 'app');
    await fs.mkdir(appPath);
    await fs.writeFile(path.join(appPath, 'package.json'), JSON.stringify({
      name: 'claude-pet-codex-compatibility-diagnostic', main: 'main.js', private: true,
    }), 'utf8');
    await fs.writeFile(path.join(appPath, 'main.js'), [
      "'use strict';",
      `require(${JSON.stringify(__filename)}).main().catch(() => {`,
      "  process.stderr.write('Codex compatibility diagnostic failed.\\n');",
      "  require('electron').app.exit(1);",
      '});',
      '',
    ].join('\n'), 'utf8');
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    const exit = await new Promise((resolve, reject) => {
      const child = spawn(electronPath, [`--user-data-dir=${profilePath}`, appPath], {
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
      const timeout = setTimeout(() => child.kill(), 60_000);
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('close', (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    });
    if (exit.code !== 0 || exit.signal !== null) {
      throw new Error('Electron compatibility diagnostic did not complete');
    }
  } finally {
    await fs.rm(profilePath, { recursive: true, force: true });
  }
}

async function main() {
  const electron = require('electron');
  if (typeof electron === 'string') {
    await relaunchThroughElectron(electron);
    return;
  }
  const { app, safeStorage } = electron;
  await app.whenReady();
  let exitCode = 1;
  try {
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
    exitCode = 0;
  } finally {
    app.exit(exitCode);
  }
}

module.exports = { main, runCodexCompatibilityDiagnostic };

if (require.main === module) {
  main().catch(() => {
    process.stderr.write('Codex compatibility diagnostic failed.\n');
    process.exitCode = 1;
  });
}
