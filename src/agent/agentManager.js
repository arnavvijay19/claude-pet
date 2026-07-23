'use strict';

const { validateExecutor } = require('./agentContract.js');
const { AgentError } = require('./agentErrors.js');
const { deepFreeze } = require('./activityStore.js');

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
      if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        reject();
      }
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

function modelIdOf(model) {
  if (typeof model === 'string') return model;
  if (model && typeof model.id === 'string') return model.id;
  return null;
}

function effortOf(connection) {
  return connection.effort || null;
}

const PUBLIC_CONNECTION_FIELDS = Object.freeze([
  'id', 'executorType', 'label', 'workspacePath', 'permissionProfile',
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
    || typeof store.getConnection !== 'function') {
    throw new TypeError('Agent manager requires a connection store.');
  }
  if (!activity || typeof activity.begin !== 'function' || typeof activity.append !== 'function') {
    throw new TypeError('Agent manager requires an activity store.');
  }

  let active = null;
  let selectedConnectionId = null;

  async function selectedExecutor(signal) {
    const activeSelection = await store.getActiveSelection();
    const selected = activeSelection ? await store.getConnection(activeSelection) : null;
    throwIfAborted(signal);
    if (!selected) throw new AgentError('AGENT_REQUIRED');
    const selectedSnapshot = clonePlainJson(selected, 'UNSUPPORTED_OPTION');
    const connection = {};
    for (const field of PUBLIC_CONNECTION_FIELDS) {
      if (Object.hasOwn(selectedSnapshot, field)) connection[field] = selectedSnapshot[field];
    }
    deepFreeze(connection);
    const identifier = connection.executorType;
    if (typeof identifier !== 'string' || !identifier) throw new AgentError('AGENT_REQUIRED');
    selectedConnectionId = connection.id || null;
    return { connection, identifier, executor: executorFrom(executors, identifier) };
  }

  async function delegate(method) {
    const { connection, executor } = await selectedExecutor();
    if (method === 'getCapabilities') {
      return cloneFrozenJson(
        await executor[method](connection, connection.modelId || null),
        'PROVIDER_OUTPUT_INVALID',
      );
    }
    if (method === 'verifyPermissionProfile') {
      return cloneFrozenJson(await executor[method](connection), 'PROVIDER_OUTPUT_INVALID');
    }
    return cloneFrozenJson(await executor[method](connection), 'PROVIDER_OUTPUT_INVALID');
  }

  function getSnapshot() {
    return Object.freeze({
      busy: active !== null,
      connectionId: active?.connectionId || selectedConnectionId,
    });
  }

  async function select(id) {
    if (active) throw new AgentError('AGENT_BUSY');
    await store.setActiveSelection(id);
    const selected = id ? await store.getConnection(id) : null;
    selectedConnectionId = selected?.id || id || null;
    return selected;
  }

  async function runGoal(text) {
    if (active) throw new AgentError('AGENT_BUSY');
    const controller = new AbortController();
    const reservation = { controller, connectionId: null };
    active = reservation;

    try {
      const { connection, identifier, executor } = await selectedExecutor(controller.signal);
      reservation.connectionId = connection.id || null;

      const status = cloneFrozenJson(await executor.getStatus(connection), 'PROVIDER_OUTPUT_INVALID');
      throwIfAborted(controller.signal);
      if (status?.installed === false) throw new AgentError('CLI_NOT_INSTALLED');
      if (status?.authenticated === false) throw new AgentError('AUTH_REQUIRED');
      if (status?.workspaceAvailable === false) throw new AgentError('WORKSPACE_UNAVAILABLE');

      const modelId = connection.modelId || null;
      const capabilities = cloneFrozenJson(
        await executor.getCapabilities(connection, modelId),
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
        ? models.find((model) => (typeof model === 'string' ? model : model?.id) === modelId)
        : null;
      if (modelId && !selectedModel) throw new AgentError('MODEL_UNAVAILABLE');

      const effort = effortOf(connection);
      const supportedEfforts = capabilities?.efforts
        || selectedModel?.efforts
        || selectedModel?.capabilities?.efforts;
      if (effort && (!Array.isArray(supportedEfforts) || !supportedEfforts.includes(effort))) {
        throw new AgentError('UNSUPPORTED_OPTION');
      }

      const request = cloneFrozenJson({
        goal: text,
        workspace: connection.workspacePath,
        permissionProfile: connection.permissionProfile,
        model: modelId,
        effort,
        options: {},
      }, 'UNSUPPORTED_OPTION');
      activity.begin({ connectionId: connection.id || null, executor: identifier, model: modelId });
      const emitActivity = (event) => {
        if (active === reservation) activity.append(event);
      };
      const result = cloneFrozenJson(
        await executor.runGoal(request, emitActivity, controller.signal),
        'PROVIDER_OUTPUT_INVALID',
      );
      throwIfAborted(controller.signal);
      if (!result || typeof result.text !== 'string' || !Array.isArray(result.changedFiles)
          || result.changedFiles.some((path) => typeof path !== 'string')) {
        throw new AgentError('PROVIDER_OUTPUT_INVALID');
      }
      return {
        text: result.text,
        changedFiles: [...result.changedFiles],
        connectionId: connection.id || null,
        executor: identifier,
        model: modelId,
      };
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        throw new AgentError('RUN_STOPPED');
      }
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
