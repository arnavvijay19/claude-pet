'use strict';

const defaultFileSystem = require('node:fs/promises');
const path = require('node:path');

const { AgentError } = require('./agentErrors.js');

const STORE_VERSION = 2;
const LEGACY_STORE_VERSION = 1;
const MAX_AGENTS = 32;
const MAX_SESSIONS = 4096;
const MAX_SESSIONS_PER_AGENT = 128;
const MAX_PARTICIPANTS_PER_SESSION = 8;
const MAX_AGENT_INSTRUCTION_BYTES = 2000;
const MAX_TURNS_PER_SESSION = 512;
const MAX_TURN_BYTES = 8192;
const MAX_CHANGED_FILES = 64;
const MAX_SESSION_BYTES = 4 * 1024 * 1024;
const AGENT_PUBLIC_KEYS = Object.freeze([
  'id', 'name', 'marker', 'createdAt', 'updatedAt', 'sessionCount',
]);
const SESSION_PUBLIC_KEYS = Object.freeze([
  'id', 'title', 'workspacePath', 'participants', 'activeAgentId',
  'createdAt', 'updatedAt', 'turnCount', 'lastProvider',
]);

function unavailable(cause) {
  return new AgentError('SESSION_PERSISTENCE_UNAVAILABLE', { cause });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object'
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, allowed, required = allowed) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key))
    && required.every((key) => Object.hasOwn(value, key));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function wellFormedString(value) {
  return typeof value === 'string' && !value.includes('\0')
    && (typeof value.isWellFormed !== 'function' || value.isWellFormed());
}

function textValue(value, maximum = 80) {
  if (!wellFormedString(value)) throw unavailable();
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximum) throw unavailable();
  return trimmed;
}

function instructionValue(value) {
  if (!wellFormedString(value)
      || Buffer.byteLength(value, 'utf8') > MAX_AGENT_INSTRUCTION_BYTES) throw unavailable();
  return value;
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

function validCiphertext(value) {
  if (!nonEmptyString(value)) return false;
  try {
    return Buffer.from(value, 'base64').toString('base64') === value;
  } catch {
    return false;
  }
}

function sessionCount(state, agentId) {
  return state.sessions.filter(
    (session) => session.participants.some((participant) => participant.agentId === agentId),
  ).length;
}

function publicAgent(state, agent) {
  return freeze({
    id: agent.id,
    name: agent.name,
    marker: agent.marker,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    sessionCount: sessionCount(state, agent.id),
  });
}

function publicSession(session) {
  return freeze({
    id: session.id,
    title: session.title,
    workspacePath: session.workspacePath,
    participants: structuredClone(session.participants),
    activeAgentId: session.activeAgentId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    turnCount: session.turnCount,
    lastProvider: session.lastProvider,
  });
}

function publicProfile(agent, instruction) {
  return freeze({
    id: agent.id,
    name: agent.name,
    marker: agent.marker,
    instruction,
  });
}

function validateTurn(turn, { persisted = false, agentIds = null } = {}) {
  const allowed = [
    'role', 'text', 'agentId', 'provider', 'model', 'changedFiles',
    ...(persisted ? ['createdAt'] : []),
  ];
  if (!exactKeys(turn, allowed)) return false;
  if ((turn.role !== 'user' && turn.role !== 'assistant')
      || !wellFormedString(turn.text)
      || Buffer.byteLength(turn.text, 'utf8') > MAX_TURN_BYTES
      || !nonEmptyString(turn.agentId)
      || (agentIds && !agentIds.has(turn.agentId))
      || !Array.isArray(turn.changedFiles)
      || turn.changedFiles.length > MAX_CHANGED_FILES
      || turn.changedFiles.some((file) => !validChangedFile(file))) return false;
  if (turn.role === 'user'
      && (turn.provider !== null || turn.model !== null || turn.changedFiles.length !== 0)) return false;
  if (turn.role === 'assistant'
      && (!nonEmptyString(turn.provider) || !nonEmptyString(turn.model))) return false;
  return !persisted || nonEmptyString(turn.createdAt);
}

function validateLegacyTurn(turn, { persisted = false } = {}) {
  const allowed = [
    'role', 'text', 'provider', 'model', 'changedFiles',
    ...(persisted ? ['createdAt'] : []),
  ];
  if (!exactKeys(turn, allowed)) return false;
  if ((turn.role !== 'user' && turn.role !== 'assistant')
      || !wellFormedString(turn.text)
      || Buffer.byteLength(turn.text, 'utf8') > MAX_TURN_BYTES
      || !Array.isArray(turn.changedFiles)
      || turn.changedFiles.length > MAX_CHANGED_FILES
      || turn.changedFiles.some((file) => !validChangedFile(file))) return false;
  if (turn.role === 'user'
      && (turn.provider !== null || turn.model !== null || turn.changedFiles.length !== 0)) return false;
  if (turn.role === 'assistant'
      && (!nonEmptyString(turn.provider) || !nonEmptyString(turn.model))) return false;
  return !persisted || nonEmptyString(turn.createdAt);
}

function validateParticipant(participant, agentIds) {
  return exactKeys(participant, ['agentId', 'connectionId'])
    && nonEmptyString(participant.agentId)
    && agentIds.has(participant.agentId)
    && (participant.connectionId === null || nonEmptyString(participant.connectionId));
}

function validateSession(session, sessionIds, agentIds) {
  if (!exactKeys(session, [
    'id', 'title', 'workspacePath', 'participants', 'activeAgentId',
    'createdAt', 'updatedAt', 'turnCount', 'lastProvider', 'encryptedTurns',
  ], [
    'id', 'title', 'workspacePath', 'participants', 'activeAgentId',
    'createdAt', 'updatedAt', 'turnCount', 'lastProvider',
  ])) return false;
  if (!nonEmptyString(session.id) || sessionIds.has(session.id)
      || !nonEmptyString(session.title) || !absoluteWindowsPath(session.workspacePath)
      || !Array.isArray(session.participants) || session.participants.length < 1
      || session.participants.length > MAX_PARTICIPANTS_PER_SESSION
      || !session.participants.every((participant) => validateParticipant(participant, agentIds))
      || new Set(session.participants.map((participant) => participant.agentId)).size
        !== session.participants.length
      || !session.participants.some((participant) => participant.agentId === session.activeAgentId)
      || !nonEmptyString(session.createdAt) || !nonEmptyString(session.updatedAt)
      || !Number.isSafeInteger(session.turnCount) || session.turnCount < 0
      || session.turnCount > MAX_TURNS_PER_SESSION
      || (session.lastProvider !== null && !nonEmptyString(session.lastProvider))
      || (Object.hasOwn(session, 'encryptedTurns') && !validCiphertext(session.encryptedTurns))) {
    return false;
  }
  sessionIds.add(session.id);
  return true;
}

function validateAgent(agent, agentIds) {
  if (!exactKeys(agent, [
    'id', 'name', 'marker', 'encryptedInstruction', 'createdAt', 'updatedAt',
  ])) return false;
  if (!nonEmptyString(agent.id) || agentIds.has(agent.id)
      || !nonEmptyString(agent.name) || !nonEmptyString(agent.marker)
      || !validCiphertext(agent.encryptedInstruction)
      || !nonEmptyString(agent.createdAt) || !nonEmptyString(agent.updatedAt)) return false;
  agentIds.add(agent.id);
  return true;
}

function validateState(value) {
  if (!exactKeys(value, ['version', 'selection', 'agents', 'sessions'])
      || value.version !== STORE_VERSION
      || !exactKeys(value.selection, ['sessionId'])
      || !Array.isArray(value.agents) || value.agents.length > MAX_AGENTS
      || !Array.isArray(value.sessions) || value.sessions.length > MAX_SESSIONS) return false;
  const agentIds = new Set();
  const sessionIds = new Set();
  if (!value.agents.every((agent) => validateAgent(agent, agentIds))
      || !value.sessions.every((session) => validateSession(session, sessionIds, agentIds))) return false;
  return value.selection.sessionId === null
    || (nonEmptyString(value.selection.sessionId) && sessionIds.has(value.selection.sessionId));
}

function validateLegacySession(session, sessionIds) {
  if (!exactKeys(session, [
    'id', 'title', 'workspacePath', 'nextConnectionId', 'createdAt', 'updatedAt',
    'turnCount', 'lastProvider', 'encryptedTurns',
  ], [
    'id', 'title', 'workspacePath', 'nextConnectionId', 'createdAt', 'updatedAt',
    'turnCount', 'lastProvider',
  ])) return false;
  if (!nonEmptyString(session.id) || sessionIds.has(session.id)
      || !nonEmptyString(session.title) || !absoluteWindowsPath(session.workspacePath)
      || (session.nextConnectionId !== null && !nonEmptyString(session.nextConnectionId))
      || !nonEmptyString(session.createdAt) || !nonEmptyString(session.updatedAt)
      || !Number.isSafeInteger(session.turnCount) || session.turnCount < 0
      || session.turnCount > MAX_TURNS_PER_SESSION
      || (session.lastProvider !== null && !nonEmptyString(session.lastProvider))
      || (Object.hasOwn(session, 'encryptedTurns') && !validCiphertext(session.encryptedTurns))) {
    return false;
  }
  sessionIds.add(session.id);
  return true;
}

function validateLegacyAgent(agent, agentIds, sessionIds) {
  if (!exactKeys(agent, ['id', 'name', 'createdAt', 'updatedAt', 'sessions'])
      || !nonEmptyString(agent.id) || agentIds.has(agent.id)
      || !nonEmptyString(agent.name)
      || !nonEmptyString(agent.createdAt) || !nonEmptyString(agent.updatedAt)
      || !Array.isArray(agent.sessions)
      || agent.sessions.length > MAX_SESSIONS_PER_AGENT) return false;
  agentIds.add(agent.id);
  return agent.sessions.every((session) => validateLegacySession(session, sessionIds));
}

function validateLegacyState(value) {
  if (!exactKeys(value, ['version', 'selection', 'agents'])
      || value.version !== LEGACY_STORE_VERSION
      || !exactKeys(value.selection, ['agentId', 'sessionId'])
      || !Array.isArray(value.agents) || value.agents.length > MAX_AGENTS) return false;
  const agentIds = new Set();
  const sessionIds = new Set();
  if (!value.agents.every((agent) => validateLegacyAgent(agent, agentIds, sessionIds))) return false;
  const { agentId, sessionId } = value.selection;
  if (agentId === null && sessionId === null) return true;
  if (!nonEmptyString(agentId) || !agentIds.has(agentId)
      || (sessionId !== null && !nonEmptyString(sessionId))) return false;
  if (sessionId === null) return true;
  return value.agents.some(
    (agent) => agent.id === agentId && agent.sessions.some((session) => session.id === sessionId),
  );
}

function createSessionStore({
  filePath, crypto, randomId, clock, fileSystem = defaultFileSystem,
}) {
  if (!nonEmptyString(filePath) || !crypto || typeof crypto.isAvailable !== 'function'
      || typeof crypto.encrypt !== 'function' || typeof crypto.decrypt !== 'function'
      || typeof randomId !== 'function' || typeof clock !== 'function'
      || !fileSystem || typeof fileSystem.readFile !== 'function'
      || typeof fileSystem.rename !== 'function' || typeof fileSystem.mkdir !== 'function'
      || typeof fileSystem.open !== 'function') {
    throw new TypeError('Session store requires filePath, crypto, randomId, clock, and a file system');
  }

  let state = null;
  let initialization = null;
  let tail = Promise.resolve();

  function now() {
    return timestamp(clock());
  }

  async function writeState(next) {
    const temporaryPath = `${filePath}.tmp`;
    try {
      await fileSystem.mkdir(path.dirname(filePath), { recursive: true });
      const handle = await fileSystem.open(temporaryPath, 'w');
      try {
        await handle.writeFile(JSON.stringify(next), 'utf8');
        try {
          await handle.sync();
        } catch (error) {
          if (!error || !['ENOSYS', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error;
        }
      } finally {
        await handle.close();
      }
      await fileSystem.rename(temporaryPath, filePath);
    } catch (error) {
      try {
        await fileSystem.unlink(temporaryPath);
      } catch {
        // Cleanup only.
      }
      throw unavailable(error);
    }
  }

  async function contentAvailable() {
    try {
      return Boolean(await crypto.isAvailable());
    } catch (error) {
      throw unavailable(error);
    }
  }

  async function decryptText(ciphertext) {
    if (!await contentAvailable()) throw unavailable();
    try {
      const decrypted = await crypto.decrypt(Buffer.from(ciphertext, 'base64'));
      if (!isPlainObject(decrypted) || typeof decrypted.value !== 'string'
          || typeof decrypted.shouldReEncrypt !== 'boolean') {
        throw new Error('Invalid decrypted session payload');
      }
      return decrypted;
    } catch (error) {
      throw error instanceof AgentError ? error : unavailable(error);
    }
  }

  async function encryptText(value) {
    if (!await contentAvailable()) throw unavailable();
    try {
      const encrypted = await crypto.encrypt(value);
      if (!Buffer.isBuffer(encrypted)) throw new Error('safeStorage did not return a buffer');
      return encrypted.toString('base64');
    } catch (error) {
      throw error instanceof AgentError ? error : unavailable(error);
    }
  }

  async function decodeTurns(session, {
    legacy = false,
    ownerAgentId = null,
    agentIds = null,
  } = {}) {
    if (!session.encryptedTurns) {
      if (session.turnCount !== 0) throw unavailable();
      return { turns: [], shouldReEncrypt: false };
    }
    const decrypted = await decryptText(session.encryptedTurns);
    try {
      const turns = JSON.parse(decrypted.value);
      const validator = legacy ? validateLegacyTurn : validateTurn;
      if (!Array.isArray(turns) || turns.length !== session.turnCount
          || turns.some((turn) => !validator(turn, {
            persisted: true,
            ...(agentIds ? { agentIds } : {}),
          }))
          || Buffer.byteLength(decrypted.value, 'utf8') > MAX_SESSION_BYTES) {
        throw new Error('Invalid decrypted session turns');
      }
      return {
        turns: legacy
          ? turns.map((turn) => ({ ...turn, agentId: ownerAgentId }))
          : turns,
        shouldReEncrypt: decrypted.shouldReEncrypt,
      };
    } catch (error) {
      throw error instanceof AgentError ? error : unavailable(error);
    }
  }

  async function encodeTurns(turns) {
    const plain = JSON.stringify(turns);
    if (Buffer.byteLength(plain, 'utf8') > MAX_SESSION_BYTES) throw unavailable();
    return encryptText(plain);
  }

  async function decodeInstruction(agent) {
    const decrypted = await decryptText(agent.encryptedInstruction);
    try {
      return {
        instruction: instructionValue(decrypted.value),
        shouldReEncrypt: decrypted.shouldReEncrypt,
      };
    } catch (error) {
      throw error instanceof AgentError ? error : unavailable(error);
    }
  }

  async function migrateLegacy(parsed) {
    if (!validateLegacyState(parsed)) throw unavailable(new Error('Invalid legacy session store schema'));
    if (!await contentAvailable()) throw unavailable();
    const next = {
      version: STORE_VERSION,
      selection: { sessionId: parsed.selection.sessionId },
      agents: [],
      sessions: [],
    };
    for (const legacyAgent of parsed.agents) {
      const encryptedInstruction = await encryptText('');
      next.agents.push({
        id: legacyAgent.id,
        name: legacyAgent.name,
        marker: 'amber',
        encryptedInstruction,
        createdAt: legacyAgent.createdAt,
        updatedAt: legacyAgent.updatedAt,
      });
      for (const legacySession of legacyAgent.sessions) {
        const { turns } = await decodeTurns(legacySession, {
          legacy: true,
          ownerAgentId: legacyAgent.id,
        });
        next.sessions.push({
          id: legacySession.id,
          title: legacySession.title,
          workspacePath: legacySession.workspacePath,
          participants: [{
            agentId: legacyAgent.id,
            connectionId: legacySession.nextConnectionId,
          }],
          activeAgentId: legacyAgent.id,
          createdAt: legacySession.createdAt,
          updatedAt: legacySession.updatedAt,
          turnCount: legacySession.turnCount,
          lastProvider: legacySession.lastProvider,
          encryptedTurns: await encodeTurns(turns),
        });
      }
    }
    if (!validateState(next)) throw unavailable(new Error('Invalid migrated session store schema'));
    await writeState(next);
    return next;
  }

  function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      try {
        const parsed = JSON.parse(await fileSystem.readFile(filePath, 'utf8'));
        if (parsed?.version === LEGACY_STORE_VERSION) {
          const migrated = await migrateLegacy(parsed);
          state = structuredClone(migrated);
          return;
        }
        if (!validateState(parsed)) throw new Error('Invalid session store schema');
        state = structuredClone(parsed);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          state = {
            version: STORE_VERSION,
            selection: { sessionId: null },
            agents: [],
            sessions: [],
          };
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
    return value.sessions.find((session) => session.id === id) || null;
  }

  function newId(next, predicate) {
    for (let attempt = 0; attempt < 1024; attempt += 1) {
      const id = randomId();
      if (nonEmptyString(id) && !predicate(next, id)) return id;
    }
    throw unavailable(new Error('Could not create a unique identifier'));
  }

  function commit(next) {
    return writeState(next).then(() => {
      state = next;
    });
  }

  function createAgent(input) {
    return enqueue(async () => {
      if (!exactKeys(input, ['name', 'marker', 'instruction'])) throw unavailable();
      const name = textValue(input.name);
      const marker = textValue(input.marker, 40);
      const instruction = instructionValue(input.instruction);
      const encryptedInstruction = await encryptText(instruction);
      const next = structuredClone(state);
      if (next.agents.length >= MAX_AGENTS) throw unavailable();
      const at = now();
      const agent = {
        id: newId(next, (value, id) => Boolean(findAgent(value, id))),
        name,
        marker,
        encryptedInstruction,
        createdAt: at,
        updatedAt: at,
      };
      next.agents.push(agent);
      await commit(next);
      return publicAgent(next, agent);
    });
  }

  function updateAgent(id, input) {
    return enqueue(async () => {
      if (!nonEmptyString(id)
          || !exactKeys(input, ['name', 'marker', 'instruction'])) throw unavailable();
      const name = textValue(input.name);
      const marker = textValue(input.marker, 40);
      const instruction = instructionValue(input.instruction);
      const encryptedInstruction = await encryptText(instruction);
      const next = structuredClone(state);
      const agent = findAgent(next, id);
      if (!agent) throw unavailable();
      agent.name = name;
      agent.marker = marker;
      agent.encryptedInstruction = encryptedInstruction;
      agent.updatedAt = now();
      await commit(next);
      return publicAgent(next, agent);
    });
  }

  function renameAgent(id, name) {
    return enqueue(async () => {
      const current = findAgent(state, id);
      if (!current) throw unavailable();
      const { instruction } = await decodeInstruction(current);
      const next = structuredClone(state);
      const agent = findAgent(next, id);
      agent.name = textValue(name);
      agent.encryptedInstruction = await encryptText(instruction);
      agent.updatedAt = now();
      await commit(next);
      return publicAgent(next, agent);
    });
  }

  function removeAgent(id) {
    return enqueue(async () => {
      const agent = findAgent(state, id);
      if (!agent) return false;
      if (state.sessions.some(
        (session) => session.participants.some((participant) => participant.agentId === id),
      )) throw unavailable();
      const agentIds = new Set(state.agents.map((item) => item.id));
      for (const session of state.sessions) {
        const { turns } = await decodeTurns(session, { agentIds });
        if (turns.some((turn) => turn.agentId === id)) throw unavailable();
      }
      const next = structuredClone(state);
      next.agents = next.agents.filter((item) => item.id !== id);
      await commit(next);
      return true;
    });
  }

  async function getAgentProfile(id) {
    await ready();
    const agent = findAgent(state, id);
    if (!agent) return null;
    const originalCiphertext = agent.encryptedInstruction;
    const decoded = await decodeInstruction(agent);
    if (decoded.shouldReEncrypt) {
      await enqueue(async () => {
        const current = findAgent(state, id);
        if (!current || current.encryptedInstruction !== originalCiphertext) return;
        const next = structuredClone(state);
        const replacement = findAgent(next, id);
        replacement.encryptedInstruction = await encryptText(decoded.instruction);
        replacement.updatedAt = now();
        await commit(next);
      });
    }
    const current = findAgent(state, id);
    return current ? publicProfile(current, decoded.instruction) : null;
  }

  function createSession(input) {
    return enqueue(async () => {
      const modern = exactKeys(input, ['title', 'workspacePath', 'participant']);
      const legacy = exactKeys(input, ['agentId', 'title', 'workspacePath']);
      if (!modern && !legacy) throw unavailable();
      const participant = modern
        ? input.participant
        : { agentId: input.agentId, connectionId: null };
      if (!exactKeys(participant, ['agentId', 'connectionId'])
          || !nonEmptyString(participant.agentId)
          || (participant.connectionId !== null && !nonEmptyString(participant.connectionId))
          || !absoluteWindowsPath(input.workspacePath)) throw unavailable();
      const next = structuredClone(state);
      if (!findAgent(next, participant.agentId) || next.sessions.length >= MAX_SESSIONS) throw unavailable();
      const at = now();
      const session = {
        id: newId(next, (value, id) => Boolean(findSession(value, id))),
        title: textValue(input.title),
        workspacePath: input.workspacePath,
        participants: [structuredClone(participant)],
        activeAgentId: participant.agentId,
        createdAt: at,
        updatedAt: at,
        turnCount: 0,
        lastProvider: null,
      };
      next.sessions.push(session);
      await commit(next);
      return publicSession(session);
    });
  }

  function renameSession(id, title) {
    return enqueue(async () => {
      const next = structuredClone(state);
      const session = findSession(next, id);
      if (!session) throw unavailable();
      session.title = textValue(title);
      session.updatedAt = now();
      await commit(next);
      return publicSession(session);
    });
  }

  function removeSession(id) {
    return enqueue(async () => {
      const next = structuredClone(state);
      const session = findSession(next, id);
      if (!session) return false;
      next.sessions = next.sessions.filter((item) => item.id !== id);
      if (next.selection.sessionId === id) {
        next.selection = { sessionId: next.sessions.at(-1)?.id || null };
      }
      await commit(next);
      return true;
    });
  }

  function addParticipant(input) {
    return enqueue(async () => {
      if (!exactKeys(input, ['sessionId', 'agentId', 'connectionId'])
          || !nonEmptyString(input.sessionId) || !nonEmptyString(input.agentId)
          || !nonEmptyString(input.connectionId)) throw unavailable();
      const next = structuredClone(state);
      const session = findSession(next, input.sessionId);
      if (!session || !findAgent(next, input.agentId)
          || session.participants.length >= MAX_PARTICIPANTS_PER_SESSION
          || session.participants.some((participant) => participant.agentId === input.agentId)) {
        throw unavailable();
      }
      session.participants.push({ agentId: input.agentId, connectionId: input.connectionId });
      session.updatedAt = now();
      await commit(next);
      return publicSession(session);
    });
  }

  function removeParticipant(input) {
    return enqueue(async () => {
      if (!exactKeys(input, ['sessionId', 'agentId'])
          || !nonEmptyString(input.sessionId) || !nonEmptyString(input.agentId)) throw unavailable();
      const next = structuredClone(state);
      const session = findSession(next, input.sessionId);
      if (!session) throw unavailable();
      const index = session.participants.findIndex(
        (participant) => participant.agentId === input.agentId,
      );
      if (index < 0) return false;
      if (session.participants.length === 1) throw unavailable();
      session.participants.splice(index, 1);
      if (session.activeAgentId === input.agentId) {
        session.activeAgentId = session.participants[0].agentId;
      }
      session.updatedAt = now();
      await commit(next);
      return true;
    });
  }

  function selectParticipant(input) {
    return enqueue(async () => {
      if (!exactKeys(input, ['sessionId', 'agentId'])
          || !nonEmptyString(input.sessionId) || !nonEmptyString(input.agentId)) throw unavailable();
      const next = structuredClone(state);
      const session = findSession(next, input.sessionId);
      if (!session || !session.participants.some(
        (participant) => participant.agentId === input.agentId,
      )) throw unavailable();
      session.activeAgentId = input.agentId;
      session.updatedAt = now();
      await commit(next);
      return publicSession(session);
    });
  }

  function select(input) {
    return enqueue(async () => {
      const modern = exactKeys(input, ['sessionId']);
      const legacy = exactKeys(input, ['agentId', 'sessionId']);
      if (!modern && !legacy) throw unavailable();
      const next = structuredClone(state);
      if (input.sessionId !== null && !nonEmptyString(input.sessionId)) throw unavailable();
      const session = input.sessionId === null ? null : findSession(next, input.sessionId);
      if (input.sessionId !== null && !session) throw unavailable();
      if (legacy && input.agentId !== null) {
        if (!nonEmptyString(input.agentId)
            || (session && !session.participants.some(
              (participant) => participant.agentId === input.agentId,
            ))) throw unavailable();
        if (session) session.activeAgentId = input.agentId;
      }
      next.selection = { sessionId: input.sessionId };
      await commit(next);
      return freeze({ ...next.selection });
    });
  }

  function setNextConnection(sessionId, connectionId) {
    return enqueue(async () => {
      if (connectionId !== null && !nonEmptyString(connectionId)) throw unavailable();
      const next = structuredClone(state);
      const session = findSession(next, sessionId);
      if (!session) throw unavailable();
      const participant = session.participants.find(
        (item) => item.agentId === session.activeAgentId,
      );
      if (!participant) throw unavailable();
      participant.connectionId = connectionId;
      session.updatedAt = now();
      await commit(next);
      return publicSession(session);
    });
  }

  function appendTurn(sessionId, input) {
    return enqueue(async () => {
      const next = structuredClone(state);
      const session = findSession(next, sessionId);
      const participantIds = session
        ? new Set(session.participants.map((participant) => participant.agentId))
        : null;
      if (!session || !validateTurn(input, { agentIds: participantIds })
          || input.agentId !== session.activeAgentId
          || session.turnCount >= MAX_TURNS_PER_SESSION) throw unavailable();
      const agentIds = new Set(next.agents.map((agent) => agent.id));
      const { turns } = await decodeTurns(session, { agentIds });
      const turn = { ...structuredClone(input), createdAt: now() };
      turns.push(turn);
      session.encryptedTurns = await encodeTurns(turns);
      session.turnCount = turns.length;
      session.lastProvider = turn.role === 'assistant' ? turn.provider : session.lastProvider;
      session.updatedAt = turn.createdAt;
      await commit(next);
      return freeze(structuredClone(turn));
    });
  }

  async function listAgents() {
    await ready();
    return freeze(state.agents.map((agent) => publicAgent(state, agent)));
  }

  async function listSessions(agentId) {
    await ready();
    const sessions = agentId === undefined
      ? state.sessions
      : state.sessions.filter(
        (session) => session.participants.some((participant) => participant.agentId === agentId),
      );
    return freeze(sessions.map(publicSession));
  }

  async function getSelection() {
    await ready();
    return freeze({ ...state.selection });
  }

  async function getSessionView(sessionId) {
    await ready();
    const session = findSession(state, sessionId);
    return session ? publicSession(session) : null;
  }

  async function getContextTurns(sessionId) {
    await ready();
    const session = findSession(state, sessionId);
    if (!session) return null;
    const originalCiphertext = session.encryptedTurns || null;
    const agentIds = new Set(state.agents.map((agent) => agent.id));
    const decoded = await decodeTurns(session, { agentIds });
    if (decoded.shouldReEncrypt && originalCiphertext) {
      await enqueue(async () => {
        const current = findSession(state, sessionId);
        if (!current || current.encryptedTurns !== originalCiphertext) return;
        const next = structuredClone(state);
        const replacement = findSession(next, sessionId);
        replacement.encryptedTurns = await encodeTurns(decoded.turns);
        replacement.updatedAt = now();
        await commit(next);
      });
    }
    return freeze(structuredClone(decoded.turns));
  }

  return Object.freeze({
    initialize,
    listAgents,
    createAgent,
    updateAgent,
    renameAgent,
    removeAgent,
    getAgentProfile,
    listSessions,
    createSession,
    renameSession,
    removeSession,
    addParticipant,
    removeParticipant,
    selectParticipant,
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
  MAX_AGENT_INSTRUCTION_BYTES,
  MAX_AGENTS,
  MAX_CHANGED_FILES,
  MAX_PARTICIPANTS_PER_SESSION,
  MAX_SESSIONS,
  MAX_SESSIONS_PER_AGENT,
  MAX_SESSION_BYTES,
  MAX_TURN_BYTES,
  MAX_TURNS_PER_SESSION,
  SESSION_PUBLIC_KEYS,
  STORE_VERSION,
  createSessionStore,
};
