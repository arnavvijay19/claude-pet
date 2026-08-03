'use strict';

const cryptoModule = require('node:crypto');
const defaultFileSystem = require('node:fs/promises');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const DEFAULT_MAXIMUM_ENTRIES = 8;
const MAXIMUM_ENCODED_BYTES = 64 * 1024;
const OFFICIAL_PUBLISHER = 'OpenAI OpCo, LLC';
const IDENTITY_KEYS = Object.freeze([
  'path', 'sha256', 'volumeSerial', 'fileId', 'version', 'publisher',
]);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object'
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length
    && actual.every((key) => keys.includes(key));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPolicyRevision(value) {
  return (typeof value === 'string' && value.length > 0)
    || (Number.isSafeInteger(value) && value >= 0);
}

function isIsoTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function validateIdentity(identity) {
  return hasExactKeys(identity, IDENTITY_KEYS)
    && isNonEmptyString(identity.path)
    && path.win32.isAbsolute(identity.path)
    && typeof identity.sha256 === 'string' && /^[a-fA-F0-9]{64}$/.test(identity.sha256)
    && isNonEmptyString(identity.volumeSerial)
    && isNonEmptyString(identity.fileId)
    && typeof identity.version === 'string' && SEMVER.test(identity.version)
    && identity.publisher === OFFICIAL_PUBLISHER;
}

function digestFor(identity, policyRevision) {
  if (!validateIdentity(identity) || !isPolicyRevision(policyRevision)) return null;
  const digestInput = JSON.stringify({
    policyRevision,
    path: path.win32.normalize(identity.path).toLowerCase(),
    sha256: identity.sha256.toLowerCase(),
    volumeSerial: identity.volumeSerial,
    fileId: identity.fileId,
    version: identity.version,
    publisher: identity.publisher,
  });
  return cryptoModule.createHash('sha256').update(digestInput, 'utf8').digest('hex');
}

function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, entries: [] };
}

function validateEntry(entry, seen) {
  if (!hasExactKeys(entry, ['digest', 'qualifiedAt'])
      || typeof entry.digest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.digest)
      || !isIsoTimestamp(entry.qualifiedAt) || seen.has(entry.digest)) return false;
  seen.add(entry.digest);
  return true;
}

function validateState(value, maximumEntries) {
  if (!hasExactKeys(value, ['schemaVersion', 'entries'])
      || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.entries)
      || value.entries.length > maximumEntries) return false;
  const seen = new Set();
  return value.entries.every((entry) => validateEntry(entry, seen));
}

function isCanonicalBase64(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAXIMUM_ENCODED_BYTES
    && value.length % 4 === 0
    && /^[A-Za-z0-9+/]*={0,2}$/.test(value)
    && Buffer.from(value, 'base64').toString('base64') === value;
}

function createCodexCompatibilityStore({
  filePath,
  crypto,
  clock = () => new Date().toISOString(),
  maximumEntries = DEFAULT_MAXIMUM_ENTRIES,
  fileSystem = defaultFileSystem,
} = {}) {
  if (!isNonEmptyString(filePath) || !crypto || typeof crypto.isAvailable !== 'function'
      || typeof crypto.encrypt !== 'function' || typeof crypto.decrypt !== 'function'
      || typeof clock !== 'function' || !Number.isSafeInteger(maximumEntries)
      || maximumEntries < 1 || maximumEntries > DEFAULT_MAXIMUM_ENTRIES
      || !fileSystem || typeof fileSystem.stat !== 'function' || typeof fileSystem.readFile !== 'function'
      || typeof fileSystem.mkdir !== 'function'
      || typeof fileSystem.open !== 'function' || typeof fileSystem.rename !== 'function') {
    throw new TypeError('Codex compatibility store requires protected storage and a file path');
  }

  let state = null;
  let initializePromise = null;
  let mutationTail = Promise.resolve();
  const temporaryPath = `${filePath}.tmp`;

  function initialize() {
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      state = emptyState();
      try {
        if (!await crypto.isAvailable()) return;
        const details = await fileSystem.stat(filePath);
        if (!Number.isSafeInteger(details.size) || details.size < 1 || details.size > MAXIMUM_ENCODED_BYTES) return;
        const encoded = await fileSystem.readFile(filePath, 'utf8');
        if (!isCanonicalBase64(encoded)) return;
        const decrypted = await crypto.decrypt(Buffer.from(encoded, 'base64'));
        if (!isPlainObject(decrypted) || typeof decrypted.value !== 'string'
            || typeof decrypted.shouldReEncrypt !== 'boolean') return;
        const candidate = JSON.parse(decrypted.value);
        if (validateState(candidate, maximumEntries)) state = candidate;
      } catch {
        state = emptyState();
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

  async function writeState(next) {
    let temporaryCreated = false;
    try {
      const serialized = JSON.stringify(next);
      const encrypted = await crypto.encrypt(serialized);
      if (!Buffer.isBuffer(encrypted)) return false;
      const encoded = encrypted.toString('base64');
      if (!isCanonicalBase64(encoded)) return false;
      await fileSystem.mkdir(path.dirname(filePath), { recursive: true });
      const handle = await fileSystem.open(temporaryPath, 'wx');
      temporaryCreated = true;
      try {
        await handle.writeFile(encoded, 'utf8');
        try {
          await handle.sync();
        } catch (error) {
          if (!error || !['ENOSYS', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error;
        }
      } finally {
        await handle.close();
      }
      await fileSystem.rename(temporaryPath, filePath);
      temporaryCreated = false;
      return true;
    } catch {
      return false;
    } finally {
      if (temporaryCreated && typeof fileSystem.unlink === 'function') {
        try { await fileSystem.unlink(temporaryPath); } catch { /* ignored cleanup */ }
      }
    }
  }

  async function hasSuccessful(identity, policyRevision) {
    const digest = digestFor(identity, policyRevision);
    if (!digest) return false;
    await ready();
    try {
      if (!await crypto.isAvailable()) return false;
    } catch {
      return false;
    }
    return state.entries.some((entry) => entry.digest === digest);
  }

  function rememberSuccessful(identity, policyRevision) {
    const digest = digestFor(identity, policyRevision);
    if (!digest) return Promise.resolve(false);
    return enqueue(async () => {
      let available;
      try {
        available = Boolean(await crypto.isAvailable());
      } catch {
        return false;
      }
      if (!available) return false;
      let qualifiedAt;
      try {
        qualifiedAt = clock();
      } catch {
        return false;
      }
      if (!isIsoTimestamp(qualifiedAt)) return false;
      const remaining = state.entries.filter((entry) => entry.digest !== digest);
      const next = {
        schemaVersion: SCHEMA_VERSION,
        entries: [...remaining, { digest, qualifiedAt }].slice(-maximumEntries),
      };
      if (!await writeState(next)) return false;
      state = next;
      return true;
    });
  }

  return Object.freeze({ initialize, hasSuccessful, rememberSuccessful });
}

module.exports = {
  DEFAULT_MAXIMUM_ENTRIES,
  MAXIMUM_ENCODED_BYTES,
  OFFICIAL_PUBLISHER,
  SCHEMA_VERSION,
  createCodexCompatibilityStore,
};
