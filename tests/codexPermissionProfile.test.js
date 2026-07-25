'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { writeCodexProfile, probeCodexWorkspace } = require('../src/agent/codexPermissionProfile.js');

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
  assert.match(content, new RegExp('\\[projects\\.' + JSON.stringify(path.resolve(workspacePath)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]'));
  assert.match(content, /^"\*\*\/\*\.env" = "deny"$/m);
  assert.match(content, /^enabled = false$/m);
  assert.match(content, /^exclude = \["\*KEY\*", "\*TOKEN\*", "\*SECRET\*", "ANTHROPIC_\*", "OPENAI_\*", "CODEX_API_KEY"\]$/m);
});

test('runs every deterministic sandbox probe with the named profile and fails closed on any denial', async () => {
  const calls = [];
  const runner = {
    async capture(spec) {
      calls.push(spec);
      return { exitCode: spec.expectExitCode, stdout: '', stderr: '' };
    },
  };
  const workspacePath = 'Z:\\workspace';
  const result = await probeCodexWorkspace({ runner, codexHome: 'Z:\\codex-home', workspacePath, outsideSentinel: 'Z:\\outside.txt' });
  assert.equal(result.available, true);
  assert.equal(calls.length, 7);
  for (const call of calls) {
    assert.equal(call.command, 'codex');
    assert.deepEqual(call.args.slice(0, 7), ['sandbox', '-P', 'pet-workspace', '-C', workspacePath, '--', 'powershell.exe']);
    assert.equal(call.env.CODEX_HOME, 'Z:\\codex-home');
  }

  await assert.rejects(
    probeCodexWorkspace({
      runner: { async capture() { return { exitCode: 1, stdout: '', stderr: '' }; } },
      codexHome: 'Z:\\codex-home', workspacePath, outsideSentinel: 'Z:\\outside.txt',
    }),
    (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE',
  );
});
