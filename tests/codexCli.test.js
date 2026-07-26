'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MINIMUM_CODEX_VERSION, MODEL_IDS, EFFORTS, createCodexCliExecutor,
} = require('../src/agent/executors/codexCli.js');
const { AgentError } = require('../src/agent/agentErrors.js');

function fakeRunner(overrides = {}) {
  const calls = [];
  return {
    calls,
    capture: async (spec) => {
      calls.push({ method: 'capture', spec });
      if (spec.args[0] === '--version') return { exitCode: 0, stdout: 'codex-cli 0.145.0\n', stderr: '' };
      if (spec.args[0] === 'login') return { exitCode: 0, stdout: 'signed in\n', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    },
    streamJsonl: async (spec, onEvent) => {
      calls.push({ method: 'streamJsonl', spec });
      onEvent({ type: 'item.completed', item: { type: 'agent_message', text: 'Completed Codex goal.' } });
      return { exitCode: 0, stderr: 'authorization: Bearer secret-value' };
    },
    launch: async (spec) => { calls.push({ method: 'launch', spec }); return { child: { pid: 42 } }; },
    ...overrides,
  };
}

function connection(overrides = {}) {
  return { workspacePath: 'Z:\\workspace', permissionProfile: 'workspace', modelId: 'gpt-5.6-terra', effort: 'medium', ...overrides };
}

function runRequest(overrides = {}) {
  return { goal: 'write a note', workspace: 'Z:\\workspace', permissionProfile: 'workspace', model: 'gpt-5.6-terra', effort: 'medium', ...overrides };
}

const TEST_BINDING = Object.freeze({
  path: 'C:\\Program Files\\OpenAI\\Codex\\codex.exe', sha256: 'a'.repeat(64),
  volumeSerial: 'volume-test', fileId: 'file-test', version: '0.145.0', publisher: 'OpenAI OpCo, LLC',
});

function nativeCliDependencies() {
  return {
    discoverSignedNativeCli: async () => TEST_BINDING,
    openVerifiedNativeCliLaunchLease: async () => ({ cleanup: async () => {} }),
  };
}

test('exports the exact Codex registry and rejects a version or unlisted model before execution', async () => {
  assert.equal(MINIMUM_CODEX_VERSION, '0.144.6');
  assert.deepEqual(MODEL_IDS, ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  assert.deepEqual(EFFORTS, ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  const runner = fakeRunner({ capture: async () => ({ exitCode: 0, stdout: 'codex-cli 0.144.5', stderr: '' }) });
  const executor = createCodexCliExecutor({ runner, codexHome: 'Z:\\pet-codex', ...nativeCliDependencies() });
  assert.deepEqual(await executor.getStatus(connection()), { installed: true, authenticated: false, workspaceAvailable: false });
  await assert.rejects(executor.runGoal(runRequest({ goal: 'do not run', model: 'not-listed' }), () => {}, new AbortController().signal), { code: 'MODEL_UNAVAILABLE' });

  const missing = createCodexCliExecutor({
    runner: fakeRunner(), codexHome: 'Z:\\pet-codex',
    discoverSignedNativeCli: async () => { throw new AgentError('CLI_NOT_INSTALLED'); },
  });
  assert.deepEqual(await missing.getStatus(connection()), { installed: false, authenticated: false, workspaceAvailable: false });
});

test('uses only the dedicated home, exact hermetic exec arguments, and the last agent message', async () => {
  const runner = fakeRunner();
  const profiles = [];
  const executor = createCodexCliExecutor({
    runner, codexHome: 'Z:\\pet-codex',
    ...nativeCliDependencies(),
    writeProfile: async (input) => { profiles.push(input); return 'Z:\\pet-codex\\config.toml'; },
    probePermissionProfile: async () => ({ available: true, allowed: true }),
  });
  const events = [];
  const result = await executor.runGoal(runRequest(), (event) => events.push(event), new AbortController().signal);
  assert.deepEqual(profiles, [{ codexHome: 'Z:\\pet-codex', workspacePath: 'Z:\\workspace' }]);
  const { signal, launchLease, ...streamSpec } = runner.calls.at(-1).spec;
  assert.equal(signal instanceof AbortSignal, true);
  assert.equal(typeof launchLease.cleanup, 'function');
  assert.deepEqual(streamSpec, {
    command: TEST_BINDING.path,
    args: ['exec', '--ephemeral', '--json', '--skip-git-repo-check', '--color', 'never', '--strict-config', '--ignore-rules', '--disable', 'hooks', '--model', 'gpt-5.6-terra'],
    cwd: 'Z:\\workspace', env: { CODEX_HOME: 'Z:\\pet-codex' }, goal: 'write a note',
  });
  assert.deepEqual(result, { text: 'Completed Codex goal.', changedFiles: [] });
  assert.deepEqual(events, [{ phase: 'responding', kind: 'message', summary: 'Codex response ready' }]);
});

test('maps permission denials and nonzero or malformed stream output without exposing stderr secrets', async () => {
  const denied = fakeRunner({
    streamJsonl: async () => { const error = new Error('approval denied'); throw error; },
  });
  const executor = createCodexCliExecutor({ runner: denied, codexHome: 'Z:\\pet-codex', ...nativeCliDependencies(), writeProfile: async () => 'config', probePermissionProfile: async () => ({ available: true, allowed: true }) });
  await assert.rejects(executor.runGoal(runRequest({ goal: 'x' }), () => {}, new AbortController().signal), { code: 'PERMISSION_BLOCKED' });
});

test('binds every Codex status, login, and run child to a freshly leased discovered executable', async () => {
  const binding = Object.freeze({
    path: 'C:\\Program Files\\OpenAI\\Codex\\codex.exe', sha256: 'a'.repeat(64),
    volumeSerial: 'volume-1', fileId: 'file-1', version: '0.145.0', publisher: 'OpenAI OpCo, LLC',
  });
  const discovered = [];
  const openedLeases = [];
  const cleanedLeases = [];
  const runner = fakeRunner({
    capture: async (spec) => {
      assert.equal(spec.command, binding.path);
      assert.ok(spec.launchLease);
      if (spec.args[0] === '--version') return { exitCode: 0, stdout: 'codex-cli 0.145.0\n', stderr: '' };
      return { exitCode: 1, stdout: '', stderr: '' };
    },
    launch: async (spec) => {
      assert.equal(spec.command, binding.path);
      assert.ok(spec.launchLease);
      return { child: { pid: 42 } };
    },
    streamJsonl: async (spec, onEvent) => {
      assert.equal(spec.command, binding.path);
      assert.ok(spec.launchLease);
      onEvent({ type: 'item.completed', item: { type: 'agent_message', text: 'leased run' } });
      return { exitCode: 0, stderr: '' };
    },
  });
  const executor = createCodexCliExecutor({
    runner,
    codexHome: 'Z:\\pet-codex',
    discoverSignedNativeCli: async (input) => {
      discovered.push(input);
      return binding;
    },
    openVerifiedNativeCliLaunchLease: async (input) => {
      assert.equal(input, binding);
      const lease = { cleanup: async () => { cleanedLeases.push(lease); } };
      openedLeases.push(lease);
      return lease;
    },
    writeProfile: async () => 'Z:\\pet-codex\\config.toml',
    probePermissionProfile: async () => ({ available: true, allowed: true }),
  });

  assert.deepEqual(await executor.getStatus(connection()), {
    installed: true, authenticated: false, workspaceAvailable: false,
  });
  assert.deepEqual(await executor.beginSetup(connection()), { started: true });
  assert.deepEqual(
    await executor.runGoal(runRequest(), () => {}, new AbortController().signal),
    { text: 'leased run', changedFiles: [] },
  );
  assert.deepEqual(discovered, [
    { provider: 'codex-cli', workspacePath: 'Z:\\workspace' },
    { provider: 'codex-cli', workspacePath: 'Z:\\workspace' },
    { provider: 'codex-cli', workspacePath: 'Z:\\workspace' },
  ]);
  assert.equal(openedLeases.length, 5);
  assert.equal(new Set(openedLeases).size, 5);
  assert.deepEqual(cleanedLeases, openedLeases);
});

test('fails a successful Codex run when cleanup fails but preserves the command error', async () => {
  const binding = Object.freeze({
    path: 'C:\\Program Files\\OpenAI\\Codex\\codex.exe', sha256: 'a'.repeat(64),
    volumeSerial: 'volume-1', fileId: 'file-1', version: '0.145.0', publisher: 'OpenAI OpCo, LLC',
  });
  let cleanupCalls = 0;
  const executor = createCodexCliExecutor({
    runner: fakeRunner({
      streamJsonl: async (_spec, onEvent) => {
        onEvent({ type: 'item.completed', item: { type: 'agent_message', text: 'complete' } });
        return { exitCode: 0, stderr: '' };
      },
    }),
    codexHome: 'Z:\\pet-codex',
    discoverSignedNativeCli: async () => binding,
    openVerifiedNativeCliLaunchLease: async () => ({
      cleanup: async () => { cleanupCalls += 1; throw new Error('cleanup failed'); },
    }),
    writeProfile: async () => 'Z:\\pet-codex\\config.toml',
  });
  await assert.rejects(executor.runGoal(runRequest(), () => {}, new AbortController().signal), { code: 'COMMAND_FAILED' });
  assert.equal(cleanupCalls, 1);

  const preserving = createCodexCliExecutor({
    runner: fakeRunner({ streamJsonl: async () => { throw new AgentError('PERMISSION_BLOCKED'); } }),
    codexHome: 'Z:\\pet-codex',
    discoverSignedNativeCli: async () => binding,
    openVerifiedNativeCliLaunchLease: async () => ({
      cleanup: async () => { cleanupCalls += 1; throw new Error('cleanup failed'); },
    }),
    writeProfile: async () => 'Z:\\pet-codex\\config.toml',
  });
  await assert.rejects(preserving.runGoal(runRequest(), () => {}, new AbortController().signal), { code: 'PERMISSION_BLOCKED' });
  assert.equal(cleanupCalls, 2);
});

test('rejects a relative Codex workspace before native discovery', async () => {
  let discoveries = 0;
  const executor = createCodexCliExecutor({
    runner: fakeRunner(), codexHome: 'Z:\\pet-codex',
    discoverSignedNativeCli: async () => { discoveries += 1; return TEST_BINDING; },
  });
  const relativeConnection = connection({ workspacePath: 'relative-workspace' });
  assert.deepEqual(await executor.getStatus(relativeConnection), {
    installed: false, authenticated: false, workspaceAvailable: false,
  });
  await assert.rejects(executor.beginSetup(relativeConnection), { code: 'UNSUPPORTED_OPTION' });
  assert.equal(discoveries, 0);
});
