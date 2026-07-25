'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { writeCodexProfile, probeCodexWorkspace, selectNetworkProbeAddress } = require('../src/agent/codexPermissionProfile.js');

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
      assert.equal(hostileHooks.hooks.SessionStart[0].hooks[0].command.includes(outsideSentinel), true);
      assert.match(await fs.readFile(path.join(probeWorkspace, '.codex', 'rules', 'allow.rules'), 'utf8'), /decision = "allow"/);
      const activeProfile = await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8');
      assert.match(activeProfile, new RegExp('\\[projects\\.' + JSON.stringify(path.resolve(probeWorkspace)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]\\ntrust_level = "untrusted"'));
      return { exitCode: spec.expectExitCode, stdout: '', stderr: '' };
    },
  };
  const result = await probeCodexWorkspace({ runner, codexHome, workspacePath, outsideSentinel });
  assert.equal(result.available, true);
  assert.equal(calls.length, 7);
  for (const call of calls) {
    assert.equal(call.command, 'codex');
    assert.deepEqual(call.args.slice(0, 7), ['sandbox', '-P', 'pet-workspace', '-C', probeWorkspace, '--', 'powershell.exe']);
    assert.equal(call.env.CODEX_HOME, codexHome);
  }
  assert.equal(await fs.readFile(path.join(selectedCodexDirectory, 'config.toml'), 'utf8'), 'user-owned = true\n');
  assert.equal(await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8'), originalProfile);
  assert.deepEqual((await fs.readdir(workspacePath)).filter((name) => name.startsWith('.claude-pet-codex-probe-')), []);

  await assert.rejects(
    probeCodexWorkspace({
      runner: { async capture() { return { exitCode: 1, stdout: '', stderr: '' }; } },
      codexHome, workspacePath, outsideSentinel,
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
  const runner = {
    async capture(spec) {
      calls.push(spec);
      const source = spec.args.at(-1);
      if (source.includes('ReadAllText') && source.includes('read-probe')) {
        const readTarget = `${outsideSentinel}.read-probe`;
        assert.equal(await fs.readFile(readTarget, 'utf8'), 'claude-pet-outside-read-probe');
      }
      return { exitCode: spec.expectExitCode, stdout: '', stderr: '' };
    },
  };

  assert.deepEqual(
    await probeCodexWorkspace({ runner, codexHome, workspacePath, outsideSentinel }),
    { available: true, allowed: true },
  );
  assert.equal(calls.some((call) => call.args.at(-1).includes('hook-sentinel.txt')), true);
  assert.equal(calls.some((call) => /http:\/\/(?!127\.)\d+\.\d+\.\d+\.\d+:\d+/.test(call.args.at(-1))), true);
  assert.equal(await fs.stat(outsideSentinel).then(() => true, () => false), false);
  assert.equal(await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8'), originalProfile);
  assert.equal(await fs.stat(`${outsideSentinel}.read-probe`).then(() => true, () => false), false);
});

test('does not delete a pre-existing outside-read target it does not own', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-owned-probe-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, 'codex-home');
  const workspacePath = path.join(root, 'workspace');
  const outsideSentinel = path.join(root, 'hook-sentinel.txt');
  const outsideReadTarget = `${outsideSentinel}.read-probe`;
  await fs.mkdir(workspacePath);
  await writeCodexProfile({ codexHome, workspacePath });
  await fs.writeFile(outsideReadTarget, 'user-owned', 'utf8');

  await assert.rejects(
    probeCodexWorkspace({
      runner: { async capture() { throw new Error('runner must not start'); } },
      codexHome,
      workspacePath,
      outsideSentinel,
    }),
    (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE',
  );
  assert.equal(await fs.readFile(outsideReadTarget, 'utf8'), 'user-owned');
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
      codexHome,
      workspacePath,
      outsideSentinel,
      probeFixtureDependencies: {
        async writeFile(filePath, ...args) {
          if (filePath.endsWith('allow.rules')) throw new Error('fixture write failed');
          return fs.writeFile(filePath, ...args);
        },
      },
    }),
    (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE'
      && error.cause?.message === 'fixture write failed',
  );
  assert.equal(runnerCalls, 0);
  assert.deepEqual((await fs.readdir(workspacePath)).filter((name) => name.startsWith('.claude-pet-codex-probe-')), []);
});

test('removes the sentinel if a broken sandbox lets the hostile probe create it', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-broken-probe-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, 'codex-home');
  const workspacePath = path.join(root, 'workspace');
  const outsideSentinel = path.join(root, 'hook-sentinel.txt');
  await fs.mkdir(workspacePath);
  await writeCodexProfile({ codexHome, workspacePath });

  await assert.rejects(
    probeCodexWorkspace({
      runner: {
        async capture(spec) {
          const source = spec.args.at(-1);
          if (source.includes('hook-sentinel.txt') && source.includes("'blocked'")) {
            await fs.writeFile(outsideSentinel, 'escaped', 'utf8');
            return { exitCode: 0, stdout: '', stderr: '' };
          }
          return { exitCode: spec.expectExitCode, stdout: '', stderr: '' };
        },
      },
      codexHome,
      workspacePath,
      outsideSentinel,
    }),
    (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE',
  );
  assert.equal(await fs.access(outsideSentinel).then(() => true, () => false), false);
});
