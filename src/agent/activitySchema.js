'use strict';

const { AgentError } = require('./agentErrors.js');

const VARIANT_FIELDS = Object.freeze({
  status: Object.freeze([]),
  tool: Object.freeze(['toolName']),
  file: Object.freeze(['path', 'operation']),
  command: Object.freeze(['command', 'exitCode']),
  network: Object.freeze(['destination']),
  permission: Object.freeze(['permission', 'decision']),
  usage: Object.freeze(['usage']),
  message: Object.freeze([]),
});
const COMMON_FIELDS = Object.freeze(['phase', 'kind', 'summary', 'detail', 'status']);
const FILE_OPERATIONS = new Set(['read', 'create', 'modify', 'delete']);
const PERMISSION_DECISIONS = new Set(['allowed', 'blocked']);
const USAGE_FIELDS = Object.freeze(['inputTokens', 'outputTokens', 'cachedTokens', 'totalTokens']);

function invalid() {
  throw new AgentError('ACTIVITY_INVALID');
}

function boundedString(value, maximum, optional = false) {
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) invalid();
}

function normalizeDestination(value) {
  boundedString(value, 8192);
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid();
  }
  if (!url.protocol || !url.hostname || !/^[a-z][a-z0-9+.-]*:$/i.test(url.protocol)) invalid();
  return `${url.protocol}//${url.host}`;
}

function validatePath(value) {
  boundedString(value, 8192);
  if (value.includes('[REDACTED_PATH]')) invalid();
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(value)) invalid();
  const pieces = value.replace(/\\/g, '/').split('/');
  if (pieces.some((piece) => piece === '..' || piece === '')) invalid();
}

function validateUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const keys = Object.keys(value);
  if (keys.some((key) => !USAGE_FIELDS.includes(key))) invalid();
  for (const field of USAGE_FIELDS) {
    if (!Object.hasOwn(value, field) || !Number.isFinite(value[field]) || value[field] < 0) invalid();
  }
  return Object.fromEntries(USAGE_FIELDS.map((field) => [field, value[field]]));
}

function validateActivityEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const variant = VARIANT_FIELDS[value.kind];
  if (!variant) invalid();
  const allowed = new Set([...COMMON_FIELDS, ...variant]);
  if (Object.keys(value).some((key) => !allowed.has(key))) invalid();
  boundedString(value.phase, 240);
  boundedString(value.summary, 240);
  boundedString(value.detail, 8192, true);
  boundedString(value.status, 240, true);
  for (const field of variant) {
    if (!Object.hasOwn(value, field)) invalid();
  }

  const event = { phase: value.phase, kind: value.kind, summary: value.summary };
  if (value.detail !== undefined) event.detail = value.detail;
  if (value.status !== undefined) event.status = value.status;

  if (value.kind === 'tool') {
    boundedString(value.toolName, 240);
    event.toolName = value.toolName;
  } else if (value.kind === 'file') {
    validatePath(value.path);
    if (!FILE_OPERATIONS.has(value.operation)) invalid();
    event.path = value.path.replace(/\\/g, '/');
    event.operation = value.operation;
  } else if (value.kind === 'command') {
    boundedString(value.command, 8192);
    if (!Number.isInteger(value.exitCode)) invalid();
    event.command = value.command;
    event.exitCode = value.exitCode;
  } else if (value.kind === 'network') {
    event.destination = normalizeDestination(value.destination);
  } else if (value.kind === 'permission') {
    boundedString(value.permission, 240);
    if (!PERMISSION_DECISIONS.has(value.decision)) invalid();
    event.permission = value.permission;
    event.decision = value.decision;
  } else if (value.kind === 'usage') {
    event.usage = validateUsage(value.usage);
  }
  return event;
}

module.exports = { VARIANT_FIELDS, validateActivityEvent };
