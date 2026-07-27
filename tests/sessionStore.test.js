'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createSessionStore } = require('../src/agent/sessionStore.js');

async function temporaryStore(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-sessions-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'sessions.json');
  const store = createSessionStore({
    filePath,
    crypto: options.crypto || availableCrypto(),
    randomId: options.randomId || sequence('id'),
    clock: options.clock || (() => '2026-07-27T00:00:00.000Z'),
    ...(options.fileSystem ? { fileSystem: options.fileSystem } : {}),
  });
  await store.initialize();
  return { directory, filePath, store };
}

function sequence(prefix) {
  let number = 0;
  return () => `${prefix}-${++number}`;
}

function availableCrypto(overrides = {}) {
  return {
    isAvailable: async () => true,
    encrypt: async (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decrypt: async (buffer) => ({
      value: Buffer.from(buffer).toString('utf8').replace(/^encrypted:/, ''),
      shouldReEncrypt: false,
    }),
    ...overrides,
  };
}

function userTurn(text = 'Keep this private') {
  return { role: 'user', text, provider: null, model: null, changedFiles: [] };
}

function assistantTurn(text = 'Completed safely') {
  return {
    role: 'assistant', text, provider: 'codex-cli', model: 'gpt-5.6-terra',
    changedFiles: ['notes/result.txt'],
  };
}

function persistedTurn(turn) {
  return { ...turn, createdAt: '2026-07-27T00:00:00.000Z' };
}

test('persists only encrypted turns while restoring the selected agent, session, next connection, and public metadata', async (t) => {
  const { filePath, store } = await temporaryStore(t);
  const agent = await store.createAgent({ name: 'Research' });
  const session = await store.createSession({ agentId: agent.id, title: 'Thesis', workspacePath: 'Z:\\research' });
  await store.select({ agentId: agent.id, sessionId: session.id });
  await store.setNextConnection(session.id, 'connection-1');
  await store.appendTurn(session.id, userTurn('Do not write this plaintext'));
  await store.appendTurn(session.id, assistantTurn('Provider reply stays encrypted'));

  const disk = await fs.readFile(filePath, 'utf8');
  assert.equal(disk.includes('Do not write this plaintext'), false);
  assert.equal(disk.includes('Provider reply stays encrypted'), false);
  assert.equal(disk.includes('encrypted:'), false);

  const restored = createSessionStore({
    filePath, crypto: availableCrypto(), randomId: sequence('unused'), clock: () => '2026-07-27T00:00:03.000Z',
  });
  await restored.initialize();
  assert.deepEqual(await restored.getSelection(), { agentId: agent.id, sessionId: session.id });
  assert.deepEqual(await restored.getSessionView(session.id), {
    id: session.id, agentId: agent.id, title: 'Thesis', workspacePath: 'Z:\\research',
    nextConnectionId: 'connection-1', createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z', turnCount: 2, lastProvider: 'codex-cli',
  });
  assert.deepEqual(await restored.getContextTurns(session.id), [
    persistedTurn(userTurn('Do not write this plaintext')),
    persistedTurn(assistantTurn('Provider reply stays encrypted')),
  ]);
  const publicAgent = (await restored.listAgents())[0];
  assert.deepEqual(Object.keys(publicAgent), ['id', 'name', 'createdAt', 'updatedAt', 'sessionCount']);
  assert.equal(Object.isFrozen(publicAgent), true);
});

test('rejects renderer-owned fields, cross-agent selection, and deletion of an agent with sessions', async (t) => {
  const { store } = await temporaryStore(t);
  await assert.rejects(store.createAgent({ name: 'Bad', id: 'renderer-id' }));
  const first = await store.createAgent({ name: 'First' });
  const second = await store.createAgent({ name: 'Second' });
  const session = await store.createSession({ agentId: first.id, title: 'Only first owns this', workspacePath: 'Z:\\first' });
  await assert.rejects(store.createSession({ agentId: first.id, title: 'Bad', workspacePath: 'Z:\\first', createdAt: 'renderer-time' }));
  await assert.rejects(store.select({ agentId: second.id, sessionId: session.id }));
  await assert.rejects(store.removeAgent(first.id));
  assert.equal(await store.removeSession(session.id), true);
  assert.equal(await store.removeAgent(first.id), true);
});

test('keeps metadata readable but fails closed when safeStorage cannot persist or decrypt session content', async (t) => {
  const unavailable = availableCrypto({
    isAvailable: async () => false,
    encrypt: async () => { throw new Error('must not encrypt'); },
    decrypt: async () => { throw new Error('must not decrypt'); },
  });
  const { store } = await temporaryStore(t, { crypto: unavailable });
  const agent = await store.createAgent({ name: 'Metadata survives' });
  const session = await store.createSession({ agentId: agent.id, title: 'No plaintext fallback', workspacePath: 'Z:\\safe' });
  assert.deepEqual(await store.getSessionView(session.id), {
    id: session.id, agentId: agent.id, title: 'No plaintext fallback', workspacePath: 'Z:\\safe',
    nextConnectionId: null, createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z',
    turnCount: 0, lastProvider: null,
  });
  await assert.rejects(store.appendTurn(session.id, userTurn()), (error) => error.code === 'SESSION_PERSISTENCE_UNAVAILABLE');
  await assert.rejects(store.getContextTurns(session.id), (error) => error.code === 'SESSION_PERSISTENCE_UNAVAILABLE');
});

test('serializes concurrent mutation and leaves the durable state intact when atomic replacement fails', async (t) => {
  let failRename = false;
  const fileSystem = {
    ...fs,
    rename: async (from, to) => {
      if (failRename) throw Object.assign(new Error('rename blocked'), { code: 'EPERM' });
      return fs.rename(from, to);
    },
  };
  const { filePath, store } = await temporaryStore(t, { fileSystem });
  const agent = await store.createAgent({ name: 'Concurrent' });
  const session = await store.createSession({ agentId: agent.id, title: 'Serial', workspacePath: 'Z:\\serial' });
  await Promise.all([
    store.appendTurn(session.id, userTurn('first')),
    store.appendTurn(session.id, userTurn('second')),
    store.setNextConnection(session.id, 'connection-2'),
  ]);
  assert.equal((await store.getSessionView(session.id)).turnCount, 2);
  const before = await fs.readFile(filePath, 'utf8');
  failRename = true;
  await assert.rejects(store.renameSession(session.id, 'Lost write'));
  assert.equal(await fs.readFile(filePath, 'utf8'), before);
  assert.equal((await store.getSessionView(session.id)).title, 'Serial');
});

test('rotates stale session ciphertext after a successful decrypt without writing plaintext to disk', async (t) => {
  const { filePath, store } = await temporaryStore(t);
  const agent = await store.createAgent({ name: 'Rotate' });
  const session = await store.createSession({ agentId: agent.id, title: 'Ciphertext', workspacePath: 'Z:\\rotate' });
  await store.appendTurn(session.id, userTurn('rotate me'));

  const rotating = availableCrypto({
    encrypt: async (value) => Buffer.from(`rotated:${value}`, 'utf8'),
    decrypt: async (buffer) => ({
      value: Buffer.from(buffer).toString('utf8').replace(/^encrypted:/, ''), shouldReEncrypt: true,
    }),
  });
  const reloaded = createSessionStore({ filePath, crypto: rotating, randomId: sequence('unused'), clock: () => '2026-07-27T00:00:04.000Z' });
  await reloaded.initialize();
  assert.deepEqual(await reloaded.getContextTurns(session.id), [persistedTurn(userTurn('rotate me'))]);
  const disk = await fs.readFile(filePath, 'utf8');
  assert.equal(disk.includes('rotate me'), false);
  assert.equal(disk.includes(Buffer.from('rotated:').toString('base64').slice(0, 6)), true);
});
