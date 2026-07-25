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

test('exports the exact Codex registry and rejects a version or unlisted model before execution', async () => {
  assert.equal(MINIMUM_CODEX_VERSION, '0.144.6');
  assert.deepEqual(MODEL_IDS, ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  assert.deepEqual(EFFORTS, ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  const runner = fakeRunner({ capture: async () => ({ exitCode: 0, stdout: 'codex-cli 0.144.5', stderr: '' }) });
  const executor = createCodexCliExecutor({ runner, codexHome: 'Z:\\pet-codex' });
  assert.deepEqual(await executor.getStatus(), { installed: true, authenticated: false, workspaceAvailable: false });
  await assert.rejects(executor.runGoal(runRequest({ goal: 'do not run', model: 'not-listed' }), () => {}, new AbortController().signal), { code: 'MODEL_UNAVAILABLE' });

  const missing = createCodexCliExecutor({
    runner: fakeRunner({ capture: async () => { throw new AgentError('CLI_NOT_INSTALLED'); } }), codexHome: 'Z:\\pet-codex',
  });
  assert.deepEqual(await missing.getStatus(), { installed: false, authenticated: false, workspaceAvailable: false });
});

test('uses only the dedicated home, exact hermetic exec arguments, and the last agent message', async () => {
  const runner = fakeRunner();
  const profiles = [];
  const executor = createCodexCliExecutor({
    runner, codexHome: 'Z:\\pet-codex',
    writeProfile: async (input) => { profiles.push(input); return 'Z:\\pet-codex\\config.toml'; },
    probePermissionProfile: async () => ({ available: true, allowed: true }),
  });
  const events = [];
  const result = await executor.runGoal(runRequest(), (event) => events.push(event), new AbortController().signal);
  assert.deepEqual(profiles, [{ codexHome: 'Z:\\pet-codex', workspacePath: 'Z:\\workspace' }]);
  const { signal, ...streamSpec } = runner.calls.at(-1).spec;
  assert.equal(signal instanceof AbortSignal, true);
  assert.deepEqual(streamSpec, {
    command: 'codex',
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
  const executor = createCodexCliExecutor({ runner: denied, codexHome: 'Z:\\pet-codex', writeProfile: async () => 'config', probePermissionProfile: async () => ({ available: true, allowed: true }) });
  await assert.rejects(executor.runGoal(runRequest({ goal: 'x' }), () => {}, new AbortController().signal), { code: 'PERMISSION_BLOCKED' });
});
