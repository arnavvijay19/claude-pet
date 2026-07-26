'use strict';

const { AgentError } = require('./agentErrors.js');
const {
  FULL_COMPUTER,
  WORKSPACE,
  executorKey,
} = require('./executionModes.js');

const DRAFT_KEYS = Object.freeze([
  'id', 'executorType', 'label', 'workspacePath', 'permissionProfile',
  'modelId', 'effort', 'keyHint', 'secret',
]);
const REQUIRED_DRAFT_KEYS = Object.freeze([
  'executorType', 'label', 'workspacePath', 'permissionProfile',
  'modelId', 'effort', 'keyHint',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object'
    && Object.getPrototypeOf(value) === Object.prototype;
}

function validateDraft(draft) {
  if (!isPlainObject(draft)) throw new AgentError('UNSUPPORTED_OPTION');
  const keys = Object.keys(draft);
  if (!keys.every((key) => DRAFT_KEYS.includes(key))
      || !REQUIRED_DRAFT_KEYS.every((key) => Object.hasOwn(draft, key))) {
    throw new AgentError('UNSUPPORTED_OPTION');
  }
  if ((Object.hasOwn(draft, 'id') && (typeof draft.id !== 'string' || !draft.id))
      || typeof draft.executorType !== 'string'
      || typeof draft.label !== 'string'
      || typeof draft.workspacePath !== 'string'
      || typeof draft.modelId !== 'string'
      || (draft.effort !== null && typeof draft.effort !== 'string')
      || (draft.keyHint !== null && typeof draft.keyHint !== 'string')
      || (Object.hasOwn(draft, 'secret') && draft.secret !== null && typeof draft.secret !== 'string')) {
    throw new AgentError('UNSUPPORTED_OPTION');
  }
  executorKey(draft.executorType, draft.permissionProfile);
  return { ...draft };
}

function createFullComputerAuthorization({ store, showMessageBox, randomBytes }) {
  if (!store || typeof store.getRunConnection !== 'function'
      || typeof store.reserveConnectionId !== 'function'
      || typeof store.releaseReservedConnectionId !== 'function'
      || typeof store.saveWorkspaceConnection !== 'function'
      || typeof store.saveAuthorizedConnection !== 'function'
      || typeof store.setActiveSelection !== 'function'
      || typeof showMessageBox !== 'function' || typeof randomBytes !== 'function') {
    throw new TypeError('Full Computer authorization requires store, showMessageBox, and randomBytes');
  }

  let pending = null;

  async function select(saved) {
    await store.setActiveSelection(saved.id);
    return saved;
  }

  async function save(settingsWindow, rawDraft) {
    const draft = validateDraft(rawDraft);
    if (pending) throw new AgentError('FULL_COMPUTER_CONFIRMATION_REQUIRED');

    if (draft.permissionProfile === WORKSPACE) {
      return select(await store.saveWorkspaceConnection(draft));
    }
    if (draft.permissionProfile !== FULL_COMPUTER || draft.executorType === 'offline-demo') {
      throw new AgentError('UNSUPPORTED_OPTION');
    }

    const existing = Object.hasOwn(draft, 'id')
      ? await store.getRunConnection(draft.id)
      : null;
    if (Object.hasOwn(draft, 'id') && !existing) throw new AgentError('UNSUPPORTED_OPTION');
    if (existing?.fullAccessConfirmed === true
        && existing.executorType === draft.executorType) {
      return select(await store.saveAuthorizedConnection(draft, {
        expectedRevision: existing.revision,
      }));
    }

    const reservedId = existing ? null : await store.reserveConnectionId();
    let nonce;
    try {
      const bytes = randomBytes(32);
      if (!Buffer.isBuffer(bytes) || bytes.length !== 32) throw new Error('Invalid authorization nonce');
      nonce = bytes.toString('base64url');
    } catch (error) {
      if (reservedId) await store.releaseReservedConnectionId(reservedId);
      throw new AgentError('FULL_COMPUTER_CONFIRMATION_REQUIRED', { cause: error });
    }

    const record = Object.freeze({
      nonce,
      connectionId: existing?.id || reservedId,
      expectedRevision: existing?.revision || null,
      permissionProfile: FULL_COMPUTER,
    });
    pending = record;
    let response;
    try {
      response = await showMessageBox(settingsWindow, {
        type: 'warning',
        buttons: ['Cancel', 'Enable Full Computer'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: 'Enable Full Computer?',
        message: 'This agent can access your whole computer.',
        detail: 'It may read, change, or delete files outside the selected workspace, run programs, and use the network. This is not Workspace mode. Enable it only for goals and connections you trust.',
      });
    } catch (error) {
      if (pending === record) pending = null;
      if (reservedId) await store.releaseReservedConnectionId(reservedId);
      throw new AgentError('FULL_COMPUTER_CONFIRMATION_CANCELLED', { cause: error });
    }

    if (pending !== record || record.nonce !== nonce) {
      if (reservedId) await store.releaseReservedConnectionId(reservedId);
      throw new AgentError('FULL_COMPUTER_CONFIRMATION_REQUIRED');
    }
    pending = null;
    if (!response || response.response !== 1) {
      if (reservedId) await store.releaseReservedConnectionId(reservedId);
      throw new AgentError('FULL_COMPUTER_CONFIRMATION_CANCELLED');
    }

    try {
      const saved = existing
        ? await store.saveAuthorizedConnection(draft, { expectedRevision: record.expectedRevision })
        : await store.saveAuthorizedConnection(draft, { reservedId: record.connectionId });
      return select(saved);
    } catch (error) {
      if (reservedId) await store.releaseReservedConnectionId(reservedId);
      if (error instanceof AgentError && error.code === 'SECRET_STORE_FAILED') {
        throw new AgentError('FULL_COMPUTER_CONFIRMATION_REQUIRED', { cause: error });
      }
      throw error;
    }
  }

  return Object.freeze({
    save,
    isPending: () => pending !== null,
  });
}

module.exports = { createFullComputerAuthorization };
