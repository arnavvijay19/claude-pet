'use strict';

const { AgentError } = require('./agentErrors.js');
const { buildNeutralSessionPrompt } = require('./sessionContext.js');

function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function unavailable() { return new AgentError('SESSION_PERSISTENCE_UNAVAILABLE'); }
function expired() { return new AgentError('SESSION_SELECTION_EXPIRED'); }
function providerOf(connection) { return connection?.executorType || null; }
function neutralPrompt(turns, text) { return buildNeutralSessionPrompt({ turns, currentText: text }); }

function createSessionCoordinator({ sessionStore, connectionStore, manager, confirmProviderSwitch = async () => true }) {
  const methods = ['listAgents', 'listSessions', 'getSelection', 'getSessionView', 'getContextTurns', 'select', 'setNextConnection', 'appendTurn'];
  if (!sessionStore || methods.some((method) => typeof sessionStore[method] !== 'function') || !connectionStore
      || typeof connectionStore.listConnections !== 'function' || typeof connectionStore.getConnection !== 'function'
      || typeof connectionStore.setActiveSelection !== 'function' || typeof connectionStore.getActiveSelection !== 'function' || !manager || typeof manager.getSnapshot !== 'function'
      || typeof manager.runGoal !== 'function' || typeof manager.stop !== 'function') throw new TypeError('Session coordinator requires session, connection, and manager boundaries.');
  const assertIdle = () => { if (manager.getSnapshot().busy) throw new AgentError('AGENT_BUSY'); };
  async function selectedAgent() {
    const selection = await sessionStore.getSelection();
    if (!selection?.agentId) throw unavailable();
    const agent = (await sessionStore.listAgents()).find((item) => item.id === selection.agentId);
    if (!agent) throw unavailable();
    return { selection, agent };
  }
  async function selected() {
    const current = await selectedAgent();
    if (!current.selection.sessionId) throw unavailable();
    const session = await sessionStore.getSessionView(current.selection.sessionId);
    if (!session || session.agentId !== current.selection.agentId) throw unavailable();
    return { ...current, session };
  }
  async function ownedSession(id) {
    const current = await selectedAgent();
    const session = await sessionStore.getSessionView(id);
    if (!session || session.agentId !== current.agent.id) throw expired();
    return { ...current, session };
  }
  async function readRunConnection(id) {
    const value = typeof connectionStore.getRunConnection === 'function'
      ? await connectionStore.getRunConnection(id) : await connectionStore.getConnection(id);
    return value || null;
  }
  async function assertStable(captured, connection) {
    const current = await selected();
    if (current.selection.agentId !== captured.selection.agentId || current.selection.sessionId !== captured.selection.sessionId
        || current.agent.updatedAt !== captured.agent.updatedAt || current.session.updatedAt !== captured.session.updatedAt
        || current.session.nextConnectionId !== captured.session.nextConnectionId) throw expired();
    const latest = await readRunConnection(connection.id);
    if (!latest || latest.id !== connection.id || latest.workspacePath !== connection.workspacePath
        || latest.executorType !== connection.executorType
        || (Number.isSafeInteger(connection.revision) && latest.revision !== connection.revision)) throw expired();
  }
  async function priorProvider(session) {
    if (session.turnCount === 0) return null;
    const turns = await sessionStore.getContextTurns(session.id);
    return turns.slice().reverse().find((turn) => turn.role === 'assistant')?.provider || session.lastProvider || 'unknown';
  }
  async function snapshot() {
    const selection = await sessionStore.getSelection();
    const agents = await sessionStore.listAgents();
    const agent = agents.find((item) => item.id === selection.agentId) || null;
    const sessions = agent ? await sessionStore.listSessions(agent.id) : [];
    const session = selection.sessionId ? sessions.find((item) => item.id === selection.sessionId) || null : null;
    let turns = []; let persistence = { available: true };
    if (session) { try { turns = await sessionStore.getContextTurns(session.id); } catch (error) { if (error?.code !== 'SESSION_PERSISTENCE_UNAVAILABLE') throw error; persistence = { available: false, code: error.code }; } }
    const connections = await connectionStore.listConnections();
    return freeze({ agents: agents.map((item) => ({ ...item })), sessions: sessions.map((item) => ({ ...item })), selection: { ...selection }, agent: agent ? { ...agent } : null, session: session ? { ...session } : null, turns: turns.map((item) => ({ ...item, changedFiles: [...item.changedFiles] })), connections: connections.map((item) => ({ ...item })), persistence, busy: manager.getSnapshot().busy === true });
  }
  async function select(input) {
    assertIdle(); if (!input || Object.getPrototypeOf(input) !== Object.prototype || typeof input.agentId !== 'string' || (input.sessionId !== null && typeof input.sessionId !== 'string')) throw unavailable();
    const agent = (await sessionStore.listAgents()).find((item) => item.id === input.agentId);
    const session = input.sessionId ? await sessionStore.getSessionView(input.sessionId) : null;
    if (!agent || (input.sessionId && (!session || session.agentId !== agent.id))) throw expired();
    const result = await sessionStore.select({ agentId: input.agentId, sessionId: input.sessionId });
    await connectionStore.setActiveSelection(session?.nextConnectionId || null);
    return result;
  }
  async function setNextConnection({ sessionId, connectionId }) {
    assertIdle(); if (typeof sessionId !== 'string' || typeof connectionId !== 'string') throw unavailable();
    const current = await selected(); if (current.session.id !== sessionId) throw expired();
    const next = await readRunConnection(connectionId); if (!next) throw unavailable();
    if (next.workspacePath !== current.session.workspacePath) throw new AgentError('UNSUPPORTED_OPTION');
    const previousProvider = await priorProvider(current.session);
    if (current.session.turnCount > 0 && (!previousProvider || previousProvider === 'unknown' || previousProvider !== providerOf(next))) {
      if (await confirmProviderSwitch({ sessionId, fromProvider: previousProvider || 'unknown', toProvider: providerOf(next) }) !== true) throw new AgentError('PROVIDER_SWITCH_CANCELLED');
    }
    await assertStable(current, next);
    const priorActiveConnection = await connectionStore.getActiveSelection();
    let activeChanged = false;
    try {
      await connectionStore.setActiveSelection(connectionId); activeChanged = true;
      await assertStable(current, next);
      return await sessionStore.setNextConnection(sessionId, connectionId);
    } catch (error) {
      if (activeChanged) try { await connectionStore.setActiveSelection(priorActiveConnection); } catch { /* selected session remains authoritative */ }
      throw error;
    }
  }
  async function runGoal(text, options = {}) {
    if (typeof text !== 'string' || !text.trim() || text.includes('\0') || !options || Object.getPrototypeOf(options) !== Object.prototype || Object.keys(options).some((key) => key !== 'onStart') || (Object.hasOwn(options, 'onStart') && typeof options.onStart !== 'function')) throw unavailable();
    assertIdle(); const current = await selected(); if (!current.session.nextConnectionId) throw new AgentError('AGENT_REQUIRED');
    const runConnection = await readRunConnection(current.session.nextConnectionId);
    if (!runConnection || !Number.isSafeInteger(runConnection.revision)) throw unavailable();
    if (runConnection.workspacePath !== current.session.workspacePath) throw new AgentError('UNSUPPORTED_OPTION');
    const turns = await sessionStore.getContextTurns(current.session.id); await assertStable(current, runConnection); let started = false;
    const result = await manager.runGoal(neutralPrompt(turns, text), { expectedConnectionId: runConnection.id, expectedRevision: runConnection.revision, onStart: async (context) => {
      await assertStable(current, runConnection);
      await sessionStore.appendTurn(current.session.id, { role: 'user', text, provider: null, model: null, changedFiles: [] }); started = true;
      const agent = (await sessionStore.listAgents()).find((item) => item.id === current.selection.agentId);
      options.onStart?.(freeze({ ...context, agentId: current.selection.agentId, sessionId: current.session.id, agentName: agent?.name || '', sessionTitle: current.session.title }));
    } });
    if (!started) throw expired(); await sessionStore.appendTurn(current.session.id, { role: 'assistant', text: result.text, provider: result.executor, model: result.model, changedFiles: result.changedFiles });
    return freeze({ ...result, agentId: current.selection.agentId, sessionId: current.session.id });
  }
  const createAgent = async (input) => { assertIdle(); return sessionStore.createAgent(input); };
  const renameAgent = async (id, name) => { assertIdle(); const current = await selectedAgent(); if (current.agent.id !== id) throw expired(); return sessionStore.renameAgent(id, name); };
  const removeAgent = async (id) => { assertIdle(); const current = await selectedAgent(); if (current.agent.id !== id) throw expired(); return sessionStore.removeAgent(id); };
  const createSession = async (input) => { assertIdle(); const current = await selectedAgent(); if (!input || input.agentId !== current.agent.id) throw expired(); return sessionStore.createSession(input); };
  const renameSession = async (id, title) => { assertIdle(); await ownedSession(id); return sessionStore.renameSession(id, title); };
  const removeSession = async (id) => { assertIdle(); await ownedSession(id); return sessionStore.removeSession(id); };
  return Object.freeze({ snapshot, busy: () => manager.getSnapshot().busy === true, select, setNextConnection, runGoal, stop: () => manager.stop(), createAgent, renameAgent, removeAgent, createSession, renameSession, removeSession });
}

module.exports = { createSessionCoordinator, neutralPrompt };
