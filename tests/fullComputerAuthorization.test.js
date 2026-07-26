'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createConnectionStore } = require('../src/agent/connectionStore.js');
const { createFullComputerAuthorization } = require('../src/agent/fullComputerAuthorization.js');
const {
  FULL_COMPUTER,
  WORKSPACE,
  defaultPermissionProfile,
  executorKey,
  permissionBadge,
} = require('../src/agent/executionModes.js');

const CANCEL = 0;
const ENABLE = 1;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function availableCrypto() {
  return {
    isAvailable: async () => true,
    encrypt: async (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decrypt: async (buffer) => ({
      value: Buffer.from(buffer).toString('utf8').replace(/^encrypted:/, ''),
      shouldReEncrypt: false,
    }),
  };
}

async function harness(t, { showMessageBox } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-authorization-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'connections.json');
  let nextId = 0;
  const store = createConnectionStore({
    filePath,
    crypto: availableCrypto(),
    randomId: () => `connection-${++nextId}`,
  });
  await store.initialize();
  const dialogs = [];
  const nonces = [];
  let nonceCounter = 0;
  const authorization = createFullComputerAuthorization({
    store,
    showMessageBox: showMessageBox || (async (window, options) => {
      dialogs.push({ window, options });
      return { response: ENABLE };
    }),
    randomBytes: (size) => {
      assert.equal(size, 32);
      nonceCounter += 1;
      const value = Buffer.alloc(32, nonceCounter);
      nonces.push(value.toString('base64url'));
      return value;
    },
  });
  return { authorization, dialogs, filePath, nonces, store };
}

function codexDraft(overrides = {}) {
  return {
    executorType: 'codex-cli',
    label: 'Codex',
    workspacePath: 'Z:\\project',
    permissionProfile: FULL_COMPUTER,
    modelId: 'gpt-5.6-terra',
    effort: 'medium',
    keyHint: null,
    ...overrides,
  };
}

function offlineDraft(overrides = {}) {
  return {
    executorType: 'offline-demo',
    label: 'Offline Demo',
    workspacePath: 'Z:\\project',
    permissionProfile: WORKSPACE,
    modelId: 'offline-demo',
    effort: null,
    keyHint: null,
    ...overrides,
  };
}

test('defaults new real-provider drafts to Full Computer and keeps Offline Demo Workspace-only', () => {
  assert.equal(WORKSPACE, 'workspace');
  assert.equal(FULL_COMPUTER, 'full-computer');
  assert.equal(defaultPermissionProfile('codex-cli'), FULL_COMPUTER);
  assert.equal(defaultPermissionProfile('claude-code-cli'), FULL_COMPUTER);
  assert.equal(defaultPermissionProfile('offline-demo'), WORKSPACE);
  assert.throws(() => defaultPermissionProfile('unknown'), (error) => error.code === 'UNSUPPORTED_OPTION');

  assert.equal(executorKey('codex-cli', FULL_COMPUTER), 'codex-cli:full-computer');
  assert.equal(executorKey('offline-demo', WORKSPACE), 'offline-demo:workspace');
  for (const invalid of [null, undefined, '', 'full computer', { mode: 'workspace' }, 'FULL-COMPUTER']) {
    assert.throws(() => executorKey('codex-cli', invalid), (error) => error.code === 'UNSUPPORTED_OPTION');
    assert.throws(() => executorKey(invalid, WORKSPACE), (error) => error.code === 'UNSUPPORTED_OPTION');
  }

  assert.equal(permissionBadge(FULL_COMPUTER), 'FULL COMPUTER - broad PC access');
  assert.equal(permissionBadge(WORKSPACE), 'WORKSPACE - selected project only');
});

test('shows the exact main-owned native warning bound to the settings window', async (t) => {
  const { authorization, dialogs } = await harness(t);
  const settingsWindow = { id: 'settings' };
  await authorization.save(settingsWindow, codexDraft());
  assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0].window, settingsWindow);
  assert.deepEqual(dialogs[0].options, {
    type: 'warning',
    buttons: ['Cancel', 'Enable Full Computer'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Enable Full Computer?',
    message: 'This agent can access your whole computer.',
    detail: 'It may read, change, or delete files outside the selected workspace, run programs, and use the network. This is not Workspace mode. Enable it only for goals and connections you trust.',
  });
});

test('saves a Workspace draft without any native warning', async (t) => {
  const { authorization, dialogs, store } = await harness(t);
  const saved = await authorization.save({}, offlineDraft());
  assert.equal(dialogs.length, 0);
  assert.equal(saved.permissionProfile, WORKSPACE);
  assert.equal(Object.hasOwn(saved, 'fullAccessConfirmed'), false);
  assert.equal(Object.hasOwn(saved, 'revision'), false);
  assert.equal(await store.getActiveSelection(), saved.id);
  assert.equal((await store.getRunConnection(saved.id)).fullAccessConfirmed, false);
});

test('rejects Full Computer for Offline Demo before showing any warning', async (t) => {
  const { authorization, dialogs, store } = await harness(t);
  await assert.rejects(
    authorization.save({}, offlineDraft({ permissionProfile: FULL_COMPUTER })),
    (error) => error.code === 'UNSUPPORTED_OPTION',
  );
  assert.equal(dialogs.length, 0);
  assert.deepEqual(await store.listConnections(), []);
});

test('cancel consumes the reservation and persists or selects nothing', async (t) => {
  const { authorization, store } = await harness(t, {
    showMessageBox: async () => ({ response: CANCEL }),
  });
  await assert.rejects(
    authorization.save({}, codexDraft()),
    (error) => error.code === 'FULL_COMPUTER_CONFIRMATION_CANCELLED',
  );
  assert.deepEqual(await store.listConnections(), []);
  assert.equal(await store.getActiveSelection(), null);
  assert.equal(authorization.isPending(), false);
});

test('accept saves exactly one reserved identity and its confirmation together', async (t) => {
  const { authorization, dialogs, store } = await harness(t);
  const saved = await authorization.save({}, codexDraft());
  assert.equal(dialogs.length, 1);
  const connections = await store.listConnections();
  assert.equal(connections.length, 1);
  assert.equal(connections[0].id, saved.id);
  assert.equal(saved.permissionProfile, FULL_COMPUTER);
  assert.equal(await store.getActiveSelection(), saved.id);
  const runConnection = await store.getRunConnection(saved.id);
  assert.equal(runConnection.fullAccessConfirmed, true);
  assert.equal(runConnection.revision, 1);
  assert.equal(JSON.stringify(saved).includes('nonce'), false);
});

test('never returns or transmits the one-use authorization nonce', async (t) => {
  const { authorization, dialogs, filePath, nonces, store } = await harness(t);
  const saved = await authorization.save({}, codexDraft());
  assert.equal(nonces.length, 1);
  const serialized = JSON.stringify({
    saved,
    dialogs,
    connections: await store.listConnections(),
    runConnection: await store.getRunConnection(saved.id),
  });
  assert.equal(serialized.includes(nonces[0]), false);
  assert.equal((await fs.readFile(filePath, 'utf8')).includes(nonces[0]), false);
});

test('refuses a second concurrent dialog while one warning is already pending', async (t) => {
  const gate = deferred();
  let dialogCount = 0;
  const { authorization, store } = await harness(t, {
    showMessageBox: async () => {
      dialogCount += 1;
      await gate.promise;
      return { response: ENABLE };
    },
  });
  const first = authorization.save({}, codexDraft());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(authorization.isPending(), true);

  await assert.rejects(
    authorization.save({}, codexDraft({ label: 'second' })),
    (error) => error.code === 'FULL_COMPUTER_CONFIRMATION_REQUIRED',
  );
  assert.equal(dialogCount, 1);

  gate.resolve();
  await first;
  assert.equal(authorization.isPending(), false);
  assert.equal((await store.listConnections()).length, 1);
});

test('fails closed when the connection is removed while its warning is open', async (t) => {
  const gate = deferred();
  const { authorization, store } = await harness(t, {
    showMessageBox: async () => { await gate.promise; return { response: ENABLE }; },
  });
  const existing = await authorization.save({}, codexDraft({ permissionProfile: WORKSPACE }));
  const pending = authorization.save({}, codexDraft({ id: existing.id }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(await store.removeConnection(existing.id), true);
  gate.resolve();
  await assert.rejects(pending, (error) => error.code === 'FULL_COMPUTER_CONFIRMATION_REQUIRED');
  assert.deepEqual(await store.listConnections(), []);
});

test('fails closed when the connection is edited while its warning is open', async (t) => {
  const gate = deferred();
  const { authorization, store } = await harness(t, {
    showMessageBox: async () => { await gate.promise; return { response: ENABLE }; },
  });
  const existing = await authorization.save({}, codexDraft({ permissionProfile: WORKSPACE }));
  const pending = authorization.save({}, codexDraft({ id: existing.id }));
  await new Promise((resolve) => setImmediate(resolve));

  await store.saveWorkspaceConnection({
    id: existing.id, executorType: 'codex-cli', label: 'edited elsewhere',
    workspacePath: 'Z:\\project', permissionProfile: WORKSPACE,
    modelId: 'gpt-5.6-terra', effort: 'medium', keyHint: null,
  });
  gate.resolve();
  await assert.rejects(pending, (error) => error.code === 'FULL_COMPUTER_CONFIRMATION_REQUIRED');
  const runConnection = await store.getRunConnection(existing.id);
  assert.equal(runConnection.fullAccessConfirmed, false);
  assert.equal(runConnection.permissionProfile, WORKSPACE);
});

test('an acknowledged identity switches away and back without a second warning', async (t) => {
  const { authorization, dialogs, store } = await harness(t);
  const saved = await authorization.save({}, codexDraft());
  assert.equal(dialogs.length, 1);

  const asWorkspace = await authorization.save({}, codexDraft({ id: saved.id, permissionProfile: WORKSPACE }));
  assert.equal(asWorkspace.permissionProfile, WORKSPACE);
  assert.equal(dialogs.length, 1);
  assert.equal((await store.getRunConnection(saved.id)).fullAccessConfirmed, true);

  const backToFull = await authorization.save({}, codexDraft({ id: saved.id, label: 'renamed' }));
  assert.equal(backToFull.permissionProfile, FULL_COMPUTER);
  assert.equal(backToFull.label, 'renamed');
  assert.equal(dialogs.length, 1, 'no second warning for an acknowledged identity');
  assert.equal((await store.getRunConnection(saved.id)).fullAccessConfirmed, true);
});

test('changing an acknowledged Full Computer connection executor requires a fresh warning', async (t) => {
  const { authorization, dialogs, store } = await harness(t);
  const saved = await authorization.save({}, codexDraft());
  assert.equal(dialogs.length, 1);

  const changed = await authorization.save({}, codexDraft({
    id: saved.id,
    executorType: 'claude-code-cli',
    label: 'Claude',
    modelId: 'sonnet',
    effort: 'high',
  }));

  assert.equal(dialogs.length, 2, 'a different native executor needs its own warning');
  assert.equal(changed.executorType, 'claude-code-cli');
  assert.equal((await store.getRunConnection(saved.id)).fullAccessConfirmed, true);
});

test('changing executor in Workspace clears acknowledgement so returning to Full Computer warns', async (t) => {
  const { authorization, dialogs, store } = await harness(t);
  const saved = await authorization.save({}, codexDraft());
  assert.equal(dialogs.length, 1);

  await authorization.save({}, codexDraft({
    id: saved.id,
    executorType: 'claude-code-cli',
    label: 'Claude Workspace',
    permissionProfile: WORKSPACE,
    modelId: 'sonnet',
    effort: 'high',
  }));
  assert.equal((await store.getRunConnection(saved.id)).fullAccessConfirmed, false);

  await authorization.save({}, codexDraft({
    id: saved.id,
    executorType: 'claude-code-cli',
    label: 'Claude Full Computer',
    modelId: 'sonnet',
    effort: 'high',
  }));
  assert.equal(dialogs.length, 2, 'returning under the changed executor needs a new warning');
});

test('delete then recreate requires a new warning', async (t) => {
  const { authorization, dialogs, store } = await harness(t);
  const saved = await authorization.save({}, codexDraft());
  assert.equal(dialogs.length, 1);
  assert.equal(await store.removeConnection(saved.id), true);

  const recreated = await authorization.save({}, codexDraft());
  assert.equal(dialogs.length, 2);
  assert.notEqual(recreated.id, saved.id);
  assert.equal((await store.getRunConnection(recreated.id)).fullAccessConfirmed, true);
});

test('rejects renderer-supplied confirmation, revision, and nonce fields before any dialog', async (t) => {
  const { authorization, dialogs, store } = await harness(t);
  const rejected = [
    codexDraft({ fullAccessConfirmed: true }),
    codexDraft({ revision: 7 }),
    codexDraft({ nonce: 'forged' }),
    codexDraft({ confirmation: { accepted: true } }),
    codexDraft({ reservedId: 'forged' }),
    codexDraft({ expectedRevision: 1 }),
  ];
  for (const draft of rejected) {
    await assert.rejects(
      authorization.save({}, draft),
      (error) => error.code === 'UNSUPPORTED_OPTION',
      Object.keys(draft).join(','),
    );
  }
  assert.equal(dialogs.length, 0);
  assert.deepEqual(await store.listConnections(), []);
});

test('rejects an unknown permission profile without reserving or warning', async (t) => {
  const { authorization, dialogs, store } = await harness(t);
  for (const permissionProfile of ['FULL-COMPUTER', 'danger-full-access', '', null]) {
    await assert.rejects(
      authorization.save({}, codexDraft({ permissionProfile })),
      (error) => error.code === 'UNSUPPORTED_OPTION',
    );
  }
  assert.equal(dialogs.length, 0);
  assert.deepEqual(await store.listConnections(), []);
});

test('a rejected dialog leaves the previous profile and confirmation untouched', async (t) => {
  const { authorization, store } = await harness(t, {
    showMessageBox: async () => ({ response: CANCEL }),
  });
  const existing = await authorization.save({}, codexDraft({ permissionProfile: WORKSPACE }));
  await assert.rejects(
    authorization.save({}, codexDraft({ id: existing.id })),
    (error) => error.code === 'FULL_COMPUTER_CONFIRMATION_CANCELLED',
  );
  const runConnection = await store.getRunConnection(existing.id);
  assert.equal(runConnection.permissionProfile, WORKSPACE);
  assert.equal(runConnection.fullAccessConfirmed, false);
  assert.equal(runConnection.revision, 1);
});
