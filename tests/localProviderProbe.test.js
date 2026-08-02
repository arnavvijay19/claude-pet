'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const { CODEX_KNOWN_0145_FEATURES } = require('../src/agent/codexFeaturePolicy.js');
const providerHarness = require('../resources/probes/local-provider-harness.js');

const {
  PROBE_LIMITS,
  createLocalProviderProbe,
  defaultSpawn,
  sanitizeProbeEnvironment,
  verifyNativeToolSurface,
} = require('../src/agent/localProviderProbe.js');

function request({ url, method = 'POST', bearer = 'wrong', body = '{}', headers = {} }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const requestHeaders = {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      ...headers,
    };
    for (const [name, value] of Object.entries(requestHeaders)) {
      if (value === undefined) delete requestHeaders[name];
    }
    const call = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers: requestHeaders,
      agent: false,
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, headers: response.headers, body: text }));
    });
    call.on('error', reject);
    call.end(body);
  });
}

function fixtures(provider = 'codex-cli') {
  if (provider === 'claude-code-cli') {
    return {
      provider,
      control: {
        method: 'POST',
        pathSuffix: '/v1/messages?beta=true',
        headers: { 'x-api-key': '__OWNER_BEARER__', 'content-type': 'application/json' },
        body: { model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'fixed probe' }] },
        response: {
          statusCode: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: { ok: true, canaryUrl: '__OWNER_CANARY_URL__' },
        },
      },
    };
  }
  return {
    provider,
    control: {
      method: 'POST',
      pathSuffix: '/v1/responses',
      headers: { authorization: 'Bearer __OWNER_BEARER__', 'content-type': 'application/json' },
      body: { model: 'gpt-5.6-terra', input: 'fixed probe' },
      response: {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: { ok: true, canaryUrl: '__OWNER_CANARY_URL__' },
      },
    },
  };
}

function deterministicSecrets() {
  let value = 0;
  return (size) => {
    assert.equal(size, 32);
    value += 1;
    return Buffer.alloc(32, value);
  };
}

function safeFeatureOutput(additions = []) {
  return [...CODEX_KNOWN_0145_FEATURES.map((name) => ({
    name, stage: 'stable', enabled: false,
  })), ...additions]
    .map(({ name, stage, enabled }) => `${name.padEnd(48)}${stage}  ${enabled}`)
    .join('\n') + '\n';
}

async function tempRoot(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-pet-local-probe-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function canonicalCodexHeaders(url, bearer, body) {
  return {
    accept: 'text/event-stream',
    authorization: `Bearer ${bearer}`,
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json',
    host: new URL(url).host,
    originator: 'codex_cli_rs',
    'session-id': 'probe-session',
    'thread-id': 'probe-thread',
    'user-agent': 'codex_cli_rs/test',
    version: '0.0.0-test',
    'x-client-request-id': 'probe-request',
    'x-codex-beta-features': '',
    'x-codex-turn-metadata': '{}',
    'x-codex-window-id': 'probe-window',
    'x-openai-internal-codex-responses-lite': 'true',
  };
}

function rejectUpgrade(url, bearer) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(url);
    const socket = net.connect(Number(endpoint.port), endpoint.hostname, () => {
      socket.write([
        `GET ${endpoint.pathname} HTTP/1.1`,
        `Host: ${endpoint.host}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        `Authorization: Bearer ${bearer}`,
        'Sec-WebSocket-Key: dGVzdC1wcm9iZQ==',
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'));
    });
    socket.once('error', (error) => {
      if (error.code === 'ECONNRESET') resolve();
      else reject(error);
    });
    socket.once('close', resolve);
    socket.setTimeout(1000, () => socket.destroy());
  });
}

function canonicalCodexRequest(url, bearer, body) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(url);
    const headers = canonicalCodexHeaders(url, bearer, body);
    const socket = net.connect(Number(endpoint.port), endpoint.hostname, () => {
      const lines = [
        `POST ${endpoint.pathname} HTTP/1.0`,
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        '',
        body,
      ];
      socket.end(lines.join('\r\n'));
    });
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.once('error', reject);
    socket.once('close', () => {
      const response = Buffer.concat(chunks).toString('utf8');
      const match = /^HTTP\/\d\.\d (\d{3})/.exec(response);
      if (!match) reject(new Error('Invalid canonical probe response'));
      else resolve({ statusCode: Number(match[1]), body: response });
    });
    socket.setTimeout(2000, () => socket.destroy(new Error('Canonical request timed out')));
  });
}

test('pins complete canonical protocol metadata and fixed scenario contracts', async () => {
  const root = path.join(__dirname, '..', 'resources', 'probes');
  const codexBytes = await fs.readFile(path.join(root, 'codex-responses-fixtures.json'));
  const claudeBytes = await fs.readFile(path.join(root, 'claude-messages-sse-fixtures.json'));
  for (const bytes of [codexBytes, claudeBytes]) {
    assert.equal(bytes.at(-1), 0x0a);
    assert.equal(bytes.includes(0x0d), false);
  }
  const codex = JSON.parse(codexBytes);
  const claude = JSON.parse(claudeBytes);
  assert.deepEqual({ schemaVersion: codex.schemaVersion, provider: codex.provider, version: codex.version }, {
    schemaVersion: 1, provider: 'codex-cli', version: '0.145.0',
  });
  assert.deepEqual(codex.protocol.bodyKeys, [
    'client_metadata', 'include', 'input', 'model', 'parallel_tool_calls',
    'prompt_cache_key', 'reasoning', 'store', 'stream', 'text', 'tool_choice',
  ]);
  assert.deepEqual(codex.protocol.inputProjection.map(({ type, role }) => ({ type, role })), [
    { type: 'additional_tools', role: 'developer' },
    { type: 'message', role: 'developer' },
    { type: 'message', role: 'developer' },
    { type: 'message', role: 'developer' },
    { type: 'message', role: 'developer' },
    { type: 'message', role: 'user' },
    { type: 'message', role: 'user' },
  ]);
  assert.deepEqual(codex.protocol.execRegistry, [
    'apply_patch', 'shell_command', 'update_plan', 'view_image',
  ]);
  assert.deepEqual(codex.protocol.collaborationTools, [
    'followup_task', 'interrupt_agent', 'list_agents', 'send_message',
    'spawn_agent', 'wait_agent',
  ]);
  assert.equal(codex.protocol.classicToolsForbidden, true);
  assert.deepEqual(codex.scenario.calls.map(({ name }) => name), [
    'exec', 'wait', 'request_user_input',
    'collaboration.followup_task', 'collaboration.interrupt_agent',
    'collaboration.list_agents', 'collaboration.send_message',
    'collaboration.spawn_agent', 'collaboration.wait_agent',
  ]);

  assert.deepEqual({ schemaVersion: claude.schemaVersion, provider: claude.provider, version: claude.version }, {
    schemaVersion: 1, provider: 'claude-code-cli', version: '2.1.217',
  });
  assert.deepEqual(claude.protocol.headHeaderNames, [
    'accept', 'accept-encoding', 'connection', 'host', 'user-agent',
  ]);
  assert.deepEqual(claude.protocol.bodyKeys, [
    'context_management', 'max_tokens', 'messages', 'metadata', 'model',
    'output_config', 'stream', 'system', 'thinking', 'tools',
  ]);
  assert.deepEqual(claude.protocol.toolOrder, ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write']);
  assert.deepEqual(claude.scenario.calls.map(({ name }) => name), ['Read', 'Edit', 'Bash']);
  assert.equal(codex.scenario.finalText, 'probe-complete');
  assert.equal(claude.scenario.finalText, 'probe-complete');
});

test('rejects changed canonical fixture bytes before spawning a provider CLI', async (t) => {
  const sourceRoot = path.join(__dirname, '..', 'resources', 'probes');
  const fixtureRoot = await tempRoot(t);
  for (const name of [
    'codex-responses-fixtures.json',
    'codex-required-code-mode-tools.json',
    'codex-probe-config.toml',
  ]) {
    await fs.copyFile(path.join(sourceRoot, name), path.join(fixtureRoot, name));
  }
  const fixturePath = path.join(fixtureRoot, 'codex-responses-fixtures.json');
  const original = await fs.readFile(fixturePath, 'utf8');
  await fs.writeFile(fixturePath, original.replace(/\n$/, ' \n'), 'utf8');
  let spawnCalls = 0;

  await assert.rejects(
    verifyNativeToolSurface({
      provider: 'codex-cli',
      cliBinding: { path: 'C:\\codex.exe', version: '0.145.0' },
      workspacePath: 'Z:\\workspace',
      fixtureRoot,
      randomBytes: deterministicSecrets(),
      spawn: async () => { spawnCalls += 1; return { exitCode: 1, stdout: '', stderr: '' }; },
    }),
    (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE',
  );
  assert.equal(spawnCalls, 0);
});

test('uses one version-neutral Codex probe contract for every eligible binding version', async (t) => {
  const fixtureRoot = path.join(__dirname, '..', 'resources', 'probes');
  const probeResources = (await fs.readdir(fixtureRoot))
    .filter((name) => name.startsWith('codex-') && (
      name.includes('code-mode-tools') || name.includes('probe-config')
    )).sort();
  assert.deepEqual(probeResources, [
    'codex-probe-config.toml',
    'codex-required-code-mode-tools.json',
  ]);

  const canonicalFixtures = JSON.parse(await fs.readFile(
    path.join(fixtureRoot, 'codex-responses-fixtures.json'), 'utf8',
  ));
  const evidence = [];
  for (const version of ['0.145.0', '0.146.0', '0.200.1']) {
    const temporaryRoot = await tempRoot(t);
    let owner;
    let turn = 0;
    const scenarioHarnessFactory = ({ owner: nextOwner }) => {
      owner = nextOwner;
      return {
        handle(body) {
          assert.deepEqual(body, { turn });
          turn += 1;
          return {
            statusCode: 200,
            headers: { 'content-type': 'text/event-stream' },
            body: 'data: [DONE]\n\n',
          };
        },
        report() { return { complete: turn === 4, turns: turn, blockedToolResults: 7 }; },
      };
    };
    const runEvidence = {};
    const probe = createLocalProviderProbe({
      provider: 'codex-cli',
      purpose: 'compatibility',
      fixtures: canonicalFixtures,
      randomBytes: deterministicSecrets(),
      temporaryRoot,
      scenarioHarnessFactory,
      spawn: async (spec) => {
        if (spec.args.slice(-2).join(' ') === 'features list') {
          return { exitCode: 0, stdout: safeFeatureOutput(), stderr: '' };
        }
        const config = await fs.readFile(path.join(spec.env.CODEX_HOME, 'config.toml'), 'utf8');
        const controlBase = /openai_base_url = "([^"]+)"/.exec(config)[1];
        const controlUrl = `${controlBase}/responses`;
        runEvidence.spec = {
          args: spec.args,
          command: spec.command,
          cwdOwned: path.relative(temporaryRoot, spec.cwd).startsWith('..') === false,
          environmentKeys: Object.keys(spec.env).sort(),
          hasSignal: spec.signal instanceof AbortSignal,
          syntheticBearer: spec.env.CODEX_API_KEY,
          renderedConfig: config.replace(controlBase, '__OWNER_CONTROL_BASE__'),
        };
        for (let index = 0; index < 7; index += 1) {
          await rejectUpgrade(controlUrl, spec.env.CODEX_API_KEY);
        }
        for (let index = 0; index < 4; index += 1) {
          const body = JSON.stringify({ turn: index });
          const response = await canonicalCodexRequest(controlUrl, spec.env.CODEX_API_KEY, body);
          assert.equal(response.statusCode, 200, response.body);
        }
        const canaryUrl = /http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+/.exec(owner.codexExec)?.[0];
        assert.equal(typeof canaryUrl, 'string');
        await request({ url: canaryUrl, method: 'GET', body: '' });
        await fs.writeFile(owner.outsideWrite, 'outside-write-ok', 'utf8');
        await fs.writeFile(path.join(spec.cwd, 'codex-probe-applied.txt'), 'applied\n', 'utf8');
        return { exitCode: 0, stdout: 'probe-complete', stderr: '' };
      },
    });
    const result = await probe.run({
      cliBinding: { path: 'C:\\Program Files\\OpenAI\\Codex\\codex.exe', version },
      workspacePath: 'Z:\\workspace',
      fixtureRoot,
    });
    evidence.push({ result, spec: runEvidence.spec });
    assert.deepEqual(await fs.readdir(temporaryRoot), []);
  }
  assert.deepEqual(evidence[0], evidence[1]);
  assert.deepEqual(evidence[0], evidence[2]);
  assert.deepEqual(evidence[0].result, {
    provider: 'codex-cli', controlRequests: 4, childCanaryConnections: 1,
    processExitCode: 0, cleanup: true, upgradeAttempts: 7,
    scenarioTurns: 4, blockedToolResults: 7, credentialScrubbed: true,
  });
});

test('live installed Codex completes the version-neutral account-free contract', {
  skip: process.platform !== 'win32' || process.env.CLAUDE_PET_RUN_LIVE_CODEX_PROBE !== '1',
  timeout: 60_000,
}, async (t) => {
  if (!process.env.LOCALAPPDATA) {
    t.skip('LOCALAPPDATA is unavailable');
    return;
  }
  const command = path.win32.join(
    process.env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe',
  );
  try {
    await fs.access(command);
  } catch {
    t.skip('Codex Desktop CLI is not installed');
    return;
  }
  const report = await verifyNativeToolSurface({
    provider: 'codex-cli',
    purpose: 'compatibility',
    cliBinding: { path: command, version: '0.146.0' },
    workspacePath: 'C:\\Users\\Tester\\Desktop\\a',
    fixtureRoot: path.join(__dirname, '..', 'resources', 'probes'),
  });
  const expected = {
    provider: 'codex-cli',
    controlRequests: 4,
    childCanaryConnections: 1,
    processExitCode: 0,
    cleanup: true,
    upgradeAttempts: 7,
    scenarioTurns: 4,
    blockedToolResults: 7,
    credentialScrubbed: true,
  };
  assert.deepEqual(report, expected);
});

test('compatibility probes distinguish deterministic mismatch from retryable uncertainty', async (t) => {
  const fixtureRoot = path.join(__dirname, '..', 'resources', 'probes');
  const common = {
    provider: 'codex-cli',
    purpose: 'compatibility',
    cliBinding: { path: 'C:\\codex.exe', version: '0.146.0' },
    workspacePath: 'Z:\\workspace',
    fixtureRoot,
    randomBytes: deterministicSecrets(),
  };
  const incompatible = await verifyNativeToolSurface({
    ...common,
    spawn: async () => ({
      exitCode: 0,
      stdout: safeFeatureOutput([
        { name: 'future_enabled_surface', stage: 'experimental', enabled: true },
      ]),
      stderr: '',
    }),
  });
  assert.deepEqual(incompatible, { compatible: false });
  assert.equal(Object.isFrozen(incompatible), true);

  const missingRequiredFlag = await verifyNativeToolSurface({
    ...common,
    spawn: async () => ({
      exitCode: 2,
      stdout: '',
      stderr: "error: invalid value 'apps' for '--disable <FEATURE>': unknown feature 'apps'",
    }),
  });
  assert.deepEqual(missingRequiredFlag, { compatible: false });

  await assert.rejects(
    verifyNativeToolSurface({
      ...common,
      spawn: async (spec) => (spec.args.slice(-2).join(' ') === 'features list'
        ? { exitCode: 9, stdout: '', stderr: 'internal runtime panic' }
        : { exitCode: 0, stdout: '', stderr: '' }),
    }),
    (error) => error.name === 'LocalProviderProbeFailure' && error.kind === 'check-failed',
  );

  const runFlagFailure = await verifyNativeToolSurface({
    ...common,
    spawn: async (spec) => (spec.args.slice(-2).join(' ') === 'features list'
      ? { exitCode: 0, stdout: safeFeatureOutput(), stderr: '' }
      : { exitCode: 2, stdout: '', stderr: "error: unexpected argument '--strict-config' found" }),
  });
  assert.deepEqual(runFlagFailure, { compatible: false });

  await assert.rejects(
    verifyNativeToolSurface({
      ...common,
      spawn: async (spec) => (spec.args.slice(-2).join(' ') === 'features list'
        ? { exitCode: 0, stdout: safeFeatureOutput(), stderr: '' }
        : { exitCode: 9, stdout: '', stderr: 'internal runtime panic' }),
    }),
    (error) => error.name === 'LocalProviderProbeFailure' && error.kind === 'check-failed',
  );

  await assert.rejects(
    verifyNativeToolSurface({
      ...common,
      spawn: async () => { throw new Error('temporary spawn failure'); },
    }),
    (error) => error.name === 'LocalProviderProbeFailure'
      && error.message === 'Local provider probe failed'
      && error.kind === 'check-failed'
      && Object.keys(error).sort().join(',') === 'kind,name',
  );
});

test('accepts only bounded unique optional Codex message identifiers', () => {
  const messages = (ids) => ids.map((id) => ({
    type: 'message', role: 'user', content: [], ...(id === undefined ? {} : { id }),
  }));
  assert.equal(providerHarness.assertOptionalCodexItemIdentifiers(messages([undefined, 'a', 'b'.repeat(256)])), true);
  for (const invalid of [
    messages(['']),
    messages(['x'.repeat(257)]),
    messages(['nul\0id']),
    messages(['duplicate', 'duplicate']),
    messages([7]),
  ]) {
    assert.throws(() => providerHarness.assertOptionalCodexItemIdentifiers(invalid), /identifier/);
  }
});

test('compatibility probe infrastructure and cleanup uncertainty remain retryable', async (t) => {
  const fixtureRoot = await tempRoot(t);
  const input = {
    cliBinding: { path: 'C:\\codex.exe', version: '0.146.0' },
    workspacePath: 'Z:\\workspace',
    fixtureRoot,
  };
  const bindFailure = createLocalProviderProbe({
    provider: 'codex-cli',
    purpose: 'compatibility',
    fixtures: fixtures(),
    randomBytes: deterministicSecrets(),
    listen: () => { throw new Error('temporary bind failure'); },
  });
  await assert.rejects(
    bindFailure.run(input),
    (error) => error.name === 'LocalProviderProbeFailure' && error.kind === 'check-failed',
  );

  const cleanupRoot = await tempRoot(t);
  const cleanupFailure = createLocalProviderProbe({
    provider: 'codex-cli',
    purpose: 'compatibility',
    fixtures: fixtures(),
    randomBytes: deterministicSecrets(),
    temporaryRoot: cleanupRoot,
    fileSystem: {
      ...fs,
      async rm() { throw new Error('temporary cleanup failure'); },
    },
    spawn: async () => { throw new Error('temporary spawn failure'); },
  });
  await assert.rejects(
    cleanupFailure.run(input),
    (error) => error.name === 'LocalProviderProbeFailure' && error.kind === 'check-failed',
  );
});

test('compatibility probe classifies a healthy loopback contract violation as incompatible', async (t) => {
  const fixtureRoot = await tempRoot(t);
  const probe = createLocalProviderProbe({
    provider: 'codex-cli',
    purpose: 'compatibility',
    fixtures: fixtures(),
    randomBytes: deterministicSecrets(),
    spawn: async (spec) => {
      const config = await fs.readFile(path.join(spec.env.CODEX_HOME, 'config.toml'), 'utf8');
      const controlBase = /openai_base_url = "([^"]+)"/.exec(config)[1];
      await request({
        url: `${controlBase}/responses`,
        bearer: spec.env.CODEX_API_KEY,
        body: JSON.stringify({ model: 'wrong', input: 'unexpected' }),
      });
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  });
  await assert.rejects(
    probe.run({
      cliBinding: { path: 'C:\\codex.exe', version: '0.146.0' },
      workspacePath: 'Z:\\workspace',
      fixtureRoot,
    }),
    (error) => error.name === 'LocalProviderProbeFailure' && error.kind === 'incompatible',
  );
});

test('permission probes preserve the existing public error for deterministic mismatch', async (t) => {
  await assert.rejects(
    verifyNativeToolSurface({
      provider: 'codex-cli',
      cliBinding: { path: 'C:\\codex.exe', version: '0.146.0' },
      workspacePath: 'Z:\\workspace',
      fixtureRoot: path.join(__dirname, '..', 'resources', 'probes'),
      randomBytes: deterministicSecrets(),
      spawn: async () => ({
        exitCode: 0,
        stdout: safeFeatureOutput([
          { name: 'future_enabled_surface', stage: 'experimental', enabled: true },
        ]),
        stderr: '',
      }),
    }),
    (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE'
      && !Object.hasOwn(error, 'kind'),
  );
});

test('pins bounded request, event, transcript, and deadline limits', () => {
  assert.deepEqual(PROBE_LIMITS, {
    requests: 8,
    upgrades: 8,
    headerBytes: 32 * 1024,
    bodyBytes: 1024 * 1024,
    events: 128,
    eventBytes: 64 * 1024,
    transcriptBytes: 1024 * 1024,
    deadlineMs: 30_000,
  });
  assert.equal(Object.isFrozen(PROBE_LIMITS), true);
});

test('accepts Codex control results only when every fixed control fails closed exactly', () => {
  const calls = [
    { id: 'probe_request_user_input', name: 'request_user_input' },
    { id: 'probe_spawn', name: 'collaboration.spawn_agent' },
  ];
  const blocked = [
    {
      type: 'function_call_output',
      call_id: 'probe_request_user_input',
      output: 'request_user_input is unavailable in Default mode',
    },
    {
      type: 'function_call_output',
      call_id: 'probe_spawn',
      output: 'unsupported call: collaboration.spawn_agent',
    },
  ];

  assert.equal(providerHarness.assertCodexFailClosedResults(blocked, calls), true);
  assert.throws(
    () => providerHarness.assertCodexFailClosedResults([
      blocked[0], { ...blocked[1], output: 'spawned successfully' },
    ], calls),
    /fail closed/,
  );
});

test('requires Claude Read and Bash results to contain their fixed sentinels', () => {
  const calls = [
    { id: 'probe_claude_read', name: 'Read' },
    { id: 'probe_claude_edit', name: 'Edit' },
    { id: 'probe_claude_bash', name: 'Bash' },
  ];
  const successful = [
    { type: 'tool_result', tool_use_id: 'probe_claude_read', content: 'read-ok\n' },
    { type: 'tool_result', tool_use_id: 'probe_claude_edit', content: 'Updated.' },
    { type: 'tool_result', tool_use_id: 'probe_claude_bash', content: 'child-canary-ok\n' },
  ];

  assert.equal(providerHarness.assertClaudeToolResults(successful, calls), true);
  assert.throws(
    () => providerHarness.assertClaudeToolResults([
      { ...successful[0], content: 'permission denied', is_error: false },
      ...successful.slice(1),
    ], calls),
    /sentinel result/,
  );
});

test('Codex feature inspection omits the run-only strict-config flag', async (t) => {
  const fixtureRoot = path.join(__dirname, '..', 'resources', 'probes');
  const temporaryRoot = await tempRoot(t);
  const canonicalFixtures = JSON.parse(await fs.readFile(
    path.join(fixtureRoot, 'codex-responses-fixtures.json'), 'utf8',
  ));
  let featureSpec;
  const probe = createLocalProviderProbe({
    provider: 'codex-cli',
    fixtures: canonicalFixtures,
    randomBytes: deterministicSecrets(),
    temporaryRoot,
    spawn: async (spec) => {
      featureSpec = spec;
      return { exitCode: 1, stdout: '', stderr: '' };
    },
  });

  await assert.rejects(
    probe.run({
      cliBinding: { path: 'C:\\codex.exe', version: '0.145.0' },
      workspacePath: 'Z:\\workspace',
      fixtureRoot,
    }),
    (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE',
  );
  assert.equal(featureSpec.args.includes('--strict-config'), false);
  assert.equal(featureSpec.args[0], '--disable');
  assert.deepEqual(featureSpec.args.slice(-2), ['features', 'list']);
  assert.deepEqual(await fs.readdir(temporaryRoot), []);
});

test('Codex WebSocket upgrade rejection closes without an HTTP response', async (t) => {
  const fixtureRoot = path.join(__dirname, '..', 'resources', 'probes');
  const temporaryRoot = await tempRoot(t);
  const canonicalFixtures = JSON.parse(await fs.readFile(
    path.join(fixtureRoot, 'codex-responses-fixtures.json'), 'utf8',
  ));
  const featureOutput = CODEX_KNOWN_0145_FEATURES
    .map((name) => `${name.padEnd(48)}stable  false`)
    .join('\n') + '\n';
  let upgradeResponse = null;
  const probe = createLocalProviderProbe({
    provider: 'codex-cli',
    fixtures: canonicalFixtures,
    randomBytes: deterministicSecrets(),
    temporaryRoot,
    spawn: async (spec) => {
      if (spec.args.slice(-2).join(' ') === 'features list') {
        return { exitCode: 0, stdout: featureOutput, stderr: '' };
      }
      const config = await fs.readFile(path.join(spec.env.CODEX_HOME, 'config.toml'), 'utf8');
      const controlBase = /openai_base_url = "([^"]+)"/.exec(config)[1];
      const endpoint = new URL(`${controlBase}/responses`);
      upgradeResponse = await new Promise((resolve) => {
        const chunks = [];
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve(Buffer.concat(chunks).toString('utf8'));
        };
        const socket = net.connect(Number(endpoint.port), endpoint.hostname, () => {
          socket.write([
            `GET ${endpoint.pathname} HTTP/1.1`,
            `Host: ${endpoint.host}`,
            'Connection: Upgrade',
            'Upgrade: websocket',
            `Authorization: Bearer ${spec.env.CODEX_API_KEY}`,
            'Sec-WebSocket-Key: dGFzay0xNC1wcm9iZQ==',
            'Sec-WebSocket-Version: 13',
            '',
            '',
          ].join('\r\n'));
        });
        socket.on('data', (chunk) => chunks.push(chunk));
        socket.once('error', finish);
        socket.once('close', finish);
        socket.setTimeout(1000, () => socket.destroy());
      });
      return { exitCode: 1, stdout: '', stderr: '' };
    },
  });

  await assert.rejects(
    probe.run({
      cliBinding: { path: 'C:\\codex.exe', version: '0.145.0' },
      workspacePath: 'Z:\\workspace',
      fixtureRoot,
    }),
    (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE',
  );
  assert.equal(upgradeResponse, '');
  assert.deepEqual(await fs.readdir(temporaryRoot), []);
});

test('Claude accepts only the pinned unauthenticated HEAD preflight on the secret control path', async (t) => {
  const fixtureRoot = path.join(__dirname, '..', 'resources', 'probes');
  const temporaryRoot = await tempRoot(t);
  const canonicalFixtures = JSON.parse(await fs.readFile(
    path.join(fixtureRoot, 'claude-messages-sse-fixtures.json'), 'utf8',
  ));
  let headStatus = null;
  const probe = createLocalProviderProbe({
    provider: 'claude-code-cli',
    fixtures: canonicalFixtures,
    randomBytes: deterministicSecrets(),
    temporaryRoot,
    spawn: async (spec) => {
      const endpoint = new URL(spec.env.ANTHROPIC_BASE_URL);
      headStatus = await new Promise((resolve, reject) => {
        const call = http.request({
          hostname: endpoint.hostname,
          port: endpoint.port,
          path: endpoint.pathname,
          method: 'HEAD',
          headers: {
            accept: '*/*',
            'accept-encoding': 'gzip, deflate',
            'user-agent': 'claude-cli/2.1.217',
          },
          agent: false,
        }, (response) => {
          response.resume();
          response.once('end', () => resolve(response.statusCode));
        });
        call.once('error', reject);
        call.end();
      });
      return { exitCode: 1, stdout: '', stderr: '' };
    },
  });

  await assert.rejects(
    probe.run({
      cliBinding: { path: 'C:\\claude.exe', version: '2.1.217' },
      workspacePath: 'Z:\\workspace',
      fixtureRoot,
    }),
    (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE',
  );
  assert.equal(headStatus, 200);
  assert.deepEqual(await fs.readdir(temporaryRoot), []);
});

test('inherits only the minimal Windows environment allowlist', () => {
  const clean = sanitizeProbeEnvironment({
    PATH: 'C:\\Windows\\System32',
    SystemRoot: 'C:\\Windows',
    TEMP: 'C:\\Temp',
    OPENAI_API_KEY: 'real-openai', ANTHROPIC_API_KEY: 'real-anthropic',
    CODEX_API_KEY: 'real-codex', CLAUDE_CODE_OAUTH_TOKEN: 'real-claude',
    OPENAI_BASE_URL: 'https://attacker.invalid', ANTHROPIC_BASE_URL: 'https://attacker.invalid',
    HTTP_PROXY: 'http://proxy.invalid', HTTPS_PROXY: 'http://proxy.invalid', ALL_PROXY: 'socks://proxy.invalid',
    NO_PROXY: '*', NODE_EXTRA_CA_CERTS: 'Z:\\hostile.pem', SSL_CERT_FILE: 'Z:\\hostile.pem',
    AWS_SECRET_ACCESS_KEY: 'cloud-secret',
    GITHUB_TOKEN: 'github-secret',
    DATABASE_PASSWORD: 'database-secret',
    OTHER_SAFE_VALUE: 'must-not-be-inherited',
  });
  assert.deepEqual(clean, {
    PATH: 'C:\\Windows\\System32',
    SystemRoot: 'C:\\Windows',
    TEMP: 'C:\\Temp',
  });
});

test('default spawn aborts the verified process tree and waits for close', async () => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.exitCode = null;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const events = [];
  const controller = new AbortController();
  const result = defaultSpawn({
    command: 'C:\\Program Files\\OpenAI\\Codex\\codex.exe',
    args: [],
    cwd: 'Z:\\workspace',
    env: {},
    signal: controller.signal,
    goal: 'probe',
  }, {
    spawnProcess: () => child,
    terminate: async (identity) => {
      events.push(['terminate', identity]);
      child.exitCode = 1;
      child.emit('close', 1);
    },
  });

  controller.abort(new Error('caller stopped probe'));
  await assert.rejects(result, /caller stopped probe/);
  assert.deepEqual(events, [[
    'terminate',
    { pid: 4242, execFile: 'C:\\Program Files\\OpenAI\\Codex\\codex.exe' },
  ]]);
});

test('forwards caller cancellation through probe spawning before cleanup', async (t) => {
  const fixtureRoot = await tempRoot(t);
  const temporaryRoot = await tempRoot(t);
  const controller = new AbortController();
  let observedSignal;
  const probe = createLocalProviderProbe({
    provider: 'codex-cli',
    fixtures: fixtures(),
    randomBytes: deterministicSecrets(),
    temporaryRoot,
    spawn: (spec) => {
      observedSignal = spec.signal;
      return new Promise((resolve, reject) => {
        spec.signal.addEventListener('abort', () => reject(spec.signal.reason), { once: true });
      });
    },
  });

  const running = probe.run({
    cliBinding: { path: 'C:\\codex.exe', version: '0.145.0' },
    workspacePath: 'Z:\\workspace',
    fixtureRoot,
    signal: controller.signal,
  });
  while (!observedSignal) await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error('cancelled by owner'));

  await assert.rejects(
    running,
    (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE',
  );
  assert.equal(observedSignal.aborted, true);
  assert.deepEqual(await fs.readdir(temporaryRoot), []);
});

test('owns authenticated loopback endpoints and separates control traffic from child canary traffic', async (t) => {
  const fixtureRoot = await tempRoot(t);
  const seen = {};
  const probe = createLocalProviderProbe({
    provider: 'codex-cli',
    fixtures: fixtures(),
    randomBytes: deterministicSecrets(),
    environment: {
      PATH: process.env.PATH,
      OPENAI_API_KEY: 'real-secret',
      OPENAI_BASE_URL: 'https://real-provider.invalid/v1',
      HTTPS_PROXY: 'http://real-proxy.invalid',
    },
    spawn: async (spec) => {
      seen.spec = spec;
      const config = await fs.readFile(path.join(spec.env.CODEX_HOME, 'config.toml'), 'utf8');
      const controlBase = /openai_base_url = "([^"]+)"/.exec(config)[1];
      const bearer = spec.env.CODEX_API_KEY;
      assert.equal(typeof bearer, 'string', 'Codex probe must use CODEX_API_KEY');
      const controlUrl = `${controlBase}/responses`;

      seen.wrongPath = await request({ url: controlUrl.replace('/v1/responses', '/wrong'), bearer });
      seen.wrongBearer = await request({ url: controlUrl, bearer: 'wrong', body: JSON.stringify(fixtures().control.body) });
      const valid = await request({ url: controlUrl, bearer, body: JSON.stringify(fixtures().control.body) });
      const canaryUrl = JSON.parse(valid.body).canaryUrl;
      seen.canary = await request({ url: canaryUrl, bearer: 'not-used', body: '' });
      return { exitCode: 0, stdout: 'probe complete', stderr: '' };
    },
  });

  const report = await probe.run({
    cliBinding: { path: 'C:\\Program Files\\OpenAI\\Codex\\codex.exe', version: '0.145.0' },
    workspacePath: 'Z:\\workspace',
    fixtureRoot,
  });

  assert.equal(seen.wrongPath.statusCode, 404);
  assert.equal(seen.wrongBearer.statusCode, 401);
  assert.equal(seen.canary.statusCode, 204);
  assert.equal(seen.spec.env.CODEX_API_KEY === 'real-secret', false);
  assert.equal(typeof seen.spec.env.CODEX_API_KEY, 'string');
  assert.equal(Object.hasOwn(seen.spec.env, 'OPENAI_API_KEY'), false);
  assert.equal(Object.hasOwn(seen.spec.env, 'OPENAI_BASE_URL'), false);
  assert.equal(Object.hasOwn(seen.spec.env, 'HTTPS_PROXY'), false);
  assert.equal(seen.spec.command.endsWith('codex.exe'), true);
  assert.deepEqual(seen.spec.args, [
    '--sandbox', 'danger-full-access', '--ask-for-approval', 'never',
    '--strict-config',
    '--disable', 'apps', '--disable', 'auth_elicitation',
    '--disable', 'browser_use', '--disable', 'browser_use_external',
    '--disable', 'browser_use_full_cdp_access', '--disable', 'code_mode_host',
    '--disable', 'computer_use', '--disable', 'hooks', '--disable', 'goals',
    '--disable', 'guardian_approval', '--disable', 'image_generation',
    '--disable', 'in_app_browser', '--disable', 'memories', '--disable', 'in_app_updates',
    '--disable', 'multi_agent',
    '--disable', 'plugins', '--disable', 'plugin_sharing', '--disable', 'remote_plugin',
    '--disable', 'skill_mcp_dependency_install', '--disable', 'skill_search',
    '--disable', 'tool_call_mcp_elicitation', '--disable', 'tool_suggest',
    '--disable', 'workspace_dependencies', '-c', 'web_search="disabled"',
    '--model', 'gpt-5.6-terra', '-c', 'model_reasoning_effort="high"',
    'exec', '--ignore-rules', '--ephemeral', '--json',
    '--skip-git-repo-check', '--color', 'never',
  ]);
  assert.deepEqual(report, {
    provider: 'codex-cli',
    controlRequests: 1,
    childCanaryConnections: 1,
    processExitCode: 0,
    cleanup: true,
  });
  const serialized = JSON.stringify({ report, spec: seen.spec });
  assert.equal(serialized.includes('real-secret'), false);
  assert.equal(serialized.includes('real-provider.invalid'), false);
  assert.equal(serialized.includes('real-proxy.invalid'), false);
  assert.deepEqual(await fs.readdir(fixtureRoot), []);
});

test('keeps transient config, hostile workspace, transcript, and sentinels out of immutable fixtures', async (t) => {
  const fixtureRoot = await tempRoot(t);
  const temporaryRoot = await tempRoot(t);
  await fs.writeFile(path.join(fixtureRoot, 'immutable-marker.txt'), 'fixture-bytes', 'utf8');
  let seenSpec;
  const probe = createLocalProviderProbe({
    provider: 'codex-cli', fixtures: fixtures(), randomBytes: deterministicSecrets(),
    temporaryRoot,
    spawn: async (spec) => {
      seenSpec = spec;
      assert.equal(path.relative(temporaryRoot, spec.cwd).startsWith('..'), false);
      assert.equal(path.relative(temporaryRoot, spec.env.CODEX_HOME).startsWith('..'), false);
      const config = await fs.readFile(path.join(spec.env.CODEX_HOME, 'config.toml'), 'utf8');
      const controlUrl = `${/openai_base_url = "([^"]+)"/.exec(config)[1]}/responses`;
      await request({
        url: controlUrl,
        bearer: spec.env.CODEX_API_KEY,
        body: JSON.stringify(fixtures().control.body),
      });
      return { exitCode: 0, stdout: 'probe complete', stderr: '' };
    },
  });
  await probe.run({
    cliBinding: { path: 'C:\\codex.exe', version: '0.145.0' },
    workspacePath: 'Z:\\workspace', fixtureRoot,
  });
  assert.equal(seenSpec.cwd === 'Z:\\workspace', false);
  assert.deepEqual(await fs.readdir(fixtureRoot), ['immutable-marker.txt']);
  assert.deepEqual(await fs.readdir(temporaryRoot), []);
});

test('launches the pinned Claude probe in verbose stream mode with only the dummy API key', async (t) => {
  const fixtureRoot = await tempRoot(t);
  let seenSpec;
  const probe = createLocalProviderProbe({
    provider: 'claude-code-cli',
    fixtures: fixtures('claude-code-cli'),
    randomBytes: deterministicSecrets(),
    environment: {
      PATH: process.env.PATH,
      ANTHROPIC_API_KEY: 'real-secret',
      ANTHROPIC_BASE_URL: 'https://real-provider.invalid',
    },
    spawn: async (spec) => {
      seenSpec = spec;
      const url = `${spec.env.ANTHROPIC_BASE_URL}/v1/messages?beta=true`;
      const body = JSON.stringify(fixtures('claude-code-cli').control.body);
      const response = await request({
        url,
        bearer: 'ignored',
        body,
        headers: {
          'x-api-key': spec.env.ANTHROPIC_API_KEY,
          authorization: undefined,
        },
      });
      assert.equal(response.statusCode, 200, response.body);
      return { exitCode: 0, stdout: 'probe complete', stderr: '' };
    },
  });

  await probe.run({
    cliBinding: { path: 'C:\\Program Files\\Anthropic\\claude.exe', version: '2.1.217' },
    workspacePath: 'Z:\\workspace',
    fixtureRoot,
  });

  assert.equal(seenSpec.env.ANTHROPIC_API_KEY === 'real-secret', false);
  assert.equal(Object.hasOwn(seenSpec.env, 'ANTHROPIC_BASE_URL'), true);
  assert.deepEqual(seenSpec.args, [
    '--print', '--verbose', '--output-format', 'stream-json', '--input-format', 'text',
    '--no-session-persistence', '--safe-mode', '--setting-sources', '',
    '--dangerously-skip-permissions', '--no-chrome', '--disable-slash-commands',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--tools', 'Bash,Read,Edit,Write,Glob,Grep',
    '--model', 'sonnet', '--effort', 'high',
  ]);
  assert.deepEqual(await fs.readdir(fixtureRoot), []);
});

test('rejects caller-controlled probe fields before opening a listener or spawning', async (t) => {
  const fixtureRoot = await tempRoot(t);
  let spawnCalls = 0;
  const probe = createLocalProviderProbe({
    provider: 'codex-cli', fixtures: fixtures(), randomBytes: deterministicSecrets(),
    spawn: async () => { spawnCalls += 1; return { exitCode: 0 }; },
  });
  for (const forged of [
    { endpoint: 'https://attacker.invalid' },
    { port: 1234 },
    { bearer: 'forged' },
    { credential: 'forged' },
    { fixtures: {} },
    { prompt: 'do something else' },
  ]) {
    await assert.rejects(
      probe.run({
        cliBinding: { path: 'C:\\codex.exe', version: '0.145.0' },
        workspacePath: 'Z:\\workspace', fixtureRoot, ...forged,
      }),
      (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE',
    );
  }
  assert.equal(spawnCalls, 0);
});

test('closes listeners and removes all owned state when spawn or protocol validation fails', async (t) => {
  const fixtureRoot = await tempRoot(t);
  const failures = [
    async () => { throw new Error('spawn failed with secret=abc'); },
    async (spec) => {
      const config = await fs.readFile(path.join(spec.env.CODEX_HOME, 'config.toml'), 'utf8');
      const controlBase = /openai_base_url = "([^"]+)"/.exec(config)[1];
      await request({
        url: `${controlBase}/responses`, bearer: spec.env.OPENAI_API_KEY,
        body: JSON.stringify({ model: 'wrong', input: 'unexpected' }),
      });
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  ];
  for (const spawn of failures) {
    const probe = createLocalProviderProbe({
      provider: 'codex-cli', fixtures: fixtures(), spawn,
      randomBytes: deterministicSecrets(),
    });
    await assert.rejects(
      probe.run({
        cliBinding: { path: 'C:\\codex.exe', version: '0.145.0' },
        workspacePath: 'Z:\\workspace', fixtureRoot,
      }),
      (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE'
        && !String(error.message).includes('secret=abc'),
    );
    assert.deepEqual(await fs.readdir(fixtureRoot), []);
  }
});
