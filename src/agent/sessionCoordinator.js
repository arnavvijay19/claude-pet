'use strict';

const { AgentError } = require('./agentErrors.js');
const { validateGoal } = require('./goalLimits.js');
const { buildNeutralSessionPrompt } = require('./sessionContext.js');

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function unavailable() {
  return new AgentError('SESSION_PERSISTENCE_UNAVAILABLE');
}

function expired() {
  return new AgentError('SESSION_SELECTION_EXPIRED');
}

function providerOf(connection) {
  return connection?.executorType || null;
}

function plainInput(value, keys) {
  return value !== null && typeof value === 'object'
    && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function normalizedParticipants(session, selection) {
  if (Array.isArray(session?.participants)) {
    return session.participants.map((participant) => ({ ...participant }));
  }
  const agentId = session?.agentId || selection?.agentId || null;
  return agentId
    ? [{ agentId, connectionId: session?.nextConnectionId || null }]
    : [];
}

function activeAgentIdOf(session, selection) {
  return session?.activeAgentId || session?.agentId || selection?.agentId || null;
}

function participantOf(session, selection, agentId = activeAgentIdOf(session, selection)) {
  return normalizedParticipants(session, selection).find(
    (participant) => participant.agentId === agentId,
  ) || null;
}

function compatibleSession(session, selection) {
  if (!session) return null;
  const participants = normalizedParticipants(session, selection);
  const activeAgentId = activeAgentIdOf(session, selection);
  const participant = participants.find((item) => item.agentId === activeAgentId) || null;
  return {
    ...session,
    participants,
    activeAgentId,
    // Temporary aliases consumed by the legacy Settings renderer until UX Task 6.
    agentId: activeAgentId,
    nextConnectionId: participant?.connectionId || null,
  };
}

function neutralPrompt(turns, agents, activeAgent, text, attachment = null) {
  return buildNeutralSessionPrompt({
    turns,
    agents: agents.map((agent) => ({ id: agent.id, name: agent.name })),
    activeAgent: {
      id: activeAgent.id,
      name: activeAgent.name,
      instruction: activeAgent.instruction,
    },
    currentText: text,
    currentAttachment: attachment,
  });
}

function normalizedAttachment(value) {
  if (value === undefined || value === null) return null;
  if (!plainInput(value, ['name', 'extension', 'size', 'text'])
      || typeof value.name !== 'string' || !value.name
      || typeof value.extension !== 'string' || !value.extension.startsWith('.')
      || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > 49152
      || typeof value.text !== 'string' || value.text.includes('\0')
      || Buffer.byteLength(value.text, 'utf8') !== value.size) throw unavailable();
  return freeze({ ...value });
}

function createSessionCoordinator({
  sessionStore,
  connectionStore,
  manager,
  confirmProviderSwitch = async () => true,
}) {
  const methods = [
    'listAgents', 'listSessions', 'getSelection', 'getSessionView',
    'getContextTurns', 'select', 'setNextConnection', 'appendTurn',
  ];
  if (!sessionStore || methods.some((method) => typeof sessionStore[method] !== 'function')
      || !connectionStore || typeof connectionStore.listConnections !== 'function'
      || typeof connectionStore.getConnection !== 'function'
      || typeof connectionStore.setActiveSelection !== 'function'
      || typeof connectionStore.getActiveSelection !== 'function'
      || !manager || typeof manager.getSnapshot !== 'function'
      || typeof manager.runGoal !== 'function' || typeof manager.stop !== 'function') {
    throw new TypeError('Session coordinator requires session, connection, and manager boundaries.');
  }

  const assertIdle = () => {
    if (manager.getSnapshot().busy) throw new AgentError('AGENT_BUSY');
  };

  async function readRunConnection(id) {
    const value = typeof connectionStore.getRunConnection === 'function'
      ? await connectionStore.getRunConnection(id)
      : await connectionStore.getConnection(id);
    return value || null;
  }

  async function readAllSessions(selection) {
    let sessions = await sessionStore.listSessions();
    if (sessions.length === 0 && selection?.agentId) {
      sessions = await sessionStore.listSessions(selection.agentId);
    }
    return sessions;
  }

  async function readAgentProfile(agent) {
    if (typeof sessionStore.getAgentProfile !== 'function') {
      return { id: agent.id, name: agent.name, marker: agent.marker || 'amber', instruction: '' };
    }
    const profile = await sessionStore.getAgentProfile(agent.id);
    if (!profile) throw unavailable();
    return profile;
  }

  async function selected() {
    const selection = await sessionStore.getSelection();
    if (!selection?.sessionId) throw unavailable();
    const session = await sessionStore.getSessionView(selection.sessionId);
    if (!session) throw unavailable();
    const activeAgentId = activeAgentIdOf(session, selection);
    const participant = participantOf(session, selection, activeAgentId);
    const agents = await sessionStore.listAgents();
    const agent = agents.find((item) => item.id === activeAgentId) || null;
    if (!activeAgentId || !participant || !agent) throw unavailable();
    const profile = await readAgentProfile(agent);
    return {
      selection: { sessionId: selection.sessionId },
      session,
      participants: normalizedParticipants(session, selection),
      participant,
      agents,
      agent,
      profile,
    };
  }

  async function assertConnectionSnapshot(connection) {
    const latest = await readRunConnection(connection.id);
    if (!latest || latest.id !== connection.id
        || latest.workspacePath !== connection.workspacePath
        || latest.executorType !== connection.executorType
        || (Number.isSafeInteger(connection.revision)
          && latest.revision !== connection.revision)) throw expired();
    return latest;
  }

  async function assertStable(captured, connection) {
    const current = await selected();
    if (current.selection.sessionId !== captured.selection.sessionId
        || current.session.id !== captured.session.id
        || current.session.workspacePath !== captured.session.workspacePath
        || current.agent.id !== captured.agent.id
        || current.agent.updatedAt !== captured.agent.updatedAt
        || current.participant.agentId !== captured.participant.agentId
        || current.participant.connectionId !== captured.participant.connectionId) throw expired();
    await assertConnectionSnapshot(connection);
    return current;
  }

  async function snapshot() {
    const selection = await sessionStore.getSelection();
    const agents = await sessionStore.listAgents();
    const sessions = await readAllSessions(selection);
    const rawSession = selection.sessionId
      ? sessions.find((item) => item.id === selection.sessionId)
        || await sessionStore.getSessionView(selection.sessionId)
      : null;
    const session = compatibleSession(rawSession, selection);
    const activeAgent = session
      ? agents.find((item) => item.id === session.activeAgentId) || null
      : null;
    let turns = [];
    let persistence = { available: true };
    if (session) {
      try {
        turns = await sessionStore.getContextTurns(session.id);
      } catch (error) {
        if (error?.code !== 'SESSION_PERSISTENCE_UNAVAILABLE') throw error;
        persistence = { available: false, code: error.code };
      }
    }
    const connections = await connectionStore.listConnections();
    const publicSelection = {
      sessionId: selection.sessionId || null,
      // Temporary alias consumed by the legacy Settings renderer until UX Task 6.
      agentId: activeAgent?.id || selection.agentId || null,
    };
    return freeze({
      agents: agents.map((item) => ({ ...item })),
      sessions: sessions.map((item) => compatibleSession(item, selection)),
      selection: publicSelection,
      activeAgent: activeAgent ? { ...activeAgent } : null,
      // Temporary alias consumed by the legacy response/settings surfaces.
      agent: activeAgent ? { ...activeAgent } : null,
      session,
      turns: turns.map((item) => ({ ...item, changedFiles: [...item.changedFiles] })),
      connections: connections.map((item) => ({ ...item })),
      persistence,
      busy: manager.getSnapshot().busy === true,
    });
  }

  async function confirmSwitch({
    sessionId,
    fromAgent,
    toAgent,
    fromConnection,
    toConnection,
  }) {
    const fromProvider = providerOf(fromConnection);
    const toProvider = providerOf(toConnection);
    if (!fromProvider || !toProvider || fromProvider === toProvider) return;
    const accepted = await confirmProviderSwitch(freeze({
      sessionId,
      fromAgent: { id: fromAgent.id, name: fromAgent.name },
      toAgent: { id: toAgent.id, name: toAgent.name },
      fromProvider,
      toProvider,
    }));
    if (accepted !== true) throw new AgentError('PROVIDER_SWITCH_CANCELLED');
  }

  async function selectParticipant(input) {
    assertIdle();
    if (!plainInput(input, ['sessionId', 'agentId'])
        || typeof input.sessionId !== 'string' || !input.sessionId
        || typeof input.agentId !== 'string' || !input.agentId) throw unavailable();
    if (typeof sessionStore.selectParticipant !== 'function') throw unavailable();
    const current = await selected();
    if (current.session.id !== input.sessionId) throw expired();
    if (current.agent.id === input.agentId) return compatibleSession(current.session, current.selection);
    const targetParticipant = current.participants.find(
      (participant) => participant.agentId === input.agentId,
    );
    const targetAgent = current.agents.find((agent) => agent.id === input.agentId);
    if (!targetParticipant || !targetAgent || !targetParticipant.connectionId) {
      throw new AgentError('AGENT_REQUIRED');
    }
    const fromConnection = current.participant.connectionId
      ? await readRunConnection(current.participant.connectionId)
      : null;
    const targetConnection = await readRunConnection(targetParticipant.connectionId);
    if (!targetConnection) throw unavailable();
    if (targetConnection.workspacePath !== current.session.workspacePath) {
      throw new AgentError('UNSUPPORTED_OPTION');
    }
    if (fromConnection) await assertStable(current, fromConnection);
    else if ((await selected()).agent.id !== current.agent.id) throw expired();
    await assertConnectionSnapshot(targetConnection);
    await confirmSwitch({
      sessionId: current.session.id,
      fromAgent: current.agent,
      toAgent: targetAgent,
      fromConnection,
      toConnection: targetConnection,
    });
    const priorActiveConnection = await connectionStore.getActiveSelection();
    let activeChanged = false;
    try {
      await connectionStore.setActiveSelection(targetConnection.id);
      activeChanged = true;
      if (fromConnection) await assertStable(current, fromConnection);
      await assertConnectionSnapshot(targetConnection);
      return await sessionStore.selectParticipant(input);
    } catch (error) {
      if (activeChanged) {
        try {
          await connectionStore.setActiveSelection(priorActiveConnection);
        } catch {
          // The durable session selection remains authoritative.
        }
      }
      throw error;
    }
  }

  async function setParticipantConnection(input) {
    assertIdle();
    if (!plainInput(input, ['sessionId', 'agentId', 'connectionId'])
        || typeof input.sessionId !== 'string' || !input.sessionId
        || typeof input.agentId !== 'string' || !input.agentId
        || typeof input.connectionId !== 'string' || !input.connectionId) throw unavailable();
    const current = await selected();
    if (current.session.id !== input.sessionId || current.agent.id !== input.agentId) throw expired();
    const next = await readRunConnection(input.connectionId);
    if (!next) throw unavailable();
    if (next.workspacePath !== current.session.workspacePath) {
      throw new AgentError('UNSUPPORTED_OPTION');
    }
    const previous = current.participant.connectionId
      ? await readRunConnection(current.participant.connectionId)
      : null;
    if (previous) await assertStable(current, previous);
    await assertConnectionSnapshot(next);
    await confirmSwitch({
      sessionId: current.session.id,
      fromAgent: current.agent,
      toAgent: current.agent,
      fromConnection: previous,
      toConnection: next,
    });
    const priorActiveConnection = await connectionStore.getActiveSelection();
    let activeChanged = false;
    try {
      await connectionStore.setActiveSelection(next.id);
      activeChanged = true;
      if (previous) await assertStable(current, previous);
      await assertConnectionSnapshot(next);
      return await sessionStore.setNextConnection(current.session.id, next.id);
    } catch (error) {
      if (activeChanged) {
        try {
          await connectionStore.setActiveSelection(priorActiveConnection);
        } catch {
          // The durable participant connection remains authoritative.
        }
      }
      throw error;
    }
  }

  async function select(input) {
    assertIdle();
    if (!input || Object.getPrototypeOf(input) !== Object.prototype
        || (input.sessionId !== null && typeof input.sessionId !== 'string')) throw unavailable();
    if (input.sessionId === null) {
      const result = await sessionStore.select({ sessionId: null });
      await connectionStore.setActiveSelection(null);
      return result;
    }
    const session = await sessionStore.getSessionView(input.sessionId);
    if (!session) throw expired();
    await sessionStore.select({ sessionId: input.sessionId });
    const requestedAgentId = typeof input.agentId === 'string'
      ? input.agentId
      : activeAgentIdOf(session, input);
    if (requestedAgentId !== activeAgentIdOf(session, input)
        && typeof sessionStore.selectParticipant === 'function') {
      await selectParticipant({ sessionId: input.sessionId, agentId: requestedAgentId });
    }
    const latest = await sessionStore.getSessionView(input.sessionId);
    const participant = participantOf(latest, { sessionId: input.sessionId });
    await connectionStore.setActiveSelection(participant?.connectionId || null);
    return freeze({ sessionId: input.sessionId, agentId: activeAgentIdOf(latest, input) });
  }

  async function setNextConnection({ sessionId, connectionId }) {
    const current = await selected();
    return setParticipantConnection({
      sessionId,
      agentId: current.agent.id,
      connectionId,
    });
  }

  async function runGoal(text, options = {}) {
    if (typeof text !== 'string' || !text.trim() || text.includes('\0')
        || !options || Object.getPrototypeOf(options) !== Object.prototype
        || Object.keys(options).some((key) => !['onStart', 'onReserved', 'attachment'].includes(key))
        || (Object.hasOwn(options, 'onStart') && typeof options.onStart !== 'function')
        || (Object.hasOwn(options, 'onReserved') && typeof options.onReserved !== 'function')) {
      throw unavailable();
    }
    const attachment = normalizedAttachment(options.attachment);
    const visibleText = validateGoal(
      attachment ? `${text}\n\n[Attached file: ${attachment.name}]` : text,
    );
    assertIdle();
    const current = await selected();
    if (!current.participant.connectionId) throw new AgentError('AGENT_REQUIRED');
    const runConnection = await readRunConnection(current.participant.connectionId);
    if (!runConnection || !Number.isSafeInteger(runConnection.revision)) throw unavailable();
    if (runConnection.workspacePath !== current.session.workspacePath) {
      throw new AgentError('UNSUPPORTED_OPTION');
    }
    const turns = await sessionStore.getContextTurns(current.session.id);
    const prompt = neutralPrompt(turns, current.agents, current.profile, text, attachment);
    await assertStable(current, runConnection);
    let started = false;
    const result = await manager.runGoal(prompt, {
      expectedConnectionId: runConnection.id,
      expectedRevision: runConnection.revision,
      onStart: async (context) => {
        options.onReserved?.();
        await assertStable(current, runConnection);
        await sessionStore.appendTurn(current.session.id, {
          role: 'user',
          text: visibleText,
          agentId: current.agent.id,
          provider: null,
          model: null,
          changedFiles: [],
        });
        started = true;
        options.onStart?.(freeze({
          ...context,
          agentId: current.agent.id,
          sessionId: current.session.id,
          agentName: current.agent.name,
          sessionTitle: current.session.title,
        }));
      },
    });
    if (!started) throw expired();
    await assertStable(current, runConnection);
    await sessionStore.appendTurn(current.session.id, {
      role: 'assistant',
      text: result.text,
      agentId: current.agent.id,
      provider: result.executor,
      model: result.model,
      changedFiles: result.changedFiles,
    });
    return freeze({
      ...result,
      agentId: current.agent.id,
      sessionId: current.session.id,
    });
  }

  async function ensureSessionForConnection(connectionId) {
    assertIdle();
    if (typeof connectionId !== 'string' || !connectionId) throw unavailable();
    const connection = await readRunConnection(connectionId);
    if (!connection) throw unavailable();
    let current = await snapshot();
    let agent = current.activeAgent || current.agents[0] || null;
    if (!agent) {
      agent = await sessionStore.createAgent({
        name: 'My Agent',
        marker: 'amber',
        instruction: '',
      });
    }
    let session = current.session
      || current.sessions.find((item) => item.workspacePath === connection.workspacePath)
      || null;
    if (!session) {
      session = await sessionStore.createSession({
        title: 'New Session',
        workspacePath: connection.workspacePath,
        participant: { agentId: agent.id, connectionId: connection.id },
      });
    }
    await sessionStore.select({ sessionId: session.id });
    const latest = await sessionStore.getSessionView(session.id);
    const activeParticipant = participantOf(latest, { sessionId: session.id });
    if (!activeParticipant) throw unavailable();
    if (!activeParticipant.connectionId) {
      await sessionStore.setNextConnection(session.id, connection.id);
    }
    await connectionStore.setActiveSelection(
      activeParticipant.connectionId || connection.id,
    );
    return snapshot();
  }

  const createAgent = async (input) => {
    assertIdle();
    const normalized = plainInput(input, ['name'])
      ? { name: input.name, marker: 'amber', instruction: '' }
      : input;
    return sessionStore.createAgent(normalized);
  };
  const renameAgent = async (id, name) => {
    assertIdle();
    return sessionStore.renameAgent(id, name);
  };
  const removeAgent = async (id) => {
    assertIdle();
    return sessionStore.removeAgent(id);
  };
  const createSession = async (input) => {
    assertIdle();
    if (!plainInput(input, ['agentId', 'title', 'connectionId'])
        || typeof input.agentId !== 'string' || !input.agentId
        || typeof input.connectionId !== 'string' || !input.connectionId) throw unavailable();
    const connection = await readRunConnection(input.connectionId);
    if (!connection) throw unavailable();
    return sessionStore.createSession({
      title: input.title,
      workspacePath: connection.workspacePath,
      participant: { agentId: input.agentId, connectionId: connection.id },
    });
  };
  const renameSession = async (id, title) => {
    assertIdle();
    const current = await selected();
    if (current.session.id !== id) throw expired();
    return sessionStore.renameSession(id, title);
  };
  const removeSession = async (id) => {
    assertIdle();
    const current = await selected();
    if (current.session.id !== id) throw expired();
    return sessionStore.removeSession(id);
  };
  const addParticipant = async (input) => {
    assertIdle();
    if (typeof sessionStore.addParticipant !== 'function') throw unavailable();
    return sessionStore.addParticipant(input);
  };
  const removeParticipant = async (input) => {
    assertIdle();
    if (typeof sessionStore.removeParticipant !== 'function') throw unavailable();
    return sessionStore.removeParticipant(input);
  };

  return Object.freeze({
    snapshot,
    busy: () => manager.getSnapshot().busy === true,
    select,
    selectParticipant,
    setParticipantConnection,
    setNextConnection,
    runGoal,
    stop: () => manager.stop(),
    ensureSessionForConnection,
    createAgent,
    renameAgent,
    removeAgent,
    createSession,
    renameSession,
    removeSession,
    addParticipant,
    removeParticipant,
  });
}

module.exports = { createSessionCoordinator, neutralPrompt };
