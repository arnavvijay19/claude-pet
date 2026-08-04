'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const path = require('node:path');

const {
  main,
  relaunchThroughElectron,
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

function runDocumentedDiagnostic() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/diagnose-codex-compatibility.js'], {
      cwd: path.join(__dirname, '..'),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function electronChild(pid = 4321) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

function ownedFileSystem(events) {
  return {
    mkdtemp: async () => 'C:\\Temp\\claude-pet-codex-compatibility-owned',
    mkdir: async () => {},
    writeFile: async () => {},
    rm: async (target) => { events.push(`remove:${target}`); },
  };
}

test('relaunch discards failing Electron child diagnostics instead of publishing them', async () => {
  // Catches forwarding raw Electron stdout/stderr into this public bounded diagnostic.
  const events = [];
  const output = [];
  const child = electronChild();
  await assert.rejects(relaunchThroughElectron('C:\\tools\\electron.exe', {
    fileSystem: ownedFileSystem(events),
    spawnProcess: () => {
      queueMicrotask(() => {
        child.stdout.end('C:\\private\\codex.exe bearer raw-child-output');
        child.stderr.end('C:\\private\\electron-failure');
        child.emit('close', 1, null);
      });
      return child;
    },
    writeOutput: (value) => output.push(value),
  }));
  assert.deepEqual(output, []);
  assert.deepEqual(events, ['remove:C:\\Temp\\claude-pet-codex-compatibility-owned']);
});

test('relaunch timeout terminates the owned Electron process tree before removing its profile', async () => {
  // Catches timeout cleanup that kills only Electron's root process and races profile removal.
  const events = [];
  const output = [];
  const child = electronChild(9876);
  await assert.rejects(relaunchThroughElectron('C:\\tools\\electron.exe', {
    fileSystem: ownedFileSystem(events),
    spawnProcess: () => child,
    terminateProcessTree: async (spec) => {
      events.push(`terminate:${spec.pid}:${spec.execFile}`);
      child.stdout.end('{"publisher":"OpenAI OpCo, LLC","version":"0.146.0","staticIdentity":"verified","compatibility":"compatible","providerEndpoint":"loopback","realCredentialUsed":false,"realModelRequestUsed":false,"cleanup":true}\n');
      child.stderr.end();
      child.emit('close', 0, null);
      return true;
    },
    timeoutMs: 1,
    writeOutput: (value) => output.push(value),
  }));
  assert.deepEqual(events, [
    'terminate:9876:C:\\tools\\electron.exe',
    'remove:C:\\Temp\\claude-pet-codex-compatibility-owned',
  ]);
  assert.deepEqual(output, []);
});

test('relaunch omits inherited Node and Electron customization variables', async () => {
  // Catches passing inherited customization into the account-free Electron diagnostic.
  const events = [];
  const output = [];
  const child = electronChild();
  const originalNodeOptions = process.env.NODE_OPTIONS;
  const originalElectronLogging = process.env.ELECTRON_ENABLE_LOGGING;
  process.env.NODE_OPTIONS = '--require C:\\private\\instrumentation.js';
  process.env.ELECTRON_ENABLE_LOGGING = '1';
  try {
    let spawnOptions;
    await relaunchThroughElectron('C:\\tools\\electron.exe', {
      fileSystem: ownedFileSystem(events),
      spawnProcess: (_command, _args, options) => {
        spawnOptions = options;
        queueMicrotask(() => {
          child.stdout.end('{"publisher":"OpenAI OpCo, LLC","version":"0.146.0","staticIdentity":"verified","compatibility":"compatible","providerEndpoint":"loopback","realCredentialUsed":false,"realModelRequestUsed":false,"cleanup":true}\n');
          child.stderr.end();
          child.emit('close', 0, null);
        });
        return child;
      },
      writeOutput: (value) => output.push(value),
    });
    assert.equal(Object.hasOwn(spawnOptions.env, 'NODE_OPTIONS'), false);
    assert.equal(Object.hasOwn(spawnOptions.env, 'ELECTRON_ENABLE_LOGGING'), false);
    assert.equal(Object.hasOwn(spawnOptions.env, 'ELECTRON_RUN_AS_NODE'), false);
    assert.deepEqual(output, ['{"publisher":"OpenAI OpCo, LLC","version":"0.146.0","staticIdentity":"verified","compatibility":"compatible","providerEndpoint":"loopback","realCredentialUsed":false,"realModelRequestUsed":false,"cleanup":true}\n']);
  } finally {
    if (originalNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = originalNodeOptions;
    if (originalElectronLogging === undefined) delete process.env.ELECTRON_ENABLE_LOGGING;
    else process.env.ELECTRON_ENABLE_LOGGING = originalElectronLogging;
  }
});

test('documented Node diagnostic completes the real Electron entrypoint boundary', { timeout: 90_000 }, async () => {
  // Catches a Node-launched entrypoint that treats Electron's executable-path export as its API.
  const result = await runDocumentedDiagnostic();
  assert.equal(result.signal, null);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    publisher: 'OpenAI OpCo, LLC',
    version: '0.146.0',
    staticIdentity: 'verified',
    compatibility: 'compatible',
    providerEndpoint: 'loopback',
    realCredentialUsed: false,
    realModelRequestUsed: false,
    cleanup: true,
  });
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
