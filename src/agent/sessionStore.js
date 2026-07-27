'use strict';

const defaultFileSystem = require('node:fs/promises');
const path = require('node:path');

const { AgentError } = require('./agentErrors.js');

const STORE_VERSION = 1;
const MAX_AGENTS = 32;
const MAX_SESSIONS_PER_AGENT = 128;
const MAX_TURNS_PER_SESSION = 512;
const MAX_TURN_BYTES = 8192;
const MAX_CHANGED_FILES = 64;
const MAX_SESSION_BYTES = 4 * 1024 * 1024;
const AGENT_PUBLIC_KEYS = Object.freeze(['id', 'name', 'createdAt', 'updatedAt', 'sessionCount']);
const SESSION_PUBLIC_KEYS = Object.freeze([
  'id', 'agentId', 'title', 'workspacePath', 'nextConnectionId',
  'createdAt', 'updatedAt', 'turnCount', 'lastProvider',
]);

function unavailable(cause) {
  return new AgentError('SESSION_PERSISTENCE_UNAVAILABLE', { cause });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, allowed, required = allowed) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(value, key));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function textValue(value, maximum = 80) {
  if (typeof value !== 'string') throw unavailable();
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximum || trimmed.includes('\0')) throw unavailable();
  return trimmed;
}

function timestamp(value) {
  if (!nonEmptyString(value) || value.includes('\0')) throw unavailable();
  return value;
}

function absoluteWindowsPath(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0')
    && (/^[A-Za-z]:\\/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value));
}

function validChangedFile(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0')
    && !path.win32.isAbsolute(value) && !path.posix.isAbsolute(value)
    && !value.split(/[\\/]+/).includes('..');
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function publicAgent(agent) {
  return freeze({
    id: agent.id,
    name: agent.name,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    sessionCount: agent.sessions.length,
  });
}

function publicSession(agent, session) {
  return freeze({
    id: session.id,
    agentId: agent.id,
    title: session.title,
    workspacePath: session.workspacePath,
    nextConnectionId: session.nextConnectionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    turnCount: session.turnCount,
    lastProvider: session.lastProvider,
  });
}

function validateTurn(turn, { persisted = false } = {}) {
  const allowed = ['role', 'text', 'provider', 'model', 'changedFiles', ...(persisted ? ['createdAt'] : [])];
  if (!exactKeys(turn, allowed)) return false;
  if ((turn.role !== 'user' && turn.role !== 'assistant')
      || typeof turn.text !== 'string' || turn.text.includes('\0')
      || Buffer.byteLength(turn.text, 'utf8') > MAX_TURN_BYTES
      || !Array.isArray(turn.changedFiles) || turn.changedFiles.length > MAX_CHANGED_FILES
      || turn.changedFiles.some((file) => !validChangedFile(file))) return false;
  if (turn.role === 'user' && (turn.provider !== null || turn.model !== null || turn.changedFiles.length !== 0)) return false;
  if (turn.role === 'assistant' && (!nonEmptyString(turn.provider) || !nonEmptyString(turn.model))) return false;
  return !persisted || nonEmptyString(turn.createdAt);
}

function validateSession(session, ids) {
  if (!exactKeys(session, [
    'id', 'title', 'workspacePath', 'nextConnectionId', 'createdAt', 'updatedAt',
    'turnCount', 'lastProvider', 'encryptedTurns',
  ], ['id', 'title', 'workspacePath', 'nextConnectionId', 'createdAt', 'updatedAt', 'turnCount', 'lastProvider'])) return false;
  if (!nonEmptyString(session.id) || ids.has(session.id) || !nonEmptyString(session.title)
      || !absoluteWindowsPath(session.workspacePath) || (session.nextConnectionId !== null && !nonEmptyString(session.nextConnectionId))
      || !nonEmptyString(session.createdAt) || !nonEmptyString(session.updatedAt)
      || !Number.isSafeInteger(session.turnCount) || session.turnCount < 0 || session.turnCount > MAX_TURNS_PER_SESSION
      || (session.lastProvider !== null && !nonEmptyString(session.lastProvider))
      || (Object.hasOwn(session, 'encryptedTurns') && !nonEmptyString(session.encryptedTurns))) return false;
  ids.add(session.id);
  return true;
}

function validateAgent(agent, agentIds, sessionIds) {
  if (!exactKeys(agent, ['id', 'name', 'createdAt', 'updatedAt', 'sessions'])) return false;
  if (!nonEmptyString(agent.id) || agentIds.has(agent.id) || !nonEmptyString(agent.name)
      || !nonEmptyString(agent.createdAt) || !nonEmptyString(agent.updatedAt)
      || !Array.isArray(agent.sessions) || agent.sessions.length > MAX_SESSIONS_PER_AGENT) return false;
  agentIds.add(agent.id);
  return agent.sessions.every((session) => validateSession(session, sessionIds));
}

function validateState(value) {
  if (!exactKeys(value, ['version', 'selection', 'agents'])) return false;
  if (value.version !== STORE_VERSION || !exactKeys(value.selection, ['agentId', 'sessionId']) || !Array.isArray(value.agents)
      || value.agents.length > MAX_AGENTS) return false;
  const agentIds = new Set();
  const sessionIds = new Set();
  if (!value.agents.every((agent) => validateAgent(agent, agentIds, sessionIds))) return false;
  const { agentId, sessionId } = value.selection;
  if (agentId === null && sessionId === null) return true;
  if (!nonEmptyString(agentId) || !agentIds.has(agentId) || (sessionId !== null && !nonEmptyString(sessionId))) return false;
  if (sessionId === null) return true;
  return value.agents.some((agent) => agent.id === agentId && agent.sessions.some((session) => session.id === sessionId));
}

function createSessionStore({ filePath, crypto, randomId, clock, fileSystem = defaultFileSystem }) {
  if (!nonEmptyString(filePath) || !crypto || typeof crypto.isAvailable !== 'function'
      || typeof crypto.encrypt !== 'function' || typeof crypto.decrypt !== 'function'
      || typeof randomId !== 'function' || typeof clock !== 'function'
      || !fileSystem || typeof fileSystem.readFile !== 'function' || typeof fileSystem.writeFile !== 'function'
      || typeof fileSystem.rename !== 'function' || typeof fileSystem.mkdir !== 'function' || typeof fileSystem.open !== 'function') {
    throw new TypeError('Session store requires filePath, crypto, randomId, clock, and a file system');
  }

  let state = null;
  let initialization = null;
  let tail = Promise.resolve();

  function now() { return timestamp(clock()); }

  async function writeState(next) {
    const temporaryPath = `${filePath}.tmp`;
    try {
      await fileSystem.mkdir(path.dirname(filePath), { recursive: true });
      const handle = await fileSystem.open(temporaryPath, 'w');
      try {
        await handle.writeFile(JSON.stringify(next), 'utf8');
        try { await handle.sync(); } catch (error) {
          if (!error || !['ENOSYS', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error;
        }
      } finally {
        await handle.close();
      }
      await fileSystem.rename(temporaryPath, filePath);
    } catch (error) {
      try { await fileSystem.unlink(temporaryPath); } catch { /* cleanup only */ }
      throw unavailable(error);
    }
  }

  function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      try {
        const parsed = JSON.parse(await fileSystem.readFile(filePath, 'utf8'));
        if (!validateState(parsed)) throw new Error('Invalid session store schema');
        state = structuredClone(parsed);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          state = { version: STORE_VERSION, selection: { agentId: null, sessionId: null }, agents: [] };
          return;
        }
        throw error instanceof AgentError ? error : unavailable(error);
      }
    })();
    return initialization;
  }

  async function ready() {
    await initialize();
    await tail;
  }

  function enqueue(operation) {
    const pending = tail.then(async () => {
      await initialize();
      return operation();
    });
    tail = pending.catch(() => {});
    return pending;
  }

  function findAgent(value, id) {
    return value.agents.find((agent) => agent.id === id) || null;
  }

  function findSession(value, id) {
    for (const agent of value.agents) {
      const session = agent.sessions.find((item) => item.id === id);
      if (session) return { agent, session };
    }
    return null;
  }

  function newId(next, predicate) {
    for (let attempt = 0; attempt < 1024; attempt += 1) {
      const id = randomId();
      if (nonEmptyString(id) && !predicate(next, id)) return id;
    }
    throw unavailable(new Error('Could not create a unique identifier'));
  }

  async function contentAvailable() {
    try {
      return Boolean(await crypto.isAvailable());
    } catch (error) {
      throw unavailable(error);
    }
  }

  async function decodeTurns(session) {
    if (!await contentAvailable()) throw unavailable();
    if (!session.encryptedTurns) return { turns: [], shouldReEncrypt: false };
    let decrypted;
    try {
      decrypted = await crypto.decrypt(Buffer.from(session.encryptedTurns, 'base64'));
      if (!isPlainObject(decrypted) || typeof decrypted.value !== 'string' || typeof decrypted.shouldReEncrypt !== 'boolean') {
        throw new Error('Invalid decrypted session payload');
      }
      const turns = JSON.parse(decrypted.value);
      if (!Array.isArray(turns) || turns.length !== session.turnCount || turns.some((turn) => !validateTurn(turn, { persisted: true }))) {
        throw new Error('Invalid decrypted session turns');
      }
      if (Buffer.byteLength(decrypted.value, 'utf8') > MAX_SESSION_BYTES) throw new Error('Session too large');
      return { turns, shouldReEncrypt: decrypted.shouldReEncrypt };
    } catch (error) {
      throw error instanceof AgentError ? error : unavailable(error);
    }
  }

  async function encodeTurns(turns) {
    const plain = JSON.stringify(turns);
    if (Buffer.byteLength(plain, 'utf8') > MAX_SESSION_BYTES) throw unavailable();
    try {
      const encrypted = await crypto.encrypt(plain);
      if (!Buffer.isBuffer(encrypted)) throw new Error('safeStorage did not return a buffer');
      return encrypted.toString('base64');
    } catch (error) {
      throw error instanceof AgentError ? error : unavailable(error);
    }
  }

  function commit(next) {
    return writeState(next).then(() => { state = next; });
  }

  function createAgent(input) {
    return enqueue(async () => {
      if (!exactKeys(input, ['name'])) throw unavailable();
      const next = structuredClone(state);
      if (next.agents.length >= MAX_AGENTS) throw unavailable();
      const at = now();
      const agent = { id: newId(next, (value, id) => Boolean(findAgent(value, id))), name: textValue(input.name), createdAt: at, updatedAt: at, sessions: [] };
      next.agents.push(agent);
      await commit(next);
      return publicAgent(agent);
    });
  }

  function renameAgent(id, name) {
    return enqueue(async () => {
      const next = structuredClone(state);
      const agent = findAgent(next, id);
      if (!agent) throw unavailable();
      agent.name = textValue(name);
      agent.updatedAt = now();
      await commit(next);
      return publicAgent(agent);
    });
  }

  function removeAgent(id) {
    return enqueue(async () => {
      const next = structuredClone(state);
      const agent = findAgent(next, id);
      if (!agent) return false;
      if (agent.sessions.length) throw unavailable();
      next.agents = next.agents.filter((item) => item.id !== id);
      if (next.selection.agentId === id) next.selection = { agentId: null, sessionId: null };
      await commit(next);
      return true;
    });
  }

  function createSession(input) {
    return enqueue(async () => {
      if (!exactKeys(input, ['agentId', 'title', 'workspacePath'])) throw unavailable();
      const next = structuredClone(state);
      const agent = findAgent(next, input.agentId);
      if (!agent || agent.sessions.length >= MAX_SESSIONS_PER_AGENT || !absoluteWindowsPath(input.workspacePath)) throw unavailable();
      const at = now();
      const session = {
        id: newId(next, (value, id) => Boolean(findSession(value, id))),
        title: textValue(input.title), workspacePath: input.workspacePath,
        nextConnectionId: null, createdAt: at, updatedAt: at, turnCount: 0, lastProvider: null,
      };
      agent.sessions.push(session);
      agent.updatedAt = at;
      await commit(next);
      return publicSession(agent, session);
    });
  }

  function renameSession(id, title) {
    return enqueue(async () => {
      const next = structuredClone(state);
      const found = findSession(next, id);
      if (!found) throw unavailable();
      found.session.title = textValue(title);
      found.session.updatedAt = now();
      found.agent.updatedAt = found.session.updatedAt;
      await commit(next);
      return publicSession(found.agent, found.session);
    });
  }

  function removeSession(id) {
    return enqueue(async () => {
      const next = structuredClone(state);
      const found = findSession(next, id);
      if (!found) return false;
      found.agent.sessions = found.agent.sessions.filter((session) => session.id !== id);
      found.agent.updatedAt = now();
      if (next.selection.sessionId === id) {
        const newest = found.agent.sessions.at(-1) || null;
        next.selection = { agentId: found.agent.id, sessionId: newest?.id || null };
      }
      await commit(next);
      return true;
    });
  }

  function select(input) {
    return enqueue(async () => {
      if (!exactKeys(input, ['agentId', 'sessionId']) || !nonEmptyString(input.agentId)
          || (input.sessionId !== null && !nonEmptyString(input.sessionId))) throw unavailable();
      const next = structuredClone(state);
      const agent = findAgent(next, input.agentId);
      if (!agent || (input.sessionId !== null && !agent.sessions.some((session) => session.id === input.sessionId))) throw unavailable();
      next.selection = { agentId: agent.id, sessionId: input.sessionId };
      await commit(next);
      return freeze({ ...next.selection });
    });
  }

  function setNextConnection(sessionId, connectionId) {
    return enqueue(async () => {
      if (connectionId !== null && !nonEmptyString(connectionId)) throw unavailable();
      const next = structuredClone(state);
      const found = findSession(next, sessionId);
      if (!found) throw unavailable();
      found.session.nextConnectionId = connectionId;
      found.session.updatedAt = now();
      found.agent.updatedAt = found.session.updatedAt;
      await commit(next);
      return publicSession(found.agent, found.session);
    });
  }

  function appendTurn(sessionId, input) {
    return enqueue(async () => {
      if (!validateTurn(input)) throw unavailable();
      const next = structuredClone(state);
      const found = findSession(next, sessionId);
      if (!found || found.session.turnCount >= MAX_TURNS_PER_SESSION || !await contentAvailable()) throw unavailable();
      const { turns } = await decodeTurns(found.session);
      const turn = { ...structuredClone(input), createdAt: now() };
      turns.push(turn);
      found.session.encryptedTurns = await encodeTurns(turns);
      found.session.turnCount = turns.length;
      found.session.lastProvider = turn.role === 'assistant' ? turn.provider : found.session.lastProvider;
      found.session.updatedAt = turn.createdAt;
      found.agent.updatedAt = turn.createdAt;
      await commit(next);
      return freeze(structuredClone(turn));
    });
  }

  async function listAgents() {
    await ready();
    return freeze(state.agents.map(publicAgent));
  }

  async function listSessions(agentId) {
    await ready();
    const agent = findAgent(state, agentId);
    if (!agent) return freeze([]);
    return freeze(agent.sessions.map((session) => publicSession(agent, session)));
  }

  async function getSelection() {
    await ready();
    return freeze({ ...state.selection });
  }

  async function getSessionView(sessionId) {
    await ready();
    const found = findSession(state, sessionId);
    return found ? publicSession(found.agent, found.session) : null;
  }

  async function getContextTurns(sessionId) {
    await ready();
    const found = findSession(state, sessionId);
    if (!found) return null;
    const originalCiphertext = found.session.encryptedTurns || null;
    const decoded = await decodeTurns(found.session);
    if (decoded.shouldReEncrypt && originalCiphertext) {
      await enqueue(async () => {
        const current = findSession(state, sessionId);
        if (!current || current.session.encryptedTurns !== originalCiphertext) return;
        const next = structuredClone(state);
        const replacement = findSession(next, sessionId);
        replacement.session.encryptedTurns = await encodeTurns(decoded.turns);
        replacement.session.updatedAt = now();
        replacement.agent.updatedAt = replacement.session.updatedAt;
        await commit(next);
      });
    }
    return freeze(structuredClone(decoded.turns));
  }

  return Object.freeze({
    initialize,
    listAgents,
    createAgent,
    renameAgent,
    removeAgent,
    listSessions,
    createSession,
    renameSession,
    removeSession,
    select,
    getSelection,
    setNextConnection,
    appendTurn,
    getSessionView,
    getContextTurns,
  });
}

module.exports = {
  AGENT_PUBLIC_KEYS,
  MAX_AGENTS,
  MAX_CHANGED_FILES,
  MAX_SESSIONS_PER_AGENT,
  MAX_SESSION_BYTES,
  MAX_TURN_BYTES,
  MAX_TURNS_PER_SESSION,
  SESSION_PUBLIC_KEYS,
  STORE_VERSION,
  createSessionStore,
};
