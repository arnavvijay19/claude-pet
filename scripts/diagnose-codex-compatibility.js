'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createCodexCompatibility, createCodexCompatibilityQualifier } = require('../src/agent/codexCompatibility.js');
const { createCodexCompatibilityStore } = require('../src/agent/codexCompatibilityStore.js');
const { minimalEnvironment } = require('../src/agent/cliRunner.js');
const { discoverSignedNativeCli } = require('../src/agent/nativeCliDiscovery.js');
const { createSafeStorageCrypto } = require('../src/agent/safeStorageCrypto.js');
const { terminateWindowsProcessTree } = require('../src/agent/windowsProcessTree.js');

const MAXIMUM_CHILD_OUTPUT_BYTES = 64 * 1024;
const BOUNDED_DIAGNOSTIC_KEYS = Object.freeze([
  'publisher', 'version', 'staticIdentity', 'compatibility', 'providerEndpoint',
  'realCredentialUsed', 'realModelRequestUsed', 'cleanup',
]);

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

function boundedDiagnosticOutput(output) {
  if (typeof output !== 'string' || Buffer.byteLength(output, 'utf8') > MAXIMUM_CHILD_OUTPUT_BYTES) {
    return null;
  }
  let report;
  try { report = JSON.parse(output); } catch { return null; }
  if (!report || Object.getPrototypeOf(report) !== Object.prototype
      || Object.keys(report).length !== BOUNDED_DIAGNOSTIC_KEYS.length
      || !BOUNDED_DIAGNOSTIC_KEYS.every((key) => Object.hasOwn(report, key))
      || report.publisher !== 'OpenAI OpCo, LLC'
      || typeof report.version !== 'string' || report.version.length === 0
      || report.staticIdentity !== 'verified' || report.compatibility !== 'compatible'
      || report.providerEndpoint !== 'loopback' || report.realCredentialUsed !== false
      || report.realModelRequestUsed !== false || report.cleanup !== true) return null;
  return `${JSON.stringify(report)}\n`;
}

async function relaunchThroughElectron(electronPath, {
  fileSystem = fs,
  spawnProcess = spawn,
  terminateProcessTree = terminateWindowsProcessTree,
  timeoutMs = 60_000,
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  const profilePath = await fileSystem.mkdtemp(path.join(os.tmpdir(), 'claude-pet-codex-compatibility-'));
  let childSpawned = false;
  let childClosed = false;
  let terminationRequired = false;
  let terminationComplete = false;
  try {
    const appPath = path.join(profilePath, 'app');
    await fileSystem.mkdir(appPath);
    await fileSystem.writeFile(path.join(appPath, 'package.json'), JSON.stringify({
      name: 'claude-pet-codex-compatibility-diagnostic', main: 'main.js', private: true,
    }), 'utf8');
    await fileSystem.writeFile(path.join(appPath, 'main.js'), [
      "'use strict';",
      `require(${JSON.stringify(__filename)}).main().catch(() => {`,
      "  process.stderr.write('Codex compatibility diagnostic failed.\\n');",
      "  require('electron').app.exit(1);",
      '});',
      '',
    ].join('\n'), 'utf8');
    const exit = await new Promise((resolve, reject) => {
      const child = spawnProcess(electronPath, [`--user-data-dir=${profilePath}`, appPath], {
        env: minimalEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      childSpawned = true;
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let outputExceeded = false;
      let timedOut = false;
      let termination = null;
      const capture = (current, chunk) => {
        const chunkBytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, 'utf8');
        if (chunkBytes > MAXIMUM_CHILD_OUTPUT_BYTES - current.length) {
          outputExceeded = true;
          return current;
        }
        return Buffer.concat([current, Buffer.from(chunk)]);
      };
      const onStdout = (chunk) => { stdout = capture(stdout, chunk); };
      const onStderr = (chunk) => { stderr = capture(stderr, chunk); };
      child.stdout?.on?.('data', onStdout);
      child.stderr?.on?.('data', onStderr);
      const timeout = setTimeout(() => {
        timedOut = true;
        terminationRequired = true;
        termination = Promise.resolve().then(
          () => terminateProcessTree({ pid: child.pid, execFile: electronPath }),
        );
        termination.catch(() => {});
      }, timeoutMs);
      const finish = () => {
        clearTimeout(timeout);
        child.stdout?.removeListener?.('data', onStdout);
        child.stderr?.removeListener?.('data', onStderr);
      };
      child.once('error', (error) => {
        finish();
        childClosed = true;
        reject(error);
      });
      child.once('close', (code, signal) => {
        finish();
        childClosed = true;
        resolve({ code, signal, outputExceeded, timedOut, termination, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') });
      });
    });
    if (exit.termination) {
      try {
        await exit.termination;
        terminationComplete = true;
      } catch {
        throw new Error('Electron compatibility diagnostic did not complete');
      }
    }
    const output = exit.outputExceeded ? null : boundedDiagnosticOutput(exit.stdout);
    if (exit.code !== 0 || exit.signal !== null || exit.timedOut || !output) {
      throw new Error('Electron compatibility diagnostic did not complete');
    }
    writeOutput(output);
  } finally {
    if (!childSpawned || (childClosed && (!terminationRequired || terminationComplete))) {
      await fileSystem.rm(profilePath, { recursive: true, force: true });
    }
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

module.exports = { main, relaunchThroughElectron, runCodexCompatibilityDiagnostic };

if (require.main === module) {
  main().catch(() => {
    process.stderr.write('Codex compatibility diagnostic failed.\n');
    process.exitCode = 1;
  });
}
