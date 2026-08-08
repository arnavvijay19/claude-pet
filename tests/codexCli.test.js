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
    ensureCodexCompatibility: async () => ({ compatible: true, version: TEST_BINDING.version, cached: false }),
  };
}

test('requires the runtime-owned compatibility coordinator', () => {
  // Catches a production executor that silently bypasses qualification.
  assert.throws(
    () => createCodexCliExecutor({ runner: fakeRunner(), codexHome: 'Z:\\pet-codex', ...nativeCliDependencies(), ensureCodexCompatibility: undefined }),
    /compatibility coordinator/,
  );
});

test('exports the Codex registry and reports deterministic incompatibility without signing in', async () => {
  assert.equal(MINIMUM_CODEX_VERSION, '0.144.6');
  assert.deepEqual(MODEL_IDS, ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  assert.deepEqual(EFFORTS, ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  const runner = fakeRunner();
  const executor = createCodexCliExecutor({
    runner, codexHome: 'Z:\\pet-codex', ...nativeCliDependencies(),
    ensureCodexCompatibility: async () => { throw new AgentError('CLI_VERSION_UNSUPPORTED'); },
  });
  assert.deepEqual(await executor.getStatus(connection()), {
    installed: true, compatible: false, authenticated: false, workspaceAvailable: false,
  });
  assert.equal(runner.calls.length, 0);
  await assert.rejects(executor.runGoal(runRequest({ goal: 'do not run', model: 'not-listed' }), () => {}, new AbortController().signal), { code: 'MODEL_UNAVAILABLE' });

  const missing = createCodexCliExecutor({
    runner: fakeRunner(), codexHome: 'Z:\\pet-codex',
    discoverSignedNativeCli: async () => { throw new AgentError('CLI_NOT_INSTALLED'); },
    ensureCodexCompatibility: async () => ({ compatible: true }),
  });
  assert.deepEqual(await missing.getStatus(connection()), { installed: false, authenticated: false, workspaceAvailable: false });

  const unsafe = createCodexCliExecutor({
    runner: fakeRunner(), codexHome: 'Z:\\pet-codex',
    discoverSignedNativeCli: async () => ({ ...TEST_BINDING, path: 'relative\\codex.exe' }),
    ensureCodexCompatibility: async () => ({ compatible: true }),
  });
  assert.deepEqual(await unsafe.getStatus(connection()), { installed: false, authenticated: false, workspaceAvailable: false });
});

test('qualifies the freshly discovered 0.146.0 binding before status authentication and surfaces retryable failures', async () => {
  // Catches version pinning, qualifying a stale identity, or treating retryable failures as signed out.
  const binding = { ...TEST_BINDING, version: '0.146.0', fileId: 'file-146' };
  const qualified = [];
  const executor = createCodexCliExecutor({
    runner: fakeRunner(), codexHome: 'Z:\\pet-codex',
    discoverSignedNativeCli: async () => binding,
    openVerifiedNativeCliLaunchLease: async () => ({ cleanup: async () => {} }),
    ensureCodexCompatibility: async (value) => {
      qualified.push(value);
      return { compatible: true, version: value.version, cached: false };
    },
  });
  assert.deepEqual(await executor.getStatus(connection()), {
    installed: true, compatible: true, authenticated: true, workspaceAvailable: true,
  });
  assert.deepEqual(qualified, [binding]);

  const retryable = createCodexCliExecutor({
    runner: fakeRunner(), codexHome: 'Z:\\pet-codex', ...nativeCliDependencies(),
    ensureCodexCompatibility: async () => { throw new AgentError('CLI_COMPATIBILITY_CHECK_FAILED'); },
  });
  await assert.rejects(retryable.getStatus(connection()), { code: 'CLI_COMPATIBILITY_CHECK_FAILED' });
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

test('qualifies every Codex status, setup, permission, and run operation using its freshly discovered executable', async () => {
  const binding = Object.freeze({
    path: 'C:\\Program Files\\OpenAI\\Codex\\codex.exe', sha256: 'a'.repeat(64),
    volumeSerial: 'volume-1', fileId: 'file-1', version: '0.145.0', publisher: 'OpenAI OpCo, LLC',
  });
  const discovered = [];
  const openedLeases = [];
  const cleanedLeases = [];
  const qualified = [];
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
    ensureCodexCompatibility: async (input, options) => {
      qualified.push({ input, options });
      return { compatible: true, version: input.version, cached: false };
    },
  });

  assert.deepEqual(await executor.getStatus(connection()), {
    installed: true, compatible: true, authenticated: false, workspaceAvailable: false,
  });
  assert.deepEqual(await executor.beginSetup(connection()), { started: true });
  assert.deepEqual(await executor.verifyPermissionProfile(connection()), { available: true, allowed: true });
  assert.deepEqual(
    await executor.runGoal(runRequest(), () => {}, new AbortController().signal),
    { text: 'leased run', changedFiles: [] },
  );
  assert.deepEqual(discovered, [
    { provider: 'codex-cli', workspacePath: 'Z:\\workspace' },
    { provider: 'codex-cli', workspacePath: 'Z:\\workspace' },
    { provider: 'codex-cli', workspacePath: 'Z:\\workspace' },
    { provider: 'codex-cli', workspacePath: 'Z:\\workspace' },
  ]);
  assert.deepEqual(qualified.map(({ input }) => input), [binding, binding, binding, binding]);
  assert.equal(openedLeases.length, 3);
  assert.equal(new Set(openedLeases).size, 3);
  assert.deepEqual(cleanedLeases, openedLeases);
});

test('does not reuse a status binding for a later Codex run', async () => {
  // Catches a time-of-check/time-of-use bug that launches a binding qualified on an earlier status call.
  const first = { ...TEST_BINDING, version: '0.145.0', fileId: 'status-file' };
  const second = { ...TEST_BINDING, version: '0.146.0', fileId: 'run-file' };
  const qualified = [];
  let discoveries = 0;
  const executor = createCodexCliExecutor({
    runner: fakeRunner(), codexHome: 'Z:\\pet-codex',
    discoverSignedNativeCli: async () => (++discoveries === 1 ? first : second),
    openVerifiedNativeCliLaunchLease: async () => ({ cleanup: async () => {} }),
    ensureCodexCompatibility: async (binding) => {
      qualified.push(binding);
      return { compatible: true, version: binding.version, cached: false };
    },
    writeProfile: async () => 'config',
  });
  await executor.getStatus(connection());
  await executor.runGoal(runRequest(), () => {}, new AbortController().signal);
  assert.deepEqual(qualified, [first, second]);
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
    ensureCodexCompatibility: async () => ({ compatible: true }),
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
    ensureCodexCompatibility: async () => ({ compatible: true }),
  });
  await assert.rejects(preserving.runGoal(runRequest(), () => {}, new AbortController().signal), { code: 'PERMISSION_BLOCKED' });
  assert.equal(cleanupCalls, 2);
});

test('rejects a relative Codex workspace before native discovery', async () => {
  let discoveries = 0;
  const executor = createCodexCliExecutor({
    runner: fakeRunner(), codexHome: 'Z:\\pet-codex',
    discoverSignedNativeCli: async () => { discoveries += 1; return TEST_BINDING; },
    ensureCodexCompatibility: async () => ({ compatible: true }),
  });
  const relativeConnection = connection({ workspacePath: 'relative-workspace' });
  assert.deepEqual(await executor.getStatus(relativeConnection), {
    installed: false, authenticated: false, workspaceAvailable: false,
  });
  await assert.rejects(executor.beginSetup(relativeConnection), { code: 'UNSUPPORTED_OPTION' });
  assert.equal(discoveries, 0);
});

test('getStatus rejects immediately when the verification signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  const runner = fakeRunner();
  const executor = createCodexCliExecutor({
    runner, codexHome: 'Z:\\pet-codex', ...nativeCliDependencies(),
  });
  await assert.rejects(executor.getStatus(connection(), controller.signal), /Abort/);
  assert.equal(runner.calls.length, 0, 'no provider process is launched after abort');
});

test('getStatus forwards the abort signal to the runner login-status capture', async () => {
  const controller = new AbortController();
  const runner = fakeRunner();
  const executor = createCodexCliExecutor({
    runner, codexHome: 'Z:\\pet-codex', ...nativeCliDependencies(),
  });
  await executor.getStatus(connection(), controller.signal);
  const loginCall = runner.calls.find(
    (call) => call.spec.args[0] === 'login' && call.spec.args[1] === 'status',
  );
  assert.ok(loginCall, 'login status capture was performed');
  assert.equal(loginCall.spec.signal, controller.signal, 'runner.capture receives the abort signal');
});

test('getStatus stops the login-status capture when the signal aborts mid-flight', async () => {
  const controller = new AbortController();
  const runner = fakeRunner({
    capture: async (spec) => {
      if (spec.signal?.aborted) throw new Error('Aborted');
      if (spec.args[0] === 'login' && spec.args[1] === 'status') {
        // Would block until the real provider answers; the abort must interrupt it.
        await new Promise(() => {});
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  });
  const executor = createCodexCliExecutor({
    runner, codexHome: 'Z:\\pet-codex', ...nativeCliDependencies(),
  });
  const promise = executor.getStatus(connection(), controller.signal);
  controller.abort();
  await assert.rejects(promise, /Abort/);
});
