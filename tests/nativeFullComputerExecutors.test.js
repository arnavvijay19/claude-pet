'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CODEX_DISABLED_FEATURES,
  codexFeatureArgs,
} = require('../src/agent/codexFeaturePolicy.js');
const codexNativeFullComputer = require('../src/agent/executors/codexNativeFullComputer.js');
const { createCodexNativeFullComputerExecutor } = codexNativeFullComputer;
const {
  CLAUDE_FULL_COMPUTER_VERSION,
  createClaudeNativeFullComputerExecutor,
} = require('../src/agent/executors/claudeNativeFullComputer.js');

const CODEX_BINDING = Object.freeze({
  path: 'C:\\Program Files\\OpenAI\\Codex\\codex.exe', version: '0.145.0',
  sha256: 'a'.repeat(64), volumeSerial: 'volume', fileId: 'codex', publisher: 'OpenAI OpCo, LLC',
});
const CLAUDE_BINDING = Object.freeze({
  path: 'C:\\Program Files\\Anthropic\\Claude\\claude.exe', version: '2.1.217',
  sha256: 'b'.repeat(64), volumeSerial: 'volume', fileId: 'claude', publisher: 'Anthropic, PBC',
});

function connection(provider, overrides = {}) {
  return {
    id: 'connection-1', revision: 4, executorType: provider,
    label: provider, workspacePath: 'Z:\\workspace',
    permissionProfile: 'full-computer', fullAccessConfirmed: true,
    modelId: provider === 'codex-cli' ? 'gpt-5.6-terra' : 'sonnet',
    effort: provider === 'codex-cli' ? 'medium' : 'high',
    keyHint: null, hasSecret: false,
    ...overrides,
  };
}

function requestFor(provider, overrides = {}) {
  return {
    goal: 'write a harmless temporary sentinel',
    workspace: 'Z:\\workspace', permissionProfile: 'full-computer',
    model: provider === 'codex-cli' ? 'gpt-5.6-terra' : 'sonnet',
    effort: provider === 'codex-cli' ? 'medium' : 'high', options: {},
    ...overrides,
  };
}

function runSnapshot(provider, overrides = {}) {
  const saved = connection(provider, overrides);
  return Object.freeze({
    connectionId: saved.id,
    connectionRevision: saved.revision,
    executorType: saved.executorType,
    permissionProfile: saved.permissionProfile,
    fullAccessConfirmed: saved.fullAccessConfirmed,
    workspace: saved.workspacePath,
    model: saved.modelId,
    effort: saved.effort,
  });
}

function fakeRunner(provider, binding) {
  const calls = [];
  return {
    calls,
    capture: async (spec) => {
      calls.push({ method: 'capture', spec });
      if (spec.args[0] === '--version') {
        return {
          exitCode: 0,
          stdout: provider === 'codex-cli' ? 'codex-cli 0.145.0\n' : '2.1.217 (Claude Code)\n',
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: 'signed in\n', stderr: '' };
    },
    launch: async (spec) => {
      calls.push({ method: 'launch', spec });
      return { child: { pid: 42 } };
    },
    streamJsonl: async (spec, onEvent) => {
      calls.push({ method: 'streamJsonl', spec });
      onEvent(provider === 'codex-cli'
        ? { type: 'item.completed', item: { type: 'agent_message', text: 'Codex complete' } }
        : { type: 'result', subtype: 'success', result: 'Claude complete' });
      return { exitCode: 0, stdout: '', stderr: '' };
    },
    binding,
  };
}

function dependencies(provider, binding) {
  const leases = [];
  const probes = [];
  const configs = [];
  return {
    leases,
    probes,
    configs,
    discoverSignedNativeCli: async (input) => {
      // The discovery call may optionally carry an AbortSignal for cancellation; assert the
      // meaningful fields and tolerate the optional signal so cancellation threading is not blocked.
      const { signal, ...core } = input;
      assert.deepEqual(core, provider === 'codex-cli'
        ? { provider, workspacePath: 'Z:\\workspace', retainSession: true }
        : { provider, workspacePath: 'Z:\\workspace' });
      return provider === 'codex-cli'
        ? { binding, session: { release: async () => {} } }
        : binding;
    },
    openVerifiedNativeCliLaunchLease: async (input, options) => {
      assert.equal(input, binding);
      if (provider === 'codex-cli') assert.equal(typeof options?.session?.release, 'function');
      const lease = { cleanup: async () => { lease.cleaned = true; } };
      leases.push(lease);
      return lease;
    },
    verifyNativeToolSurface: async (input) => {
      probes.push(input);
      return { available: true, allowed: true, controlRequests: 1, childCanaryConnections: 1 };
    },
    writeFullComputerConfig: async (input) => {
      configs.push(input);
      return { path: `${input.home}\\config`, sha256: 'c'.repeat(64) };
    },
    ensureCodexCompatibility: async (input) => ({ compatible: true, version: input.version, cached: false }),
  };
}

test('does not export an exact Codex full-computer version while preserving Claude policy', () => {
  // Catches a native executor that can reject a qualified future Codex binding by a local version pin.
  assert.equal(Object.hasOwn(codexNativeFullComputer, 'CODEX_FULL_COMPUTER_VERSION'), false);
  assert.equal(CLAUDE_FULL_COMPUTER_VERSION, '2.1.217');
  assert.equal(CODEX_DISABLED_FEATURES.includes('multi_agent'), true);
  assert.deepEqual(codexFeatureArgs().slice(0, 3), ['--strict-config', '--disable', 'apps']);
});

test('codex status opens the inspection helper exactly once', async () => {
  let opens = 0;
  const executor = createCodexNativeFullComputerExecutor({
    runner: {
      capture: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      launch: async () => ({}),
      streamJsonl: async () => {},
    },
    codexHome: 'C:\\owned\\home',
    discoverSignedNativeCli: async () => {
      opens += 1;
      return { binding: CODEX_BINDING, session: { release: async () => {} } };
    },
    openVerifiedNativeCliLaunchLease: async (binding, options) => {
      assert.equal(binding, CODEX_BINDING);
      assert.equal(typeof options?.session?.release, 'function');
      return { cleanup: async () => {} };
    },
    writeFullComputerConfig: async () => ({ path: 'C:\\owned\\home\\config.toml', sha256: 'a'.repeat(64) }),
    ensureCodexCompatibility: async () => ({ compatible: true, version: '0.146.0', cached: true }),
  });
  const status = await executor.getStatus(connection('codex-cli'));
  assert.equal(status.installed, true);
  assert.equal(opens, 1);
});

test('requires the runtime-owned compatibility coordinator for native Codex execution', () => {
  // Catches a full-computer executor that bypasses the shared runtime coordinator.
  const deps = dependencies('codex-cli', CODEX_BINDING);
  assert.throws(
    () => createCodexNativeFullComputerExecutor({
      runner: fakeRunner('codex-cli', CODEX_BINDING), codexHome: 'Z:\\pet\\native-codex',
      ...deps, ensureCodexCompatibility: undefined,
    }),
    /compatibility coordinator/,
  );
});

test('native Codex status qualifies a 0.146.0 binding and distinguishes unsupported from retryable compatibility', async () => {
  // Catches local version equality, status authentication before qualification, and swallowed retryable failures.
  const binding = { ...CODEX_BINDING, version: '0.146.0', fileId: 'codex-146' };
  const deps = dependencies('codex-cli', binding);
  const qualified = [];
  const executor = createCodexNativeFullComputerExecutor({
    runner: fakeRunner('codex-cli', binding), codexHome: 'Z:\\pet\\native-codex',
    ...deps,
    ensureCodexCompatibility: async (value) => {
      qualified.push(value);
      return { compatible: true, version: value.version, cached: false };
    },
  });
  assert.deepEqual(await executor.getStatus(connection('codex-cli')), {
    installed: true, compatible: true, authenticated: true, fullComputerAvailable: true,
  });
  assert.deepEqual(qualified, [binding]);

  const unsupported = createCodexNativeFullComputerExecutor({
    runner: fakeRunner('codex-cli', CODEX_BINDING), codexHome: 'Z:\\pet\\native-codex',
    ...dependencies('codex-cli', CODEX_BINDING),
    ensureCodexCompatibility: async () => { throw new (require('../src/agent/agentErrors.js').AgentError)('CLI_VERSION_UNSUPPORTED'); },
  });
  assert.deepEqual(await unsupported.getStatus(connection('codex-cli')), {
    installed: true, compatible: false, authenticated: false, fullComputerAvailable: false,
  });
  const retryable = createCodexNativeFullComputerExecutor({
    runner: fakeRunner('codex-cli', CODEX_BINDING), codexHome: 'Z:\\pet\\native-codex',
    ...dependencies('codex-cli', CODEX_BINDING),
    ensureCodexCompatibility: async () => { throw new (require('../src/agent/agentErrors.js').AgentError)('CLI_COMPATIBILITY_CHECK_FAILED'); },
  });
  await assert.rejects(retryable.getStatus(connection('codex-cli')), { code: 'CLI_COMPATIBILITY_CHECK_FAILED' });
});

test('native Codex status does not advertise Full Computer when qualified login is signed out', async () => {
  // Catches an authenticated false status that incorrectly leaves Full Computer available.
  const runner = fakeRunner('codex-cli', CODEX_BINDING);
  runner.capture = async (spec) => {
    runner.calls.push({ method: 'capture', spec });
    return { exitCode: 1, stdout: '', stderr: '' };
  };
  const executor = createCodexNativeFullComputerExecutor({
    runner, codexHome: 'Z:\\pet\\native-codex',
    ...dependencies('codex-cli', CODEX_BINDING),
  });
  assert.deepEqual(await executor.getStatus(connection('codex-cli')), {
    installed: true, compatible: true, authenticated: false, fullComputerAvailable: false,
  });
});

test('codex permission verification reports readiness without a synthetic probe', async () => {
  // Catches a permission path that spends a bounded probe deadline re-proving facts the
  // compatibility contract already supplies, which surfaced as PERMISSION_PROFILE_UNAVAILABLE.
  const runner = fakeRunner('codex-cli', CODEX_BINDING);
  const deps = dependencies('codex-cli', CODEX_BINDING);
  const executor = createCodexNativeFullComputerExecutor({
    runner, codexHome: 'Z:\\pet\\native-codex',
    ...deps,
  });
  const result = await executor.verifyPermissionProfile(connection('codex-cli'));
  assert.deepEqual(result, { available: true, allowed: true });
  assert.equal(deps.probes.length, 0);
});

test('Codex qualifies each full-computer setup, permission, and run operation on a freshly held executable', async () => {
  const runner = fakeRunner('codex-cli', CODEX_BINDING);
  const deps = dependencies('codex-cli', CODEX_BINDING);
  const qualified = [];
  deps.ensureCodexCompatibility = async (binding, options) => {
    qualified.push({ binding, options });
    return { compatible: true, version: binding.version, cached: false };
  };
  const executor = createCodexNativeFullComputerExecutor({
    runner, codexHome: 'Z:\\pet\\native-codex',
    ...deps,
  });
  const saved = connection('codex-cli');
  assert.deepEqual(await executor.getCapabilities(saved, saved.modelId), {
    permissionProfiles: ['full-computer'], network: true, authentication: true,
    efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  });
  assert.deepEqual(await executor.verifyPermissionProfile(saved), { available: true, allowed: true });
  assert.deepEqual(await executor.beginSetup(saved), { started: true });
  const result = await executor.runGoal(
    requestFor('codex-cli'), () => {}, new AbortController().signal,
    runSnapshot('codex-cli'),
  );
  assert.deepEqual(result, { text: 'Codex complete', changedFiles: [] });

  const stream = runner.calls.find(({ method }) => method === 'streamJsonl').spec;
  const { signal, launchLease, ...publicSpec } = stream;
  assert.equal(signal instanceof AbortSignal, true);
  assert.equal(typeof launchLease.cleanup, 'function');
  assert.deepEqual(publicSpec, {
    command: CODEX_BINDING.path,
    args: [
      '--sandbox', 'danger-full-access', '--ask-for-approval', 'never',
      ...codexFeatureArgs(),
      '--model', 'gpt-5.6-terra', '-c', 'model_reasoning_effort="medium"',
      'exec', '--ignore-rules', '--ephemeral', '--json',
      '--skip-git-repo-check', '--color', 'never',
    ],
    cwd: 'Z:\\workspace',
    env: { CODEX_HOME: 'Z:\\pet\\native-codex' },
    goal: 'write a harmless temporary sentinel',
  });
  assert.equal(JSON.stringify(publicSpec).includes('wsl.exe'), false);
  assert.equal(JSON.stringify(publicSpec).includes('pet-workspace'), false);
  // Setup, permission, and run each rediscover and qualify a freshly held executable. The
  // permission path no longer runs a synthetic probe, so no probe may be spawned at all.
  assert.equal(deps.probes.length, 0);
  assert.deepEqual(qualified.map(({ binding }) => binding), [CODEX_BINDING, CODEX_BINDING, CODEX_BINDING]);
  assert.equal(deps.leases.every((lease) => lease.cleaned === true), true);
});

test('native Codex does not reuse a status binding for a later run', async () => {
  // Catches a full-computer time-of-check/time-of-use launch against an identity qualified by status.
  const first = { ...CODEX_BINDING, version: '0.145.0', fileId: 'native-status-file' };
  const second = { ...CODEX_BINDING, version: '0.146.0', fileId: 'native-run-file' };
  const qualified = [];
  let discoveries = 0;
  const executor = createCodexNativeFullComputerExecutor({
    runner: fakeRunner('codex-cli', second), codexHome: 'Z:\\pet\\native-codex',
    ...dependencies('codex-cli', second),
    discoverSignedNativeCli: async () => ({
      binding: (++discoveries === 1 ? first : second),
      session: { release: async () => {} },
    }),
    ensureCodexCompatibility: async (binding) => {
      qualified.push(binding);
      return { compatible: true, version: binding.version, cached: false };
    },
  });
  await executor.getStatus(connection('codex-cli'));
  await executor.runGoal(requestFor('codex-cli'), () => {}, new AbortController().signal, runSnapshot('codex-cli'));
  assert.deepEqual(qualified, [first, second]);
});

test('Claude uses exact native full-permission arguments without WSL or Workspace denial flags', async () => {
  const runner = fakeRunner('claude-code-cli', CLAUDE_BINDING);
  const deps = dependencies('claude-code-cli', CLAUDE_BINDING);
  const executor = createClaudeNativeFullComputerExecutor({
    runner, claudeConfigDir: 'Z:\\pet\\native-claude', fixtureRoot: 'Z:\\pet\\resources\\probes',
    ...deps,
  });
  const saved = connection('claude-code-cli');
  assert.deepEqual(await executor.verifyPermissionProfile(saved), {
    available: true, allowed: true, controlRequests: 1, childCanaryConnections: 1,
  });
  const result = await executor.runGoal(
    requestFor('claude-code-cli'), () => {}, new AbortController().signal,
    runSnapshot('claude-code-cli'),
  );
  assert.deepEqual(result, { text: 'Claude complete', changedFiles: [] });
  const stream = runner.calls.find(({ method }) => method === 'streamJsonl').spec;
  const { signal, launchLease, ...publicSpec } = stream;
  assert.equal(signal instanceof AbortSignal, true);
  assert.equal(typeof launchLease.cleanup, 'function');
  assert.deepEqual(publicSpec, {
    command: CLAUDE_BINDING.path,
    args: [
      '--print', '--verbose', '--output-format', 'stream-json', '--input-format', 'text',
      '--no-session-persistence', '--safe-mode', '--setting-sources', '',
      '--dangerously-skip-permissions', '--no-chrome', '--disable-slash-commands',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--tools', 'Bash,Read,Edit,Write,Glob,Grep',
      '--model', 'sonnet', '--effort', 'high',
    ],
    cwd: 'Z:\\workspace',
    env: { CLAUDE_CONFIG_DIR: 'Z:\\pet\\native-claude' },
    goal: 'write a harmless temporary sentinel',
  });
  assert.equal(JSON.stringify(publicSpec).includes('wsl.exe'), false);
  assert.equal(JSON.stringify(publicSpec).includes('dontAsk'), false);
  assert.equal(deps.leases.every((lease) => lease.cleaned === true), true);
});

test('both native executors reject Workspace, stale confirmation, or mismatched run snapshots before launch', async () => {
  const cases = [
    {
      create: (deps, runner) => createCodexNativeFullComputerExecutor({
        runner, codexHome: 'Z:\\pet\\codex', ...deps,
      }),
      provider: 'codex-cli', binding: CODEX_BINDING,
    },
    {
      create: (deps, runner) => createClaudeNativeFullComputerExecutor({
        runner, claudeConfigDir: 'Z:\\pet\\claude', fixtureRoot: 'Z:\\fixtures', ...deps,
      }),
      provider: 'claude-code-cli', binding: CLAUDE_BINDING,
    },
  ];
  for (const item of cases) {
    const runner = fakeRunner(item.provider, item.binding);
    const deps = dependencies(item.provider, item.binding);
    const executor = item.create(deps, runner);
    for (const invalid of [
      connection(item.provider, { permissionProfile: 'workspace' }),
      connection(item.provider, { fullAccessConfirmed: false }),
    ]) {
      await assert.rejects(
        executor.verifyPermissionProfile(invalid),
        (error) => error.code === 'FULL_COMPUTER_CONFIRMATION_REQUIRED'
          || error.code === 'UNSUPPORTED_OPTION',
      );
    }
    const validRequest = requestFor(item.provider);
    for (const snapshot of [
      runSnapshot(item.provider, { permissionProfile: 'workspace' }),
      runSnapshot(item.provider, { fullAccessConfirmed: false }),
      runSnapshot(item.provider, { workspacePath: 'Z:\\other' }),
    ]) {
      await assert.rejects(
        executor.runGoal(validRequest, () => {}, new AbortController().signal, snapshot),
        (error) => error.code === 'FULL_COMPUTER_CONFIRMATION_REQUIRED'
          || error.code === 'UNSUPPORTED_OPTION',
      );
    }
    assert.equal(runner.calls.length, 0);
    assert.equal(deps.probes.length, 0);
  }
});

test('maps native launch failure to a fixed public error without exposing process details', async () => {
  const runner = fakeRunner('codex-cli', CODEX_BINDING);
  runner.streamJsonl = async () => { throw new Error('CreateProcess failed token=secret'); };
  const deps = dependencies('codex-cli', CODEX_BINDING);
  const executor = createCodexNativeFullComputerExecutor({
    runner, codexHome: 'Z:\\pet\\codex', ...deps,
  });
  await assert.rejects(
    executor.runGoal(
      requestFor('codex-cli'), () => {}, new AbortController().signal,
      runSnapshot('codex-cli'),
    ),
    (error) => error.code === 'NATIVE_FULL_COMPUTER_LAUNCH_FAILED'
      && !String(error.message).includes('token=secret'),
  );
});

test('stop during a run releases the lease once and terminates the owned tree', async () => {
  const controller = new AbortController();
  let releases = 0;
  let terminated = 0;
  const base = dependencies('codex-cli', CODEX_BINDING);
  const executor = createCodexNativeFullComputerExecutor({
    runner: {
      capture: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      launch: async () => ({}),
      streamJsonl: async () => {
        controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 10));
        terminated += 1;
        const error = new Error('Aborted');
        error.name = 'AbortError';
        throw error;
      },
    },
    codexHome: 'Z:\\pet\\codex',
    ...base,
    discoverSignedNativeCli: async () => ({ binding: CODEX_BINDING, session: { release: async () => {} } }),
    openVerifiedNativeCliLaunchLease: async () => {
      const lease = { cleanup: async () => { releases += 1; } };
      return lease;
    },
  });
  await assert.rejects(() => executor.runGoal(
    requestFor('codex-cli'), () => {}, controller.signal, runSnapshot('codex-cli'),
  ));
  assert.equal(releases, 1);
  assert.equal(terminated, 1);
});
