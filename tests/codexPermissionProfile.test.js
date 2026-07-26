'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  collectNativeCodexBoundaryEvidence,
  writeCodexProfile,
  probeCodexWorkspace,
  selectNetworkProbeAddress,
} = require('../src/agent/codexPermissionProfile.js');

const TEST_CODEX_BINDING = Object.freeze({
  path: 'C:\\trusted\\codex.exe', sha256: 'c'.repeat(64), volumeSerial: 'volume-test',
  fileId: 'file-test', version: '0.145.0', publisher: 'OpenAI OpCo, LLC',
});

test('selects a usable non-loopback IPv4 address for the network probe', () => {
  assert.equal(selectNetworkProbeAddress({
    unusable: [{ family: 'IPv4', internal: false, address: '0.0.0.0' }],
    linkLocal: [{ family: 'IPv4', internal: false, address: '169.254.1.2' }],
    loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    wifi: [{ family: 'IPv4', internal: false, address: '192.168.1.38' }],
  }), '192.168.1.38');
});

test('closes the network server when host preflight fails', async () => {
  let server;
  await assert.rejects(
    probeCodexWorkspace({
      runner: { async capture() { throw new Error('runner must not start'); } },
      cliBinding: TEST_CODEX_BINDING,
      codexHome: 'unused',
      workspacePath: 'unused',
      outsideSentinel: 'unused',
      networkProbeDependencies: {
        interfaces: { wifi: [{ family: 'IPv4', internal: false, address: '127.0.0.2' }] },
        createServer(handler) {
          server = http.createServer(handler);
          return server;
        },
        get() {
          const request = new EventEmitter();
          request.setTimeout = () => request;
          request.destroy = (error) => request.emit('error', error);
          setImmediate(() => request.emit('error', new Error('preflight failed')));
          return request;
        },
      },
    }),
    (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE',
  );
  assert.equal(server.listening, false);
});

test('writes an app-owned untrusted Workspace Agent config without reading credentials', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-codex-home-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspacePath = path.join(root, 'workspace');
  await fs.mkdir(workspacePath);
  await fs.writeFile(path.join(root, 'auth.json'), '{"secret":"do not read"}', 'utf8');
  const configPath = await writeCodexProfile({ codexHome: root, workspacePath, profile: 'pet-workspace' });
  const content = await fs.readFile(configPath, 'utf8');
  assert.equal(configPath, path.join(root, 'config.toml'));
  assert.match(content, /^default_permissions = "pet-workspace"$/m);
  assert.match(content, /^approval_policy = "never"$/m);
  assert.match(content, /^allow_login_shell = false$/m);
  assert.match(content, /^web_search = "disabled"$/m);
  assert.match(content, /^hooks = false$/m);
  assert.match(content, /^\[windows\]$/m);
  assert.match(content, /^sandbox = "elevated"$/m);
  assert.match(content, new RegExp('\\[projects\\.' + JSON.stringify(path.resolve(workspacePath)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]'));
  assert.match(content, /^"\*\*\/\*\.env" = "deny"$/m);
  assert.match(content, /^enabled = false$/m);
  assert.match(content, /^exclude = \["\*KEY\*", "\*TOKEN\*", "\*SECRET\*", "ANTHROPIC_\*", "OPENAI_\*", "CODEX_API_KEY"\]$/m);
});

test('collects the complete sanitized native evidence matrix after mixed probe failures', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-native-evidence-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, 'codex-home');
  const workspacePath = path.join(root, 'workspace');
  await fs.mkdir(workspacePath);
  await writeCodexProfile({ codexHome, workspacePath });
  const originalProfile = await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8');
  const actualExitCodes = [0, 0, 0, 1, 0, 0, 1];
  let callIndex = 0;
  let outsideFixtureRoot;

  const report = await collectNativeCodexBoundaryEvidence({
    runner: {
      async capture(spec) {
        assert.equal(spec.command, 'C:\\trusted\\codex.exe');
        if (!outsideFixtureRoot) {
          const entries = await fs.readdir(root, { withFileTypes: true });
          const fixture = entries.find((entry) => entry.isDirectory()
            && entry.name.startsWith('.claude-pet-native-outside-'));
          assert.ok(fixture);
          outsideFixtureRoot = path.join(root, fixture.name);
          assert.equal(path.dirname(outsideFixtureRoot), path.dirname(workspacePath));
          assert.notEqual(outsideFixtureRoot, workspacePath);
          assert.notEqual(outsideFixtureRoot, codexHome);
        }
        return {
          exitCode: actualExitCodes[callIndex++],
          stdout: `private output ${root}`,
          stderr: `private error ${root}`,
        };
      },
    },
    cliBinding: TEST_CODEX_BINDING,
    codexHome,
    workspacePath,
    temporaryRoots: [],
  });

  assert.equal(callIndex, 7);
  assert.deepEqual(report, {
    available: false,
    results: [
      { id: 'workspace-read', passed: true, expectedExitCode: 0, actualExitCode: 0 },
      { id: 'workspace-write', passed: true, expectedExitCode: 0, actualExitCode: 0 },
      { id: 'outside-read', passed: false, expectedExitCode: 1, actualExitCode: 0 },
      { id: 'outside-write', passed: true, expectedExitCode: 1, actualExitCode: 1 },
      { id: 'network', passed: false, expectedExitCode: 1, actualExitCode: 0 },
      { id: 'hostile-project-override', passed: true, expectedExitCode: 0, actualExitCode: 0 },
      { id: 'hook-sentinel', passed: false, expectedExitCode: 0, actualExitCode: 1 },
      { id: 'cleanup', passed: true, expectedExitCode: 0, actualExitCode: 0 },
    ],
  });
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.results), true);
  assert.equal(report.results.every((result) => Object.isFrozen(result)), true);
  assert.equal(report.results.every((result) => assert.deepEqual(
    Object.keys(result), ['id', 'passed', 'expectedExitCode', 'actualExitCode'],
  ) === undefined), true);
  assert.equal(JSON.stringify(report).includes(root), false);
  assert.equal(await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8'), originalProfile);
  assert.equal(await fs.access(outsideFixtureRoot).then(() => true, () => false), false);
  assert.deepEqual((await fs.readdir(workspacePath)).filter((name) => name.startsWith('.claude-pet-codex-probe-')), []);
});

test('reports profile-restoration failure in cleanup and remains unavailable', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-native-cleanup-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, 'codex-home');
  const workspacePath = path.join(root, 'workspace');
  await fs.mkdir(workspacePath);
  await writeCodexProfile({ codexHome, workspacePath });
  let calls = 0;

  const report = await collectNativeCodexBoundaryEvidence({
    runner: {
      async capture(spec) {
        calls += 1;
        if (calls === 7) await fs.rm(codexHome, { recursive: true, force: true });
        return { exitCode: spec.expectExitCode, stdout: '', stderr: '' };
      },
    },
    cliBinding: TEST_CODEX_BINDING,
    codexHome,
    workspacePath,
    temporaryRoots: [],
  });

  assert.equal(calls, 7);
  assert.deepEqual(report.results.at(-1), {
    id: 'cleanup', passed: false, expectedExitCode: 0, actualExitCode: 1,
  });
  assert.equal(report.available, false);
});

test('uses a new lease for each Codex native diagnostic probe and sanitizes a lease-open failure', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-native-leases-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, 'codex-home');
  const workspacePath = path.join(root, 'workspace');
  const binding = TEST_CODEX_BINDING;
  await fs.mkdir(workspacePath);
  await writeCodexProfile({ codexHome, workspacePath });
  const opened = [];
  const cleaned = [];
  let openAttempts = 0;
  const runnerCalls = [];

  const report = await collectNativeCodexBoundaryEvidence({
    runner: {
      async capture(spec) {
        runnerCalls.push(spec);
        assert.equal(spec.command, binding.path);
        assert.ok(spec.launchLease);
        return { exitCode: spec.expectExitCode, stdout: '', stderr: '' };
      },
    },
    cliBinding: binding,
    codexHome,
    workspacePath,
    temporaryRoots: [],
    openVerifiedNativeCliLaunchLease: async (input) => {
      assert.equal(input, binding);
      openAttempts += 1;
      if (openAttempts === 3) throw new Error('lease open failed');
      const lease = { cleanup: async () => { cleaned.push(lease); } };
      opened.push(lease);
      return lease;
    },
  });

  assert.equal(openAttempts, 7);
  assert.equal(opened.length, 6);
  assert.equal(new Set(opened).size, 6);
  assert.deepEqual(cleaned, opened);
  assert.equal(runnerCalls.length, 6);
  assert.equal(report.results[2].actualExitCode, -1);
  assert.equal(report.results[2].passed, false);
  assert.deepEqual(report.results.map(({ id }) => id), [
    'workspace-read', 'workspace-write', 'outside-read', 'outside-write',
    'network', 'hostile-project-override', 'hook-sentinel', 'cleanup',
  ]);
});

test('runs every deterministic sandbox probe with the named profile and fails closed on any denial', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-codex-probes-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, 'codex-home');
  const workspacePath = path.join(root, 'workspace');
  const outsideSentinel = path.join(root, 'hook-sentinel.txt');
  await fs.mkdir(workspacePath);
  await writeCodexProfile({ codexHome, workspacePath });
  const originalProfile = await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8');
  const selectedCodexDirectory = path.join(workspacePath, '.codex');
  await fs.mkdir(selectedCodexDirectory);
  await fs.writeFile(path.join(selectedCodexDirectory, 'config.toml'), 'user-owned = true\n', 'utf8');
  const calls = [];
  let probeWorkspace;
  const runner = {
    async capture(spec) {
      calls.push(spec);
      probeWorkspace ||= spec.args[4];
      assert.equal(spec.args[4], probeWorkspace);
      assert.notEqual(probeWorkspace, workspacePath);
      assert.equal(path.dirname(probeWorkspace), workspacePath);
      assert.equal(await fs.readFile(path.join(probeWorkspace, '.claude-pet-probe.txt'), 'utf8'), 'claude-pet-workspace-probe');
      assert.match(await fs.readFile(path.join(probeWorkspace, '.codex', 'config.toml'), 'utf8'), /sandbox_mode = "danger-full-access"/);
      const hostileHooks = JSON.parse(await fs.readFile(path.join(probeWorkspace, '.codex', 'hooks.json'), 'utf8'));
      assert.equal(hostileHooks.hooks.SessionStart[0].hooks[0].command.includes(outsideSentinel), false);
      assert.match(hostileHooks.hooks.SessionStart[0].hooks[0].command, /\.claude-pet-native-outside-/);
      assert.match(await fs.readFile(path.join(probeWorkspace, '.codex', 'rules', 'allow.rules'), 'utf8'), /decision = "allow"/);
      const activeProfile = await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8');
      assert.match(activeProfile, new RegExp('\\[projects\\.' + JSON.stringify(path.resolve(probeWorkspace)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]\\ntrust_level = "untrusted"'));
      return { exitCode: spec.expectExitCode, stdout: '', stderr: '' };
    },
  };
  const result = await probeCodexWorkspace({
    runner, cliBinding: TEST_CODEX_BINDING, codexHome, workspacePath, outsideSentinel, temporaryRoots: [],
  });
  assert.equal(result.available, true);
  assert.equal(calls.length, 7);
  for (const call of calls) {
    assert.equal(call.command, TEST_CODEX_BINDING.path);
    assert.deepEqual(call.args.slice(0, 7), ['sandbox', '-P', 'pet-workspace', '-C', probeWorkspace, '--', 'powershell.exe']);
    assert.equal(call.env.CODEX_HOME, codexHome);
  }
  assert.equal(await fs.readFile(path.join(selectedCodexDirectory, 'config.toml'), 'utf8'), 'user-owned = true\n');
  assert.equal(await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8'), originalProfile);
  assert.deepEqual((await fs.readdir(workspacePath)).filter((name) => name.startsWith('.claude-pet-codex-probe-')), []);

  await assert.rejects(
    probeCodexWorkspace({
      runner: { async capture() { return { exitCode: 1, stdout: '', stderr: '' }; } },
      cliBinding: TEST_CODEX_BINDING, codexHome, workspacePath, outsideSentinel, temporaryRoots: [],
    }),
    (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE',
  );
  assert.equal(await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8'), originalProfile);
  assert.deepEqual((await fs.readdir(workspacePath)).filter((name) => name.startsWith('.claude-pet-codex-probe-')), []);
});

test('uses a real outside-read target while keeping the hostile-hook sentinel absent', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-codex-probe-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, 'codex-home');
  const workspacePath = path.join(root, 'workspace');
  const outsideSentinel = path.join(root, 'hook-sentinel.txt');
  await fs.mkdir(workspacePath);
  await writeCodexProfile({ codexHome, workspacePath });
  const originalProfile = await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8');
  const calls = [];
  let outsideFixtureRoot;
  const runner = {
    async capture(spec) {
      calls.push(spec);
      const source = spec.args.at(-1);
      if (source.includes('ReadAllText') && source.includes('outside-read.txt')) {
        const match = source.match(/ReadAllText\(("(?:\\.|[^"])*")\)/);
        assert.ok(match);
        const readTarget = JSON.parse(match[1]);
        outsideFixtureRoot = path.dirname(readTarget);
        assert.equal(path.dirname(outsideFixtureRoot), path.dirname(workspacePath));
        assert.match(path.basename(outsideFixtureRoot), /^\.claude-pet-native-outside-/);
        assert.equal(await fs.readFile(readTarget, 'utf8'), 'claude-pet-outside-read-probe');
      }
      return { exitCode: spec.expectExitCode, stdout: '', stderr: '' };
    },
  };

  assert.deepEqual(
    await probeCodexWorkspace({
      runner, cliBinding: TEST_CODEX_BINDING, codexHome, workspacePath, outsideSentinel, temporaryRoots: [],
    }),
    { available: true, allowed: true },
  );
  assert.equal(calls.some((call) => call.args.at(-1).includes('hook-sentinel.txt')), true);
  assert.equal(calls.some((call) => /http:\/\/(?!127\.)\d+\.\d+\.\d+\.\d+:\d+/.test(call.args.at(-1))), true);
  assert.equal(await fs.stat(outsideSentinel).then(() => true, () => false), false);
  assert.equal(await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8'), originalProfile);
  assert.equal(await fs.stat(outsideFixtureRoot).then(() => true, () => false), false);
});

test('rejects and preserves an injected sibling fixture that is not empty', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-owned-probe-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, 'codex-home');
  const workspacePath = path.join(root, 'workspace');
  const siblingFixture = await fs.mkdtemp(path.join(root, '.claude-pet-native-outside-'));
  const outsideReadTarget = path.join(siblingFixture, 'outside-read.txt');
  await fs.mkdir(workspacePath);
  await writeCodexProfile({ codexHome, workspacePath });
  await fs.writeFile(outsideReadTarget, 'user-owned', 'utf8');
  let runnerCalls = 0;

  const report = await collectNativeCodexBoundaryEvidence({
      runner: { async capture() { runnerCalls += 1; throw new Error('runner must not start'); } },
      cliBinding: TEST_CODEX_BINDING,
      codexHome,
      workspacePath,
      temporaryRoots: [],
      async makeSiblingFixture(prefix) {
        assert.equal(prefix, path.join(root, '.claude-pet-native-outside-'));
        return siblingFixture;
      },
    });
  assert.equal(report.available, false);
  assert.equal(runnerCalls, 0);
  assert.equal(await fs.readFile(outsideReadTarget, 'utf8'), 'user-owned');
});

test('rejects a sibling fixture beneath a temporary root before launching a probe', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-temp-fixture-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, 'codex-home');
  const workspacePath = path.join(root, 'workspace');
  const siblingFixture = await fs.mkdtemp(path.join(root, '.claude-pet-native-outside-'));
  await fs.mkdir(workspacePath);
  await writeCodexProfile({ codexHome, workspacePath });
  let runnerCalls = 0;

  const report = await collectNativeCodexBoundaryEvidence({
    runner: { async capture() { runnerCalls += 1; return { exitCode: 0 }; } },
    cliBinding: TEST_CODEX_BINDING,
    codexHome,
    workspacePath,
    temporaryRoots: [root],
    async makeSiblingFixture() { return siblingFixture; },
  });

  assert.equal(report.available, false);
  assert.equal(runnerCalls, 0);
  assert.equal(await fs.access(siblingFixture).then(() => true, () => false), true);
});

test('removes a partially written hostile fixture before probing', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-partial-probe-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, 'codex-home');
  const workspacePath = path.join(root, 'workspace');
  const outsideSentinel = path.join(root, 'hook-sentinel.txt');
  await fs.mkdir(workspacePath);
  await writeCodexProfile({ codexHome, workspacePath });
  let runnerCalls = 0;

  await assert.rejects(
    probeCodexWorkspace({
      runner: { async capture() { runnerCalls += 1; throw new Error('runner must not start'); } },
      cliBinding: TEST_CODEX_BINDING,
      codexHome,
      workspacePath,
      outsideSentinel,
      temporaryRoots: [],
      probeFixtureDependencies: {
        async writeFile(filePath, ...args) {
          if (filePath.endsWith('allow.rules')) throw new Error('fixture write failed');
          return fs.writeFile(filePath, ...args);
        },
      },
    }),
    (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE',
  );
  assert.equal(runnerCalls, 0);
  assert.deepEqual((await fs.readdir(workspacePath)).filter((name) => name.startsWith('.claude-pet-codex-probe-')), []);
  assert.deepEqual((await fs.readdir(root)).filter((name) => name.startsWith('.claude-pet-native-outside-')), []);
});

test('removes the owned outside-write sentinel if a broken sandbox changes it', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-broken-probe-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, 'codex-home');
  const workspacePath = path.join(root, 'workspace');
  const outsideSentinel = path.join(root, 'hook-sentinel.txt');
  await fs.mkdir(workspacePath);
  await writeCodexProfile({ codexHome, workspacePath });
  let outsideWriteTarget;

  await assert.rejects(
    probeCodexWorkspace({
      runner: {
        async capture(spec) {
          const source = spec.args.at(-1);
          if (source.includes('outside-write.txt') && source.includes("'blocked'")) {
            const match = source.match(/WriteAllText\(("(?:\\.|[^"])*"), 'blocked'\)/);
            assert.ok(match);
            outsideWriteTarget = JSON.parse(match[1]);
            await fs.writeFile(outsideWriteTarget, 'escaped', 'utf8');
            return { exitCode: 0, stdout: '', stderr: '' };
          }
          return { exitCode: spec.expectExitCode, stdout: '', stderr: '' };
        },
      },
      cliBinding: TEST_CODEX_BINDING,
      codexHome,
      workspacePath,
      outsideSentinel,
      temporaryRoots: [],
    }),
    (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE',
  );
  assert.ok(outsideWriteTarget);
  assert.equal(await fs.access(path.dirname(outsideWriteTarget)).then(() => true, () => false), false);
  assert.equal(await fs.access(outsideSentinel).then(() => true, () => false), false);
});
