'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { AgentError } = require('../agentErrors.js');
const { createCliRunner } = require('../cliRunner.js');
const { mapClaudeEvent } = require('../claudeEventMapper.js');
const { verifyNativeToolSurface: defaultVerifyNativeToolSurface } = require('../localProviderProbe.js');
const { discoverSignedNativeCli: defaultDiscoverSignedNativeCli } = require('../nativeCliDiscovery.js');
const { openVerifiedNativeCliLaunchLease: defaultOpenLease } = require('../nativeCliLaunchLease.js');
const { EFFORTS, MODEL_IDS, listClaudeModels, parseVersion } = require('./claudeModels.js');

const CLAUDE_FULL_COMPUTER_VERSION = '2.1.217';
const EMPTY_MCP_CONFIG = '{"mcpServers":{}}';

function launchFailure(cause) {
  return new AgentError('NATIVE_FULL_COMPUTER_LAUNCH_FAILED', { cause });
}

function validBinding(binding) {
  return binding && typeof binding === 'object'
    && typeof binding.path === 'string' && path.win32.isAbsolute(binding.path);
}

function validateConnection(connection) {
  if (!connection || connection.permissionProfile !== 'full-computer'
      || connection.executorType !== 'claude-code-cli'
      || typeof connection.workspacePath !== 'string'
      || !path.win32.isAbsolute(connection.workspacePath)) {
    throw new AgentError('UNSUPPORTED_OPTION');
  }
  if (connection.fullAccessConfirmed !== true) {
    throw new AgentError('FULL_COMPUTER_CONFIRMATION_REQUIRED');
  }
}

function validateRun(request, run) {
  if (!run || run.permissionProfile !== 'full-computer') throw new AgentError('UNSUPPORTED_OPTION');
  if (run.fullAccessConfirmed !== true) throw new AgentError('FULL_COMPUTER_CONFIRMATION_REQUIRED');
  if (run.executorType !== 'claude-code-cli' || !Number.isSafeInteger(run.connectionRevision)
      || run.connectionRevision <= 0 || request?.workspace !== run.workspace
      || request?.permissionProfile !== run.permissionProfile || request?.model !== run.model
      || request?.effort !== run.effort) throw new AgentError('UNSUPPORTED_OPTION');
  if (typeof request.goal !== 'string' || !path.win32.isAbsolute(request.workspace)
      || !MODEL_IDS.includes(request.model)) throw new AgentError('MODEL_UNAVAILABLE');
  if (request.effort !== null && !EFFORTS.includes(request.effort)) {
    throw new AgentError('UNSUPPORTED_OPTION');
  }
}

async function prepareClaudeConfig({ home }) {
  await fs.mkdir(home, { recursive: true });
  return { path: home, sha256: 'empty-dedicated-claude-config' };
}

function authenticatedFrom(output) {
  try {
    const status = JSON.parse(output);
    return status?.loggedIn === true || status?.authenticated === true || status?.status === 'logged_in';
  } catch { return false; }
}

function createClaudeNativeFullComputerExecutor({
  runner = createCliRunner(),
  claudeConfigDir,
  fixtureRoot,
  discoverSignedNativeCli = defaultDiscoverSignedNativeCli,
  openVerifiedNativeCliLaunchLease = defaultOpenLease,
  verifyNativeToolSurface = defaultVerifyNativeToolSurface,
  writeFullComputerConfig = prepareClaudeConfig,
} = {}) {
  if (typeof claudeConfigDir !== 'string' || !claudeConfigDir
      || typeof fixtureRoot !== 'string' || !fixtureRoot) {
    throw new TypeError('Native Claude executor requires dedicated config and probe fixtures.');
  }
  const environment = Object.freeze({ CLAUDE_CONFIG_DIR: claudeConfigDir });

  async function discover(connection) {
    validateConnection(connection);
    try {
      const binding = await discoverSignedNativeCli({
        provider: 'claude-code-cli', workspacePath: connection.workspacePath,
      });
      if (!validBinding(binding)) throw new Error('Invalid Claude CLI binding');
      return binding;
    } catch (error) {
      if (error instanceof AgentError && ['UNSUPPORTED_OPTION', 'FULL_COMPUTER_CONFIRMATION_REQUIRED'].includes(error.code)) throw error;
      throw new AgentError('CLI_NOT_INSTALLED', { cause: error });
    }
  }

  async function withLease(binding, operation) {
    let lease;
    let operationError;
    try {
      lease = await openVerifiedNativeCliLaunchLease(binding);
      return await operation(lease);
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      if (lease?.cleanup) {
        try { await lease.cleanup(); } catch (error) { if (!operationError) throw error; }
      }
    }
  }

  async function exactVersion(binding) {
    const result = await withLease(binding, (launchLease) => runner.capture({
      command: binding.path, launchLease, args: ['--version'], env: environment, timeoutMs: 5000,
    }));
    const version = parseVersion(result?.stdout);
    return result?.exitCode === 0 && version?.join('.') === CLAUDE_FULL_COMPUTER_VERSION;
  }

  async function prepare(connection) {
    validateConnection(connection);
    return writeFullComputerConfig({
      provider: 'claude-code-cli', home: claudeConfigDir, workspacePath: connection.workspacePath,
    });
  }

  return Object.freeze({
    async getStatus(connection) {
      let binding;
      try { binding = await discover(connection); } catch { return { installed: false, authenticated: false, fullComputerAvailable: false }; }
      try {
        if (!await exactVersion(binding)) return { installed: false, authenticated: false, fullComputerAvailable: false };
        const status = await withLease(binding, (launchLease) => runner.capture({
          command: binding.path, launchLease,
          args: ['auth', 'status', '--json'], env: environment, timeoutMs: 5000,
        }));
        return {
          installed: true,
          authenticated: status?.exitCode === 0 && authenticatedFrom(status.stdout),
          fullComputerAvailable: true,
        };
      } catch { return { installed: true, authenticated: false, fullComputerAvailable: false }; }
    },
    async beginSetup(connection) {
      const binding = await discover(connection);
      if (!await exactVersion(binding)) throw new AgentError('CLI_NOT_INSTALLED');
      await withLease(binding, (launchLease) => runner.launch({
        command: binding.path, launchLease, args: ['auth', 'login'], env: environment, visible: true,
      }));
      return { started: true };
    },
    async listModels() { return listClaudeModels(); },
    async getCapabilities(connection) {
      validateConnection(connection);
      return {
        permissionProfiles: ['full-computer'], network: true,
        authentication: true, efforts: [...EFFORTS],
      };
    },
    async verifyPermissionProfile(connection) {
      await prepare(connection);
      const binding = await discover(connection);
      if (!await exactVersion(binding)) throw new AgentError('CLI_NOT_INSTALLED');
      return verifyNativeToolSurface({
        provider: 'claude-code-cli', cliBinding: binding,
        workspacePath: connection.workspacePath, fixtureRoot,
        spawn: (spec) => withLease(binding, (launchLease) => runner.capture({
          ...spec, launchLease, timeoutMs: 30_000,
        })),
      });
    },
    async runGoal(request, emitActivity, signal, run) {
      validateRun(request, run);
      await prepare({
        executorType: 'claude-code-cli', workspacePath: request.workspace,
        permissionProfile: run.permissionProfile, fullAccessConfirmed: run.fullAccessConfirmed,
      });
      const binding = await discover({
        executorType: 'claude-code-cli', workspacePath: request.workspace,
        permissionProfile: run.permissionProfile, fullAccessConfirmed: run.fullAccessConfirmed,
      });
      if (!await exactVersion(binding)) throw new AgentError('CLI_NOT_INSTALLED');
      let responseText = null;
      try {
        await withLease(binding, (launchLease) => runner.streamJsonl({
          command: binding.path,
          launchLease,
          args: [
            '--print', '--verbose', '--output-format', 'stream-json', '--input-format', 'text',
            '--no-session-persistence', '--safe-mode', '--setting-sources', '',
            '--dangerously-skip-permissions', '--no-chrome', '--disable-slash-commands',
            '--strict-mcp-config', '--mcp-config', EMPTY_MCP_CONFIG,
            '--tools', 'Bash,Read,Edit,Write,Glob,Grep',
            '--model', request.model, '--effort', request.effort,
          ],
          cwd: request.workspace,
          env: environment,
          goal: request.goal,
          signal,
        }, (event) => {
          const mapped = mapClaudeEvent(event);
          if (!mapped) return;
          if (mapped.activity) emitActivity(mapped.activity);
          if (mapped.responseText) responseText = mapped.responseText;
          if (mapped.error) throw new AgentError(mapped.error);
        }));
      } catch (error) {
        if (error instanceof AgentError) throw error;
        throw launchFailure(error);
      }
      if (!responseText) throw new AgentError('PROVIDER_OUTPUT_INVALID');
      return { text: responseText, changedFiles: [] };
    },
  });
}

module.exports = {
  CLAUDE_FULL_COMPUTER_VERSION,
  createClaudeNativeFullComputerExecutor,
  prepareClaudeConfig,
};
