'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createSafeStorageCrypto } = require('../src/agent/safeStorageCrypto.js');
const {
  DISK_KEYS,
  PUBLIC_KEYS,
  STORE_VERSION,
  createConnectionStore,
} = require('../src/agent/connectionStore.js');

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-store-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function temporaryStore(t, crypto, randomId = () => 'connection-1', overrides = {}) {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'connections.json');
  const store = createConnectionStore({ filePath, crypto, randomId, ...overrides });
  await store.initialize();
  return { directory, filePath, store };
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

function workspaceInput(overrides = {}) {
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

function fullComputerInput(overrides = {}) {
  return {
    executorType: 'codex-cli',
    label: 'Codex Full Computer',
    workspacePath: 'Z:\\project',
    permissionProfile: 'full-computer',
    modelId: 'gpt-5.6-terra',
    effort: 'medium',
    keyHint: null,
    ...overrides,
  };
}

async function readDisk(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
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

test('publishes v2 key allowlists that hide revision and confirmation from renderers', () => {
  assert.equal(STORE_VERSION, 2);
  assert.deepEqual(PUBLIC_KEYS, [
    'id', 'executorType', 'label', 'workspacePath', 'permissionProfile',
    'modelId', 'effort', 'keyHint', 'hasSecret',
  ]);
  assert.deepEqual(DISK_KEYS, [
    'id', 'revision', 'executorType', 'label', 'workspacePath',
    'permissionProfile', 'fullAccessConfirmed', 'modelId', 'effort',
    'keyHint', 'encryptedKey',
  ]);
  assert.equal(PUBLIC_KEYS.includes('revision'), false);
  assert.equal(PUBLIC_KEYS.includes('fullAccessConfirmed'), false);
});

test('stores encrypted secrets but exposes only the explicit public allowlist', async (t) => {
  const { filePath, store } = await temporaryStore(t, availableCrypto());
  const saved = await store.saveWorkspaceConnection(workspaceInput({ secret: 'plain-secret' }));
  assert.deepEqual(Object.keys(saved), [...PUBLIC_KEYS]);
  assert.equal(JSON.stringify(saved).includes('plain-secret'), false);
  assert.equal(saved.hasSecret, true);

  const disk = await fs.readFile(filePath, 'utf8');
  assert.equal(disk.includes('plain-secret'), false);
  assert.equal(disk.includes('ZW5jcnlwdGVkOnBsYWluLXNlY3JldA=='), true);
  assert.equal(await store.getSecret(saved.id), 'plain-secret');
  assert.deepEqual(await store.listConnections(), [saved]);
  assert.deepEqual(await store.getConnection(saved.id), saved);
});

test('exposes revision and confirmation only through the main-only run accessor', async (t) => {
  const { store } = await temporaryStore(t, availableCrypto());
  const saved = await store.saveWorkspaceConnection(workspaceInput());
  const runConnection = await store.getRunConnection(saved.id);
  assert.deepEqual(Object.keys(runConnection).sort(), [
    'effort', 'executorType', 'fullAccessConfirmed', 'hasSecret', 'id', 'keyHint',
    'label', 'modelId', 'permissionProfile', 'revision', 'workspacePath',
  ]);
  assert.equal(runConnection.revision, 1);
  assert.equal(runConnection.fullAccessConfirmed, false);
  assert.equal(await store.getRunConnection('missing'), null);
  assert.equal(await store.getRunConnection(null), null);

  for (const publicValue of [await store.getConnection(saved.id), ...(await store.listConnections())]) {
    assert.equal(Object.hasOwn(publicValue, 'revision'), false);
    assert.equal(Object.hasOwn(publicValue, 'fullAccessConfirmed'), false);
  }
});

test('migrates a v1 file to v2 without upgrading any stored permission profile', async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'connections.json');
  await fs.writeFile(filePath, JSON.stringify({
    version: 1,
    activeSelection: 'legacy-workspace',
    connections: [
      {
        id: 'legacy-workspace', executorType: 'codex-cli', label: 'Legacy workspace',
        workspacePath: 'Z:\\legacy', permissionProfile: 'workspace', fullAccessConfirmed: false,
        modelId: 'gpt-5.6-terra', effort: 'medium', keyHint: null,
      },
      {
        id: 'legacy-full', executorType: 'claude-code-cli', label: 'Legacy full',
        workspacePath: 'Z:\\legacy-full', permissionProfile: 'full-computer', fullAccessConfirmed: true,
        modelId: 'sonnet', effort: 'high', keyHint: null,
      },
    ],
  }), 'utf8');

  const store = createConnectionStore({ filePath, crypto: availableCrypto(), randomId: () => 'unused' });
  await store.initialize();

  const workspaceConnection = await store.getRunConnection('legacy-workspace');
  assert.equal(workspaceConnection.permissionProfile, 'workspace');
  assert.equal(workspaceConnection.fullAccessConfirmed, false);
  assert.equal(workspaceConnection.revision, 1);

  const fullConnection = await store.getRunConnection('legacy-full');
  assert.equal(fullConnection.permissionProfile, 'full-computer');
  assert.equal(fullConnection.fullAccessConfirmed, true);
  assert.equal(fullConnection.revision, 1);
  assert.equal(await store.getActiveSelection(), 'legacy-workspace');

  await store.setActiveSelection('legacy-full');
  const disk = await readDisk(filePath);
  assert.equal(disk.version, 2);
  assert.deepEqual(disk.connections.map((connection) => connection.permissionProfile), ['workspace', 'full-computer']);
  assert.deepEqual(disk.connections.map((connection) => connection.fullAccessConfirmed), [false, true]);
});

test('increments a monotonic revision on every mutation of that connection', async (t) => {
  const { store } = await temporaryStore(t, availableCrypto());
  const saved = await store.saveWorkspaceConnection(workspaceInput());
  assert.equal((await store.getRunConnection(saved.id)).revision, 1);
  await store.saveWorkspaceConnection(workspaceInput({ id: saved.id, label: 'Renamed' }));
  assert.equal((await store.getRunConnection(saved.id)).revision, 2);
  await store.saveWorkspaceConnection(workspaceInput({
    id: saved.id, label: 'Renamed', workspacePath: 'Z:\\other',
  }));
  const third = await store.getRunConnection(saved.id);
  assert.equal(third.revision, 3);
  assert.equal(third.workspacePath, 'Z:\\other');
  assert.equal(third.label, 'Renamed');
});

test('serializes concurrent saves so every mutation commits exactly once', async (t) => {
  let nextId = 0;
  const { filePath, store } = await temporaryStore(t, availableCrypto(), () => `connection-${++nextId}`);
  const first = await store.saveWorkspaceConnection(workspaceInput({ label: 'first' }));

  const results = await Promise.all([
    store.saveWorkspaceConnection(workspaceInput({ id: first.id, label: 'a' })),
    store.saveWorkspaceConnection(workspaceInput({ id: first.id, label: 'b' })),
    store.saveWorkspaceConnection(workspaceInput({ label: 'new-one' })),
  ]);

  assert.equal(results.length, 3);
  const disk = await readDisk(filePath);
  assert.equal(disk.connections.length, 2);
  const updated = disk.connections.find((connection) => connection.id === first.id);
  assert.equal(updated.revision, 3);
  assert.equal(['a', 'b'].includes(updated.label), true);
  assert.equal(new Set(disk.connections.map((connection) => connection.id)).size, 2);
});

test('leaves in-memory and on-disk state intact when the atomic replacement fails', async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'connections.json');
  let failRename = false;
  const fileSystem = {
    ...fs,
    rename: async (from, to) => {
      if (failRename) throw Object.assign(new Error('rename refused'), { code: 'EPERM' });
      return fs.rename(from, to);
    },
  };
  const store = createConnectionStore({
    filePath, crypto: availableCrypto(), randomId: () => 'connection-1', fileSystem,
  });
  await store.initialize();
  const saved = await store.saveWorkspaceConnection(workspaceInput({ label: 'durable' }));
  const before = await readDisk(filePath);

  failRename = true;
  await assert.rejects(
    store.saveWorkspaceConnection(workspaceInput({ id: saved.id, label: 'lost' })),
    (error) => error.code === 'SECRET_STORE_FAILED',
  );

  assert.deepEqual(await readDisk(filePath), before);
  assert.equal((await store.getConnection(saved.id)).label, 'durable');
  assert.equal((await store.getRunConnection(saved.id)).revision, 1);
  await assert.rejects(fs.access(`${filePath}.tmp`));

  failRename = false;
  await store.saveWorkspaceConnection(workspaceInput({ id: saved.id, label: 'recovered' }));
  assert.equal((await store.getConnection(saved.id)).label, 'recovered');
  assert.equal((await store.getRunConnection(saved.id)).revision, 2);
});

test('reserves unique connection identifiers that no other save may claim', async (t) => {
  const identifiers = ['collides', 'collides', 'fresh-id'];
  let index = 0;
  const { store } = await temporaryStore(t, availableCrypto(), () => identifiers[index++]);
  const existing = await store.saveWorkspaceConnection(workspaceInput());
  assert.equal(existing.id, 'collides');

  const reserved = await store.reserveConnectionId();
  assert.equal(typeof reserved, 'string');
  assert.equal(reserved.length > 0, true);
  assert.notEqual(reserved, existing.id);
  assert.equal(await store.getConnection(reserved), null);
  assert.equal((await store.listConnections()).length, 1);
});

test('commits a reserved Full Computer identity and its confirmation atomically', async (t) => {
  const { filePath, store } = await temporaryStore(t, availableCrypto(), () => 'reserved-1');
  const reserved = await store.reserveConnectionId();
  const saved = await store.saveAuthorizedConnection(fullComputerInput(), { reservedId: reserved });

  assert.equal(saved.id, reserved);
  assert.equal(saved.permissionProfile, 'full-computer');
  assert.equal(Object.hasOwn(saved, 'fullAccessConfirmed'), false);
  const runConnection = await store.getRunConnection(reserved);
  assert.equal(runConnection.fullAccessConfirmed, true);
  assert.equal(runConnection.revision, 1);
  const disk = await readDisk(filePath);
  assert.equal(disk.version, 2);
  assert.equal(disk.connections[0].fullAccessConfirmed, true);

  await assert.rejects(
    store.saveAuthorizedConnection(fullComputerInput(), { reservedId: reserved }),
    (error) => error.code === 'SECRET_STORE_FAILED',
  );
});

test('rejects an authorized commit whose expected revision no longer matches', async (t) => {
  const { store } = await temporaryStore(t, availableCrypto(), () => 'connection-1');
  const saved = await store.saveWorkspaceConnection(workspaceInput({ executorType: 'codex-cli', modelId: 'gpt-5.6-terra', effort: 'medium' }));
  assert.equal((await store.getRunConnection(saved.id)).revision, 1);

  await store.saveWorkspaceConnection(workspaceInput({ id: saved.id, executorType: 'codex-cli', modelId: 'gpt-5.6-terra', effort: 'medium', label: 'edited' }));

  await assert.rejects(
    store.saveAuthorizedConnection(fullComputerInput({ id: saved.id }), { expectedRevision: 1 }),
    (error) => error.code === 'SECRET_STORE_FAILED',
  );
  assert.equal((await store.getRunConnection(saved.id)).fullAccessConfirmed, false);
  assert.equal((await store.getRunConnection(saved.id)).permissionProfile, 'workspace');

  const authorized = await store.saveAuthorizedConnection(fullComputerInput({ id: saved.id }), { expectedRevision: 2 });
  assert.equal(authorized.permissionProfile, 'full-computer');
  assert.equal((await store.getRunConnection(saved.id)).fullAccessConfirmed, true);
  assert.equal((await store.getRunConnection(saved.id)).revision, 3);
});

test('rejects an authorized commit for a connection deleted while the warning was open', async (t) => {
  const { store } = await temporaryStore(t, availableCrypto(), () => 'connection-1');
  const saved = await store.saveWorkspaceConnection(workspaceInput({ executorType: 'codex-cli', modelId: 'gpt-5.6-terra', effort: 'medium' }));
  assert.equal(await store.removeConnection(saved.id), true);
  await assert.rejects(
    store.saveAuthorizedConnection(fullComputerInput({ id: saved.id }), { expectedRevision: 1 }),
    (error) => error.code === 'SECRET_STORE_FAILED',
  );
  assert.equal((await store.listConnections()).length, 0);
});

test('keeps Workspace saves incapable of granting Full Computer authorization', async (t) => {
  const { store } = await temporaryStore(t, availableCrypto(), () => 'connection-1');
  await assert.rejects(
    store.saveWorkspaceConnection(workspaceInput({ permissionProfile: 'full-computer' })),
    (error) => error.code === 'SECRET_STORE_FAILED',
  );
  const reserved = await store.reserveConnectionId();
  await assert.rejects(
    store.saveAuthorizedConnection(workspaceInput(), { reservedId: reserved }),
    (error) => error.code === 'SECRET_STORE_FAILED',
  );
  assert.deepEqual(await store.listConnections(), []);
});

test('preserves an existing acknowledgement across a Workspace round trip', async (t) => {
  const { store } = await temporaryStore(t, availableCrypto(), () => 'connection-1');
  const reserved = await store.reserveConnectionId();
  const saved = await store.saveAuthorizedConnection(fullComputerInput(), { reservedId: reserved });
  assert.equal((await store.getRunConnection(saved.id)).fullAccessConfirmed, true);

  await store.saveWorkspaceConnection(workspaceInput({
    id: saved.id, executorType: 'codex-cli', modelId: 'gpt-5.6-terra', effort: 'medium',
  }));
  const afterWorkspace = await store.getRunConnection(saved.id);
  assert.equal(afterWorkspace.permissionProfile, 'workspace');
  assert.equal(afterWorkspace.fullAccessConfirmed, true);

  assert.equal(await store.removeConnection(saved.id), true);
  const recreated = await store.saveWorkspaceConnection(workspaceInput({
    executorType: 'codex-cli', modelId: 'gpt-5.6-terra', effort: 'medium',
  }));
  assert.equal((await store.getRunConnection(recreated.id)).fullAccessConfirmed, false);
});

test('rejects unknown save properties and never leaks secret-shaped fields publicly', async (t) => {
  const { store } = await temporaryStore(t, availableCrypto());
  for (const key of ['apiKey', 'token', 'internalNote', 'fullAccessConfirmed', 'revision', 'options', 'hasSecret']) {
    await assert.rejects(
      store.saveWorkspaceConnection(workspaceInput({ [key]: key === 'options' ? {} : 'not-allowed' })),
      (error) => error.code === 'SECRET_STORE_FAILED',
      key,
    );
  }
  const reserved = await store.reserveConnectionId();
  for (const key of ['fullAccessConfirmed', 'revision', 'nonce']) {
    await assert.rejects(
      store.saveAuthorizedConnection(fullComputerInput({ [key]: 'not-allowed' }), { reservedId: reserved }),
      (error) => error.code === 'SECRET_STORE_FAILED',
      key,
    );
  }
  await store.releaseReservedConnectionId(reserved);
  const saved = await store.saveWorkspaceConnection(workspaceInput({ secret: 'secret' }));
  const publicValue = await store.getConnection(saved.id);
  for (const forbidden of ['apiKey', 'secret', 'token', 'internalNote', 'encryptedKey', 'options', 'revision', 'fullAccessConfirmed']) {
    assert.equal(Object.hasOwn(publicValue, forbidden), false, forbidden);
  }
});

test('persists workspace, permission, and active selection and clears selection on removal', async (t) => {
  const { filePath, store } = await temporaryStore(t, availableCrypto(), () => 'connection-2');
  const reserved = await store.reserveConnectionId();
  const saved = await store.saveAuthorizedConnection(
    fullComputerInput({ workspacePath: 'Z:\\project' }), { reservedId: reserved },
  );
  await store.setActiveSelection(saved.id);
  const reloaded = createConnectionStore({ filePath, crypto: availableCrypto(), randomId: () => 'unused' });
  await reloaded.initialize();
  assert.equal(await reloaded.getActiveSelection(), saved.id);
  assert.equal((await reloaded.getConnection(saved.id)).workspacePath, 'Z:\\project');
  assert.equal((await reloaded.getConnection(saved.id)).permissionProfile, 'full-computer');
  assert.equal((await reloaded.getRunConnection(saved.id)).fullAccessConfirmed, true);
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
    version: 2,
    activeSelection: null,
    connections: [{
      id: 'connection-1', revision: 1, executorType: 'offline-demo', label: 'Demo',
      workspacePath: 'Z:\\workspace', permissionProfile: 'workspace', fullAccessConfirmed: false,
      modelId: 'offline-demo', effort: 'low', keyHint: null,
      encryptedKey: Buffer.from('old').toString('base64'),
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
  const saved = await store.saveWorkspaceConnection(workspaceInput({ secret: 'secret' }));
  await assert.rejects(store.getSecret(saved.id), (error) => error.code === 'SECRET_STORE_FAILED');
});

test('rejects an unknown store version rather than guessing a migration', async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'connections.json');
  await fs.writeFile(filePath, JSON.stringify({ version: 3, activeSelection: null, connections: [] }), 'utf8');
  const store = createConnectionStore({ filePath, crypto: availableCrypto(), randomId: () => 'unused' });
  await assert.rejects(store.initialize(), (error) => error.code === 'SECRET_STORE_FAILED');
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
  const saved = await store.saveWorkspaceConnection(workspaceInput());
  const cliOnly = await store.saveWorkspaceConnection(workspaceInput({
    executorType: 'codex-cli', label: 'Codex CLI', modelId: 'gpt-5.6-sol', effort: 'high',
  }));
  assert.equal(saved.hasSecret, false);
  assert.equal(cliOnly.hasSecret, false);
  assert.equal((await store.listConnections()).length, 2);
  assert.equal(encryptionCalls, 0);

  await assert.rejects(store.saveWorkspaceConnection(workspaceInput({ id: saved.id, secret: 'forbidden' })), (error) => error.code === 'SECRET_STORE_FAILED');
  assert.equal(encryptionCalls, 0);
  assert.equal((await fs.readFile(filePath, 'utf8')).includes('forbidden'), false);
});

test('preserves existing encrypted ciphertext during unavailable metadata writes and blocks secret paths', async (t) => {
  const initialCrypto = availableCrypto();
  const { filePath, store: initial } = await temporaryStore(t, initialCrypto);
  const saved = await initial.saveWorkspaceConnection(workspaceInput({ secret: 'protected' }));
  const before = (await readDisk(filePath)).connections[0].encryptedKey;

  let cryptographyCalls = 0;
  const unavailable = availableCrypto({
    isAvailable: async () => false,
    encrypt: async () => { cryptographyCalls += 1; throw new Error('must not encrypt'); },
    decrypt: async () => { cryptographyCalls += 1; throw new Error('must not decrypt'); },
  });
  const store = createConnectionStore({ filePath, crypto: unavailable, randomId: () => 'unused' });
  await store.initialize();
  await store.saveWorkspaceConnection(workspaceInput({ id: saved.id, label: 'Renamed demo' }));
  const after = (await readDisk(filePath)).connections[0].encryptedKey;
  assert.equal(after, before);
  assert.equal(cryptographyCalls, 0);
  await assert.rejects(store.getSecret(saved.id), (error) => error.code === 'SECRET_STORE_FAILED');
  await assert.rejects(store.saveWorkspaceConnection(workspaceInput({ id: saved.id, secret: 'replacement' })), (error) => error.code === 'SECRET_STORE_FAILED');
  for (const secret of [null, '']) {
    await assert.rejects(store.saveWorkspaceConnection(workspaceInput({ id: saved.id, secret })), (error) => error.code === 'SECRET_STORE_FAILED');
    const unchanged = (await readDisk(filePath)).connections[0].encryptedKey;
    assert.equal(unchanged, before);
  }
  assert.equal(cryptographyCalls, 0);
});
