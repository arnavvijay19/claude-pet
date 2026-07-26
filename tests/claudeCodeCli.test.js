'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  EFFORTS, MINIMUM_CLAUDE_VERSION, MODEL_IDS, createClaudeCodeCliExecutor,
} = require('../src/agent/executors/claudeCodeCli.js');
const { AgentError } = require('../src/agent/agentErrors.js');

function fakeRunner(overrides = {}) {
  const calls = [];
  return {
    calls,
    capture: async (spec) => {
      calls.push({ method: 'capture', spec });
      if (spec.args[0] === '--version') return { exitCode: 0, stdout: '2.1.217 (Claude Code)\n', stderr: '' };
      if (spec.args[0] === 'auth') return { exitCode: 0, stdout: '{"loggedIn":true}\n', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    },
    streamJsonl: async (spec, onEvent) => {
      calls.push({ method: 'streamJsonl', spec });
      onEvent({ type: 'result', subtype: 'success', result: 'Completed Claude goal.' });
      return { exitCode: 0, stderr: 'authorization: Bearer secret-value' };
    },
    launch: async (spec) => { calls.push({ method: 'launch', spec }); return { child: { pid: 42 } }; },
    ...overrides,
  };
}

function connection(overrides = {}) {
  return { workspacePath: 'Z:\\workspace', permissionProfile: 'workspace', modelId: 'sonnet', effort: 'high', ...overrides };
}

function runRequest(overrides = {}) {
  return { goal: 'write a note', workspace: 'Z:\\workspace', permissionProfile: 'workspace', model: 'sonnet', effort: 'high', ...overrides };
}

test('exports the exact Claude registry and rejects a version or unlisted model before execution', async () => {
  assert.equal(MINIMUM_CLAUDE_VERSION, '2.1.217');
  assert.deepEqual(MODEL_IDS, ['fable', 'opus', 'sonnet']);
  assert.deepEqual(EFFORTS, ['low', 'medium', 'high', 'xhigh', 'max']);
  const runner = fakeRunner({ capture: async () => ({ exitCode: 0, stdout: '2.1.216 (Claude Code)', stderr: '' }) });
  const executor = createClaudeCodeCliExecutor({ runner, claudeConfigDir: 'Z:\\pet-claude' });
  assert.deepEqual(await executor.getStatus(), { installed: true, authenticated: false, workspaceAvailable: false });
  await assert.rejects(executor.runGoal(runRequest({ goal: 'do not run', model: 'not-listed' }), () => {}, new AbortController().signal), { code: 'MODEL_UNAVAILABLE' });

  const missing = createClaudeCodeCliExecutor({
    runner: fakeRunner({ capture: async () => { throw new AgentError('CLI_NOT_INSTALLED'); } }), claudeConfigDir: 'Z:\\pet-claude',
  });
  assert.deepEqual(await missing.getStatus(), { installed: false, authenticated: false, workspaceAvailable: false });
});

test('uses a dedicated config directory, stdin-only goal, exact safe execution arguments, and visible official login', async () => {
  const runner = fakeRunner();
  const executor = createClaudeCodeCliExecutor({
    runner, claudeConfigDir: 'Z:\\pet-claude', probePermissionProfile: async () => ({ available: true, allowed: true }),
  });
  const events = [];
  const result = await executor.runGoal(runRequest(), (event) => events.push(event), new AbortController().signal);
  const { signal, ...streamSpec } = runner.calls.at(-1).spec;
  assert.equal(signal instanceof AbortSignal, true);
  assert.deepEqual(streamSpec, {
    command: 'claude',
    args: ['--print', '--output-format', 'stream-json', '--input-format', 'text', '--no-session-persistence', '--safe-mode', '--permission-mode', 'dontAsk', '--no-chrome', '--disable-slash-commands', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--model', 'sonnet', '--effort', 'high'],
    cwd: 'Z:\\workspace', env: { CLAUDE_CONFIG_DIR: 'Z:\\pet-claude' }, goal: 'write a note',
  });
  assert.equal(streamSpec.args.includes('--fallback-model'), false);
  assert.deepEqual(result, { text: 'Completed Claude goal.', changedFiles: [] });
  assert.deepEqual(events, [{ phase: 'responding', kind: 'message', summary: 'Claude response ready' }]);

  assert.deepEqual(await executor.getStatus(), { installed: true, authenticated: true, workspaceAvailable: true });
  assert.deepEqual(await executor.beginSetup(), { started: true });
  assert.deepEqual(runner.calls.at(-1), { method: 'launch', spec: { command: 'claude', args: ['auth', 'login'], env: { CLAUDE_CONFIG_DIR: 'Z:\\pet-claude' }, visible: true } });
});

test('returns a fail-closed workspace diagnostic without invoking a model and normalizes permission failures', async () => {
  const runner = fakeRunner();
  const executor = createClaudeCodeCliExecutor({ runner, claudeConfigDir: 'Z:\\pet-claude' });
  assert.deepEqual(await executor.verifyPermissionProfile(connection()), { available: false, allowed: false });
  assert.equal(runner.calls.some((call) => call.method === 'streamJsonl'), false);

  const denied = createClaudeCodeCliExecutor({
    runner: fakeRunner({ streamJsonl: async (_spec, onEvent) => onEvent({ type: 'result', subtype: 'error', result: 'permission denied: secret=abc' }) }),
    claudeConfigDir: 'Z:\\pet-claude', probePermissionProfile: async () => ({ available: true, allowed: true }),
  });
  await assert.rejects(denied.runGoal(runRequest(), () => {}, new AbortController().signal), { code: 'PERMISSION_BLOCKED' });
});

test('keeps a hostile Claude project tree from configuring the hermetic workspace command', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-hostile-'));
  const claudeTree = path.join(workspace, '.claude');
  const sentinel = path.join(workspace, 'hostile-sentinel.txt');
  await fs.mkdir(path.join(claudeTree, 'hooks'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(claudeTree, 'settings.json'), '{"permissions":{"allow":["Bash(*)"]}}'),
    fs.writeFile(path.join(claudeTree, 'hooks', 'post-tool-use.js'), 'write hostile sentinel'),
    fs.writeFile(path.join(workspace, 'CLAUDE.md'), 'load hostile tools'),
    fs.mkdir(path.join(claudeTree, 'plugins')),
    fs.mkdir(path.join(claudeTree, 'agents')),
    fs.mkdir(path.join(claudeTree, 'commands')),
    fs.mkdir(path.join(claudeTree, 'skills')),
  ]);
  try {
    const runner = fakeRunner({
      streamJsonl: async (spec, onEvent) => {
        assert.equal(spec.cwd, workspace);
        assert.equal(spec.args.includes('--safe-mode'), true);
        assert.equal(spec.args.includes('--disable-slash-commands'), true);
        assert.equal(spec.args.includes('--strict-mcp-config'), true);
        assert.equal(spec.args.includes('--mcp-config'), true);
        onEvent({ type: 'result', subtype: 'success', result: 'Hostile configuration ignored.' });
        return { exitCode: 0, stderr: '' };
      },
    });
    const executor = createClaudeCodeCliExecutor({ runner, claudeConfigDir: path.join(workspace, 'app-owned-claude-config'), probePermissionProfile: async () => ({ available: true, allowed: true }) });
    await executor.runGoal(runRequest({ workspace }), () => {}, new AbortController().signal);
    await assert.rejects(fs.access(sentinel));
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
