'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cryptoModule = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  MAXIMUM_ENCODED_BYTES,
  createCodexCompatibilityStore,
} = require('../src/agent/codexCompatibilityStore.js');

const IDENTITY = Object.freeze({
  path: 'C:\\Users\\Tester\\.codex\\packages\\standalone\\releases\\0.146.0-x86_64-pc-windows-msvc\\bin\\codex.exe',
  sha256: 'a'.repeat(64),
  volumeSerial: 'A1B2C3D4',
  fileId: '0011223344556677',
  version: '0.146.0',
  publisher: 'OpenAI OpCo, LLC',
});
const POLICY = 'codex-probe-v1';

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-codex-compatibility-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function availableCrypto(overrides = {}) {
  return {
    isAvailable: async () => true,
    encrypt: async (value) => Buffer.from(value, 'utf8'),
    decrypt: async (buffer) => ({ value: Buffer.from(buffer).toString('utf8'), shouldReEncrypt: false }),
    ...overrides,
  };
}

async function temporaryStore(t, overrides = {}) {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'codex-compatibility.evidence');
  const store = createCodexCompatibilityStore({
    filePath,
    crypto: availableCrypto(),
    clock: () => '2026-08-02T12:34:56.789Z',
    ...overrides,
  });
  await store.initialize();
  return { directory, filePath, store };
}

async function decryptedState(filePath, crypto = availableCrypto()) {
  const wrapped = await fs.readFile(filePath, 'utf8');
  const decrypted = await crypto.decrypt(Buffer.from(wrapped, 'base64'));
  return JSON.parse(decrypted.value);
}

function changedIdentity(field, value) {
  return { ...IDENTITY, [field]: value };
}

test('records only an exact identity and policy revision as successful evidence', async (t) => {
  const { filePath, store } = await temporaryStore(t);
  assert.equal(await store.hasSuccessful(IDENTITY, POLICY), false);
  assert.equal(await store.rememberSuccessful(IDENTITY, POLICY), true);
  assert.equal(await store.hasSuccessful(IDENTITY, POLICY), true);

  const reloaded = createCodexCompatibilityStore({ filePath, crypto: availableCrypto() });
  await reloaded.initialize();
  assert.equal(await reloaded.hasSuccessful(IDENTITY, POLICY), true);

  const changes = {
    path: 'C:\\Elsewhere\\codex.exe',
    sha256: 'b'.repeat(64),
    volumeSerial: 'FFEEDDCC',
    fileId: '7766554433221100',
    version: '0.146.1',
    publisher: 'Different publisher',
  };
  for (const [field, value] of Object.entries(changes)) {
    assert.equal(await reloaded.hasSuccessful(changedIdentity(field, value), POLICY), false, field);
  }
  assert.equal(await reloaded.hasSuccessful(IDENTITY, 'codex-probe-v2'), false);
});

test('normalizes Windows path casing without creating a second identity record', async (t) => {
  const { filePath, store } = await temporaryStore(t);
  const differentlyCased = changedIdentity('path', IDENTITY.path.toUpperCase());
  assert.equal(await store.rememberSuccessful(IDENTITY, POLICY), true);
  assert.equal(await store.rememberSuccessful(differentlyCased, POLICY), true);
  assert.equal(await store.hasSuccessful(differentlyCased, POLICY), true);
  assert.equal((await decryptedState(filePath)).entries.length, 1);
});

test('persists only bounded digest evidence and does not expose a cache record', async (t) => {
  const { filePath, store } = await temporaryStore(t);
  const remembered = await store.rememberSuccessful(IDENTITY, POLICY);
  const found = await store.hasSuccessful(IDENTITY, POLICY);
  assert.equal(typeof remembered, 'boolean');
  assert.equal(typeof found, 'boolean');
  assert.equal(Object.prototype.toString.call(remembered), '[object Boolean]');

  const wrapped = await fs.readFile(filePath, 'utf8');
  assert.equal(wrapped.includes(IDENTITY.path), false);
  const state = await decryptedState(filePath);
  assert.deepEqual(Object.keys(state), ['schemaVersion', 'entries']);
  assert.deepEqual(Object.keys(state.entries[0]), ['digest', 'qualifiedAt']);
  assert.match(state.entries[0].digest, /^[a-f0-9]{64}$/);
  assert.equal(state.entries[0].qualifiedAt, '2026-08-02T12:34:56.789Z');
  for (const value of [...Object.values(IDENTITY), POLICY]) {
    assert.equal(JSON.stringify(state).includes(value), false);
  }
});

test('evicts the oldest of eight distinct identities', async (t) => {
  let tick = 0;
  const { filePath, store } = await temporaryStore(t, {
    clock: () => `2026-08-02T12:34:${String(tick++).padStart(2, '0')}.000Z`,
  });
  const identities = Array.from({ length: 9 }, (_, index) => changedIdentity('sha256', String(index).repeat(64)));
  for (const identity of identities) assert.equal(await store.rememberSuccessful(identity, POLICY), true);
  assert.equal(await store.hasSuccessful(identities[0], POLICY), false);
  assert.equal(await store.hasSuccessful(identities[8], POLICY), true);
  assert.equal((await decryptedState(filePath)).entries.length, 8);
});

test('refreshes duplicate evidence recency without growing the bounded list', async (t) => {
  let tick = 0;
  const { filePath, store } = await temporaryStore(t, {
    clock: () => `2026-08-02T12:35:${String(tick++).padStart(2, '0')}.000Z`,
  });
  const identities = Array.from({ length: 9 }, (_, index) => changedIdentity('sha256', String(index).repeat(64)));
  for (const identity of identities.slice(0, 8)) await store.rememberSuccessful(identity, POLICY);
  await store.rememberSuccessful(identities[0], POLICY);
  await store.rememberSuccessful(identities[8], POLICY);
  assert.equal(await store.hasSuccessful(identities[0], POLICY), true);
  assert.equal(await store.hasSuccessful(identities[1], POLICY), false);
  assert.equal((await decryptedState(filePath)).entries.length, 8);
});

test('rejects malformed identities and policies instead of authorizing version-only evidence', async (t) => {
  const { store } = await temporaryStore(t);
  for (const identity of [
    { version: IDENTITY.version },
    { ...IDENTITY, sha256: IDENTITY.sha256.slice(1) },
    { ...IDENTITY, path: 'codex.exe' },
    { ...IDENTITY, volumeSerial: '' },
    { ...IDENTITY, fileId: '' },
    { ...IDENTITY, version: '0.146' },
    { ...IDENTITY, publisher: '' },
    { ...IDENTITY, extra: true },
  ]) {
    assert.equal(await store.hasSuccessful(identity, POLICY), false);
    assert.equal(await store.rememberSuccessful(identity, POLICY), false);
  }
  assert.equal(await store.rememberSuccessful(IDENTITY, ''), false);
  assert.equal(await store.hasSuccessful(IDENTITY, 1), false);
});

test('rejects every publisher other than the exact official Codex publisher', async (t) => {
  const { store } = await temporaryStore(t);
  for (const publisher of [
    'OpenAI',
    'OpenAI OpCo, LLC ',
    'OpenAI OpCo LLC',
    'Other Publisher',
  ]) {
    assert.equal(await store.rememberSuccessful(changedIdentity('publisher', publisher), POLICY), false, publisher);
    assert.equal(await store.hasSuccessful(changedIdentity('publisher', publisher), POLICY), false, publisher);
  }
});

test('fails closed if protected storage becomes unavailable after evidence is initialized', async (t) => {
  let available = true;
  const crypto = availableCrypto({ isAvailable: async () => available });
  const { store } = await temporaryStore(t, { crypto });
  assert.equal(await store.rememberSuccessful(IDENTITY, POLICY), true);
  available = false;
  assert.equal(await store.hasSuccessful(IDENTITY, POLICY), false);
});

test('checks an oversized evidence file before reading it into memory', async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'codex-compatibility.evidence');
  await fs.writeFile(filePath, 'a'.repeat(65537), 'utf8');
  let readCalls = 0;
  const fileSystem = {
    ...fs,
    readFile: async (...args) => {
      readCalls += 1;
      return fs.readFile(...args);
    },
  };
  const store = createCodexCompatibilityStore({ filePath, crypto: availableCrypto(), fileSystem });
  await store.initialize();
  assert.equal(readCalls, 0);
  assert.equal(await store.hasSuccessful(IDENTITY, POLICY), false);
});

test('bounds a raced evidence read through one opened handle and closes it', async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'codex-compatibility.evidence');
  const oversized = Buffer.alloc(MAXIMUM_ENCODED_BYTES + 1, 'a');
  let pathReadCalls = 0;
  let handleStatCalls = 0;
  let requestedLength = null;
  let closeCalls = 0;
  const fileSystem = {
    ...fs,
    stat: async () => ({ size: 4 }),
    readFile: async () => {
      pathReadCalls += 1;
      return oversized.toString('utf8');
    },
    open: async (target, flags) => {
      assert.equal(target, filePath);
      assert.equal(flags, 'r');
      return {
        stat: async () => {
          handleStatCalls += 1;
          return { size: 4 };
        },
        read: async (buffer, offset, length) => {
          requestedLength = length;
          oversized.copy(buffer, offset, 0, length);
          return { bytesRead: length, buffer };
        },
        close: async () => { closeCalls += 1; },
      };
    },
  };
  const store = createCodexCompatibilityStore({ filePath, crypto: availableCrypto(), fileSystem });
  await store.initialize();
  assert.equal(pathReadCalls, 0);
  assert.equal(handleStatCalls, 1);
  assert.equal(requestedLength, MAXIMUM_ENCODED_BYTES + 1);
  assert.equal(closeCalls, 1);
  assert.equal(await store.hasSuccessful(IDENTITY, POLICY), false);
});

test('does not authorize a valid short-read prefix when later bytes race into evidence', async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'codex-compatibility.evidence');
  const digest = cryptoModule.createHash('sha256').update(JSON.stringify({
    policyRevision: POLICY,
    path: IDENTITY.path.toLowerCase(),
    sha256: IDENTITY.sha256,
    volumeSerial: IDENTITY.volumeSerial,
    fileId: IDENTITY.fileId,
    version: IDENTITY.version,
    publisher: IDENTITY.publisher,
  }), 'utf8').digest('hex');
  const validPrefix = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    entries: [{ digest, qualifiedAt: '2026-08-02T12:34:56.789Z' }],
  }), 'utf8').toString('base64');
  assert.equal(Buffer.from(validPrefix, 'base64').toString('base64'), validPrefix);

  const chunks = [Buffer.from(validPrefix, 'utf8'), Buffer.from('X', 'utf8'), Buffer.alloc(0)];
  const readRequests = [];
  let closeCalls = 0;
  const fileSystem = {
    ...fs,
    open: async () => ({
      stat: async () => ({ size: validPrefix.length }),
      read: async (buffer, offset, length, position) => {
        assert.ok(offset >= 0 && length >= 0 && offset + length <= MAXIMUM_ENCODED_BYTES + 1);
        assert.equal(position, offset);
        const chunk = chunks.shift();
        assert.ok(chunk, 'must stop after the zero-byte EOF read');
        assert.ok(chunk.length <= length);
        chunk.copy(buffer, offset);
        readRequests.push({ offset, length, position, bytesRead: chunk.length });
        return { bytesRead: chunk.length, buffer };
      },
      close: async () => { closeCalls += 1; },
    }),
  };

  const store = createCodexCompatibilityStore({ filePath, crypto: availableCrypto(), fileSystem });
  await store.initialize();
  assert.equal(await store.hasSuccessful(IDENTITY, POLICY), false);
  assert.equal(readRequests.length, 3);
  assert.deepEqual(readRequests.map(({ offset, position }) => ({ offset, position })), [
    { offset: 0, position: 0 },
    { offset: validPrefix.length, position: validPrefix.length },
    { offset: validPrefix.length + 1, position: validPrefix.length + 1 },
  ]);
  assert.equal(closeCalls, 1);
});

test('rejects a maximum entry limit above the mandatory cap of eight', () => {
  assert.throws(
    () => createCodexCompatibilityStore({
      filePath: 'C:\\evidence\\codex-compatibility.evidence',
      crypto: availableCrypto(),
      maximumEntries: 9,
    }),
    TypeError,
  );
});

test('ignores corrupt protected evidence instead of authorizing it', async (t) => {
  const cases = [
    ['empty', '', availableCrypto()],
    ['oversized', 'a'.repeat(65537), availableCrypto()],
    ['invalid base64', 'not valid base64!', availableCrypto()],
    ['undecryptable', Buffer.from('ciphertext').toString('base64'), availableCrypto({ decrypt: async () => { throw new Error('bad key'); } })],
    ['invalid JSON', Buffer.from('{bad-json', 'utf8').toString('base64'), availableCrypto()],
    ['wrong schema', Buffer.from(JSON.stringify({ schemaVersion: 2, entries: [] })).toString('base64'), availableCrypto()],
    ['extra keys', Buffer.from(JSON.stringify({ schemaVersion: 1, entries: [], extra: true })).toString('base64'), availableCrypto()],
    ['duplicate digest', Buffer.from(JSON.stringify({ schemaVersion: 1, entries: [
      { digest: 'a'.repeat(64), qualifiedAt: '2026-08-02T12:00:00.000Z' },
      { digest: 'a'.repeat(64), qualifiedAt: '2026-08-02T12:01:00.000Z' },
    ] })).toString('base64'), availableCrypto()],
    ['invalid timestamp', Buffer.from(JSON.stringify({ schemaVersion: 1, entries: [
      { digest: 'a'.repeat(64), qualifiedAt: 'not-a-date' },
    ] })).toString('base64'), availableCrypto()],
  ];
  for (const [name, contents, crypto] of cases) {
    const directory = await temporaryDirectory(t);
    const filePath = path.join(directory, 'codex-compatibility.evidence');
    await fs.writeFile(filePath, contents, 'utf8');
    const store = createCodexCompatibilityStore({ filePath, crypto });
    await store.initialize();
    assert.equal(await store.hasSuccessful(IDENTITY, POLICY), false, name);
  }
});

test('ignores a partial sibling temporary file', async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'codex-compatibility.evidence');
  await fs.writeFile(`${filePath}.tmp`, 'partially-written-plaintext', 'utf8');
  const store = createCodexCompatibilityStore({ filePath, crypto: availableCrypto() });
  await store.initialize();
  assert.equal(await store.hasSuccessful(IDENTITY, POLICY), false);
});

test('fails closed when protected storage is unavailable or encryption fails', async (t) => {
  for (const crypto of [
    availableCrypto({ isAvailable: async () => false }),
    availableCrypto({ encrypt: async () => { throw new Error('encryption failed'); } }),
  ]) {
    const directory = await temporaryDirectory(t);
    const filePath = path.join(directory, 'codex-compatibility.evidence');
    const store = createCodexCompatibilityStore({ filePath, crypto });
    await store.initialize();
    const qualificationSucceededInCaller = true;
    assert.equal(await store.rememberSuccessful(IDENTITY, POLICY), false);
    assert.equal(qualificationSucceededInCaller, true);
    assert.equal(await store.hasSuccessful(IDENTITY, POLICY), false);
    await assert.rejects(fs.access(filePath));
    await assert.rejects(fs.access(`${filePath}.tmp`));
  }
});
