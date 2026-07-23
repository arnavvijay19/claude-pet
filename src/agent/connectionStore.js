'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { AgentError } = require('./agentErrors.js');

const PUBLIC_KEYS = Object.freeze([
  'id', 'executorType', 'label', 'workspacePath', 'permissionProfile',
  'fullAccessConfirmed', 'modelId', 'effort', 'keyHint', 'hasSecret',
]);
const DISK_KEYS = Object.freeze([
  'id', 'executorType', 'label', 'workspacePath', 'permissionProfile',
  'fullAccessConfirmed', 'modelId', 'effort', 'keyHint', 'encryptedKey',
]);
const SAVE_KEYS = Object.freeze([
  'id', 'executorType', 'label', 'workspacePath', 'permissionProfile',
  'modelId', 'effort', 'keyHint', 'secret',
]);

function failure(cause) {
  return new AgentError('SECRET_STORE_FAILED', { cause });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, allowed, required = []) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(value, key));
}

function isStringOrNull(value) {
  return typeof value === 'string' || value === null;
}

function validateConnection(connection) {
  if (!exactKeys(connection, DISK_KEYS, [
    'id', 'executorType', 'label', 'workspacePath', 'permissionProfile',
    'fullAccessConfirmed', 'modelId', 'effort', 'keyHint',
  ])) return false;
  return typeof connection.id === 'string' && connection.id.length > 0
    && typeof connection.executorType === 'string' && connection.executorType.length > 0
    && typeof connection.label === 'string'
    && typeof connection.workspacePath === 'string'
    && typeof connection.permissionProfile === 'string'
    && typeof connection.fullAccessConfirmed === 'boolean'
    && typeof connection.modelId === 'string'
    && isStringOrNull(connection.effort)
    && isStringOrNull(connection.keyHint)
    && (!Object.hasOwn(connection, 'encryptedKey')
      || (typeof connection.encryptedKey === 'string' && connection.encryptedKey.length > 0));
}

function validateState(value) {
  if (!exactKeys(value, ['version', 'activeSelection', 'connections'], ['version', 'activeSelection', 'connections'])) return false;
  if (value.version !== 1 || !isStringOrNull(value.activeSelection) || !Array.isArray(value.connections)) return false;
  const ids = new Set();
  return value.connections.every((connection) => {
    if (!validateConnection(connection) || ids.has(connection.id)) return false;
    ids.add(connection.id);
    return true;
  }) && (value.activeSelection === null || ids.has(value.activeSelection));
}

function publicConnection(connection) {
  return {
    id: connection.id,
    executorType: connection.executorType,
    label: connection.label,
    workspacePath: connection.workspacePath,
    permissionProfile: connection.permissionProfile,
    fullAccessConfirmed: connection.fullAccessConfirmed === true,
    modelId: connection.modelId || '',
    effort: connection.effort || null,
    keyHint: connection.keyHint || null,
    hasSecret: Boolean(connection.encryptedKey),
  };
}

function createConnectionStore({ filePath, crypto, randomId }) {
  if (typeof filePath !== 'string' || filePath.length === 0 || !crypto || typeof crypto.isAvailable !== 'function'
    || typeof crypto.encrypt !== 'function' || typeof crypto.decrypt !== 'function' || typeof randomId !== 'function') {
    throw new TypeError('Connection store requires filePath, crypto, and randomId');
  }

  let state = null;

  async function writeState() {
    const temporaryPath = `${filePath}.tmp`;
    const serialized = JSON.stringify(state);
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const handle = await fs.open(temporaryPath, 'w');
      try {
        await handle.writeFile(serialized, 'utf8');
        try {
          await handle.sync();
        } catch (error) {
          if (error && !['ENOSYS', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error;
        }
      } finally {
        await handle.close();
      }
      await fs.rename(temporaryPath, filePath);
    } catch (error) {
      try { await fs.unlink(temporaryPath); } catch { /* ignored cleanup */ }
      throw failure(error);
    }
  }

  async function initialize() {
    if (state) return;
    try {
      const text = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(text);
      if (!validateState(parsed)) throw new Error('Invalid connection store schema');
      state = parsed;
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        state = { version: 1, activeSelection: null, connections: [] };
        return;
      }
      throw failure(error);
    }
  }

  async function ready() {
    await initialize();
  }

  function find(id) {
    return state.connections.find((connection) => connection.id === id) || null;
  }

  async function isAvailable() {
    try {
      return Boolean(await crypto.isAvailable());
    } catch (error) {
      throw failure(error);
    }
  }

  function validateSaveInput(input) {
    const required = ['executorType', 'label', 'workspacePath', 'permissionProfile', 'modelId', 'effort', 'keyHint'];
    if (!exactKeys(input, SAVE_KEYS, required)
      || (Object.hasOwn(input, 'id') && (typeof input.id !== 'string' || input.id.length === 0))
      || typeof input.executorType !== 'string' || input.executorType.length === 0
      || typeof input.label !== 'string' || typeof input.workspacePath !== 'string'
      || typeof input.permissionProfile !== 'string' || typeof input.modelId !== 'string'
      || !isStringOrNull(input.effort) || !isStringOrNull(input.keyHint)
      || (Object.hasOwn(input, 'secret') && !isStringOrNull(input.secret))) {
      throw failure();
    }
  }

  async function saveConnection(input) {
    await ready();
    validateSaveInput(input);
    const existing = Object.hasOwn(input, 'id') ? find(input.id) : null;
    if (Object.hasOwn(input, 'id') && !existing) throw failure();
    const connection = {
      id: existing ? existing.id : randomId(),
      executorType: input.executorType,
      label: input.label,
      workspacePath: input.workspacePath,
      permissionProfile: input.permissionProfile,
      fullAccessConfirmed: existing ? existing.fullAccessConfirmed : false,
      modelId: input.modelId,
      effort: input.effort,
      keyHint: input.keyHint,
    };
    if (typeof connection.id !== 'string' || connection.id.length === 0 || (!existing && find(connection.id))) throw failure();

    if (Object.hasOwn(input, 'secret')) {
      if (input.secret === null || input.secret === '') {
        // Intentionally omit encryptedKey to clear a previously saved secret.
      } else {
        if (!await isAvailable()) throw failure();
        try {
          const encrypted = await crypto.encrypt(input.secret);
          if (!Buffer.isBuffer(encrypted)) throw new Error('safeStorage did not return a buffer');
          connection.encryptedKey = encrypted.toString('base64');
        } catch (error) {
          throw error instanceof AgentError ? error : failure(error);
        }
      }
    } else if (existing && existing.encryptedKey) {
      connection.encryptedKey = existing.encryptedKey;
    }

    if (existing) {
      state.connections = state.connections.map((value) => value.id === existing.id ? connection : value);
    } else {
      state.connections.push(connection);
    }
    await writeState();
    return publicConnection(connection);
  }

  async function listConnections() {
    await ready();
    return state.connections.map(publicConnection);
  }

  async function getConnection(id) {
    await ready();
    if (typeof id !== 'string') return null;
    const connection = find(id);
    return connection ? publicConnection(connection) : null;
  }

  async function getSecret(id) {
    await ready();
    const connection = find(id);
    if (!connection || !connection.encryptedKey) return null;
    if (!await isAvailable()) throw failure();
    let decrypted;
    try {
      decrypted = await crypto.decrypt(Buffer.from(connection.encryptedKey, 'base64'));
      if (!isPlainObject(decrypted) || typeof decrypted.value !== 'string' || typeof decrypted.shouldReEncrypt !== 'boolean') {
        throw new Error('Invalid decrypted secret');
      }
    } catch (error) {
      throw error instanceof AgentError ? error : failure(error);
    }
    if (decrypted.shouldReEncrypt) {
      try {
        const encrypted = await crypto.encrypt(decrypted.value);
        if (!Buffer.isBuffer(encrypted)) throw new Error('safeStorage did not return a buffer');
        connection.encryptedKey = encrypted.toString('base64');
        await writeState();
      } catch (error) {
        throw error instanceof AgentError ? error : failure(error);
      }
    }
    return decrypted.value;
  }

  async function removeConnection(id) {
    await ready();
    const connection = find(id);
    if (!connection) return false;
    state.connections = state.connections.filter((value) => value.id !== id);
    if (state.activeSelection === id) state.activeSelection = null;
    await writeState();
    return true;
  }

  async function getActiveSelection() {
    await ready();
    return state.activeSelection;
  }

  async function setActiveSelection(id) {
    await ready();
    if (id !== null && (typeof id !== 'string' || !find(id))) throw failure();
    state.activeSelection = id;
    await writeState();
    return state.activeSelection;
  }

  return Object.freeze({
    initialize,
    listConnections,
    getConnection,
    getSecret,
    saveConnection,
    removeConnection,
    getActiveSelection,
    setActiveSelection,
  });
}

module.exports = { PUBLIC_KEYS, createConnectionStore, publicConnection };
