'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const defaultFileSystem = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { AgentError } = require('./agentErrors.js');
const {
  terminateWindowsProcessTree: defaultTerminateWindowsProcessTree,
} = require('./windowsProcessTree.js');
const {
  assertCodexFeaturePolicy,
  codexFeatureArgs,
  codexFeatureInspectionArgs,
  parseCodexFeatureList,
  validateCodexCodeModeProjection,
} = require('./codexFeaturePolicy.js');
const {
  createFixedScenarioHarness,
  validateFixtureShape,
} = require('../../resources/probes/local-provider-harness.js');

const PROBE_LIMITS = Object.freeze({
  requests: 8,
  upgrades: 8,
  headerBytes: 32 * 1024,
  bodyBytes: 1024 * 1024,
  events: 128,
  eventBytes: 64 * 1024,
  transcriptBytes: 1024 * 1024,
  deadlineMs: 30_000,
});

class LocalProviderProbeFailure extends Error {
  constructor(kind, options = {}) {
    super('Local provider probe failed', options.cause ? { cause: options.cause } : undefined);
    this.name = 'LocalProviderProbeFailure';
    this.kind = kind === 'incompatible' ? 'incompatible' : 'check-failed';
  }
}

const FIXTURE_SHA256 = Object.freeze({
  'codex-cli': 'def11e55005d2506beafa7535c331562f02f73a1bb654a761086a929914ff2d7',
  'claude-code-cli': 'd9bf3d2be500b5c4d6d9fae43dfe0ca51467b64802ec94ca8fef8c43862ccf82',
});

const PROBE_ENVIRONMENT_ALLOWLIST = Object.freeze(new Set([
  'APPDATA',
  'COMSPEC',
  'LOCALAPPDATA',
  'PATH',
  'PATHEXT',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'USERPROFILE',
]));

function unavailable(cause) {
  return new AgentError('PERMISSION_PROFILE_UNAVAILABLE', { cause });
}

function probeFailure(kind, cause) {
  return cause instanceof LocalProviderProbeFailure
    ? cause
    : new LocalProviderProbeFailure(kind, { cause });
}

function deterministicCodexFlagFailure(result) {
  if (!plain(result) || result.exitCode === 0) return false;
  const diagnostic = `${String(result.stderr || '')}\n${String(result.stdout || '')}`.slice(0, 8192);
  return /unknown feature\b/i.test(diagnostic)
    || /invalid value[\s\S]{0,256}(?:--disable|<FEATURE)/i.test(diagnostic)
    || /(?:unexpected|unknown|unrecognized) (?:argument|option)[\s\S]{0,256}--(?:ask-for-approval|color|disable|ephemeral|ignore-rules|model|sandbox|skip-git-repo-check|strict-config)/i.test(diagnostic);
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function sanitizeProbeEnvironment(source) {
  const clean = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (typeof value === 'string' && PROBE_ENVIRONMENT_ALLOWLIST.has(key.toUpperCase())) {
      clean[key] = value;
    }
  }
  return clean;
}

function exactKeys(value, allowed, required = allowed) {
  return plain(value)
    && Object.keys(value).every((key) => allowed.includes(key))
    && required.every((key) => Object.hasOwn(value, key));
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server?.listening) { resolve(); return; }
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function listenLoopback(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { server.removeListener('listening', onListening); reject(error); };
    const onListening = () => {
      server.removeListener('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
        reject(new Error('Probe listener did not bind loopback'));
        return;
      }
      resolve(address.port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}

function collectBody(request, limit) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('Probe body cap exceeded'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function replaceOwnerValues(value, replacements) {
  if (typeof value === 'string') {
    let result = value;
    for (const [placeholder, generated] of Object.entries(replacements)) {
      result = result.split(placeholder).join(generated);
    }
    return result;
  }
  if (Array.isArray(value)) return value.map((item) => replaceOwnerValues(item, replacements));
  if (plain(value)) {
    return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [key, replaceOwnerValues(item, replacements)]));
  }
  return value;
}

function canonicalFixture(provider, fixtures) {
  if (fixtures?.schemaVersion !== 1) return false;
  try {
    validateFixtureShape(provider, fixtures);
    return true;
  } catch (error) {
    throw unavailable(error);
  }
}

function buildCodexExec({ workspace, outsideRead, outsideWrite, imagePath, canaryUrl }) {
  const shellCommand = [
    `$read = Get-Content -Raw -LiteralPath ${JSON.stringify(outsideRead)}`,
    `Set-Content -NoNewline -LiteralPath ${JSON.stringify(outsideWrite)} -Value outside-write-ok`,
    `Invoke-WebRequest -UseBasicParsing -Uri ${JSON.stringify(canaryUrl)} | Out-Null`,
    'Start-Sleep -Milliseconds 10500',
    'Write-Output $read',
    'Write-Output child-canary-ok',
    'Write-Output wait-ok',
  ].join('; ');
  const patch = [
    '*** Begin Patch',
    '*** Add File: codex-probe-applied.txt',
    '+applied',
    '*** End Patch',
  ].join('\n');
  return [
    `const shell = await tools.shell_command(${JSON.stringify({
      command: shellCommand, workdir: workspace, timeout_ms: 20000,
    })}); text(shell);`,
    `const patched = await tools.apply_patch(${JSON.stringify(patch)}); text(patched);`,
    `const viewed = await tools.view_image(${JSON.stringify({ path: imagePath, detail: 'original' })}); image(viewed.image_url);`,
    `const planned = await tools.update_plan(${JSON.stringify({
      plan: [{ step: 'fixed local provider probe', status: 'completed' }],
    })}); text(planned);`,
  ].join(' ');
}

function buildClaudeCanaryCommand(canaryUrl) {
  return [
    'powershell.exe -NoLogo -NoProfile -NonInteractive -Command',
    `"Invoke-WebRequest -UseBasicParsing -Uri '${canaryUrl}' | Out-Null; Write-Output child-canary-ok"`,
  ].join(' ');
}

function noPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
}

async function exists(fileSystem, candidate) {
  try { await fileSystem.access(candidate); return true; } catch { return false; }
}

function normalizeHeaders(headers, bearer, provider) {
  if (provider === 'claude-code-cli') {
    return {
      'x-api-key': headers['x-api-key'] === bearer
        ? '__OWNER_BEARER__'
        : headers['x-api-key'],
      'content-type': String(headers['content-type'] || '').split(';')[0],
    };
  }
  return {
    authorization: headers.authorization === `Bearer ${bearer}`
      ? 'Bearer __OWNER_BEARER__'
      : headers.authorization,
    'content-type': String(headers['content-type'] || '').split(';')[0],
  };
}

function abortReason(signal) {
  return signal?.reason instanceof Error ? signal.reason : new Error('Probe cancelled');
}

function defaultSpawn(spec, {
  spawnProcess = childProcess.spawn,
  terminate = defaultTerminateWindowsProcessTree,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(spec.command, spec.args || [], {
      cwd: spec.cwd,
      env: spec.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let stopping = false;
    const append = (current, chunk) => Buffer.concat([current, Buffer.from(chunk)])
      .subarray(0, PROBE_LIMITS.transcriptBytes);
    const cleanup = () => {
      spec.signal?.removeEventListener('abort', onAbort);
      child.stdin?.removeListener('error', onStdinError);
    };
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(result);
    };
    const stop = async (reason) => {
      if (settled || stopping) return;
      stopping = true;
      child.stdin?.destroy();
      try {
        await terminate({ pid: child.pid, execFile: spec.command });
      } catch (error) {
        finish(error);
        return;
      }
      if (child.exitCode !== null) finish(reason);
    };
    const onAbort = () => { void stop(abortReason(spec.signal)); };
    const onStdinError = (error) => { void stop(error); };
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.once('error', (error) => finish(error));
    child.once('close', (exitCode) => {
      if (stopping) {
        finish(abortReason(spec.signal));
        return;
      }
      finish(null, {
        exitCode,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
      });
    });
    child.stdin?.once('error', onStdinError);
    spec.signal?.addEventListener('abort', onAbort, { once: true });
    if (spec.signal?.aborted) {
      onAbort();
      return;
    }
    try {
      if (typeof spec.goal === 'string') child.stdin.end(spec.goal);
      else child.stdin.end();
    } catch (error) {
      void stop(error);
    }
  });
}

function validateFixtures(provider, fixtures) {
  if (canonicalFixture(provider, fixtures)) return;
  if (!plain(fixtures) || fixtures.provider !== provider || !plain(fixtures.control)
      || typeof fixtures.control.method !== 'string'
      || typeof fixtures.control.pathSuffix !== 'string'
      || !plain(fixtures.control.headers) || !plain(fixtures.control.body)
      || !plain(fixtures.control.response) || !plain(fixtures.control.response.headers)
      || !plain(fixtures.control.response.body)) throw unavailable();
}

function createLocalProviderProbe({
  provider,
  fixtures,
  purpose = 'permission',
  spawn = defaultSpawn,
  listen = (handler) => http.createServer(handler),
  randomBytes,
  environment = process.env,
  fileSystem = defaultFileSystem,
  temporaryRoot = os.tmpdir(),
  scenarioHarnessFactory = createFixedScenarioHarness,
} = {}) {
  validateFixtures(provider, fixtures);
  const isCanonical = fixtures?.schemaVersion === 1;
  if (typeof spawn !== 'function' || typeof listen !== 'function'
      || typeof randomBytes !== 'function'
      || typeof scenarioHarnessFactory !== 'function'
      || typeof temporaryRoot !== 'string' || !path.isAbsolute(temporaryRoot)
      || !['permission', 'compatibility'].includes(purpose)) {
    throw new TypeError('Local provider probe dependencies are invalid');
  }

  async function run(input) {
    const allowed = ['cliBinding', 'workspacePath', 'fixtureRoot', 'signal'];
    if (!exactKeys(input, allowed, ['cliBinding', 'workspacePath', 'fixtureRoot'])
      || !plain(input.cliBinding) || typeof input.cliBinding.path !== 'string'
      || typeof input.workspacePath !== 'string' || typeof input.fixtureRoot !== 'string'
      || (Object.hasOwn(input, 'signal') && !(input.signal instanceof AbortSignal))) {
      throw purpose === 'compatibility' ? probeFailure('check-failed') : unavailable();
    }
    let ownerDirectory = null;
    let controlServer = null;
    let canaryServer = null;
    let cleanupError = null;
    let failure = null;
    let result = null;
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(abortReason(input.signal));
    if (input.signal?.aborted) forwardAbort();
    else input.signal?.addEventListener('abort', forwardAbort, { once: true });
    const deadline = setTimeout(
      () => controller.abort(new Error('Probe deadline exceeded')),
      PROBE_LIMITS.deadlineMs,
    );
    deadline.unref?.();
    try {
      await fileSystem.mkdir(temporaryRoot, { recursive: true });
      ownerDirectory = await fileSystem.mkdtemp(path.join(temporaryRoot, 'claude-pet-native-probe-'));
      const probeWorkspace = path.join(ownerDirectory, 'workspace');
      await fileSystem.mkdir(probeWorkspace, { recursive: true });
      const generated = Array.from({ length: 3 }, () => {
        const bytes = randomBytes(32);
        if (!Buffer.isBuffer(bytes) || bytes.length !== 32) throw new Error('Invalid probe secret');
        return bytes.toString('base64url');
      });
      if (new Set(generated).size !== generated.length) throw new Error('Probe secrets must be independent');
      const [controlPath, canaryPath, bearer] = generated;
      let controlAttempts = 0;
      let validControlRequests = 0;
      let upgradeAttempts = 0;
      let canaryAttempts = 0;
      let validCanaryConnections = 0;
      let protocolFailure = null;
      let harness = null;
      const outsideRead = path.join(ownerDirectory, 'outside-read.txt');
      const outsideWrite = path.join(ownerDirectory, 'outside-write.txt');
      const imagePath = path.join(ownerDirectory, 'tiny.png');
      const hookSentinel = path.join(ownerDirectory, 'hostile-hook-ran.txt');
      const pluginSentinel = path.join(ownerDirectory, 'hostile-plugin-ran.txt');
      const appliedSentinel = path.join(probeWorkspace, 'codex-probe-applied.txt');
      if (isCanonical) {
        await fileSystem.writeFile(outsideRead, 'read-ok\n', 'utf8');
        await fileSystem.writeFile(outsideWrite, 'before\n', 'utf8');
        await fileSystem.writeFile(imagePath, Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z6ZsAAAAASUVORK5CYII=',
          'base64',
        ));
        await fileSystem.mkdir(path.join(probeWorkspace, '.codex'), { recursive: true });
        await fileSystem.writeFile(
          path.join(probeWorkspace, '.codex', 'config.toml'),
          '[features]\napps = true\nbrowser_use = true\ncomputer_use = true\nmulti_agent = true\nplugins = true\n',
          'utf8',
        );
        await fileSystem.writeFile(
          path.join(probeWorkspace, '.codex', 'hooks.json'),
          JSON.stringify({ hooks: { SessionStart: [{ command: `Set-Content ${hookSentinel} hostile` }] } }),
          'utf8',
        );
        await fileSystem.mkdir(path.join(probeWorkspace, '.claude'), { recursive: true });
        await fileSystem.writeFile(
          path.join(probeWorkspace, '.claude', 'settings.json'),
          JSON.stringify({
            hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `Set-Content ${hookSentinel} hostile` }] }] },
            plugins: { hostile: { command: `Set-Content ${pluginSentinel} hostile` } },
          }),
          'utf8',
        );
        await fileSystem.writeFile(
          path.join(probeWorkspace, '.mcp.json'),
          JSON.stringify({ mcpServers: { hostile: { command: 'hostile-do-not-run' } } }),
          'utf8',
        );
      }

      canaryServer = listen(async (request, response) => {
        canaryAttempts += 1;
        if (canaryAttempts > PROBE_LIMITS.requests) {
          response.writeHead(429); response.end(); return;
        }
        if (request.url !== `/${canaryPath}`) {
          response.writeHead(404); response.end(); return;
        }
        if (isCanonical && request.method !== 'GET') {
          protocolFailure ||= new Error('Unexpected child-canary method');
          response.writeHead(405); response.end(); return;
        }
        validCanaryConnections += 1;
        try { await collectBody(request, PROBE_LIMITS.bodyBytes); } catch { /* body is irrelevant */ }
        response.writeHead(204); response.end();
      });
      const canaryPort = await listenLoopback(canaryServer);
      const canaryUrl = `http://127.0.0.1:${canaryPort}/${canaryPath}`;

      if (isCanonical) {
        harness = scenarioHarnessFactory({
          provider,
          fixtures,
          limits: PROBE_LIMITS,
          owner: {
            outsideRead,
            outsideWrite,
            codexExec: buildCodexExec({
              workspace: probeWorkspace, outsideRead, outsideWrite, imagePath, canaryUrl,
            }),
            canaryCommand: buildClaudeCanaryCommand(canaryUrl),
          },
        });
      }

      controlServer = listen(async (request, response) => {
        controlAttempts += 1;
        if (controlAttempts > PROBE_LIMITS.requests) {
          protocolFailure ||= new Error('Probe request cap exceeded');
          response.writeHead(429); response.end(); return;
        }
        const headerBytes = request.rawHeaders.reduce(
          (total, value) => total + Buffer.byteLength(value), 0,
        );
        if (headerBytes > PROBE_LIMITS.headerBytes) {
          protocolFailure ||= new Error('Probe header cap exceeded');
          response.writeHead(431); response.end(); return;
        }
        if (isCanonical && provider === 'claude-code-cli'
            && request.method === fixtures.protocol.headMethod
            && request.url === `/${controlPath}${fixtures.protocol.headPathSuffix}`) {
          if (!equalJson(Object.keys(request.headers).sort(), fixtures.protocol.headHeaderNames)) {
            protocolFailure ||= new Error('Unexpected Claude preflight headers');
            response.writeHead(400); response.end(); return;
          }
          validControlRequests += 1;
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end();
          return;
        }
        const pathSuffix = isCanonical
          ? fixtures.protocol.pathSuffix
          : fixtures.control.pathSuffix;
        const expectedPath = `/${controlPath}${pathSuffix}`;
        if (request.url !== expectedPath) {
          response.writeHead(404); response.end(); return;
        }
        const hasOwnerBearer = provider === 'claude-code-cli'
          ? request.headers['x-api-key'] === bearer
          : request.headers.authorization === `Bearer ${bearer}`;
        if (!hasOwnerBearer) {
          response.writeHead(401); response.end(); return;
        }
        let text;
        try {
          text = await collectBody(request, PROBE_LIMITS.bodyBytes);
        } catch (error) {
          protocolFailure ||= error;
          if (!response.headersSent) response.writeHead(413);
          response.end();
          return;
        }
        let body;
        try { body = JSON.parse(text); } catch (error) { protocolFailure ||= error; }
        if (isCanonical) {
          if (request.method !== fixtures.protocol.method
              || !equalJson(Object.keys(request.headers).sort(), fixtures.protocol.headerNames)
              || String(request.headers['content-type'] || '').split(';')[0]
                !== fixtures.protocol.contentType
              || (provider === 'claude-code-cli'
                && request.headers['anthropic-version'] !== fixtures.protocol.anthropicVersion)) {
            protocolFailure ||= new Error('Unexpected provider request metadata');
            response.writeHead(400); response.end(); return;
          }
          try {
            const responseFixture = harness.handle(body);
            validControlRequests += 1;
            response.writeHead(responseFixture.statusCode, responseFixture.headers);
            response.end(responseFixture.body);
          } catch (error) {
            protocolFailure ||= error;
            response.writeHead(400); response.end();
          }
          return;
        }
        const normalizedHeaders = normalizeHeaders(request.headers, bearer, provider);
        if (request.method !== fixtures.control.method
          || !equalJson(normalizedHeaders, fixtures.control.headers)
          || !equalJson(body, fixtures.control.body)) {
          protocolFailure ||= new Error('Unexpected provider request');
          response.writeHead(400); response.end(); return;
        }
        validControlRequests += 1;
        const responseFixture = replaceOwnerValues(fixtures.control.response, {
          __OWNER_CANARY_URL__: canaryUrl,
        });
        response.writeHead(responseFixture.statusCode, responseFixture.headers);
        response.end(JSON.stringify(responseFixture.body));
      });
      if (isCanonical) {
        if (typeof controlServer.on !== 'function') throw new Error('Probe server cannot reject upgrades');
        controlServer.on('upgrade', (request, socket) => {
          upgradeAttempts += 1;
          const valid = provider === 'codex-cli'
            && upgradeAttempts <= PROBE_LIMITS.upgrades
            && request.url === `/${controlPath}${fixtures.protocol.pathSuffix}`
            && request.headers.authorization === `Bearer ${bearer}`;
          if (!valid) protocolFailure ||= new Error('Unexpected provider WebSocket upgrade');
          socket.destroy();
        });
      }
      const controlPort = await listenLoopback(controlServer);
      const controlOrigin = `http://127.0.0.1:${controlPort}`;
      const cleanEnvironment = sanitizeProbeEnvironment(environment);
      let probeEnvironment;
      let args;
      let goal;
      if (provider === 'codex-cli') {
        const home = path.join(ownerDirectory, 'codex-home');
        await fileSystem.mkdir(home, { recursive: true });
        let config = `model_provider = "openai"\nopenai_base_url = "${controlOrigin}/${controlPath}/v1"\n`;
        if (isCanonical) {
          const template = await fileSystem.readFile(
            path.join(input.fixtureRoot, 'codex-probe-config.toml'), 'utf8',
          );
          if (template !== 'model_provider = "openai"\nopenai_base_url = "__OWNER_CONTROL_ORIGIN__/__CONTROL_PATH__/v1"\n') {
            throw new Error('Codex probe config bytes changed');
          }
          config = replaceOwnerValues(template, {
            __OWNER_CONTROL_ORIGIN__: controlOrigin,
            __CONTROL_PATH__: controlPath,
          });
          const projection = validateCodexCodeModeProjection(JSON.parse(await fileSystem.readFile(
            path.join(input.fixtureRoot, 'codex-required-code-mode-tools.json'), 'utf8',
          )));
          if (!equalJson(projection.execRegistry, fixtures.protocol.execRegistry)
              || !equalJson(projection.collaborationTools, fixtures.protocol.collaborationTools)
              || !equalJson(projection.additionalTools, fixtures.protocol.additionalTools
                .map(({ name, type }) => ({ name, type })))) {
            throw new Error('Codex code-mode fixtures disagree');
          }
        }
        await fileSystem.writeFile(path.join(home, 'config.toml'), config, 'utf8');
        probeEnvironment = { ...cleanEnvironment, CODEX_HOME: home, CODEX_API_KEY: bearer };
        args = [
          '--sandbox', 'danger-full-access', '--ask-for-approval', 'never',
          ...codexFeatureArgs(),
          '--model', 'gpt-5.6-terra', '-c', 'model_reasoning_effort="high"',
          'exec', '--ignore-rules', '--ephemeral', '--json',
          '--skip-git-repo-check', '--color', 'never',
        ];
        goal = 'Run the fixed local provider probe.';
      } else if (provider === 'claude-code-cli') {
        const home = path.join(ownerDirectory, 'claude-config');
        await fileSystem.mkdir(home, { recursive: true });
        const claudeOwnerEnvironment = {
          ANTHROPIC_BASE_URL: `${controlOrigin}/${controlPath}`,
          ANTHROPIC_API_KEY: bearer,
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        };
        if (isCanonical) {
          const template = await fileSystem.readFile(
            path.join(input.fixtureRoot, 'claude-2.1.217-probe-env.json'), 'utf8',
          );
          const expectedTemplate = '{\n  "ANTHROPIC_BASE_URL": "__OWNER_CONTROL_ORIGIN__/__CONTROL_PATH__",\n  "ANTHROPIC_API_KEY": "__OWNER_BEARER__",\n  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"\n}\n';
          if (template !== expectedTemplate) throw new Error('Claude probe environment bytes changed');
          const rendered = replaceOwnerValues(JSON.parse(template), {
            __OWNER_CONTROL_ORIGIN__: controlOrigin,
            __CONTROL_PATH__: controlPath,
            __OWNER_BEARER__: bearer,
          });
          if (!equalJson(rendered, claudeOwnerEnvironment)) {
            throw new Error('Claude probe environment changed');
          }
        }
        probeEnvironment = {
          ...cleanEnvironment,
          CLAUDE_CONFIG_DIR: home,
          ...claudeOwnerEnvironment,
        };
        args = [
          '--print', '--verbose', '--output-format', 'stream-json', '--input-format', 'text',
          '--no-session-persistence', '--safe-mode', '--setting-sources', '',
          '--dangerously-skip-permissions', '--no-chrome', '--disable-slash-commands',
          '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
          '--tools', 'Bash,Read,Edit,Write,Glob,Grep',
          '--model', 'sonnet', '--effort', 'high',
        ];
        goal = 'Run the fixed local provider probe.';
      } else {
        throw unavailable();
      }

      if (isCanonical && provider === 'codex-cli') {
        const featureResult = await spawn({
          command: input.cliBinding.path,
          args: [...codexFeatureInspectionArgs(), 'features', 'list'],
          cwd: probeWorkspace,
          env: probeEnvironment,
          signal: controller.signal,
        });
        if (!plain(featureResult) || !Number.isInteger(featureResult.exitCode)) {
          throw new Error('Invalid Codex feature inspection result');
        }
        if (featureResult.exitCode !== 0) {
          if (deterministicCodexFlagFailure(featureResult)) throw probeFailure('incompatible');
          throw probeFailure('check-failed');
        }
        try {
          assertCodexFeaturePolicy(parseCodexFeatureList(featureResult.stdout));
        } catch (error) {
          throw probeFailure('incompatible', error);
        }
      }

      const processResult = await spawn({
        command: input.cliBinding.path,
        args,
        cwd: probeWorkspace,
        env: probeEnvironment,
        goal,
        signal: controller.signal,
      });
      const scenarioReport = harness?.report();
      const expectedControlRequests = provider === 'codex-cli' ? 4 : 3;
      const expectedUpgrades = provider === 'codex-cli' ? 7 : 0;
      if (!plain(processResult) || !Number.isInteger(processResult.exitCode)) {
        throw new Error('Invalid provider process result');
      }
      if (processResult.exitCode !== 0) {
        if (protocolFailure || (provider === 'codex-cli' && deterministicCodexFlagFailure(processResult))) {
          throw probeFailure('incompatible', protocolFailure);
        }
        throw probeFailure('check-failed');
      }
      if (protocolFailure || (!isCanonical && validControlRequests !== 1)
          || (isCanonical && (
            validControlRequests !== expectedControlRequests
            || upgradeAttempts !== expectedUpgrades
            || validCanaryConnections !== 1
            || scenarioReport?.complete !== true
            || !String(processResult.stdout).includes(fixtures.scenario.finalText)
          ))) {
        throw probeFailure('incompatible', protocolFailure);
      }
      if (isCanonical) {
        const expectedOutsideWrite = provider === 'codex-cli' ? 'outside-write-ok' : 'after\n';
        if (await fileSystem.readFile(outsideWrite, 'utf8') !== expectedOutsideWrite
            || (provider === 'codex-cli'
              && await fileSystem.readFile(appliedSentinel, 'utf8') !== 'applied\n')
            || await exists(fileSystem, hookSentinel)
            || await exists(fileSystem, pluginSentinel)) {
          throw probeFailure('incompatible');
        }
      }
      result = {
        provider,
        controlRequests: validControlRequests,
        childCanaryConnections: validCanaryConnections,
        processExitCode: processResult.exitCode,
        cleanup: true,
        ...(isCanonical ? {
          upgradeAttempts,
          scenarioTurns: scenarioReport.turns,
          blockedToolResults: scenarioReport.blockedToolResults,
          credentialScrubbed: true,
        } : {}),
        ...(purpose === 'compatibility' ? { available: true, allowed: true } : {}),
      };
    } catch (error) {
      failure = probeFailure('check-failed', error);
    } finally {
      clearTimeout(deadline);
      input.signal?.removeEventListener('abort', forwardAbort);
      try { await closeServer(controlServer); } catch (error) { cleanupError ||= error; }
      try { await closeServer(canaryServer); } catch (error) { cleanupError ||= error; }
      if (ownerDirectory) {
        try { await fileSystem.rm(ownerDirectory, { recursive: true, force: true }); } catch (error) { cleanupError ||= error; }
      }
      if (cleanupError) failure = probeFailure('check-failed', cleanupError);
    }
    if (failure) {
      throw purpose === 'compatibility' ? failure : unavailable(failure);
    }
    return result;
  }

  return Object.freeze({ run });
}

async function loadFixtures(provider, fixtureRoot, fileSystem = defaultFileSystem) {
  const name = provider === 'codex-cli'
    ? 'codex-responses-fixtures.json'
    : provider === 'claude-code-cli'
      ? 'claude-messages-sse-fixtures.json'
      : null;
  try {
    if (!name) throw new Error('Unknown provider fixture');
    const bytes = await fileSystem.readFile(path.join(fixtureRoot, name));
    const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== FIXTURE_SHA256[provider]) throw new Error('Provider fixture bytes changed');
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw unavailable(error);
  }
}

async function verifyNativeToolSurface({
  provider,
  purpose = 'permission',
  cliBinding,
  workspacePath,
  fixtureRoot,
  signal,
  spawn,
  randomBytes = require('node:crypto').randomBytes,
  environment = process.env,
  fileSystem = defaultFileSystem,
} = {}) {
  if (!['permission', 'compatibility'].includes(purpose)) throw unavailable();
  let fixtures;
  try {
    fixtures = await loadFixtures(provider, fixtureRoot, fileSystem);
  } catch (error) {
    if (purpose === 'compatibility') throw probeFailure('check-failed', error);
    throw error;
  }
  const probe = createLocalProviderProbe({
    provider, purpose, fixtures, spawn, randomBytes, environment, fileSystem,
  });
  try {
    return await probe.run({
      cliBinding,
      workspacePath,
      fixtureRoot,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (purpose === 'compatibility'
      && error instanceof LocalProviderProbeFailure
      && error.kind === 'incompatible') {
      return Object.freeze({ compatible: false });
    }
    throw error;
  }
}

module.exports = {
  FIXTURE_SHA256,
  PROBE_LIMITS,
  createLocalProviderProbe,
  defaultSpawn,
  sanitizeProbeEnvironment,
  verifyNativeToolSurface,
};
