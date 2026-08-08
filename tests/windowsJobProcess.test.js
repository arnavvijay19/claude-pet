'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn: realSpawn } = require('node:child_process');
const test = require('node:test');

const {
  JOB_PROTOCOL_VERSION,
  MAX_ENVELOPE_BYTES,
  MAX_READY_BYTES,
  MAX_READY_TIMEOUT_MS,
  READY_LINE,
  createWindowsJobProcessLauncher,
  resolveHelperPath,
  buildLaunchEnvelope,
  parseReadiness,
} = require('../src/agent/windowsJobProcess.js');

const {
  OUTPUT_NAMES,
  PROTOCOL_VERSION,
  buildProviderJobHost,
  defaultCompilerCandidates,
} = require('../scripts/build-provider-job-host.js');

const FAKE_HELPER = path.join(__dirname, '..', 'scripts', '_fixtures', 'fake-provider-job-host.cjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Runs the fake helper through node so it behaves like a real child process.
function nodeSpawn(override) {
  return (command, args, options = {}) => {
    const opts = Object.assign({}, options);
    opts.cwd = path.dirname(command); // posix dir of the .cjs fixture
    if (typeof override === 'function') override(opts);
    return realSpawn(process.execPath, [command].concat(args || []), opts);
  };
}

// Captures the spawn options the adapter hands to spawn (proves env inheritance etc.).
function capturingNodeSpawn(capture) {
  return nodeSpawn((opts) => { capture(opts); });
}

function validSpec() {
  return {
    command: 'C:\\app\\provider.exe',
    args: ['--flag', 'value'],
    options: {
      cwd: 'C:\\app',
      env: { PATH: 'C:\\app', SYSTEMROOT: 'C:\\Windows' },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  };
}

function makeLauncher(overrides = {}) {
  return createWindowsJobProcessLauncher(Object.assign({
    spawn: nodeSpawn(),
    helperPath: FAKE_HELPER,
    ownerPid: process.pid,
    ownerExecutable: 'fake-provider-job-host.cjs',
    readyTimeoutMs: 5000,
  }, overrides));
}

function readLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const idx = buffer.indexOf('\n');
      if (idx === -1) return;
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      cleanup();
      resolve(line);
    };
    const onError = (err) => { cleanup(); reject(err); };
    const onEnd = () => {
      cleanup();
      if (buffer.length) resolve(buffer.replace(/\r$/, ''));
      else reject(new Error('stream ended before a full line'));
    };
    const cleanup = () => {
      stream.removeListener('data', onData);
      stream.removeListener('error', onError);
      stream.removeListener('end', onEnd);
    };
    stream.on('data', onData);
    stream.on('error', onError);
    stream.on('end', onEnd);
  });
}

function waitClose(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('close', () => resolve());
  });
}

// ---------------------------------------------------------------------------
// Adapter bounds / exports
// ---------------------------------------------------------------------------

test('adapter exports the documented constants and bounds', () => {
  assert.equal(JOB_PROTOCOL_VERSION, 1);
  assert.equal(MAX_ENVELOPE_BYTES, 65536);
  assert.equal(MAX_READY_BYTES, 128);
  assert.equal(MAX_READY_TIMEOUT_MS, 30000);
  assert.ok(READY_LINE.equals(Buffer.from('CLAUDE_PET_JOB_READY 1\r\n', 'ascii')));
});

test('resolveHelperPath points at the generated helper executable', () => {
  const p = resolveHelperPath();
  assert.ok(path.isAbsolute(p));
  assert.ok(p.endsWith(path.join('resources', 'windows', 'generated', 'provider-job-host.exe')));
});

// ---------------------------------------------------------------------------
// Envelope framing
// ---------------------------------------------------------------------------

test('buildLaunchEnvelope frames a well-formed, goal-free envelope', () => {
  const envelope = buildLaunchEnvelope(Object.assign(
    { ownerPid: process.pid, ownerExecutable: 'host.exe' },
    validSpec(),
  ));
  assert.ok(Buffer.isBuffer(envelope));
  const text = envelope.toString('utf8');
  assert.ok(text.endsWith('\n'), 'envelope is newline-terminated');
  const parsed = JSON.parse(text.slice(0, -1));
  assert.equal(parsed.protocolVersion, 1);
  assert.equal(parsed.command, 'C:\\app\\provider.exe');
  assert.deepEqual(parsed.args, ['--flag', 'value']);
  assert.equal(parsed.cwd, 'C:\\app');
  assert.equal(parsed.visible, false); // windowsHide true => not visible
  assert.equal(parsed.ownerPid, process.pid);
  assert.equal(parsed.ownerExecutable, 'host.exe');
  assert.equal(parsed.env, undefined, 'envelope never carries the environment');
  assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_ENVELOPE_BYTES);
});

test('visible:true maps to visible:true and a hidden run stays hidden', () => {
  const hidden = buildLaunchEnvelope(Object.assign(
    { ownerPid: process.pid, ownerExecutable: 'host.exe' },
    validSpec(),
  ));
  assert.equal(JSON.parse(hidden.toString('utf8').trim()).visible, false);

  const visibleSpec = validSpec();
  visibleSpec.options.windowsHide = false;
  const visible = buildLaunchEnvelope(Object.assign(
    { ownerPid: process.pid, ownerExecutable: 'host.exe' },
    visibleSpec,
  ));
  assert.equal(JSON.parse(visible.toString('utf8').trim()).visible, true);
});

test('buildLaunchEnvelope rejects invalid command, args, options, and owner', () => {
  const base = { ownerPid: process.pid, ownerExecutable: 'host.exe' };
  const fails = (fn) => (err) => err != null && err.code === 'COMMAND_FAILED';
  assert.throws(
    () => buildLaunchEnvelope(Object.assign({}, base, validSpec(), { command: 'relative.exe' })),
    fails(),
  );
  assert.throws(
    () => buildLaunchEnvelope(Object.assign({}, base, validSpec(), {
      options: Object.assign({}, validSpec().options, { shell: true }),
    })),
    fails(),
  );
  assert.throws(
    () => buildLaunchEnvelope(Object.assign({}, base, validSpec(), {
      options: Object.assign({}, validSpec().options, { stdio: ['pipe', 'inherit', 'pipe'] }),
    })),
    fails(),
  );
  const tooMany = Array.from({ length: 257 }, (_, i) => `a${i}`);
  assert.throws(
    () => buildLaunchEnvelope(Object.assign({}, base, validSpec(), { args: tooMany })),
    fails(),
  );
  assert.throws(
    () => buildLaunchEnvelope(Object.assign({}, validSpec(), { ownerPid: -1, ownerExecutable: 'h' })),
    fails(),
  );
});

test('parseReadiness detects the exact readiness line only', () => {
  assert.equal(parseReadiness(Buffer.from('CLAUDE_PET_JOB_READY 1\r\n')), true);
  assert.equal(parseReadiness('CLAUDE_PET_JOB_READY 1\r\n'), true);
  assert.equal(parseReadiness('CLAUDE_PET_JOB_WRONG 1\r\n'), false);
  assert.equal(parseReadiness('garbage'), false);
  assert.equal(parseReadiness(''), false);
});

// ---------------------------------------------------------------------------
// Integration: launch through the fake helper
// ---------------------------------------------------------------------------

test('launch returns providerAssigned and preserves stdout/stderr streams', async () => {
  const launcher = makeLauncher();
  const pending = launcher.launch(validSpec());
  const { child, execFile, providerAssigned } = await pending;

  assert.equal(execFile, FAKE_HELPER);
  assert.equal(providerAssigned, true);
  assert.ok(child && typeof child.pid === 'number');

  // provider-stderr marker arrives on the helper's stderr, after the readiness frame.
  const stderrLine = await readLine(child.stderr);
  assert.equal(stderrLine, 'provider-stderr');

  // provider stdin (written by the app) is proxied to provider stdout.
  const echoed = readLine(child.stdout);
  child.stdin.write('ping\n');
  const outLine = await echoed;
  assert.equal(outLine, 'ping');

  child.stdin.end();
  await waitClose(child);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test('killing the helper tears the launch down cleanly', async () => {
  const launcher = makeLauncher();
  const { child, providerAssigned } = await launcher.launch(validSpec());
  assert.equal(providerAssigned, true);
  child.kill();
  await waitClose(child);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test('helper inherits env unchanged and receives no env key in the envelope', async () => {
  let captured = null;
  const launcher = makeLauncher({ spawn: capturingNodeSpawn((opts) => { captured = opts; }) });
  const spec = validSpec();
  const { child } = await launcher.launch(spec);
  assert.ok(captured);
  assert.equal(captured.env, spec.options.env, 'env object passed unchanged');
  assert.deepEqual(captured.stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(captured.shell, false);
  assert.equal(captured.windowsHide, true);

  const envelope = buildLaunchEnvelope(Object.assign(
    { ownerPid: process.pid, ownerExecutable: 'host.exe' },
    spec,
  ));
  assert.equal(JSON.parse(envelope.toString('utf8').trim()).env, undefined);

  child.stdin.end();
  await waitClose(child);
});

test('a malformed readiness frame rejects the launch', async () => {
  const spec = validSpec();
  spec.options.env = Object.assign({}, spec.options.env, { FAKE_HELPER_WRONG: '1' });
  const launcher = makeLauncher({ readyTimeoutMs: 3000 });
  await assert.rejects(
    launcher.launch(spec),
    (err) => err.code === 'COMMAND_FAILED',
  );
});

test('no readiness frame within the timeout rejects the launch', async () => {
  const spec = validSpec();
  spec.options.env = Object.assign({}, spec.options.env, { FAKE_HELPER_SILENT: '1' });
  const launcher = makeLauncher({ readyTimeoutMs: 300 });
  await assert.rejects(
    launcher.launch(spec),
    (err) => err.code === 'COMMAND_FAILED',
  );
});

// ---------------------------------------------------------------------------
// Build-script pure functions / offline build (no real csc)
// ---------------------------------------------------------------------------

function fakeCompiler(command, args) {
  if (args.includes('/?')) {
    return {
      status: 0,
      stdout: 'Microsoft (R) Visual C# Compiler version 4.8.9032.0\r\n',
      stderr: '',
    };
  }
  const outArg = args.find((a) => a.startsWith('/out:'));
  const outPath = outArg.slice('/out:'.length);
  fs.writeFileSync(outPath, 'compiled-fake');
  return { status: 0, stdout: '', stderr: '' };
}

test('build module exports the documented build contract', () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.deepEqual(Object.keys(OUTPUT_NAMES).sort(), ['executable', 'record']);
  assert.equal(OUTPUT_NAMES.executable, 'provider-job-host.exe');
  assert.equal(OUTPUT_NAMES.record, 'provider-job-host.build.json');
  assert.deepEqual(
    defaultCompilerCandidates('C:\\Windows'),
    [
      'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
      'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
    ],
  );
});

test('buildProviderJobHost produces a frozen record with pure hashing (no csc invoked)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'job-adapter-build-'));
  try {
    const sourcePath = path.join(root, 'provider-job-host.cs');
    const compilerPath = path.join(root, 'csc.exe');
    const outputDirectory = path.join(root, 'generated');
    const sourceBytes = Buffer.from('// offline build fixture source');
    fs.writeFileSync(sourcePath, sourceBytes);
    fs.writeFileSync(compilerPath, 'fixture compiler');

    const result = buildProviderJobHost({
      sourcePath,
      outputDirectory,
      compilerCandidates: [compilerPath],
      spawnSync: fakeCompiler,
    });

    assert.deepEqual(Object.keys(result).sort(), [
      'architecture',
      'compilerPath',
      'compilerVersion',
      'executableSha256',
      'protocolVersion',
      'sourceSha256',
    ]);
    assert.equal(result.protocolVersion, 1);
    assert.equal(result.architecture, 'x64');
    assert.equal(result.compilerPath, compilerPath);
    assert.equal(result.compilerVersion, '4.8.9032.0');
    assert.match(result.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(result.executableSha256, /^[a-f0-9]{64}$/);
    assert.ok(Object.isFrozen(result));

    // hashes are independently reproducible.
    assert.equal(
      crypto.createHash('sha256').update(sourceBytes).digest('hex'),
      result.sourceSha256,
    );
    const exeBytes = fs.readFileSync(path.join(outputDirectory, OUTPUT_NAMES.executable));
    assert.equal(
      crypto.createHash('sha256').update(exeBytes).digest('hex'),
      result.executableSha256,
    );

    // record file on disk matches the returned record.
    const onDisk = JSON.parse(fs.readFileSync(
      path.join(outputDirectory, OUTPUT_NAMES.record),
      'utf8',
    ));
    assert.deepEqual(onDisk, result);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildProviderJobHost fails without a compiler or with compiler warnings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'job-adapter-build-fail-'));
  try {
    const sourcePath = path.join(root, 'provider-job-host.cs');
    const compilerPath = path.join(root, 'csc.exe');
    const outputDirectory = path.join(root, 'generated');
    fs.writeFileSync(sourcePath, '// x');
    fs.writeFileSync(compilerPath, 'fixture compiler');

    assert.throws(
      () => buildProviderJobHost({
        sourcePath,
        outputDirectory,
        compilerCandidates: [],
        spawnSync: fakeCompiler,
      }),
      /provider helper compiler unavailable/i,
    );

    assert.throws(
      () => buildProviderJobHost({
        sourcePath,
        outputDirectory,
        compilerCandidates: [compilerPath],
        spawnSync(command, args) {
          if (args.includes('/?')) {
            return { status: 0, stdout: 'Microsoft (R) Visual C# Compiler version 4.8.9032.0\r\n', stderr: '' };
          }
          return { status: 0, stdout: '', stderr: 'warning CS1234: simulated' };
        },
      }),
      /provider helper compilation failed/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
