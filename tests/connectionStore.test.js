'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createSafeStorageCrypto } = require('../src/agent/safeStorageCrypto.js');
const { createConnectionStore } = require('../src/agent/connectionStore.js');

async function temporaryStore(t, crypto, randomId = () => 'connection-1') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-store-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createConnectionStore({
    filePath: path.join(directory, 'connections.json'),
    crypto,
    randomId,
  });
  await store.initialize();
  return { directory, filePath: path.join(directory, 'connections.json'), store };
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

function saveInput(overrides = {}) {
  return {
    executorType: 'offline-demo',
    label: 'Offline demo',
    workspacePath: 'Z:\\workspace',
    permissionProfile: 'workspace',
    modelId: 'offline-demo',
    effort: 'low',
    keyHint: null,
    ...overrides,
  };
}

test('wraps Electron async decrypt results and uses the synchronous fallback', async () => {
  const asyncCrypto = createSafeStorageCrypto({
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptStringAsync: async () => ({ result: 'secret', shouldReEncrypt: true }),
  });
  assert.equal(await asyncCrypto.isAvailable(), true);
  assert.deepEqual(await asyncCrypto.decrypt(Buffer.from('ciphertext')), {
    value: 'secret', shouldReEncrypt: true,
  });

  const syncCrypto = createSafeStorageCrypto({
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: () => 'old-secret',
  });
  assert.deepEqual(await syncCrypto.decrypt(Buffer.from('ciphertext')), {
    value: 'old-secret', shouldReEncrypt: false,
  });
});

test('stores encrypted secrets but exposes only the explicit public allowlist', async (t) => {
  const { filePath, store } = await temporaryStore(t, availableCrypto());
  const saved = await store.saveConnection(saveInput({ secret: 'plain-secret' }));
  assert.deepEqual(Object.keys(saved), [
    'id', 'executorType', 'label', 'workspacePath', 'permissionProfile',
    'fullAccessConfirmed', 'modelId', 'effort', 'keyHint', 'hasSecret',
  ]);
  assert.equal(JSON.stringify(saved).includes('plain-secret'), false);
  assert.equal(saved.hasSecret, true);

  const disk = await fs.readFile(filePath, 'utf8');
  assert.equal(disk.includes('plain-secret'), false);
  assert.equal(disk.includes('encrypted:cGxhaW4tc2VjcmV0'), false);
  assert.equal(disk.includes('ZW5jcnlwdGVkOnBsYWluLXNlY3JldA=='), true);
  assert.equal(await store.getSecret(saved.id), 'plain-secret');
  assert.deepEqual(await store.listConnections(), [saved]);
  assert.deepEqual(await store.getConnection(saved.id), saved);
});

test('rejects unknown save properties and never leaks secret-shaped fields publicly', async (t) => {
  const { store } = await temporaryStore(t, availableCrypto());
  for (const key of ['apiKey', 'token', 'internalNote', 'fullAccessConfirmed', 'options', 'hasSecret']) {
    await assert.rejects(
      store.saveConnection(saveInput({ [key]: key === 'options' ? {} : 'not-allowed' })),
      (error) => error.code === 'SECRET_STORE_FAILED',
      key,
    );
  }
  const saved = await store.saveConnection(saveInput({ secret: 'secret' }));
  const publicValue = await store.getConnection(saved.id);
  for (const forbidden of ['apiKey', 'secret', 'token', 'internalNote', 'encryptedKey', 'options']) {
    assert.equal(Object.hasOwn(publicValue, forbidden), false, forbidden);
  }
});

test('persists workspace, permission, and active selection and clears selection on removal', async (t) => {
  const { filePath, store } = await temporaryStore(t, availableCrypto(), () => 'connection-2');
  const saved = await store.saveConnection(saveInput({
    workspacePath: 'Z:\\project', permissionProfile: 'full-computer',
  }));
  await store.setActiveSelection(saved.id);
  const reloaded = createConnectionStore({ filePath, crypto: availableCrypto(), randomId: () => 'unused' });
  await reloaded.initialize();
  assert.equal(await reloaded.getActiveSelection(), saved.id);
  assert.equal((await reloaded.getConnection(saved.id)).workspacePath, 'Z:\\project');
  assert.equal((await reloaded.getConnection(saved.id)).permissionProfile, 'full-computer');
  assert.equal(await reloaded.removeConnection(saved.id), true);
  assert.equal(await reloaded.getActiveSelection(), null);
  assert.equal(await reloaded.getConnection(saved.id), null);
});

test('rotates old safeStorage ciphertext through an atomic rewrite', async (t) => {
  let encryptCalls = 0;
  const crypto = availableCrypto({
    encrypt: async (value) => {
      encryptCalls += 1;
      return Buffer.from(`new:${value}`, 'utf8');
    },
    decrypt: async () => ({ value: 'rotation-secret', shouldReEncrypt: true }),
  });
  const { filePath } = await temporaryStore(t, crypto);
  await fs.writeFile(filePath, JSON.stringify({
    version: 1,
    activeSelection: null,
    connections: [{
      id: 'connection-1', executorType: 'offline-demo', label: 'Demo', workspacePath: 'Z:\\workspace',
      permissionProfile: 'workspace', fullAccessConfirmed: false, modelId: 'offline-demo', effort: 'low',
      keyHint: null, encryptedKey: Buffer.from('old').toString('base64'),
    }],
  }), 'utf8');
  const store = createConnectionStore({ filePath, crypto, randomId: () => 'unused' });
  await store.initialize();
  assert.equal(await store.getSecret('connection-1'), 'rotation-secret');
  assert.equal(encryptCalls, 1);
  const disk = await fs.readFile(filePath, 'utf8');
  assert.equal(disk.includes(Buffer.from('new:rotation-secret').toString('base64')), true);
  await assert.rejects(fs.access(`${filePath}.tmp`));
});

test('returns SECRET_STORE_FAILED for corrupt disk data and decryption failures', async (t) => {
  const { filePath } = await temporaryStore(t, availableCrypto());
  await fs.writeFile(filePath, '{not-json', 'utf8');
  const corrupt = createConnectionStore({ filePath, crypto: availableCrypto(), randomId: () => 'unused' });
  await assert.rejects(corrupt.initialize(), (error) => error.code === 'SECRET_STORE_FAILED');

  const { store } = await temporaryStore(t, availableCrypto({ decrypt: async () => { throw new Error('bad key'); } }));
  const saved = await store.saveConnection(saveInput({ secret: 'secret' }));
  await assert.rejects(store.getSecret(saved.id), (error) => error.code === 'SECRET_STORE_FAILED');
});

test('preserves metadata-only connections when safeStorage is unavailable', async (t) => {
  let encryptionCalls = 0;
  const unavailable = availableCrypto({
    isAvailable: async () => false,
    encrypt: async () => { encryptionCalls += 1; throw new Error('must not encrypt'); },
    decrypt: async () => { encryptionCalls += 1; throw new Error('must not decrypt'); },
  });
  let nextId = 0;
  const { filePath, store } = await temporaryStore(t, unavailable, () => `connection-${++nextId}`);
  const saved = await store.saveConnection(saveInput());
  const cliOnly = await store.saveConnection(saveInput({
    executorType: 'codex-cli', label: 'Codex CLI', modelId: 'gpt-5.6-sol', effort: 'high',
  }));
  assert.equal(saved.hasSecret, false);
  assert.equal(cliOnly.hasSecret, false);
  assert.equal((await store.listConnections()).length, 2);
  assert.equal(encryptionCalls, 0);

  await assert.rejects(store.saveConnection(saveInput({ id: saved.id, secret: 'forbidden' })), (error) => error.code === 'SECRET_STORE_FAILED');
  assert.equal(encryptionCalls, 0);
  assert.equal((await fs.readFile(filePath, 'utf8')).includes('forbidden'), false);
});

test('preserves existing encrypted ciphertext during unavailable metadata writes and blocks secret paths', async (t) => {
  const initialCrypto = availableCrypto();
  const { filePath, store: initial } = await temporaryStore(t, initialCrypto);
  const saved = await initial.saveConnection(saveInput({ secret: 'protected' }));
  const before = JSON.parse(await fs.readFile(filePath, 'utf8')).connections[0].encryptedKey;

  let cryptographyCalls = 0;
  const unavailable = availableCrypto({
    isAvailable: async () => false,
    encrypt: async () => { cryptographyCalls += 1; throw new Error('must not encrypt'); },
    decrypt: async () => { cryptographyCalls += 1; throw new Error('must not decrypt'); },
  });
  const store = createConnectionStore({ filePath, crypto: unavailable, randomId: () => 'unused' });
  await store.initialize();
  await store.saveConnection(saveInput({ id: saved.id, label: 'Renamed demo' }));
  const after = JSON.parse(await fs.readFile(filePath, 'utf8')).connections[0].encryptedKey;
  assert.equal(after, before);
  assert.equal(cryptographyCalls, 0);
  await assert.rejects(store.getSecret(saved.id), (error) => error.code === 'SECRET_STORE_FAILED');
  await assert.rejects(store.saveConnection(saveInput({ id: saved.id, secret: 'replacement' })), (error) => error.code === 'SECRET_STORE_FAILED');
  for (const secret of [null, '']) {
    await assert.rejects(store.saveConnection(saveInput({ id: saved.id, secret })), (error) => error.code === 'SECRET_STORE_FAILED');
    const unchanged = JSON.parse(await fs.readFile(filePath, 'utf8')).connections[0].encryptedKey;
    assert.equal(unchanged, before);
  }
  assert.equal(cryptographyCalls, 0);
});
