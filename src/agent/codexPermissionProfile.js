'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { AgentError } = require('./agentErrors.js');

const PROFILE_NAME = 'pet-workspace';

function profileToml(workspacePath, profile) {
  const normalizedWorkspace = path.resolve(workspacePath);
  return [
    `default_permissions = ${JSON.stringify(profile)}`,
    'approval_policy = "never"',
    'allow_login_shell = false',
    'web_search = "disabled"',
    '',
    '[features]',
    'hooks = false',
    '',
    `[projects.${JSON.stringify(normalizedWorkspace)}]`,
    'trust_level = "untrusted"',
    '',
    `[permissions.${profile}.filesystem]`,
    '":minimal" = "read"',
    'glob_scan_max_depth = 4',
    '',
    `[permissions.${profile}.filesystem.":workspace_roots"]`,
    '"." = "write"',
    '"**/*.env" = "deny"',
    '',
    `[permissions.${profile}.network]`,
    'enabled = false',
    '',
    '[shell_environment_policy]',
    'inherit = "core"',
    'exclude = ["*KEY*", "*TOKEN*", "*SECRET*", "ANTHROPIC_*", "OPENAI_*", "CODEX_API_KEY"]',
    '',
  ].join('\n');
}

async function writeCodexProfile({ codexHome, workspacePath, profile = PROFILE_NAME } = {}) {
  if (profile !== PROFILE_NAME || typeof codexHome !== 'string' || typeof workspacePath !== 'string') {
    throw new AgentError('PERMISSION_PROFILE_UNAVAILABLE');
  }
  const configPath = path.join(codexHome, 'config.toml');
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(configPath, profileToml(workspacePath, profile), 'utf8');
  return configPath;
}

function probeSource(name, workspacePath, outsideSentinel) {
  const workspaceFile = path.join(workspacePath, '.claude-pet-probe.txt');
  switch (name) {
    case 'workspace-read': return `[IO.File]::ReadAllText(${JSON.stringify(workspaceFile)}) | Out-Null`;
    case 'workspace-write': return `[IO.File]::WriteAllText(${JSON.stringify(workspaceFile)}, 'ok')`;
    case 'outside-read': return `[IO.File]::ReadAllText(${JSON.stringify(outsideSentinel)}) | Out-Null`;
    case 'outside-write': return `[IO.File]::WriteAllText(${JSON.stringify(outsideSentinel)}, 'blocked')`;
    case 'network': return 'Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 https://example.invalid | Out-Null';
    case 'hostile-project-override': return 'if (Test-Path -LiteralPath .codex\\config.toml) { exit 0 }';
    case 'hook-sentinel': return `if (Test-Path -LiteralPath ${JSON.stringify(outsideSentinel)}) { exit 1 }`;
    default: throw new TypeError('Unknown Codex probe');
  }
}

async function probeCodexWorkspace({ runner, codexHome, workspacePath, outsideSentinel } = {}) {
  if (!runner || typeof runner.capture !== 'function' || typeof codexHome !== 'string'
    || typeof workspacePath !== 'string' || typeof outsideSentinel !== 'string') {
    throw new AgentError('PERMISSION_PROFILE_UNAVAILABLE');
  }
  const probes = [
    ['workspace-read', 0], ['workspace-write', 0], ['outside-read', 1], ['outside-write', 1],
    ['network', 1], ['hostile-project-override', 0], ['hook-sentinel', 0],
  ];
  for (const [name, expectExitCode] of probes) {
    let result;
    try {
      result = await runner.capture({
        command: 'codex',
        args: ['sandbox', '-P', PROFILE_NAME, '-C', workspacePath, '--', 'powershell.exe', '-NoProfile', '-Command', probeSource(name, workspacePath, outsideSentinel)],
        env: { CODEX_HOME: codexHome },
        expectExitCode,
        timeoutMs: 5000,
      });
    } catch (error) {
      throw new AgentError('PERMISSION_PROFILE_UNAVAILABLE', { cause: error });
    }
    if (!result || result.exitCode !== expectExitCode) throw new AgentError('PERMISSION_PROFILE_UNAVAILABLE');
  }
  return { available: true, allowed: true };
}

module.exports = {
  PROFILE_NAME,
  probeCodexWorkspace,
  profileToml,
  writeCodexProfile,
};
