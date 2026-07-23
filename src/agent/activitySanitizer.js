'use strict';

const { AgentError } = require('./agentErrors.js');

const MAX_DEPTH = 6;
const MAX_NODES = 200;
const MAX_STRING_LENGTH = 8192;
const MAX_SERIALIZED_BYTES = 32768;
const REDACTED = '[REDACTED]';
const REDACTED_PATH = '[REDACTED_PATH]';

function invalid() {
  throw new AgentError('ACTIVITY_INVALID');
}

function isCredentialKey(key) {
  const normalized = String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
  return /(^|[_-])(api[_-]?key|access[_-]?key|secret|password|passphrase|credential|authorization|auth|cookie|private[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|token)([_-]|$)/.test(normalized);
}

function redactUrl(match) {
  try {
    const url = new URL(match);
    if (!url.hostname) return REDACTED;
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return REDACTED;
  }
}

function sanitizeString(value) {
  if (value.length > MAX_STRING_LENGTH) invalid();
  let result = value;
  result = result.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, redactUrl);
  result = result.replace(/((?:^|[\s"'`])(?:-u|--user)(?:\s+|=))(?:"[^"]*"|'[^']*'|[^\s"';&|]+)/gi, `$1${REDACTED}`);
  result = result.replace(/(^|\r?\n)(\s*(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*)[^\r\n]*/gi, `$1$2${REDACTED}`);
  result = result.replace(/((?:authorization|proxy-authorization)\s*:\s*)(?:(?:bearer|basic)\s+)?[^"'\r\n;&|]+/gi, `$1${REDACTED}`);
  result = result.replace(/((?:cookie|set-cookie)\s*:\s*)[^"'\r\n]+/gi, `$1${REDACTED}`);
  result = result.replace(/\b([A-Za-z_][A-Za-z0-9_]*(?:API_KEY|ACCESS_KEY|SECRET|PASSWORD|PASSPHRASE|TOKEN|COOKIE|AUTHORIZATION|CREDENTIAL)[A-Za-z0-9_]*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s;&|]+)/gi, `$1=${REDACTED}`);
  result = result.replace(/((?:--?|\/)(?:api[-_]?key|access[-_]?key|secret|password|passphrase|token|authorization|cookie|credential)(?:\s+|=))(?:"[^"]*"|'[^']*'|[^\s;&|]+)/gi, `$1${REDACTED}`);
  result = result.replace(/\b(?:api[_-]?key|access[_-]?key|secret|password|passphrase|token|authorization|cookie|credential)\s*[=:]\s*[^\s,;&]+/gi, (match) => `${match.split(/[=:]/, 1)[0]}=${REDACTED}`);
  result = result.replace(/(?:[A-Za-z]:\\Users\\[^\\\s]+\\\.(?:aws|azure|config|codex|claude)\\[^\s"',]*(?:credentials?|tokens?|auth\.json|hosts\.yml|application_default_credentials\.json)|~?\/(?:\.aws|\.azure|\.config|\.codex|\.claude)\/[^\s"',]*(?:credentials?|tokens?|auth\.json|hosts\.yml|application_default_credentials\.json))/gi, REDACTED_PATH);
  return result;
}

function sanitizeActivityValue(value) {
  const state = { nodes: 0 };
  const ancestors = new Set();

  function walk(current, depth, credentialValue = false) {
    state.nodes += 1;
    if (state.nodes > MAX_NODES || depth > MAX_DEPTH) invalid();
    if (current === null || typeof current === 'boolean') return credentialValue ? REDACTED : current;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) invalid();
      return credentialValue ? REDACTED : current;
    }
    if (typeof current === 'string') {
      const sanitized = sanitizeString(current);
      return credentialValue ? REDACTED : sanitized;
    }
    if (typeof current !== 'object') invalid();
    if (ancestors.has(current)) invalid();
    if (!Array.isArray(current)
        && Object.getPrototypeOf(current) !== Object.prototype
        && Object.getPrototypeOf(current) !== null) invalid();
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        const clone = current.map((item) => walk(item, depth + 1));
        return credentialValue ? REDACTED : clone;
      }
      const clone = {};
      for (const [key, item] of Object.entries(current)) {
        Object.defineProperty(clone, key, {
          value: walk(item, depth + 1, isCredentialKey(key)),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return credentialValue ? REDACTED : clone;
    } finally {
      ancestors.delete(current);
    }
  }

  const sanitized = walk(value, 0);
  let serialized;
  try {
    serialized = JSON.stringify(sanitized);
  } catch {
    invalid();
  }
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_SERIALIZED_BYTES) invalid();
  return sanitized;
}

module.exports = {
  MAX_DEPTH,
  MAX_NODES,
  MAX_STRING_LENGTH,
  MAX_SERIALIZED_BYTES,
  sanitizeActivityValue,
};
