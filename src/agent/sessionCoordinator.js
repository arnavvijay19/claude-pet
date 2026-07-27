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
  async function selected() {
    const selection = await sessionStore.getSelection();
    if (!selection?.agentId || !selection.sessionId) throw unavailable();
    const session = await sessionStore.getSessionView(selection.sessionId);
    if (!session || session.agentId !== selection.agentId) throw unavailable();
    return { selection, session };
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
    const result = await sessionStore.select({ agentId: input.agentId, sessionId: input.sessionId });
    const session = input.sessionId ? await sessionStore.getSessionView(input.sessionId) : null;
    await connectionStore.setActiveSelection(session?.nextConnectionId || null);
    return result;
  }
  async function setNextConnection({ sessionId, connectionId }) {
    assertIdle(); if (typeof sessionId !== 'string' || typeof connectionId !== 'string') throw unavailable();
    const current = await selected(); if (current.session.id !== sessionId) throw expired();
    const next = await connectionStore.getConnection(connectionId); if (!next) throw unavailable();
    const previous = current.session.nextConnectionId ? await connectionStore.getConnection(current.session.nextConnectionId) : null;
    if (current.session.turnCount > 0 && providerOf(previous) && providerOf(previous) !== providerOf(next)) {
      if (await confirmProviderSwitch({ sessionId, fromProvider: providerOf(previous), toProvider: providerOf(next) }) !== true) throw new AgentError('PROVIDER_SWITCH_CANCELLED');
    }
    const before = await selected(); if (before.session.id !== sessionId || before.session.updatedAt !== current.session.updatedAt) throw expired();
    const priorActiveConnection = await connectionStore.getActiveSelection();
    await connectionStore.setActiveSelection(connectionId);
    try { return await sessionStore.setNextConnection(sessionId, connectionId); } catch (error) {
      try { await connectionStore.setActiveSelection(priorActiveConnection); } catch { /* next run reconciles from selected session */ }
      throw error;
    }
  }
  async function runGoal(text, options = {}) {
    if (typeof text !== 'string' || !text.trim() || text.includes('\0') || !options || Object.getPrototypeOf(options) !== Object.prototype || Object.keys(options).some((key) => key !== 'onStart') || (Object.hasOwn(options, 'onStart') && typeof options.onStart !== 'function')) throw unavailable();
    assertIdle(); const current = await selected(); if (!current.session.nextConnectionId) throw new AgentError('AGENT_REQUIRED');
    const runConnection = typeof connectionStore.getRunConnection === 'function' ? await connectionStore.getRunConnection(current.session.nextConnectionId) : await connectionStore.getConnection(current.session.nextConnectionId);
    if (!runConnection || !Number.isSafeInteger(runConnection.revision)) throw unavailable();
    const turns = await sessionStore.getContextTurns(current.session.id); await connectionStore.setActiveSelection(runConnection.id); let started = false;
    const result = await manager.runGoal(neutralPrompt(turns, text), { expectedConnectionId: runConnection.id, expectedRevision: runConnection.revision, onStart: async (context) => {
      const latest = await selected(); if (latest.session.id !== current.session.id || latest.session.updatedAt !== current.session.updatedAt || latest.session.nextConnectionId !== runConnection.id) throw expired();
      await sessionStore.appendTurn(current.session.id, { role: 'user', text, provider: null, model: null, changedFiles: [] }); started = true;
      const agent = (await sessionStore.listAgents()).find((item) => item.id === current.selection.agentId);
      options.onStart?.(freeze({ ...context, agentId: current.selection.agentId, sessionId: current.session.id, agentName: agent?.name || '', sessionTitle: current.session.title }));
    } });
    if (!started) throw expired(); await sessionStore.appendTurn(current.session.id, { role: 'assistant', text: result.text, provider: result.executor, model: result.model, changedFiles: result.changedFiles });
    return freeze({ ...result, agentId: current.selection.agentId, sessionId: current.session.id });
  }
  const guarded = (method) => async (...args) => { assertIdle(); return sessionStore[method](...args); };
  return Object.freeze({ snapshot, busy: () => manager.getSnapshot().busy === true, select, setNextConnection, runGoal, stop: () => manager.stop(), createAgent: guarded('createAgent'), renameAgent: guarded('renameAgent'), removeAgent: guarded('removeAgent'), createSession: guarded('createSession'), renameSession: guarded('renameSession'), removeSession: guarded('removeSession') });
}

module.exports = { createSessionCoordinator, neutralPrompt };
