'use strict';

const defaultFileSystem = require('node:fs/promises');
const path = require('node:path');

const { AgentError } = require('./agentErrors.js');
const { digestFor } = require('./codexCompatibilityStore.js');
const { verifyNativeToolSurface: defaultVerifyNativeToolSurface } = require('./localProviderProbe.js');

function result(version, cached) {
  return Object.freeze({ compatible: true, version, cached });
}

function checkDependencies(store, qualify, policyRevision) {
  if (!store || typeof store.hasSuccessful !== 'function'
      || typeof store.rememberSuccessful !== 'function'
      || typeof qualify !== 'function'
      || !((typeof policyRevision === 'string' && policyRevision.length > 0)
        || (Number.isSafeInteger(policyRevision) && policyRevision >= 0))) {
    throw new TypeError('Codex compatibility requires protected storage and a qualifier');
  }
}

function createCodexCompatibility({ store, qualify, policyRevision = 1 } = {}) {
  checkDependencies(store, qualify, policyRevision);
  const successful = new Set();
  const pending = new Map();

  async function ensureCompatible(binding, { signal } = {}) {
    const digest = digestFor(binding, policyRevision);
    if (!digest) throw new AgentError('CLI_COMPATIBILITY_CHECK_FAILED');
    if (successful.has(digest)) return result(binding.version, true);
    try {
      if (await store.hasSuccessful(binding, policyRevision)) {
        successful.add(digest);
        return result(binding.version, true);
      }
    } catch {
      throw new AgentError('CLI_COMPATIBILITY_CHECK_FAILED');
    }
    if (pending.has(digest)) return pending.get(digest);
    const qualification = (async () => {
      let qualified;
      try {
        qualified = await qualify(binding, { signal });
      } catch {
        throw new AgentError('CLI_COMPATIBILITY_CHECK_FAILED');
      }
      if (qualified === false) throw new AgentError('CLI_VERSION_UNSUPPORTED');
      if (qualified !== true) throw new AgentError('CLI_COMPATIBILITY_CHECK_FAILED');
      successful.add(digest);
      try { await store.rememberSuccessful(binding, policyRevision); } catch { /* memory cache is sufficient */ }
      return result(binding.version, false);
    })();
    pending.set(digest, qualification);
    try {
      return await qualification;
    } finally {
      pending.delete(digest);
    }
  }

  return Object.freeze({ ensureCompatible });
}

function completeIncompatibility(resultValue) {
  return resultValue !== null && typeof resultValue === 'object'
    && Object.getPrototypeOf(resultValue) === Object.prototype
    && Object.keys(resultValue).length === 1
    && resultValue.compatible === false;
}

function createCodexCompatibilityQualifier({
  compatibilityRoot,
  fixtureRoot,
  verifyNativeToolSurface = defaultVerifyNativeToolSurface,
  fileSystem = defaultFileSystem,
} = {}) {
  if (typeof compatibilityRoot !== 'string' || !path.isAbsolute(compatibilityRoot)
      || typeof fixtureRoot !== 'string' || fixtureRoot.length === 0
      || typeof verifyNativeToolSurface !== 'function'
      || !fileSystem || typeof fileSystem.mkdir !== 'function'
      || typeof fileSystem.mkdtemp !== 'function' || typeof fileSystem.rm !== 'function') {
    throw new TypeError('Codex compatibility qualifier requires app-owned probe storage');
  }

  return async function qualify(binding, { signal } = {}) {
    let workspacePath = null;
    let probeResult;
    let failure = null;
    try {
      await fileSystem.mkdir(compatibilityRoot, { recursive: true });
      workspacePath = await fileSystem.mkdtemp(path.join(compatibilityRoot, 'codex-compatibility-'));
      probeResult = await verifyNativeToolSurface({
        provider: 'codex-cli',
        purpose: 'compatibility',
        cliBinding: binding,
        workspacePath,
        fixtureRoot,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      failure = error;
    } finally {
      if (workspacePath) {
        try {
          await fileSystem.rm(workspacePath, { recursive: true, force: true });
        } catch (error) {
          failure = error;
        }
      }
    }
    if (failure) throw failure;
    if (completeIncompatibility(probeResult)) return false;
    if (probeResult?.available === true && probeResult.allowed === true
        && probeResult.cleanup === true && probeResult.credentialScrubbed === true) return true;
    throw new Error('Codex compatibility probe did not complete');
  };
}

module.exports = {
  createCodexCompatibility,
  createCodexCompatibilityQualifier,
};
