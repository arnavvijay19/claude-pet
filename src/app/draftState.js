'use strict';

(function exposeDraftState(root) {
  const MAX_DRAFT_BYTES = 8192;
  const MAX_SESSION_DRAFTS = 32;

  function byteLength(value) {
    return new TextEncoder().encode(value).byteLength;
  }

  function validKey(value) {
    return typeof value === 'string' && value.length > 0 && !value.includes('\0');
  }

  function createDraftState() {
    const composers = new Map();
    const settingsDrafts = new Map();
    const touch = (map, key, value, maximum) => {
      map.delete(key);
      map.set(key, value);
      while (map.size > maximum) map.delete(map.keys().next().value);
    };
    return Object.freeze({
      composer(sessionId) {
        return validKey(sessionId) ? composers.get(sessionId) || '' : '';
      },
      setComposer(sessionId, text) {
        if (!validKey(sessionId) || typeof text !== 'string'
            || text.includes('\0') || byteLength(text) > MAX_DRAFT_BYTES) {
          throw new TypeError('Invalid composer draft');
        }
        touch(composers, sessionId, text, MAX_SESSION_DRAFTS);
      },
      clearComposer(sessionId) {
        composers.delete(sessionId);
      },
      settings(key) {
        return validKey(key) ? { ...(settingsDrafts.get(key) || {}) } : {};
      },
      patchSettings(key, patch) {
        if (!validKey(key) || !patch || Object.getPrototypeOf(patch) !== Object.prototype) {
          throw new TypeError('Invalid settings draft');
        }
        touch(settingsDrafts, key, {
          ...(settingsDrafts.get(key) || {}),
          ...patch,
        }, 64);
      },
      clearSettings(key) {
        settingsDrafts.delete(key);
      },
    });
  }

  const api = Object.freeze({ MAX_DRAFT_BYTES, createDraftState });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.claudePetDraftState = api;
}(globalThis));
