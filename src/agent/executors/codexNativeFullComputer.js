'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { AgentError } = require('../agentErrors.js');
const { createCliRunner } = require('../cliRunner.js');
const { codexFeatureArgs } = require('../codexFeaturePolicy.js');
const { mapCodexEvent } = require('../codexEventMapper.js');
const { createStageTimer } = require('../stageTiming.js');
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
  discoverSignedNativeCli = defaultDiscoverSignedNativeCli,
  openVerifiedNativeCliLaunchLease = defaultOpenLease,
  writeFullComputerConfig = writeNativeCodexConfig,
  ensureCodexCompatibility,
  // Stage timing is a diagnostic. It is enabled only when the app is unpackaged and the
  // CLAUDE_PET_STAGE_TIMING env flag is set (wired from main.js). The report carries only
  // fixed stage names, integer milliseconds, and fixed outcome categories — never paths,
  // hashes, credentials, command lines, environment values, or provider output — and is
  // consumed only in-process, never across the IPC/renderer boundary.
  stageTimingEnabled = false,
} = {}) {
  if (typeof codexHome !== 'string' || !codexHome) {
    throw new TypeError('Native Codex executor requires a dedicated home.');
  }
  if (typeof ensureCodexCompatibility !== 'function') throw new TypeError('Native Codex executor requires a runtime compatibility coordinator.');
  const environment = Object.freeze({ CODEX_HOME: codexHome });

  // In-process diagnostic sink only. The report never leaves the main process.
  const stageReports = [];
  function recordStageReport(timer) {
    if (!stageTimingEnabled) return;
    stageReports.push(timer.report());
    if (stageReports.length > 256) stageReports.shift();
  }

  async function withVerifiedCodex(connection, operation, signal, timer) {
    validateConnection(connection);
    let binding;
    let retainedSession;
    let lease;
    let operationError;
    try {
      let discovered;
      try {
        discovered = await timer.stage('discovery', async () => discoverSignedNativeCli({
          provider: 'codex-cli', workspacePath: connection.workspacePath, retainSession: true,
        }));
        binding = discovered?.binding || discovered;
        retainedSession = discovered?.session;
        if (!validBinding(binding)) throw new Error('Invalid Codex CLI binding');
      } catch (error) {
        if (error instanceof AgentError
          && ['UNSUPPORTED_OPTION', 'FULL_COMPUTER_CONFIRMATION_REQUIRED'].includes(error.code)) throw error;
        throw new AgentError('CLI_NOT_INSTALLED', { cause: error });
      }
      await timer.stage('qualification', async () => ensureCodexCompatibility(binding, { signal }));
      lease = await timer.stage('lease', async () => openVerifiedNativeCliLaunchLease(binding, retainedSession
        ? { session: retainedSession }
        : undefined));
      retainedSession = null;
      return await operation({ binding, lease });
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      if (lease?.cleanup) {
        try { await lease.cleanup(); } catch (error) { if (!operationError) throw error; }
      } else if (retainedSession?.release) {
        try { await retainedSession.release(); } catch (error) { if (!operationError) throw error; }
      }
    }
  }

  async function prepare(connection) {
    validateConnection(connection);
    return writeFullComputerConfig({
      provider: 'codex-cli', home: codexHome, workspacePath: connection.workspacePath,
    });
  }

  return Object.freeze({
    async getStatus(connection) {
      const timer = createStageTimer({ enabled: stageTimingEnabled });
      try {
        try {
          return await withVerifiedCodex(connection, async ({ binding, lease }) => {
            const login = await timer.stage('login-status', async () => runner.capture({
              command: binding.path, launchLease: lease, args: ['login', 'status'],
              env: environment, timeoutMs: 5000,
            }));
            const authenticated = login?.exitCode === 0;
            return { installed: true, compatible: true, authenticated, fullComputerAvailable: authenticated };
          }, undefined, timer);
        } catch (error) {
          if (error instanceof AgentError && error.code === 'CLI_NOT_INSTALLED') {
            return { installed: false, authenticated: false, fullComputerAvailable: false };
          }
          if (error instanceof AgentError && error.code === 'CLI_VERSION_UNSUPPORTED') {
            return { installed: true, compatible: false, authenticated: false, fullComputerAvailable: false };
          }
          if (error instanceof AgentError && error.code === 'CLI_COMPATIBILITY_CHECK_FAILED') throw error;
          return { installed: true, compatible: true, authenticated: false, fullComputerAvailable: false };
        }
      } finally {
        recordStageReport(timer);
      }
    },
    async beginSetup(connection) {
      const timer = createStageTimer({ enabled: stageTimingEnabled });
      try {
        await withVerifiedCodex(connection, ({ binding, lease }) => timer.stage('provider-start', async () => runner.launch({
          command: binding.path, launchLease: lease, args: ['login'], env: environment, visible: true,
        })), undefined, timer);
        return { started: true };
      } finally {
        recordStageReport(timer);
      }
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
      const timer = createStageTimer({ enabled: stageTimingEnabled });
      try {
        // Readiness comes from the compatibility contract, which already rediscovers the exact
        // signed executable and qualifies it. The former permission-purpose probe emitted no
        // available/allowed facts, so it could only ever pass or exhaust its bounded deadline.
        await timer.stage('config', async () => prepare(connection));
        await withVerifiedCodex(connection, async () => ({ available: true, allowed: true }), undefined, timer);
        return { available: true, allowed: true };
      } finally {
        recordStageReport(timer);
      }
    },
    async runGoal(request, emitActivity, signal, run) {
      validateRun(request, run);
      const activeConnection = {
        executorType: 'codex-cli', workspacePath: request.workspace,
        permissionProfile: run.permissionProfile, fullAccessConfirmed: run.fullAccessConfirmed,
      };
      const timer = createStageTimer({ enabled: stageTimingEnabled });
      let responseText = null;
      const changedFiles = [];
      try {
        await timer.stage('config', async () => prepare(activeConnection));
        try {
          await withVerifiedCodex(activeConnection, ({ binding, lease }) => timer.stage('provider-start', async () => runner.streamJsonl({
            command: binding.path,
            launchLease: lease,
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
          })), signal, timer);
        } catch (error) {
          if (error instanceof AgentError) throw error;
          throw launchFailure(error);
        }
        if (!responseText) throw new AgentError('PROVIDER_OUTPUT_INVALID');
        return { text: responseText, changedFiles: [...new Set(changedFiles)] };
      } finally {
        recordStageReport(timer);
      }
    },
  });
}

module.exports = {
  createCodexNativeFullComputerExecutor,
  writeNativeCodexConfig,
};
