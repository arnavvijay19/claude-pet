'use strict';

const { deepFreeze } = require('../agent/activityStore.js');
const { boundedNoticeRequest } = require('../agent/goalLimits.js');

const VIEWS = Object.freeze(['conversation', 'activity', 'settings']);
const AGENT_KEYS = Object.freeze([
  'id', 'name', 'marker', 'createdAt', 'updatedAt', 'sessionCount',
]);
const SESSION_KEYS = Object.freeze([
  'id', 'title', 'workspacePath', 'participants', 'activeAgentId',
  'createdAt', 'updatedAt', 'turnCount', 'lastProvider',
]);
const CONNECTION_KEYS = Object.freeze([
  'id', 'executorType', 'label', 'workspacePath', 'permissionProfile',
  'modelId', 'effort', 'keyHint', 'hasSecret',
]);
const TURN_KEYS = Object.freeze([
  'role', 'text', 'agentId', 'provider', 'model', 'changedFiles', 'createdAt',
]);
const RUN_KEYS = Object.freeze(['busy', 'connectionId', 'permissionProfile']);
const NOTICE_KEYS = Object.freeze(['status', 'message', 'action', 'agentId', 'request']);
const ATTACHMENT_KEYS = Object.freeze(['name', 'extension', 'size']);
const SECRET_KEY = /(?:encrypted|cipher|secret|token|password|authorization|dismissCapability|resumeId|authDirectory|configDirectory)/i;
const USAGE_COUNTER_KEYS = new Set(['inputTokens', 'outputTokens', 'cachedTokens', 'totalTokens']);

function invalid() {
  throw new TypeError('Invalid application snapshot source');
}

function checked(label, compose) {
  try {
    return compose();
  } catch (error) {
    throw new TypeError(
      `Invalid application snapshot source: ${label} (${error?.message || 'invalid value'})`,
      { cause: error },
    );
  }
}

function plain(value) {
  return value !== null && typeof value === 'object'
    && Object.getPrototypeOf(value) === Object.prototype;
}

function safeString(value, { empty = true, maximum = 65536 } = {}) {
  return typeof value === 'string'
    && (empty || value.length > 0)
    && value.length <= maximum
    && !value.includes('\0')
    && (typeof value.isWellFormed !== 'function' || value.isWellFormed());
}

function select(value, keys, required = keys, { exact = false } = {}) {
  if (!plain(value)
      || (exact && Object.keys(value).some((key) => !keys.includes(key)))
      || !required.every((key) => Object.hasOwn(value, key))) invalid();
  const result = {};
  for (const key of keys) {
    if (Object.hasOwn(value, key)) result[key] = value[key];
  }
  return result;
}

function agent(value) {
  const result = select(value, AGENT_KEYS, ['id', 'name', 'marker', 'createdAt', 'updatedAt']);
  if (!safeString(result.id, { empty: false, maximum: 200 })
      || !safeString(result.name, { empty: false, maximum: 80 })
      || !safeString(result.marker, { empty: false, maximum: 40 })
      || !safeString(result.createdAt, { empty: false, maximum: 100 })
      || !safeString(result.updatedAt, { empty: false, maximum: 100 })
      || (Object.hasOwn(result, 'sessionCount')
        && (!Number.isSafeInteger(result.sessionCount) || result.sessionCount < 0))) invalid();
  return result;
}

function participant(value) {
  const result = select(value, ['agentId', 'connectionId']);
  if (!safeString(result.agentId, { empty: false, maximum: 200 })
      || (result.connectionId !== null
        && !safeString(result.connectionId, { empty: false, maximum: 200 }))) invalid();
  return result;
}

function session(value) {
  const result = select(value, SESSION_KEYS);
  if (!safeString(result.id, { empty: false, maximum: 200 })
      || !safeString(result.title, { empty: false, maximum: 80 })
      || !safeString(result.workspacePath, { empty: false, maximum: 32767 })
      || !Array.isArray(result.participants) || result.participants.length > 8
      || !safeString(result.activeAgentId, { empty: false, maximum: 200 })
      || !safeString(result.createdAt, { empty: false, maximum: 100 })
      || !safeString(result.updatedAt, { empty: false, maximum: 100 })
      || !Number.isSafeInteger(result.turnCount) || result.turnCount < 0
      || (result.lastProvider !== null
        && !safeString(result.lastProvider, { empty: false, maximum: 200 }))) invalid();
  result.participants = result.participants.map(participant);
  if (!result.participants.some((item) => item.agentId === result.activeAgentId)) invalid();
  return result;
}

function turn(value) {
  const result = select(value, TURN_KEYS);
  if (!['user', 'assistant'].includes(result.role)
      || !safeString(result.text, { maximum: 8192 })
      || !safeString(result.agentId, { empty: false, maximum: 200 })
      || (result.provider !== null
        && !safeString(result.provider, { empty: false, maximum: 200 }))
      || (result.model !== null
        && !safeString(result.model, { empty: false, maximum: 200 }))
      || !Array.isArray(result.changedFiles)
      || result.changedFiles.some((item) => !safeString(item, { empty: false, maximum: 32767 }))
      || !safeString(result.createdAt, { empty: false, maximum: 100 })) invalid();
  result.changedFiles = [...result.changedFiles];
  return result;
}

function connection(value) {
  const result = select(value, CONNECTION_KEYS);
  if (!safeString(result.id, { empty: false, maximum: 200 })
      || !safeString(result.executorType, { empty: false, maximum: 200 })
      || !safeString(result.label, { maximum: 80 })
      || !safeString(result.workspacePath, { maximum: 32767 })
      || !['workspace', 'full-computer'].includes(result.permissionProfile)
      || !safeString(result.modelId, { maximum: 200 })
      || (result.effort !== null && !safeString(result.effort, { empty: false, maximum: 80 }))
      || (result.keyHint !== null && !safeString(result.keyHint, { maximum: 200 }))
      || typeof result.hasSecret !== 'boolean') invalid();
  return result;
}

function safeJson(value, depth = 0, trail = 'activity') {
  if (depth > 12) throw new TypeError(`Invalid activity value at ${trail}: depth`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Invalid activity value at ${trail}: number`);
    return value;
  }
  if (typeof value === 'string') {
    if (!safeString(value)) throw new TypeError(`Invalid activity value at ${trail}: string`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 1000) throw new TypeError(`Invalid activity value at ${trail}: array`);
    return value.map((item, index) => safeJson(item, depth + 1, `${trail}[${index}]`));
  }
  if (!plain(value)) throw new TypeError(`Invalid activity value at ${trail}: type`);
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key) && !USAGE_COUNTER_KEYS.has(key)) {
      throw new TypeError(`Invalid activity value at ${trail}.${key}: key`);
    }
    result[key] = safeJson(child, depth + 1, `${trail}.${key}`);
  }
  return result;
}

function run(value) {
  const result = select(value, RUN_KEYS, ['busy']);
  if (typeof result.busy !== 'boolean'
      || (result.connectionId !== undefined && result.connectionId !== null
        && !safeString(result.connectionId, { empty: false, maximum: 200 }))
      || (result.permissionProfile !== undefined && result.permissionProfile !== null
        && !['workspace', 'full-computer'].includes(result.permissionProfile))) invalid();
  return {
    busy: result.busy,
    connectionId: result.connectionId || null,
    permissionProfile: result.permissionProfile || null,
  };
}

function notice(value) {
  if (value === null) return null;
  const result = select(value, NOTICE_KEYS, ['status', 'message'], { exact: true });
  if (result.request !== undefined) {
    const bounded = boundedNoticeRequest(result.request);
    if (bounded === undefined) delete result.request;
    else result.request = bounded;
  }
  if (!['waiting', 'success', 'error', 'stopped'].includes(result.status)
      || !safeString(result.message, { empty: false, maximum: 2000 })
      || (result.action !== undefined && !safeString(result.action, { maximum: 200 }))
      || (result.agentId !== undefined && !safeString(result.agentId, { empty: false, maximum: 200 }))
      || (result.request !== undefined && !safeString(result.request, { maximum: 8192 }))) invalid();
  return result;
}

function pendingAttachment(value) {
  if (value === undefined || value === null) return null;
  const result = select(value, ATTACHMENT_KEYS, ATTACHMENT_KEYS, { exact: true });
  if (!safeString(result.name, { empty: false, maximum: 255 })
      || !safeString(result.extension, { empty: false, maximum: 16 })
      || !result.extension.startsWith('.')
      || !Number.isSafeInteger(result.size) || result.size < 0 || result.size > 49152) invalid();
  return result;
}

function statusFor(agentId, { activeAgentId, runState, noticeState }) {
  if (runState.busy && agentId === activeAgentId) return 'running';
  if (noticeState?.status === 'waiting' && noticeState.agentId === agentId) return 'waiting';
  if (noticeState?.status === 'error' && agentId === activeAgentId) return 'error';
  return 'idle';
}

function createAppSnapshot({
  coordinator,
  connections,
  manager,
  activity,
  view,
  notice: noticeValue,
  pendingAttachment: pendingAttachmentValue,
} = {}) {
  if (!plain(coordinator) || !Array.isArray(coordinator.agents)
      || !Array.isArray(coordinator.sessions) || !plain(coordinator.selection)
      || !Array.isArray(coordinator.turns) || !Array.isArray(connections)
      || !plain(manager) || !plain(activity) || !VIEWS.includes(view)
      || Object.keys(coordinator).some((key) => SECRET_KEY.test(key))) invalid();
  const runState = checked('run', () => run(manager));
  const noticeState = checked('notice', () => notice(noticeValue));
  const sourceAgents = checked('agents', () => coordinator.agents.map(agent));
  const activeAgentId = coordinator.activeAgent?.id || null;
  const statusContext = { activeAgentId, runState, noticeState };
  const agents = sourceAgents.map((item) => ({
    ...item,
    status: statusFor(item.id, statusContext),
  }));
  const sessions = checked('sessions', () => coordinator.sessions.map(session));
  const selection = select(coordinator.selection, ['sessionId', 'agentId'], ['sessionId']);
  if (selection.sessionId !== null
      && !safeString(selection.sessionId, { empty: false, maximum: 200 })) invalid();
  if (selection.agentId !== undefined && selection.agentId !== null
      && !safeString(selection.agentId, { empty: false, maximum: 200 })) invalid();
  const activeAgent = coordinator.activeAgent === null
    ? null
    : agents.find((item) => item.id === coordinator.activeAgent.id) || null;
  const activeSession = coordinator.session === null
    ? null
    : checked('active session', () => session(coordinator.session));
  const result = {
    view,
    agents,
    sessions,
    selection: {
      sessionId: selection.sessionId,
      agentId: activeAgent?.id || selection.agentId || null,
    },
    activeAgent,
    session: activeSession,
    turns: checked('turns', () => coordinator.turns.map(turn)),
    connections: checked('connections', () => connections.map(connection)),
    run: runState,
    activity: checked('activity', () => safeJson(activity)),
    notice: noticeState,
    pendingAttachment: checked(
      'pending attachment',
      () => pendingAttachment(pendingAttachmentValue),
    ),
  };
  return deepFreeze(result);
}

module.exports = { VIEWS, createAppSnapshot };
