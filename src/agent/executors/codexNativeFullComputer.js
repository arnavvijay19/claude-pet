'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { AgentError } = require('../agentErrors.js');
const { createCliRunner } = require('../cliRunner.js');
const { codexFeatureArgs } = require('../codexFeaturePolicy.js');
const { mapCodexEvent } = require('../codexEventMapper.js');
const { verifyNativeToolSurface: defaultVerifyNativeToolSurface } = require('../localProviderProbe.js');
const { discoverSignedNativeCli: defaultDiscoverSignedNativeCli } = require('../nativeCliDiscovery.js');
const { openVerifiedNativeCliLaunchLease: defaultOpenLease } = require('../nativeCliLaunchLease.js');
const { EFFORTS, MODEL_IDS, listCodexModels } = require('./codexModels.js');

function launchFailure(cause) {
  return new AgentError('NATIVE_FULL_COMPUTER_LAUNCH_FAILED', { cause });
}

function validBinding(binding) {
  return binding && typeof binding === 'object'
    && typeof binding.path === 'string' && path.win32.isAbsolute(binding.path);
}

function validateConnection(connection) {
  if (!connection || connection.permissionProfile !== 'full-computer'
      || connection.executorType !== 'codex-cli'
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
  if (run.executorType !== 'codex-cli' || !Number.isSafeInteger(run.connectionRevision)
      || run.connectionRevision <= 0 || request?.workspace !== run.workspace
      || request?.permissionProfile !== run.permissionProfile || request?.model !== run.model
      || request?.effort !== run.effort) throw new AgentError('UNSUPPORTED_OPTION');
  if (typeof request.goal !== 'string' || !path.win32.isAbsolute(request.workspace)
      || !MODEL_IDS.includes(request.model)) throw new AgentError('MODEL_UNAVAILABLE');
  if (request.effort !== null && !EFFORTS.includes(request.effort)) {
    throw new AgentError('UNSUPPORTED_OPTION');
  }
}

async function writeNativeCodexConfig({ home, workspacePath }) {
  const escapedWorkspace = JSON.stringify(path.win32.normalize(workspacePath));
  const contents = [
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    'web_search = "disabled"',
    '',
    `[projects.${escapedWorkspace}]`,
    'trust_level = "untrusted"',
    '',
  ].join('\n');
  await fs.mkdir(home, { recursive: true });
  const configPath = path.join(home, 'config.toml');
  await fs.writeFile(configPath, contents, 'utf8');
  return {
    path: configPath,
    sha256: crypto.createHash('sha256').update(contents, 'utf8').digest('hex'),
  };
}

function createCodexNativeFullComputerExecutor({
  runner = createCliRunner(),
  codexHome,
  fixtureRoot,
  discoverSignedNativeCli = defaultDiscoverSignedNativeCli,
  openVerifiedNativeCliLaunchLease = defaultOpenLease,
  verifyNativeToolSurface = defaultVerifyNativeToolSurface,
  writeFullComputerConfig = writeNativeCodexConfig,
  ensureCodexCompatibility,
} = {}) {
  if (typeof codexHome !== 'string' || !codexHome
      || typeof fixtureRoot !== 'string' || !fixtureRoot) {
    throw new TypeError('Native Codex executor requires dedicated home and probe fixtures.');
  }
  if (typeof ensureCodexCompatibility !== 'function') throw new TypeError('Native Codex executor requires a runtime compatibility coordinator.');
  const environment = Object.freeze({ CODEX_HOME: codexHome });

  async function discover(connection) {
    validateConnection(connection);
    try {
      const binding = await discoverSignedNativeCli({
        provider: 'codex-cli', workspacePath: connection.workspacePath,
      });
      if (!validBinding(binding)) throw new Error('Invalid Codex CLI binding');
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

  async function compatibleBinding(connection, signal) {
    const binding = await discover(connection);
    await ensureCodexCompatibility(binding, { signal });
    return binding;
  }

  async function prepare(connection) {
    validateConnection(connection);
    return writeFullComputerConfig({
      provider: 'codex-cli', home: codexHome, workspacePath: connection.workspacePath,
    });
  }

  return Object.freeze({
    async getStatus(connection) {
      let binding;
      try { binding = await discover(connection); } catch { return { installed: false, authenticated: false, fullComputerAvailable: false }; }
      try {
        await ensureCodexCompatibility(binding, { signal: undefined });
        const login = await withLease(binding, (launchLease) => runner.capture({
          command: binding.path, launchLease, args: ['login', 'status'], env: environment, timeoutMs: 5000,
        }));
        return { installed: true, compatible: true, authenticated: login?.exitCode === 0, fullComputerAvailable: true };
      } catch (error) {
        if (error instanceof AgentError && error.code === 'CLI_VERSION_UNSUPPORTED') {
          return { installed: true, compatible: false, authenticated: false, fullComputerAvailable: false };
        }
        if (error instanceof AgentError && error.code === 'CLI_COMPATIBILITY_CHECK_FAILED') throw error;
        return { installed: true, compatible: true, authenticated: false, fullComputerAvailable: false };
      }
    },
    async beginSetup(connection) {
      const binding = await compatibleBinding(connection);
      await withLease(binding, (launchLease) => runner.launch({
        command: binding.path, launchLease, args: ['login'], env: environment, visible: true,
      }));
      return { started: true };
    },
    async listModels() { return listCodexModels(); },
    async getCapabilities(connection) {
      validateConnection(connection);
      return {
        permissionProfiles: ['full-computer'], network: true,
        authentication: true, efforts: [...EFFORTS],
      };
    },
    async verifyPermissionProfile(connection) {
      await prepare(connection);
      const binding = await compatibleBinding(connection);
      return verifyNativeToolSurface({
        provider: 'codex-cli', cliBinding: binding,
        workspacePath: connection.workspacePath, fixtureRoot,
        spawn: (spec) => withLease(binding, (launchLease) => runner.capture({
          ...spec, launchLease, timeoutMs: 30_000,
        })),
      });
    },
    async runGoal(request, emitActivity, signal, run) {
      validateRun(request, run);
      await prepare({
        executorType: 'codex-cli', workspacePath: request.workspace,
        permissionProfile: run.permissionProfile, fullAccessConfirmed: run.fullAccessConfirmed,
      });
      const binding = await compatibleBinding({
        executorType: 'codex-cli', workspacePath: request.workspace,
        permissionProfile: run.permissionProfile, fullAccessConfirmed: run.fullAccessConfirmed,
      }, signal);
      let responseText = null;
      const changedFiles = [];
      try {
        await withLease(binding, (launchLease) => runner.streamJsonl({
          command: binding.path,
          launchLease,
          args: [
            '--sandbox', 'danger-full-access', '--ask-for-approval', 'never',
            ...codexFeatureArgs(),
            '--model', request.model,
            '-c', `model_reasoning_effort="${request.effort}"`,
            'exec', '--ignore-rules', '--ephemeral', '--json',
            '--skip-git-repo-check', '--color', 'never',
          ],
          cwd: request.workspace,
          env: environment,
          goal: request.goal,
          signal,
        }, (event) => {
          const mapped = mapCodexEvent(event);
          if (!mapped) return;
          if (mapped.activity) emitActivity(mapped.activity);
          if (mapped.responseText) responseText = mapped.responseText;
          if (mapped.changedFiles) changedFiles.push(...mapped.changedFiles);
          if (mapped.error) throw new AgentError('PERMISSION_BLOCKED');
        }));
      } catch (error) {
        if (error instanceof AgentError) throw error;
        throw launchFailure(error);
      }
      if (!responseText) throw new AgentError('PROVIDER_OUTPUT_INVALID');
      return { text: responseText, changedFiles: [...new Set(changedFiles)] };
    },
  });
}

module.exports = {
  createCodexNativeFullComputerExecutor,
  writeNativeCodexConfig,
};
