'use strict';

const defaultFileSystem = require('node:fs/promises');
const path = require('node:path');

const { AgentError } = require('./agentErrors.js');
const { FULL_COMPUTER, WORKSPACE } = require('./executionModes.js');

const STORE_VERSION = 2;
const PUBLIC_KEYS = Object.freeze([
  'id', 'executorType', 'label', 'workspacePath', 'permissionProfile',
  'modelId', 'effort', 'keyHint', 'hasSecret',
]);
const DISK_KEYS = Object.freeze([
  'id', 'revision', 'executorType', 'label', 'workspacePath',
  'permissionProfile', 'fullAccessConfirmed', 'modelId', 'effort',
  'keyHint', 'encryptedKey',
]);
const SAVE_KEYS = Object.freeze([
  'id', 'executorType', 'label', 'workspacePath', 'permissionProfile',
  'modelId', 'effort', 'keyHint', 'secret',
]);

function failure(cause) {
  return new AgentError('SECRET_STORE_FAILED', { cause });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object'
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, allowed, required = []) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key))
    && required.every((key) => Object.hasOwn(value, key));
}

function isStringOrNull(value) {
  return typeof value === 'string' || value === null;
}

function validateConnection(connection, { version = STORE_VERSION } = {}) {
  const keys = version === 1 ? DISK_KEYS.filter((key) => key !== 'revision') : DISK_KEYS;
  const required = [
    'id', 'executorType', 'label', 'workspacePath', 'permissionProfile',
    'fullAccessConfirmed', 'modelId', 'effort', 'keyHint',
  ];
  if (version === STORE_VERSION) required.splice(1, 0, 'revision');
  if (!exactKeys(connection, keys, required)) return false;
  return typeof connection.id === 'string' && connection.id.length > 0
    && (version === 1 || (Number.isSafeInteger(connection.revision) && connection.revision > 0))
    && typeof connection.executorType === 'string' && connection.executorType.length > 0
    && typeof connection.label === 'string'
    && typeof connection.workspacePath === 'string'
    && (connection.permissionProfile === WORKSPACE || connection.permissionProfile === FULL_COMPUTER)
    && typeof connection.fullAccessConfirmed === 'boolean'
    && typeof connection.modelId === 'string'
    && isStringOrNull(connection.effort)
    && isStringOrNull(connection.keyHint)
    && (!Object.hasOwn(connection, 'encryptedKey')
      || (typeof connection.encryptedKey === 'string' && connection.encryptedKey.length > 0));
}

function validateState(value, version) {
  if (!exactKeys(value, ['version', 'activeSelection', 'connections'], [
    'version', 'activeSelection', 'connections',
  ])) return false;
  if (value.version !== version || !isStringOrNull(value.activeSelection)
      || !Array.isArray(value.connections)) return false;
  const ids = new Set();
  return value.connections.every((connection) => {
    if (!validateConnection(connection, { version }) || ids.has(connection.id)) return false;
    ids.add(connection.id);
    return true;
  }) && (value.activeSelection === null || ids.has(value.activeSelection));
}

function migrateState(value) {
  if (validateState(value, STORE_VERSION)) return structuredClone(value);
  if (!validateState(value, 1)) throw new Error('Invalid connection store schema');
  return {
    version: STORE_VERSION,
    activeSelection: value.activeSelection,
    connections: value.connections.map((connection) => ({
      id: connection.id,
      revision: 1,
      executorType: connection.executorType,
      label: connection.label,
      workspacePath: connection.workspacePath,
      permissionProfile: connection.permissionProfile,
      fullAccessConfirmed: connection.fullAccessConfirmed === true,
      modelId: connection.modelId,
      effort: connection.effort,
      keyHint: connection.keyHint,
      ...(connection.encryptedKey ? { encryptedKey: connection.encryptedKey } : {}),
    })),
  };
}

function publicConnection(connection) {
  return {
    id: connection.id,
    executorType: connection.executorType,
    label: connection.label,
    workspacePath: connection.workspacePath,
    permissionProfile: connection.permissionProfile,
    modelId: connection.modelId || '',
    effort: connection.effort || null,
    keyHint: connection.keyHint || null,
    hasSecret: Boolean(connection.encryptedKey),
  };
}

function runConnection(connection) {
  return {
    ...publicConnection(connection),
    revision: connection.revision,
    fullAccessConfirmed: connection.fullAccessConfirmed === true,
  };
}

function createConnectionStore({
  filePath,
  crypto,
  randomId,
  fileSystem = defaultFileSystem,
}) {
  if (typeof filePath !== 'string' || filePath.length === 0
      || !crypto || typeof crypto.isAvailable !== 'function'
      || typeof crypto.encrypt !== 'function' || typeof crypto.decrypt !== 'function'
      || typeof randomId !== 'function'
      || !fileSystem || typeof fileSystem.readFile !== 'function'
      || typeof fileSystem.writeFile !== 'function' || typeof fileSystem.rename !== 'function') {
    throw new TypeError('Connection store requires filePath, crypto, randomId, and a file system');
  }

  let state = null;
  let initializePromise = null;
  let mutationTail = Promise.resolve();
  const reservations = new Set();

  async function writeState(next) {
    const temporaryPath = `${filePath}.tmp`;
    const serialized = JSON.stringify(next);
    try {
      await fileSystem.mkdir(path.dirname(filePath), { recursive: true });
      const handle = await fileSystem.open(temporaryPath, 'w');
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
      await fileSystem.rename(temporaryPath, filePath);
    } catch (error) {
      try { await fileSystem.unlink(temporaryPath); } catch { /* ignored cleanup */ }
      throw failure(error);
    }
  }

  function initialize() {
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      try {
        const text = await fileSystem.readFile(filePath, 'utf8');
        state = migrateState(JSON.parse(text));
      } catch (error) {
        if (error && error.code === 'ENOENT') {
          state = { version: STORE_VERSION, activeSelection: null, connections: [] };
          return;
        }
        throw error instanceof AgentError ? error : failure(error);
      }
    })();
    return initializePromise;
  }

  async function ready() {
    await initialize();
    await mutationTail;
  }

  function enqueue(operation) {
    const pending = mutationTail.then(async () => {
      await initialize();
      return operation();
    });
    mutationTail = pending.catch(() => {});
    return pending;
  }

  function findIn(value, id) {
    return value.connections.find((connection) => connection.id === id) || null;
  }

  async function isAvailable() {
    try {
      return Boolean(await crypto.isAvailable());
    } catch (error) {
      throw failure(error);
    }
  }

  function validateSaveInput(input, requiredProfile) {
    const required = [
      'executorType', 'label', 'workspacePath', 'permissionProfile',
      'modelId', 'effort', 'keyHint',
    ];
    if (!exactKeys(input, SAVE_KEYS, required)
      || (Object.hasOwn(input, 'id') && (typeof input.id !== 'string' || input.id.length === 0))
      || typeof input.executorType !== 'string' || input.executorType.length === 0
      || typeof input.label !== 'string' || typeof input.workspacePath !== 'string'
      || input.permissionProfile !== requiredProfile || typeof input.modelId !== 'string'
      || !isStringOrNull(input.effort) || !isStringOrNull(input.keyHint)
      || (Object.hasOwn(input, 'secret') && !isStringOrNull(input.secret))) {
      throw failure();
    }
  }

  async function connectionFromInput(input, existing, { id, confirmed }) {
    const connection = {
      id,
      revision: existing ? existing.revision + 1 : 1,
      executorType: input.executorType,
      label: input.label,
      workspacePath: input.workspacePath,
      permissionProfile: input.permissionProfile,
      fullAccessConfirmed: confirmed,
      modelId: input.modelId,
      effort: input.effort,
      keyHint: input.keyHint,
    };
    if (Object.hasOwn(input, 'secret')) {
      if (!await isAvailable()) throw failure();
      if (input.secret !== null && input.secret !== '') {
        try {
          const encrypted = await crypto.encrypt(input.secret);
          if (!Buffer.isBuffer(encrypted)) throw new Error('safeStorage did not return a buffer');
          connection.encryptedKey = encrypted.toString('base64');
        } catch (error) {
          throw error instanceof AgentError ? error : failure(error);
        }
      }
    } else if (existing?.encryptedKey) {
      connection.encryptedKey = existing.encryptedKey;
    }
    return connection;
  }

  async function commitConnection(next, connection) {
    const existing = findIn(next, connection.id);
    if (existing) {
      next.connections = next.connections.map((value) => value.id === connection.id ? connection : value);
    } else {
      next.connections.push(connection);
    }
    await writeState(next);
    state = next;
    return publicConnection(connection);
  }

  function saveWorkspaceConnection(input) {
    return enqueue(async () => {
      validateSaveInput(input, WORKSPACE);
      const next = structuredClone(state);
      const existing = Object.hasOwn(input, 'id') ? findIn(next, input.id) : null;
      if (Object.hasOwn(input, 'id') && !existing) throw failure();
      let id;
      if (existing) {
        id = existing.id;
      } else {
        id = randomId();
        if (typeof id !== 'string' || !id || findIn(next, id) || reservations.has(id)) throw failure();
      }
      const connection = await connectionFromInput(input, existing, {
        id,
        confirmed: existing?.fullAccessConfirmed === true
          && existing.executorType === input.executorType,
      });
      return commitConnection(next, connection);
    });
  }

  function reserveConnectionId() {
    return enqueue(async () => {
      for (let attempt = 0; attempt < 1024; attempt += 1) {
        const id = randomId();
        if (typeof id === 'string' && id.length > 0 && !findIn(state, id) && !reservations.has(id)) {
          reservations.add(id);
          return id;
        }
      }
      throw failure(new Error('Could not reserve a unique connection identifier'));
    });
  }

  function releaseReservedConnectionId(id) {
    return enqueue(async () => reservations.delete(id));
  }

  function saveAuthorizedConnection(input, authorization) {
    return enqueue(async () => {
      validateSaveInput(input, FULL_COMPUTER);
      if (!exactKeys(authorization, ['reservedId', 'expectedRevision'])) throw failure();
      const next = structuredClone(state);
      let existing = null;
      let id;
      if (Object.hasOwn(input, 'id')) {
        if (Object.hasOwn(authorization, 'reservedId')
          || !Number.isSafeInteger(authorization.expectedRevision)
          || authorization.expectedRevision <= 0) throw failure();
        existing = findIn(next, input.id);
        if (!existing || existing.revision !== authorization.expectedRevision) throw failure();
        id = existing.id;
      } else {
        if (Object.hasOwn(authorization, 'expectedRevision')
          || typeof authorization.reservedId !== 'string'
          || !reservations.has(authorization.reservedId)
          || findIn(next, authorization.reservedId)) throw failure();
        id = authorization.reservedId;
        reservations.delete(id);
      }
      const connection = await connectionFromInput(input, existing, { id, confirmed: true });
      return commitConnection(next, connection);
    });
  }

  async function listConnections() {
    await ready();
    return state.connections.map(publicConnection);
  }

  async function getConnection(id) {
    await ready();
    if (typeof id !== 'string') return null;
    const connection = findIn(state, id);
    return connection ? publicConnection(connection) : null;
  }

  async function getRunConnection(id) {
    await ready();
    if (typeof id !== 'string') return null;
    const connection = findIn(state, id);
    return connection ? runConnection(connection) : null;
  }

  async function getSecret(id) {
    await ready();
    const connection = findIn(state, id);
    if (!connection?.encryptedKey) return null;
    if (!await isAvailable()) throw failure();
    let decrypted;
    try {
      decrypted = await crypto.decrypt(Buffer.from(connection.encryptedKey, 'base64'));
      if (!isPlainObject(decrypted) || typeof decrypted.value !== 'string'
          || typeof decrypted.shouldReEncrypt !== 'boolean') {
        throw new Error('Invalid decrypted secret');
      }
    } catch (error) {
      throw error instanceof AgentError ? error : failure(error);
    }
    if (decrypted.shouldReEncrypt) {
      const originalCiphertext = connection.encryptedKey;
      await enqueue(async () => {
        const current = findIn(state, id);
        if (!current || current.encryptedKey !== originalCiphertext) throw failure();
        try {
          const encrypted = await crypto.encrypt(decrypted.value);
          if (!Buffer.isBuffer(encrypted)) throw new Error('safeStorage did not return a buffer');
          const next = structuredClone(state);
          const replacement = findIn(next, id);
          replacement.encryptedKey = encrypted.toString('base64');
          replacement.revision += 1;
          await writeState(next);
          state = next;
        } catch (error) {
          throw error instanceof AgentError ? error : failure(error);
        }
      });
    }
    return decrypted.value;
  }

  function removeConnection(id) {
    return enqueue(async () => {
      const existing = findIn(state, id);
      if (!existing) return false;
      const next = structuredClone(state);
      next.connections = next.connections.filter((connection) => connection.id !== id);
      if (next.activeSelection === id) next.activeSelection = null;
      await writeState(next);
      state = next;
      return true;
    });
  }

  async function getActiveSelection() {
    await ready();
    return state.activeSelection;
  }

  function setActiveSelection(id) {
    return enqueue(async () => {
      if (id !== null && (typeof id !== 'string' || !findIn(state, id))) throw failure();
      const next = structuredClone(state);
      next.activeSelection = id;
      await writeState(next);
      state = next;
      return state.activeSelection;
    });
  }

  return Object.freeze({
    initialize,
    listConnections,
    getConnection,
    getRunConnection,
    getSecret,
    saveConnection: saveWorkspaceConnection,
    saveWorkspaceConnection,
    reserveConnectionId,
    releaseReservedConnectionId,
    saveAuthorizedConnection,
    removeConnection,
    getActiveSelection,
    setActiveSelection,
  });
}

module.exports = {
  DISK_KEYS,
  PUBLIC_KEYS,
  STORE_VERSION,
  createConnectionStore,
  publicConnection,
};
