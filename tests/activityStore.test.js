'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeActivityValue,
} = require('../src/agent/activitySanitizer.js');
const {
  validateActivityEvent,
} = require('../src/agent/activitySchema.js');
const { createActivityStore } = require('../src/agent/activityStore.js');

const variants = [
  { phase: 'run', kind: 'status', summary: 'Working' },
  { phase: 'run', kind: 'tool', summary: 'Using tool', toolName: 'search' },
  { phase: 'run', kind: 'file', summary: 'Editing', path: 'src/main.js', operation: 'modify' },
  { phase: 'run', kind: 'command', summary: 'Testing', command: 'npm.cmd test', exitCode: 0 },
  { phase: 'run', kind: 'network', summary: 'Connecting', destination: 'https://example.com:8443' },
  { phase: 'run', kind: 'permission', summary: 'Checking', permission: 'workspace', decision: 'allowed' },
  { phase: 'run', kind: 'usage', summary: 'Tokens', usage: {
    inputTokens: 2, outputTokens: 3, cachedTokens: 1, totalTokens: 6,
  } },
  { phase: 'run', kind: 'message', summary: 'Complete', detail: 'Done', status: 'ok' },
];

test('validates every exact activity variant', () => {
  for (const value of variants) {
    assert.deepEqual(validateActivityEvent(value), value);
  }
});

test('rejects unknown fields and invalid discriminants', () => {
  assert.throws(
    () => validateActivityEvent({ ...variants[0], secretExtra: true }),
    (error) => error.code === 'ACTIVITY_INVALID',
  );
  assert.throws(
    () => validateActivityEvent({ phase: 'run', kind: 'other', summary: 'No' }),
    (error) => error.code === 'ACTIVITY_INVALID',
  );
});

test('redacts nested credentials, commands, URLs, headers, environment values, and profile paths', () => {
  const source = {
    apiKey: 'top-secret',
    nested: [{ note: 'Authorization: Bearer abc123\nCookie: sid=cookie-secret' }],
    command: 'OPENAI_API_KEY=sk-live tool --token abc --url https://user:pass@example.com/a?q=secret#frag',
    headers: 'curl -H "Authorization: Bearer bearer-command-secret" -H "Cookie: sid=one; second=cookie-second-secret" https://example.com',
    profile: 'read C:\\Users\\me\\.aws\\credentials, C:\\Users\\me\\.codex\\auth.json and ~/.config/gcloud/application_default_credentials.json',
  };

  const clean = sanitizeActivityValue(source);

  assert.equal(clean.apiKey, '[REDACTED]');
  const serialized = JSON.stringify(clean);
  for (const secret of ['top-secret', 'abc123', 'cookie-secret', 'sk-live', 'user', 'pass', 'q=secret', 'frag',
    'bearer-command-secret', 'cookie-second-secret', '.codex']) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.equal(source.apiKey, 'top-secret');
  assert.match(serialized, /REDACTED/);
});

test('rejects unsafe paths and invalid usage values', () => {
  for (const path of ['C:\\secret.txt', '/etc/passwd', '..\\secret.txt', 'src/../secret.txt']) {
    assert.throws(
      () => validateActivityEvent({ phase: 'run', kind: 'file', summary: 'File', path, operation: 'read' }),
      (error) => error.code === 'ACTIVITY_INVALID',
    );
  }
  assert.throws(
    () => validateActivityEvent({ ...variants[6], usage: { ...variants[6].usage, totalTokens: -1 } }),
    (error) => error.code === 'ACTIVITY_INVALID',
  );
  assert.throws(
    () => validateActivityEvent({ ...variants[6], usage: { ...variants[6].usage, inputTokens: Infinity } }),
    (error) => error.code === 'ACTIVITY_INVALID',
  );
});

test('reduces network destinations to scheme, host, and optional port', () => {
  const clean = validateActivityEvent({
    phase: 'run', kind: 'network', summary: 'Net',
    destination: 'https://user:pass@example.com:8443/private?q=secret#fragment',
  });
  assert.equal(clean.destination, 'https://example.com:8443');
});

test('enforces depth, node, string, object type, and serialized size bounds', () => {
  let deep = 'leaf';
  for (let index = 0; index < 7; index += 1) deep = { child: deep };
  const tooMany = Array.from({ length: 201 }, () => 1);
  for (const value of [deep, tooMany, new Date(), { value: NaN }]) {
    assert.throws(() => sanitizeActivityValue(value), (error) => error.code === 'ACTIVITY_INVALID');
  }
  assert.throws(
    () => validateActivityEvent({ phase: 'run', kind: 'status', summary: 's'.repeat(241) }),
    (error) => error.code === 'ACTIVITY_INVALID',
  );
  assert.throws(
    () => validateActivityEvent({ phase: 'run', kind: 'status', summary: 's', detail: 'd'.repeat(8193) }),
    (error) => error.code === 'ACTIVITY_INVALID',
  );
  assert.throws(
    () => sanitizeActivityValue({ values: Array.from({ length: 160 }, () => 'x'.repeat(210)) }),
    (error) => error.code === 'ACTIVITY_INVALID',
  );
});

test('stores and publishes only sanitized immutable values', () => {
  let now = 40;
  const store = createActivityStore({ clock: () => ++now });
  const published = [];
  store.subscribe((snapshot) => published.push(snapshot));
  const run = { connectionId: 'demo', token: 'run-secret' };
  store.begin(run);
  const event = {
    phase: 'run', kind: 'command', summary: 'Run',
    command: 'TOKEN=executor-secret node task.js', exitCode: 0,
  };
  store.append(event);
  event.summary = 'mutated';
  run.connectionId = 'mutated';

  const snapshot = store.snapshot();
  assert.deepEqual(snapshot.run, { connectionId: 'demo', token: '[REDACTED]' });
  assert.equal(snapshot.events[0].sequence, 1);
  assert.equal(snapshot.events[0].timestamp, 41);
  assert.equal(snapshot.events[0].summary, 'Run');
  assert.equal(JSON.stringify(snapshot).includes('executor-secret'), false);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.events[0]), true);
  assert.equal(Object.isFrozen(published.at(-1)), true);
  assert.throws(() => { snapshot.events[0].summary = 'changed'; }, TypeError);
});

test('keeps at most 1000 events and clear removes all run data', () => {
  const store = createActivityStore({ clock: () => 1 });
  store.begin({ connectionId: 'demo' });
  for (let index = 0; index < 1002; index += 1) {
    store.append({ phase: 'run', kind: 'status', summary: String(index) });
  }
  assert.equal(store.snapshot().events.length, 1000);
  assert.equal(store.snapshot().events[0].sequence, 3);
  store.clear();
  assert.deepEqual(store.snapshot(), { run: null, events: [] });
});
