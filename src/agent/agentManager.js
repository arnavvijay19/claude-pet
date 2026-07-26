'use strict';

const { validateExecutor } = require('./agentContract.js');
const { AgentError } = require('./agentErrors.js');
const { deepFreeze } = require('./activityStore.js');
const { FULL_COMPUTER, WORKSPACE, executorKey } = require('./executionModes.js');

function clonePlainJson(value, errorCode, ancestors = new Set()) {
  const reject = () => { throw new AgentError(errorCode); };
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) reject();
    return value;
  }
  if (!value || typeof value !== 'object' || ancestors.has(value)) reject();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) reject();
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => key !== 'length'
          && (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key)))) reject();
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) reject();
      }
      return value.map((item) => clonePlainJson(item, errorCode, ancestors));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) reject();
    const clone = {};
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) reject();
      Object.defineProperty(clone, key, {
        value: clonePlainJson(descriptor.value, errorCode, ancestors),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return clone;
  } finally {
    ancestors.delete(value);
  }
}

function cloneFrozenJson(value, errorCode) {
  return deepFreeze(clonePlainJson(value, errorCode));
}

function effortOf(connection) {
  return connection.effort || null;
}

const RUN_CONNECTION_FIELDS = Object.freeze([
  'id', 'revision', 'executorType', 'label', 'workspacePath', 'permissionProfile',
  'fullAccessConfirmed', 'modelId', 'effort', 'keyHint', 'hasSecret',
]);

function executorFrom(registry, identifier) {
  const executor = registry instanceof Map ? registry.get(identifier) : registry?.[identifier];
  if (!executor) throw new AgentError('AGENT_REQUIRED');
  return validateExecutor(executor);
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    throw error;
  }
}

function createAgentManager({ store, executors, activity }) {
  if (!store
      || typeof store.getActiveSelection !== 'function'
      || typeof store.setActiveSelection !== 'function'
      || typeof store.getConnection !== 'function'
      || typeof store.getRunConnection !== 'function') {
    throw new TypeError('Agent manager requires a connection store.');
  }
  if (!activity || typeof activity.begin !== 'function' || typeof activity.append !== 'function') {
    throw new TypeError('Agent manager requires an activity store.');
  }

  let active = null;
  let selectedConnectionId = null;

  async function selectedExecutor(signal) {
    const activeSelection = await store.getActiveSelection();
    const selected = activeSelection ? await store.getRunConnection(activeSelection) : null;
    throwIfAborted(signal);
    if (!selected) throw new AgentError('AGENT_REQUIRED');
    const selectedSnapshot = clonePlainJson(selected, 'UNSUPPORTED_OPTION');
    const connection = {};
    for (const field of RUN_CONNECTION_FIELDS) {
      if (Object.hasOwn(selectedSnapshot, field)) connection[field] = selectedSnapshot[field];
    }
    if (typeof connection.id !== 'string' || !connection.id
      || !Number.isSafeInteger(connection.revision) || connection.revision <= 0
      || typeof connection.executorType !== 'string' || !connection.executorType
      || typeof connection.workspacePath !== 'string'
      || (connection.permissionProfile !== WORKSPACE && connection.permissionProfile !== FULL_COMPUTER)
      || typeof connection.fullAccessConfirmed !== 'boolean'
      || typeof connection.modelId !== 'string'
      || (connection.effort !== null && typeof connection.effort !== 'string')) {
      throw new AgentError('UNSUPPORTED_OPTION');
    }
    deepFreeze(connection);
    const identifier = connection.executorType;
    const key = executorKey(identifier, connection.permissionProfile);
    if (connection.permissionProfile === FULL_COMPUTER && !connection.fullAccessConfirmed) {
      throw new AgentError('FULL_COMPUTER_CONFIRMATION_REQUIRED');
    }
    const run = deepFreeze({
      connectionId: connection.id,
      connectionRevision: connection.revision,
      executorType: identifier,
      permissionProfile: connection.permissionProfile,
      fullAccessConfirmed: connection.fullAccessConfirmed === true,
      workspace: connection.workspacePath,
      model: connection.modelId,
      effort: effortOf(connection),
    });
    selectedConnectionId = connection.id;
    return { connection, identifier, key, run, executor: executorFrom(executors, key) };
  }

  async function delegate(method) {
    const { connection, executor } = await selectedExecutor();
    if (method === 'getCapabilities') {
      return cloneFrozenJson(
        await executor[method](connection, connection.modelId || null),
        'PROVIDER_OUTPUT_INVALID',
      );
    }
    return cloneFrozenJson(await executor[method](connection), 'PROVIDER_OUTPUT_INVALID');
  }

  function getSnapshot() {
    return Object.freeze({
      busy: active !== null,
      connectionId: active?.connectionId || selectedConnectionId,
      ...(active?.permissionProfile ? { permissionProfile: active.permissionProfile } : {}),
    });
  }

  async function select(id) {
    if (active) throw new AgentError('AGENT_BUSY');
    await store.setActiveSelection(id);
    const selected = id ? await store.getConnection(id) : null;
    selectedConnectionId = selected?.id || id || null;
    return selected;
  }

  async function runGoal(text, options = {}) {
    if (!options || typeof options !== 'object' || Object.getPrototypeOf(options) !== Object.prototype
        || Object.keys(options).some((key) => key !== 'onStart')
        || (Object.hasOwn(options, 'onStart') && typeof options.onStart !== 'function')) {
      throw new AgentError('UNSUPPORTED_OPTION');
    }
    if (active) throw new AgentError('AGENT_BUSY');
    const controller = new AbortController();
    const reservation = { controller, connectionId: null };
    active = reservation;

    try {
      const { connection, identifier, run, executor } = await selectedExecutor(controller.signal);
      reservation.connectionId = connection.id;
      reservation.permissionProfile = run.permissionProfile;
      const publicRunContext = deepFreeze({
        connectionId: run.connectionId,
        executor: run.executorType,
        model: run.model,
        workspace: run.workspace,
        permissionProfile: run.permissionProfile,
      });
      options.onStart?.(publicRunContext);
      activity.begin(publicRunContext);

      const status = cloneFrozenJson(await executor.getStatus(connection), 'PROVIDER_OUTPUT_INVALID');
      throwIfAborted(controller.signal);
      if (status?.installed === false) throw new AgentError('CLI_NOT_INSTALLED');
      if (status?.authenticated === false) throw new AgentError('AUTH_REQUIRED');
      if (run.permissionProfile === WORKSPACE && status?.workspaceAvailable === false) {
        throw new AgentError('WORKSPACE_UNAVAILABLE');
      }
      if (run.permissionProfile === FULL_COMPUTER && status?.fullComputerAvailable === false) {
        throw new AgentError('NATIVE_FULL_COMPUTER_LAUNCH_FAILED');
      }

      const capabilities = cloneFrozenJson(
        await executor.getCapabilities(connection, run.model),
        'PROVIDER_OUTPUT_INVALID',
      );
      throwIfAborted(controller.signal);
      const models = cloneFrozenJson(await executor.listModels(connection), 'PROVIDER_OUTPUT_INVALID');
      throwIfAborted(controller.signal);
      const permission = cloneFrozenJson(
        await executor.verifyPermissionProfile(connection),
        'PROVIDER_OUTPUT_INVALID',
      );
      throwIfAborted(controller.signal);
      if (permission === false || permission?.available === false) {
        throw new AgentError('PERMISSION_PROFILE_UNAVAILABLE');
      }
      if (permission?.allowed === false || permission?.blocked === true) {
        throw new AgentError('PERMISSION_BLOCKED');
      }

      const selectedModel = Array.isArray(models)
        ? models.find((model) => (typeof model === 'string' ? model : model?.id) === run.model)
        : null;
      if (run.model && !selectedModel) throw new AgentError('MODEL_UNAVAILABLE');
      const supportedEfforts = capabilities?.efforts
        || selectedModel?.efforts
        || selectedModel?.capabilities?.efforts;
      if (run.effort && (!Array.isArray(supportedEfforts) || !supportedEfforts.includes(run.effort))) {
        throw new AgentError('UNSUPPORTED_OPTION');
      }

      const request = cloneFrozenJson({
        goal: text,
        workspace: run.workspace,
        permissionProfile: run.permissionProfile,
        model: run.model,
        effort: run.effort,
        options: {},
      }, 'UNSUPPORTED_OPTION');
      const emitActivity = (event) => {
        if (active === reservation) activity.append(event);
      };
      const result = cloneFrozenJson(
        await executor.runGoal(request, emitActivity, controller.signal, run),
        'PROVIDER_OUTPUT_INVALID',
      );
      throwIfAborted(controller.signal);
      if (!result || typeof result.text !== 'string' || !Array.isArray(result.changedFiles)
          || result.changedFiles.some((filePath) => typeof filePath !== 'string')) {
        throw new AgentError('PROVIDER_OUTPUT_INVALID');
      }
      return {
        text: result.text,
        changedFiles: [...result.changedFiles],
        connectionId: run.connectionId,
        executor: identifier,
        model: run.model,
      };
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') throw new AgentError('RUN_STOPPED');
      if (error instanceof AgentError) throw error;
      throw new AgentError('COMMAND_FAILED', { cause: error });
    } finally {
      if (active === reservation) active = null;
    }
  }

  function stop() {
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  return Object.freeze({
    getSnapshot,
    select,
    getStatus: () => delegate('getStatus'),
    beginSetup: () => delegate('beginSetup'),
    listModels: () => delegate('listModels'),
    getCapabilities: () => delegate('getCapabilities'),
    verifyPermissionProfile: () => delegate('verifyPermissionProfile'),
    runGoal,
    stop,
  });
}

module.exports = { createAgentManager };
