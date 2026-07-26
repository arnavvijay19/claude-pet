'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CODEX_DISABLED_FEATURES,
  codexFeatureArgs,
} = require('../src/agent/codexFeaturePolicy.js');
const {
  CODEX_FULL_COMPUTER_VERSION,
  createCodexNativeFullComputerExecutor,
} = require('../src/agent/executors/codexNativeFullComputer.js');
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
      assert.deepEqual(input, { provider, workspacePath: 'Z:\\workspace' });
      return binding;
    },
    openVerifiedNativeCliLaunchLease: async (input) => {
      assert.equal(input, binding);
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
  };
}

test('pins exact native provider versions and Codex full-access feature policy', () => {
  assert.equal(CODEX_FULL_COMPUTER_VERSION, '0.145.0');
  assert.equal(CLAUDE_FULL_COMPUTER_VERSION, '2.1.217');
  assert.equal(CODEX_DISABLED_FEATURES.includes('multi_agent'), true);
  assert.deepEqual(codexFeatureArgs().slice(0, 3), ['--strict-config', '--disable', 'apps']);
});

test('Codex uses only the exact native Full Computer policy and freshly held executable', async () => {
  const runner = fakeRunner('codex-cli', CODEX_BINDING);
  const deps = dependencies('codex-cli', CODEX_BINDING);
  const executor = createCodexNativeFullComputerExecutor({
    runner, codexHome: 'Z:\\pet\\native-codex', fixtureRoot: 'Z:\\pet\\resources\\probes',
    ...deps,
  });
  const saved = connection('codex-cli');
  assert.deepEqual(await executor.getCapabilities(saved, saved.modelId), {
    permissionProfiles: ['full-computer'], network: true, authentication: true,
    efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  });
  assert.deepEqual(await executor.verifyPermissionProfile(saved), {
    available: true, allowed: true, controlRequests: 1, childCanaryConnections: 1,
  });
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
  assert.equal(deps.probes.length, 1);
  assert.equal(deps.probes[0].provider, 'codex-cli');
  assert.equal(deps.leases.every((lease) => lease.cleaned === true), true);
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
        runner, codexHome: 'Z:\\pet\\codex', fixtureRoot: 'Z:\\fixtures', ...deps,
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
    runner, codexHome: 'Z:\\pet\\codex', fixtureRoot: 'Z:\\fixtures', ...deps,
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
