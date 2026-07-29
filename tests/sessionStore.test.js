'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createSessionStore } = require('../src/agent/sessionStore.js');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'session-store-v1.json');

async function temporaryPath(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-sessions-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, filePath: path.join(directory, 'sessions.json') };
}

function buildStore(filePath, options = {}) {
  return createSessionStore({
    filePath,
    crypto: options.crypto || availableCrypto(),
    randomId: options.randomId || sequence('id'),
    clock: options.clock || (() => '2026-07-27T00:00:00.000Z'),
    ...(options.fileSystem ? { fileSystem: options.fileSystem } : {}),
  });
}

async function temporaryStore(t, options = {}) {
  const location = await temporaryPath(t);
  const store = buildStore(location.filePath, options);
  await store.initialize();
  return { ...location, store };
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

function userTurn(agentId, text = 'Keep this private') {
  return { role: 'user', text, agentId, provider: null, model: null, changedFiles: [] };
}

function assistantTurn(agentId, text = 'Completed safely') {
  return {
    role: 'assistant', text, agentId, provider: 'codex-cli', model: 'gpt-5.6-terra',
    changedFiles: ['notes/result.txt'],
  };
}

function persistedTurn(turn, createdAt = '2026-07-27T00:00:00.000Z') {
  return { ...turn, createdAt };
}

test('migrates version 1 nested sessions into encrypted version 2 shared sessions', async (t) => {
  const { filePath } = await temporaryPath(t);
  await fs.copyFile(FIXTURE_PATH, filePath);
  const store = buildStore(filePath);

  await store.initialize();

  const snapshot = await store.getSelection();
  const sessions = await store.listSessions();
  assert.equal(snapshot.sessionId, 'session-old');
  assert.deepEqual(sessions[0].participants, [
    { agentId: 'agent-old', connectionId: 'offline' },
  ]);
  assert.equal(sessions[0].activeAgentId, 'agent-old');
  assert.deepEqual((await store.getContextTurns('session-old')).map((turn) => turn.agentId), [
    'agent-old', 'agent-old',
  ]);
  assert.deepEqual(await store.getAgentProfile('agent-old'), {
    id: 'agent-old', name: 'Researcher', marker: 'amber', instruction: '',
  });
  const disk = await fs.readFile(filePath, 'utf8');
  assert.equal(JSON.parse(disk).version, 2);
  assert.equal(disk.includes('legacy private turn'), false);
  assert.equal(disk.includes('legacy private answer'), false);
  assert.equal(disk.includes('private instruction'), false);
});

test('persists encrypted agent profiles and attributed turns in one top-level shared session', async (t) => {
  const { filePath, store } = await temporaryStore(t);
  const researcher = await store.createAgent({
    name: 'Researcher', marker: 'amber', instruction: 'Find primary evidence',
  });
  const reviewer = await store.createAgent({
    name: 'Reviewer', marker: 'blue', instruction: 'Check concrete defects',
  });
  const session = await store.createSession({
    title: 'Thesis', workspacePath: 'Z:\\research',
    participant: { agentId: researcher.id, connectionId: 'connection-1' },
  });
  await store.addParticipant({
    sessionId: session.id, agentId: reviewer.id, connectionId: 'connection-2',
  });
  await store.selectParticipant({ sessionId: session.id, agentId: reviewer.id });
  await store.select({ sessionId: session.id });
  await store.appendTurn(session.id, userTurn(reviewer.id, 'Do not write this plaintext'));
  await store.appendTurn(session.id, assistantTurn(reviewer.id, 'Provider reply stays encrypted'));
  await store.updateAgent(reviewer.id, {
    name: 'Critical Reviewer', marker: 'violet', instruction: 'private instruction',
  });

  const disk = await fs.readFile(filePath, 'utf8');
  assert.equal(disk.includes('Do not write this plaintext'), false);
  assert.equal(disk.includes('Provider reply stays encrypted'), false);
  assert.equal(disk.includes('Find primary evidence'), false);
  assert.equal(disk.includes('private instruction'), false);
  assert.equal(disk.includes('encrypted:'), false);

  const restored = buildStore(filePath, {
    randomId: sequence('unused'), clock: () => '2026-07-27T00:00:03.000Z',
  });
  await restored.initialize();
  assert.deepEqual(await restored.getSelection(), { sessionId: session.id });
  assert.deepEqual(await restored.getSessionView(session.id), {
    id: session.id, title: 'Thesis', workspacePath: 'Z:\\research',
    participants: [
      { agentId: researcher.id, connectionId: 'connection-1' },
      { agentId: reviewer.id, connectionId: 'connection-2' },
    ],
    activeAgentId: reviewer.id,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
    turnCount: 2, lastProvider: 'codex-cli',
  });
  assert.deepEqual(await restored.getContextTurns(session.id), [
    persistedTurn(userTurn(reviewer.id, 'Do not write this plaintext')),
    persistedTurn(assistantTurn(reviewer.id, 'Provider reply stays encrypted')),
  ]);
  assert.deepEqual(await restored.getAgentProfile(reviewer.id), {
    id: reviewer.id, name: 'Critical Reviewer', marker: 'violet', instruction: 'private instruction',
  });
  const publicAgent = (await restored.listAgents()).find((agent) => agent.id === reviewer.id);
  assert.deepEqual(Object.keys(publicAgent), ['id', 'name', 'marker', 'createdAt', 'updatedAt', 'sessionCount']);
  assert.equal(Object.isFrozen(publicAgent), true);
  assert.equal(Object.isFrozen((await restored.listSessions())[0].participants), true);
});

test('enforces participant membership, the eight-participant ceiling, and final-participant safety', async (t) => {
  const { store } = await temporaryStore(t);
  const agents = [];
  for (let index = 0; index < 9; index += 1) {
    agents.push(await store.createAgent({
      name: `Agent ${index + 1}`, marker: `marker-${index + 1}`, instruction: '',
    }));
  }
  const session = await store.createSession({
    title: 'Shared', workspacePath: 'Z:\\shared',
    participant: { agentId: agents[0].id, connectionId: 'connection-1' },
  });
  await assert.rejects(store.addParticipant({
    sessionId: session.id, agentId: agents[0].id, connectionId: 'duplicate',
  }));
  for (let index = 1; index < 8; index += 1) {
    await store.addParticipant({
      sessionId: session.id, agentId: agents[index].id, connectionId: `connection-${index + 1}`,
    });
  }
  await assert.rejects(store.addParticipant({
    sessionId: session.id, agentId: agents[8].id, connectionId: 'connection-9',
  }));
  await assert.rejects(store.selectParticipant({ sessionId: session.id, agentId: agents[8].id }));
  await assert.rejects(store.appendTurn(session.id, userTurn(agents[8].id, 'outsider turn')));
  await assert.rejects(store.appendTurn(session.id, userTurn(agents[1].id, 'inactive turn')));
  for (let index = 7; index > 0; index -= 1) {
    assert.equal(await store.removeParticipant({ sessionId: session.id, agentId: agents[index].id }), true);
  }
  await assert.rejects(store.removeParticipant({ sessionId: session.id, agentId: agents[0].id }));
});

test('removing a participant preserves attributed history and its agent identity', async (t) => {
  const { store } = await temporaryStore(t);
  const researcher = await store.createAgent({
    name: 'Researcher', marker: 'amber', instruction: '',
  });
  const reviewer = await store.createAgent({
    name: 'Reviewer', marker: 'blue', instruction: '',
  });
  const session = await store.createSession({
    title: 'Preserved history', workspacePath: 'Z:\\shared',
    participant: { agentId: researcher.id, connectionId: 'research-connection' },
  });
  await store.addParticipant({
    sessionId: session.id, agentId: reviewer.id, connectionId: 'review-connection',
  });
  await store.selectParticipant({ sessionId: session.id, agentId: reviewer.id });
  await store.appendTurn(session.id, userTurn(reviewer.id, 'Review this result'));
  await store.removeParticipant({ sessionId: session.id, agentId: reviewer.id });

  assert.deepEqual(await store.getContextTurns(session.id), [
    persistedTurn(userTurn(reviewer.id, 'Review this result')),
  ]);
  await assert.rejects(store.removeAgent(reviewer.id));
});

test('rejects over-limit UTF-8 instructions and malformed persisted turn attribution', async (t) => {
  const { filePath, store } = await temporaryStore(t);
  await assert.rejects(store.createAgent({
    name: 'Too large', marker: 'red', instruction: 'é'.repeat(1001),
  }));
  const agent = await store.createAgent({ name: 'Valid', marker: 'green', instruction: '' });
  await assert.rejects(store.updateAgent(agent.id, {
    name: 'Valid', marker: 'green', instruction: '🙂'.repeat(501),
  }));
  const session = await store.createSession({
    title: 'Attribution', workspacePath: 'Z:\\valid',
    participant: { agentId: agent.id, connectionId: 'offline' },
  });
  await store.appendTurn(session.id, userTurn(agent.id));
  const persisted = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const turns = JSON.parse(Buffer.from(persisted.sessions[0].encryptedTurns, 'base64').toString('utf8').replace(/^encrypted:/, ''));
  turns[0].agentId = '';
  persisted.sessions[0].encryptedTurns = Buffer.from(`encrypted:${JSON.stringify(turns)}`).toString('base64');
  await fs.writeFile(filePath, JSON.stringify(persisted), 'utf8');

  const restored = buildStore(filePath);
  await restored.initialize();
  await assert.rejects(
    restored.getContextTurns(session.id),
    (error) => error.code === 'SESSION_PERSISTENCE_UNAVAILABLE',
  );
});

test('rejects oversized base64 ciphertext before decoding or decrypting it', async (t) => {
  const { filePath, store } = await temporaryStore(t);
  await store.createAgent({ name: 'Bounded', marker: 'green', instruction: '' });
  const persisted = JSON.parse(await fs.readFile(filePath, 'utf8'));
  persisted.agents[0].encryptedInstruction = 'A'.repeat(6 * 1024 * 1024);
  await fs.writeFile(filePath, JSON.stringify(persisted), 'utf8');
  let decryptCalls = 0;
  const restored = buildStore(filePath, {
    crypto: availableCrypto({
      decrypt: async () => {
        decryptCalls += 1;
        throw new Error('must not decrypt oversized input');
      },
    }),
  });

  await assert.rejects(
    restored.initialize(),
    (error) => error.code === 'SESSION_PERSISTENCE_UNAVAILABLE',
  );
  assert.equal(decryptCalls, 0);
});

test('leaves a version 1 file untouched when migration validation, decryption, encryption, or write fails', async (t) => {
  const original = await fs.readFile(FIXTURE_PATH, 'utf8');
  const cases = [
    {
      name: 'validation',
      prepare: async (filePath) => {
        const invalid = JSON.parse(original);
        invalid.agents[0].sessions[0].workspacePath = 'relative';
        await fs.writeFile(filePath, JSON.stringify(invalid), 'utf8');
      },
      options: {},
    },
    {
      name: 'decryption',
      prepare: (filePath) => fs.writeFile(filePath, original, 'utf8'),
      options: { crypto: availableCrypto({ decrypt: async () => { throw new Error('decrypt failed'); } }) },
    },
    {
      name: 'encryption',
      prepare: (filePath) => fs.writeFile(filePath, original, 'utf8'),
      options: { crypto: availableCrypto({ encrypt: async () => { throw new Error('encrypt failed'); } }) },
    },
    {
      name: 'write',
      prepare: (filePath) => fs.writeFile(filePath, original, 'utf8'),
      options: {
        fileSystem: {
          ...fs,
          rename: async () => { throw Object.assign(new Error('rename failed'), { code: 'EPERM' }); },
        },
      },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async (subtest) => {
      const { filePath } = await temporaryPath(subtest);
      await entry.prepare(filePath);
      const before = await fs.readFile(filePath, 'utf8');
      const store = buildStore(filePath, entry.options);
      await assert.rejects(
        store.initialize(),
        (error) => error.code === 'SESSION_PERSISTENCE_UNAVAILABLE',
      );
      assert.equal(await fs.readFile(filePath, 'utf8'), before);
    });
  }
});

test('serializes concurrent mutation and leaves durable version 2 state intact when replacement fails', async (t) => {
  let failRename = false;
  const fileSystem = {
    ...fs,
    rename: async (from, to) => {
      if (failRename) throw Object.assign(new Error('rename blocked'), { code: 'EPERM' });
      return fs.rename(from, to);
    },
  };
  const { filePath, store } = await temporaryStore(t, { fileSystem });
  const agent = await store.createAgent({ name: 'Concurrent', marker: 'amber', instruction: '' });
  const session = await store.createSession({
    title: 'Serial', workspacePath: 'Z:\\serial',
    participant: { agentId: agent.id, connectionId: 'offline' },
  });
  await Promise.all([
    store.appendTurn(session.id, userTurn(agent.id, 'first')),
    store.appendTurn(session.id, userTurn(agent.id, 'second')),
    store.updateAgent(agent.id, { name: 'Concurrent updated', marker: 'blue', instruction: '' }),
  ]);
  assert.equal((await store.getSessionView(session.id)).turnCount, 2);
  const before = await fs.readFile(filePath, 'utf8');
  failRename = true;
  await assert.rejects(store.renameSession(session.id, 'Lost write'));
  assert.equal(await fs.readFile(filePath, 'utf8'), before);
  assert.equal((await store.getSessionView(session.id)).title, 'Serial');
});

test('rotates stale profile and session ciphertext without writing plaintext to disk', async (t) => {
  const { filePath, store } = await temporaryStore(t);
  const agent = await store.createAgent({
    name: 'Rotate', marker: 'amber', instruction: 'rotate private instruction',
  });
  const session = await store.createSession({
    title: 'Ciphertext', workspacePath: 'Z:\\rotate',
    participant: { agentId: agent.id, connectionId: 'offline' },
  });
  await store.appendTurn(session.id, userTurn(agent.id, 'rotate private turn'));

  const rotating = availableCrypto({
    encrypt: async (value) => Buffer.from(`rotated:${value}`, 'utf8'),
    decrypt: async (buffer) => ({
      value: Buffer.from(buffer).toString('utf8').replace(/^encrypted:/, ''),
      shouldReEncrypt: true,
    }),
  });
  const reloaded = buildStore(filePath, {
    crypto: rotating, randomId: sequence('unused'), clock: () => '2026-07-27T00:00:04.000Z',
  });
  await reloaded.initialize();
  assert.equal((await reloaded.getAgentProfile(agent.id)).instruction, 'rotate private instruction');
  assert.deepEqual(await reloaded.getContextTurns(session.id), [
    persistedTurn(userTurn(agent.id, 'rotate private turn')),
  ]);
  const disk = await fs.readFile(filePath, 'utf8');
  assert.equal(disk.includes('rotate private instruction'), false);
  assert.equal(disk.includes('rotate private turn'), false);
  assert.equal(disk.includes(Buffer.from('rotated:').toString('base64').slice(0, 6)), true);
});
