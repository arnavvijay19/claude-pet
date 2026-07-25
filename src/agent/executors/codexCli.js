'use strict';

const path = require('node:path');
const { AgentError } = require('../agentErrors.js');
const { createCliRunner } = require('../cliRunner.js');
const { PROFILE_NAME, probeCodexWorkspace, writeCodexProfile } = require('../codexPermissionProfile.js');
const { mapCodexEvent } = require('../codexEventMapper.js');
const { EFFORTS, MINIMUM_CODEX_VERSION, MODEL_IDS, listCodexModels, meetsMinimumVersion } = require('./codexModels.js');

function validConnection(connection) {
  return connection && connection.permissionProfile === 'workspace' && typeof connection.workspacePath === 'string' && connection.workspacePath.length > 0;
}

function errorFrom(error) {
  if (error instanceof AgentError) return error;
  if (/approval|permission|sandbox|denied|blocked/i.test(String(error?.message || error))) return new AgentError('PERMISSION_BLOCKED', { cause: error });
  return new AgentError('COMMAND_FAILED', { cause: error });
}

function createCodexCliExecutor({
  runner = createCliRunner(), codexHome,
  writeProfile = writeCodexProfile, probePermissionProfile = probeCodexWorkspace,
} = {}) {
  if (typeof codexHome !== 'string' || !codexHome) throw new TypeError('Codex executor requires a dedicated CODEX_HOME.');
  const environment = Object.freeze({ CODEX_HOME: codexHome });

  async function installedVersion() {
    try {
      const result = await runner.capture({ command: 'codex', args: ['--version'], env: environment, timeoutMs: 5000 });
      return result?.exitCode === 0 && meetsMinimumVersion(result.stdout);
    } catch (error) {
      if (error instanceof AgentError && error.code === 'CLI_NOT_INSTALLED') throw error;
      return false;
    }
  }

  async function prepareProfile(connection) {
    if (!validConnection(connection)) throw new AgentError('UNSUPPORTED_OPTION');
    await writeProfile({ codexHome, workspacePath: connection.workspacePath });
  }

  return Object.freeze({
    async getStatus() {
      let installed;
      try { installed = await installedVersion(); } catch { return { installed: false, authenticated: false, workspaceAvailable: false }; }
      if (!installed) return { installed: true, authenticated: false, workspaceAvailable: false };
      try {
        const login = await runner.capture({ command: 'codex', args: ['login', 'status'], env: environment, timeoutMs: 5000 });
        const authenticated = login?.exitCode === 0;
        return { installed: true, authenticated, workspaceAvailable: authenticated };
      } catch { return { installed: false, authenticated: false, workspaceAvailable: false }; }
    },
    async beginSetup() {
      if (!await installedVersion()) throw new AgentError('CLI_NOT_INSTALLED');
      await runner.launch({ command: 'codex', args: ['login'], env: environment, visible: true });
      return { started: true };
    },
    async listModels() { return listCodexModels(); },
    async getCapabilities() { return { permissionProfiles: ['workspace'], network: false, authentication: true, efforts: [...EFFORTS] }; },
    async verifyPermissionProfile(connection) {
      await prepareProfile(connection);
      try {
        return await probePermissionProfile({ runner, codexHome, workspacePath: connection.workspacePath, outsideSentinel: path.join(codexHome, 'hostile-hook-sentinel.txt') });
      } catch (error) { throw errorFrom(error); }
    },
    async runGoal(request, emitActivity, signal) {
      if (!validConnection({ workspacePath: request?.workspace, permissionProfile: request?.permissionProfile })) throw new AgentError('UNSUPPORTED_OPTION');
      if (!MODEL_IDS.includes(request.model)) throw new AgentError('MODEL_UNAVAILABLE');
      if (request.effort !== null && !EFFORTS.includes(request.effort)) throw new AgentError('UNSUPPORTED_OPTION');
      await prepareProfile({ workspacePath: request.workspace, permissionProfile: request.permissionProfile });
      let responseText = null;
      const changedFiles = [];
      try {
        await runner.streamJsonl({
          command: 'codex', args: ['exec', '--ephemeral', '--json', '--skip-git-repo-check', '--color', 'never', '--strict-config', '--ignore-rules', '--disable', 'hooks', '--model', request.model],
          cwd: request.workspace, env: environment, goal: request.goal, signal,
        }, (event) => {
          const mapped = mapCodexEvent(event);
          if (!mapped) return;
          if (mapped.activity) emitActivity(mapped.activity);
          if (mapped.responseText) responseText = mapped.responseText;
          if (mapped.changedFiles) changedFiles.push(...mapped.changedFiles);
          if (mapped.error) throw new AgentError('PERMISSION_BLOCKED');
        });
      } catch (error) { throw errorFrom(error); }
      if (!responseText) throw new AgentError('PROVIDER_OUTPUT_INVALID');
      return { text: responseText, changedFiles: [...new Set(changedFiles)] };
    },
  });
}

module.exports = { EFFORTS, MINIMUM_CODEX_VERSION, MODEL_IDS, createCodexCliExecutor };
