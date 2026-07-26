'use strict';

const { AgentError } = require('../agentErrors.js');
const { createCliRunner } = require('../cliRunner.js');
const { mapClaudeEvent } = require('../claudeEventMapper.js');
const { EFFORTS, MINIMUM_CLAUDE_VERSION, MODEL_IDS, listClaudeModels, meetsMinimumVersion } = require('./claudeModels.js');

const EMPTY_MCP_CONFIG = '{"mcpServers":{}}';

function validConnection(connection) {
  return connection && connection.permissionProfile === 'workspace' && typeof connection.workspacePath === 'string' && connection.workspacePath.length > 0;
}

function errorFrom(error) {
  if (error instanceof AgentError) return error;
  if (/approval|permission|denied|blocked/i.test(String(error?.message || error))) return new AgentError('PERMISSION_BLOCKED', { cause: error });
  return new AgentError('COMMAND_FAILED', { cause: error });
}

function authenticatedFrom(output) {
  try {
    const status = JSON.parse(output);
    return status?.loggedIn === true || status?.authenticated === true || status?.status === 'logged_in';
  } catch {
    return false;
  }
}

function unavailableWorkspaceProfile() {
  return Promise.resolve({ available: false, allowed: false });
}

function createClaudeCodeCliExecutor({
  runner = createCliRunner(), claudeConfigDir, probePermissionProfile = unavailableWorkspaceProfile,
} = {}) {
  if (typeof claudeConfigDir !== 'string' || !claudeConfigDir) throw new TypeError('Claude executor requires a dedicated CLAUDE_CONFIG_DIR.');
  const environment = Object.freeze({ CLAUDE_CONFIG_DIR: claudeConfigDir });

  async function installedVersion() {
    try {
      const result = await runner.capture({ command: 'claude', args: ['--version'], env: environment, timeoutMs: 5000 });
      return result?.exitCode === 0 && meetsMinimumVersion(result.stdout);
    } catch (error) {
      if (error instanceof AgentError && error.code === 'CLI_NOT_INSTALLED') throw error;
      return false;
    }
  }

  return Object.freeze({
    async getStatus() {
      let installed;
      try { installed = await installedVersion(); } catch { return { installed: false, authenticated: false, workspaceAvailable: false }; }
      if (!installed) return { installed: true, authenticated: false, workspaceAvailable: false };
      try {
        const status = await runner.capture({ command: 'claude', args: ['auth', 'status', '--json'], env: environment, timeoutMs: 5000 });
        const authenticated = status?.exitCode === 0 && authenticatedFrom(status.stdout);
        return { installed: true, authenticated, workspaceAvailable: authenticated };
      } catch { return { installed: false, authenticated: false, workspaceAvailable: false }; }
    },
    async beginSetup() {
      if (!await installedVersion()) throw new AgentError('CLI_NOT_INSTALLED');
      await runner.launch({ command: 'claude', args: ['auth', 'login'], env: environment, visible: true });
      return { started: true };
    },
    async listModels() { return listClaudeModels(); },
    async getCapabilities() { return { permissionProfiles: ['workspace'], network: false, authentication: true, efforts: [...EFFORTS] }; },
    async verifyPermissionProfile(connection) {
      if (!validConnection(connection)) throw new AgentError('UNSUPPORTED_OPTION');
      try { return await probePermissionProfile({ workspacePath: connection.workspacePath, claudeConfigDir }); } catch (error) { throw errorFrom(error); }
    },
    async runGoal(request, emitActivity, signal) {
      if (!validConnection({ workspacePath: request?.workspace, permissionProfile: request?.permissionProfile })) throw new AgentError('UNSUPPORTED_OPTION');
      if (!MODEL_IDS.includes(request.model)) throw new AgentError('MODEL_UNAVAILABLE');
      if (request.effort !== null && !EFFORTS.includes(request.effort)) throw new AgentError('UNSUPPORTED_OPTION');
      let responseText = null;
      try {
        await runner.streamJsonl({
          command: 'claude',
          args: ['--print', '--output-format', 'stream-json', '--input-format', 'text', '--no-session-persistence', '--safe-mode', '--permission-mode', 'dontAsk', '--no-chrome', '--disable-slash-commands', '--strict-mcp-config', '--mcp-config', EMPTY_MCP_CONFIG, '--model', request.model, ...(request.effort ? ['--effort', request.effort] : [])],
          cwd: request.workspace, env: environment, goal: request.goal, signal,
        }, (event) => {
          const mapped = mapClaudeEvent(event);
          if (!mapped) return;
          if (mapped.activity) emitActivity(mapped.activity);
          if (mapped.responseText) responseText = mapped.responseText;
          if (mapped.error) throw new AgentError(mapped.error);
        });
      } catch (error) { throw errorFrom(error); }
      if (!responseText) throw new AgentError('PROVIDER_OUTPUT_INVALID');
      return { text: responseText, changedFiles: [] };
    },
  });
}

module.exports = { EFFORTS, MINIMUM_CLAUDE_VERSION, MODEL_IDS, createClaudeCodeCliExecutor };
