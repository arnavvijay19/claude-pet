'use strict';

const { validateExecutor } = require('./agentContract.js');
const { AgentError } = require('./agentErrors.js');
const { deepFreeze } = require('./activityStore.js');

function cloneFrozen(value) {
  return deepFreeze(structuredClone(value));
}

function sanitizeOptions(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new AgentError('UNSUPPORTED_OPTION');
    return value;
  }
  if (!value || typeof value !== 'object') throw new AgentError('UNSUPPORTED_OPTION');
  if (ancestors.has(value)) throw new AgentError('UNSUPPORTED_OPTION');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new AgentError('UNSUPPORTED_OPTION');
      }
      return value.map((item) => sanitizeOptions(item, ancestors));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new AgentError('UNSUPPORTED_OPTION');
    }
    const clone = {};
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new AgentError('UNSUPPORTED_OPTION');
      }
      clone[key] = sanitizeOptions(descriptor.value, ancestors);
    }
    return clone;
  } finally {
    ancestors.delete(value);
  }
}

function modelIdOf(model) {
  if (typeof model === 'string') return model;
  if (model && typeof model.id === 'string') return model.id;
  return null;
}

function effortOf(connection) {
  return connection.effort
    || (connection.model && typeof connection.model === 'object' && connection.model.options?.effort)
    || null;
}

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
  if (!store || typeof store.getSelected !== 'function' || typeof store.select !== 'function') {
    throw new TypeError('Agent manager requires a connection store.');
  }
  if (!activity || typeof activity.begin !== 'function' || typeof activity.append !== 'function') {
    throw new TypeError('Agent manager requires an activity store.');
  }

  let active = null;
  let selectedConnectionId = null;

  async function selectedExecutor(signal) {
    const selected = await store.getSelected();
    throwIfAborted(signal);
    if (!selected) throw new AgentError('AGENT_REQUIRED');
    const options = sanitizeOptions(selected.options ?? {});
    const connection = cloneFrozen({ ...selected, options });
    const identifier = connection.executor || connection.type;
    if (typeof identifier !== 'string' || !identifier) throw new AgentError('AGENT_REQUIRED');
    selectedConnectionId = connection.id || null;
    return { connection, identifier, executor: executorFrom(executors, identifier) };
  }

  async function delegate(method) {
    const { connection, executor } = await selectedExecutor();
    if (method === 'getCapabilities') {
      return executor[method](connection, modelIdOf(connection.model));
    }
    if (method === 'verifyPermissionProfile') {
      return executor[method](connection);
    }
    return executor[method](connection);
  }

  function getSnapshot() {
    return Object.freeze({
      busy: active !== null,
      connectionId: active?.connectionId || selectedConnectionId,
    });
  }

  async function select(id) {
    if (active) throw new AgentError('AGENT_BUSY');
    const selected = await store.select(id);
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

      const status = cloneFrozen(await executor.getStatus(connection));
      throwIfAborted(controller.signal);
      if (status?.installed === false) throw new AgentError('CLI_NOT_INSTALLED');
      if (status?.authenticated === false) throw new AgentError('AUTH_REQUIRED');
      if (status?.workspaceAvailable === false) throw new AgentError('WORKSPACE_UNAVAILABLE');

      const modelId = modelIdOf(connection.model);
      const capabilities = cloneFrozen(await executor.getCapabilities(connection, modelId));
      throwIfAborted(controller.signal);
      const models = cloneFrozen(await executor.listModels(connection));
      throwIfAborted(controller.signal);
      const permission = cloneFrozen(await executor.verifyPermissionProfile(connection));
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

      const request = cloneFrozen({
        goal: text,
        workspace: connection.workspace,
        permissionProfile: connection.permissionProfile,
        model: modelId,
        effort,
        options: connection.options ?? {},
      });
      activity.begin({ connectionId: connection.id || null, executor: identifier, model: modelId });
      const emitActivity = (event) => {
        if (active === reservation) activity.append(event);
      };
      const result = await executor.runGoal(request, emitActivity, controller.signal);
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
