'use strict';

const { AgentError } = require('../agent/agentErrors.js');

function plain(value) {
  return value !== null && typeof value === 'object'
    && Object.getPrototypeOf(value) === Object.prototype;
}

function validateAttachment(value) {
  const keys = ['name', 'extension', 'size', 'text'];
  if (!plain(value)
      || Object.keys(value).length !== keys.length
      || !keys.every((key) => Object.hasOwn(value, key))
      || typeof value.name !== 'string' || value.name.length === 0
      || typeof value.extension !== 'string' || !value.extension.startsWith('.')
      || !Number.isSafeInteger(value.size) || value.size < 0
      || typeof value.text !== 'string') {
    throw new AgentError('ATTACHMENT_INVALID');
  }
  return Object.freeze({ ...value });
}

function publicMetadata(value) {
  if (value === null) return null;
  return Object.freeze({
    name: value.name,
    extension: value.extension,
    size: value.size,
  });
}

function createPendingAttachment({ authorize, confirm }) {
  if (typeof authorize !== 'function' || typeof confirm !== 'function') {
    throw new TypeError('Pending attachment requires authorization and confirmation');
  }
  let attachment = null;

  return Object.freeze({
    async stage(filePath) {
      const authorization = await authorize({ filePath });
      if (!authorization || typeof authorization.consume !== 'function'
          || typeof authorization.cancel !== 'function') {
        throw new AgentError('ATTACHMENT_INVALID');
      }
      let candidate;
      try {
        candidate = validateAttachment(await authorization.consume());
      } finally {
        await authorization.cancel();
      }
      if (!await confirm(publicMetadata(candidate))) return false;
      attachment = candidate;
      return true;
    },
    clear() {
      attachment = null;
    },
    snapshot() {
      return publicMetadata(attachment);
    },
    take() {
      const current = attachment;
      attachment = null;
      return current;
    },
  });
}

module.exports = { createPendingAttachment };
