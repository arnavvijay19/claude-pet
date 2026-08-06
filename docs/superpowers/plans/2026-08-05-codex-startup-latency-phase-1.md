# Codex startup latency and reliability (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cached Codex Test Connection, official login, and task preflight complete in about 2-3 s and stop producing `PERMISSION_PROFILE_UNAVAILABLE` from a deadline abort, without weakening exact signed-identity verification.

**Architecture:** Remove work that proves nothing new. The per-task permission probe supplies no fact the compatibility contract does not already provide, so it goes. The probe's arbitrary 10.5 s sleep becomes a deterministic two-marker handshake. Repeated signed-identity verification collapses to one verified lease per operation, and the PowerShell inspection helper becomes a precompiled executable built by the same offline csc.exe step that already produces the provider job host.

**Tech Stack:** Node 22 CommonJS, `node --test`, Electron 43, Windows PowerShell 5.1 (removed in Task 4), .NET Framework 4.0 `csc.exe`, no runtime dependencies.

Design source: `docs/superpowers/specs/2026-08-05-codex-latency-and-ui-repair-design.md` sections 1.1 through 1.8.

## Global Constraints

- No runtime dependencies. `package.json` `dependencies` stays `{}` for all of Phase 1.
- Never weaken exact Codex identity verification. Discovery keeps requiring the exact ordered installer `bin` to standalone `current\bin` to versioned-release junction chain, exact `OpenAI OpCo, LLC` publisher, valid Authenticode signature, SHA-256, volume serial, file ID, and held `--version`.
- A fresh rediscovery and a fresh verified launch lease still precede every real provider process.
- Protected compatibility evidence stays fail-closed and keyed to the complete identity plus policy revision.
- Public errors stay fixed and safe. No paths, hashes, file identities, credentials, command lines, environment values, causes, or raw provider output may cross IPC or reach the renderer.
- Codex minimum version stays `0.145.0`. Codex models stay exactly `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`. Claude Code behavior is unchanged in every task.
- Test command is `npm.cmd test -- tests/<file>` from PowerShell. Full suite is `npm.cmd test`.
- Commits carry no `Co-Authored-By` trailer. Pull request bodies use `## Summary` and `## Verification` sections and no AI-credit trailer.
- Do not install WSL, sign into a provider CLI, or issue a real model request. Every probe run is account-free against loopback with synthetic credentials.
- `master` is never edited directly. Each task branches from the previous task's exact remote merge commit and lands as its own pull request.

## Measured baseline to beat

| Operation | Before |
|---|---:|
| Test Connection (cached) | 13-15 s |
| One inspection-helper open | 4.5-5.6 s |
| Compatibility qualification probe | 24,367 ms |
| Permission probe | aborts at 30,000 ms deadline |

---

### Task 1: Remove the per-task permission probe

Fixes `PERMISSION_PROFILE_UNAVAILABLE` outright and removes roughly 34 s from task preflight. Largest win, smallest change.

**Files:**
- Modify: `src/agent/agentManager.js:210-221`
- Modify: `src/agent/executors/codexNativeFullComputer.js:165-175`
- Test: `tests/agentManager.test.js`
- Test: `tests/nativeFullComputerExecutors.test.js`

**Interfaces:**
- Consumes: `executor.verifyPermissionProfile(connection)` as currently declared by `src/agent/agentContract.js`.
- Produces: the agent contract keeps `verifyPermissionProfile`, but `runGoal` preflight no longer calls it. Codex Full Computer `verifyPermissionProfile` returns `{ available: true, allowed: true }` derived from the compatibility contract rather than running a synthetic probe.

- [ ] **Step 1: Write the failing test proving the probe result is not consulted**

Add to `tests/agentManager.test.js`:

```js
test('run preflight does not call verifyPermissionProfile', async () => {
  const calls = [];
  const executor = {
    async getStatus() { calls.push('getStatus'); return { installed: true, compatible: true, authenticated: true, fullComputerAvailable: true }; },
    async beginSetup() { return { started: false }; },
    async listModels() { calls.push('listModels'); return [{ id: 'gpt-5.6-luna', efforts: ['medium'] }]; },
    async getCapabilities() { calls.push('getCapabilities'); return { permissionProfiles: ['full-computer'], network: true, authentication: true, efforts: ['medium'] }; },
    async verifyPermissionProfile() { calls.push('verifyPermissionProfile'); return { available: true, allowed: true }; },
    async runGoal() { calls.push('runGoal'); return { text: 'done', changedFiles: [] }; },
  };
  const manager = createAgentManager({
    store: fullComputerStore(),
    executors: { 'codex-cli:full-computer': executor },
    activity: recordingActivity(),
  });
  await manager.runGoal('do the thing');
  assert.equal(calls.includes('verifyPermissionProfile'), false);
  assert.equal(calls.includes('runGoal'), true);
});
```

Use the existing `fullComputerStore()` and `recordingActivity()` helpers already present in this test file. If they are named differently in the file, reuse the existing helpers rather than adding new ones.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/agentManager.test.js`
Expected: FAIL, because `calls` contains `verifyPermissionProfile`.

- [ ] **Step 3: Write the second failing test proving the old result carried no readiness facts**

Add to `tests/nativeFullComputerExecutors.test.js`:

```js
test('codex permission verification reports readiness without a synthetic probe', async () => {
  let probeCalls = 0;
  const executor = createCodexNativeFullComputerExecutor({
    runner: stubRunner(),
    codexHome: 'C:\\owned\\home',
    fixtureRoot: 'C:\\owned\\fixtures',
    discoverSignedNativeCli: async () => signedBinding(),
    openVerifiedNativeCliLaunchLease: async () => ({ cleanup: async () => {} }),
    verifyNativeToolSurface: async () => { probeCalls += 1; return {}; },
    writeFullComputerConfig: async () => ({ path: 'C:\\owned\\home\\config.toml', sha256: 'a'.repeat(64) }),
    ensureCodexCompatibility: async () => ({ compatible: true, version: '0.146.0', cached: true }),
  });
  const result = await executor.verifyPermissionProfile(fullComputerConnection());
  assert.deepEqual(result, { available: true, allowed: true });
  assert.equal(probeCalls, 0);
});
```

Reuse the existing `stubRunner()`, `signedBinding()`, and `fullComputerConnection()` helpers in this file.

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm.cmd test -- tests/nativeFullComputerExecutors.test.js`
Expected: FAIL, because `probeCalls` is 1 and `result` is `{}` rather than `{ available: true, allowed: true }`.

- [ ] **Step 5: Remove the preflight call**

In `src/agent/agentManager.js`, delete this block:

```js
      const permission = cloneFrozenJson(
        await executor.verifyPermissionProfile(connection),
        'PROVIDER_OUTPUT_INVALID',
      );
      throwIfAborted(controller.signal);
      if (permission === false || permission?.available === false) {
        throw new AgentError('PERMISSION_PROFILE_UNAVAILABLE');
      }
      if (permission?.allowed === false || permission?.blocked === true) {
        throw new AgentError('PERMISSION_BLOCKED');
      }
```

Leave the rest of `runGoal` unchanged. `getStatus` already fails closed on `installed`, `compatible`, `authenticated`, and `fullComputerAvailable`.

- [ ] **Step 6: Derive Codex permission verification from the compatibility contract**

In `src/agent/executors/codexNativeFullComputer.js`, replace the `verifyPermissionProfile` method body:

```js
    async verifyPermissionProfile(connection) {
      await prepare(connection);
      await compatibleBinding(connection);
      return { available: true, allowed: true };
    },
```

`compatibleBinding` still rediscovers the exact signed executable and still runs `ensureCodexCompatibility`, so qualification before launch is preserved. The `verifyNativeToolSurface` import stays in use by `src/agent/codexCompatibility.js`; do not delete it from that module.

- [ ] **Step 7: Run both tests to verify they pass**

Run: `npm.cmd test -- tests/agentManager.test.js`
Expected: PASS
Run: `npm.cmd test -- tests/nativeFullComputerExecutors.test.js`
Expected: PASS

- [ ] **Step 8: Run the adjacent suites**

Run: `npm.cmd test -- tests/codexCompatibility.test.js tests/localProviderProbe.test.js tests/appWindow.test.js`
Expected: PASS. If a test asserted that `runGoal` calls `verifyPermissionProfile`, update it to assert the new behavior and record why in the commit body.

- [ ] **Step 9: Run the full suite**

Run: `npm.cmd test`
Expected: 0 failing, 1 intentional live-provider skip.

- [ ] **Step 10: Commit**

```bash
git add src/agent/agentManager.js src/agent/executors/codexNativeFullComputer.js tests/agentManager.test.js tests/nativeFullComputerExecutors.test.js
git commit -m "fix: stop running the per-task Codex permission probe

The permission-purpose probe never emitted available or allowed, so the
agent manager's two readiness checks could not fire. The probe was a pure
pass-or-throw gate that cost about 34 s per task and produced
PERMISSION_PROFILE_UNAVAILABLE whenever its 30 s deadline expired.

Readiness now comes from the compatibility contract, which already
rediscovers the exact signed executable and qualifies it before launch."
```

- [ ] **Step 11: Open the pull request**

```bash
git push -u origin codex/phase-1-task-1-remove-permission-probe
```

Then `gh pr create --base master` with a `## Summary` and `## Verification` body. Record the measured task-preflight time before and after.

---

### Task 2: Deterministic wait handshake replaces the 10.5 s sleep

**Files:**
- Modify: `src/agent/localProviderProbe.js:175-201` (`buildCodexExec`), `:387-392` (owner path declarations), `:446-460` (harness construction)
- Modify: `resources/probes/local-provider-harness.js:415-440` (`createCodexHarness`)
- Test: `tests/localProviderProbe.test.js`

**Interfaces:**
- Consumes: the `owner` object passed to `scenarioHarnessFactory`, currently `{ outsideRead, outsideWrite, codexExec, canaryCommand }`.
- Produces: `owner` gains `waitStartedPath` and `waitArmedPath` (absolute strings), `armWait()` (writes the armed sentinel), and `startedWait()` (returns boolean, true once the exec cell has published its started marker). `buildCodexExec` gains `waitStartedPath` and `waitArmedPath` parameters.

Do not modify `resources/probes/codex-responses-fixtures.json`. Its bytes are pinned by `FIXTURE_SHA256` in `src/agent/localProviderProbe.js`; changing it would require updating that constant and is unnecessary for this task.

- [ ] **Step 1: Write the failing test**

Add to `tests/localProviderProbe.test.js`:

```js
test('codex exec waits on the armed sentinel instead of a fixed sleep', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'agent', 'localProviderProbe.js'),
    'utf8',
  );
  assert.equal(/Start-Sleep -Milliseconds 10500/.test(source), false);
  assert.equal(source.includes('__WAIT_ARMED__'), true);
  assert.equal(source.includes('__WAIT_STARTED__'), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/localProviderProbe.test.js`
Expected: FAIL on the first assertion, because the fixed sleep is still present.

- [ ] **Step 3: Replace the sleep with a two-marker handshake**

In `src/agent/localProviderProbe.js`, replace `buildCodexExec`:

```js
function buildCodexExec({
  workspace, outsideRead, outsideWrite, imagePath, canaryUrl, waitStartedPath, waitArmedPath,
}) {
  const shellCommand = [
    `$read = Get-Content -Raw -LiteralPath ${JSON.stringify(outsideRead)}`,
    `Set-Content -NoNewline -LiteralPath ${JSON.stringify(outsideWrite)} -Value outside-write-ok`,
    `Invoke-WebRequest -UseBasicParsing -Uri ${JSON.stringify(canaryUrl)} | Out-Null`,
    `Set-Content -NoNewline -LiteralPath ${JSON.stringify(waitStartedPath)} -Value __WAIT_STARTED__`,
    `$deadline = (Get-Date).AddSeconds(20)`,
    `while (-not (Test-Path -LiteralPath ${JSON.stringify(waitArmedPath)}) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 25 }`,
    `if (-not (Test-Path -LiteralPath ${JSON.stringify(waitArmedPath)})) { throw '__WAIT_ARMED__ never observed' }`,
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
      command: shellCommand, workdir: workspace, timeout_ms: 25000,
    })}); text(shell);`,
    `const patched = await tools.apply_patch(${JSON.stringify(patch)}); text(patched);`,
    `const viewed = await tools.view_image(${JSON.stringify({ path: imagePath, detail: 'original' })}); image(viewed.image_url);`,
    `const planned = await tools.update_plan(${JSON.stringify({
      plan: [{ step: 'fixed local provider probe', status: 'completed' }],
    })}); text(planned);`,
  ].join(' ');
}
```

The exec cell now signals that it is genuinely running (`waitStartedPath`), then blocks until the harness arms it (`waitArmedPath`). Elapsed time is no longer the coordinating mechanism.

- [ ] **Step 4: Declare the sentinel paths and pass them to the harness**

In `src/agent/localProviderProbe.js`, beside the existing owner path declarations, add:

```js
      const waitStartedPath = path.join(ownerDirectory, 'wait-started.txt');
      const waitArmedPath = path.join(ownerDirectory, 'wait-armed.txt');
```

Then extend the `scenarioHarnessFactory` call's `owner` object:

```js
          owner: {
            outsideRead,
            outsideWrite,
            waitStartedPath,
            waitArmedPath,
            armWait: () => fileSystem.writeFile(waitArmedPath, 'armed', 'utf8'),
            codexExec: buildCodexExec({
              workspace: probeWorkspace, outsideRead, outsideWrite, imagePath, canaryUrl,
              waitStartedPath, waitArmedPath,
            }),
            canaryCommand: buildClaudeCanaryCommand(canaryUrl),
          },
```

- [ ] **Step 5: Arm the wait from the harness and prove the cell was in flight**

In `resources/probes/local-provider-harness.js`, inside `createCodexHarness`, replace the `turn === 1` branch:

```js
      } else if (turn === 1) {
        const result = callResults(body).find((item) => item.call_id === calls[0].id);
        const match = /cell ID\s+([A-Za-z0-9_-]+)/i.exec(resultText(result));
        if (!match) throw new Error('Codex exec did not yield a bounded command');
        if (!owner.startedWait()) throw new Error('Codex exec cell was not running when wait was issued');
        events = codexFunctionEvents(body.model, [{
          ...calls[1],
          arguments: { cell_id: match[1], yield_time_ms: 20000, max_tokens: 10000 },
        }], 'wait');
        owner.armWait();
      } else if (turn === 2) {
```

Add `startedWait` to the owner object in `src/agent/localProviderProbe.js`:

```js
            startedWait: () => require('node:fs').existsSync(waitStartedPath),
```

Ordering is now explicit: the exec cell publishes that it started, the harness verifies that marker exists before issuing `wait`, then arms the sentinel so the cell finishes while `wait` is in flight. `turn === 2` still requires `wait-ok`, `read-ok`, and `child-canary-ok` in the wait result, so the property under test is unchanged and better evidenced.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm.cmd test -- tests/localProviderProbe.test.js`
Expected: PASS

- [ ] **Step 7: Run the live account-free qualification and record the timing**

Run: `node scripts/diagnose-codex-compatibility.js`
Expected: bounded compatible JSON for official Codex `0.146.0` with `cleanup: true`, completing in about 13 s rather than about 24 s. Record the measured duration in the commit body.

- [ ] **Step 8: Run the full suite**

Run: `npm.cmd test`
Expected: 0 failing, 1 intentional live-provider skip.

- [ ] **Step 9: Commit and open the pull request**

```bash
git add src/agent/localProviderProbe.js resources/probes/local-provider-harness.js tests/localProviderProbe.test.js
git commit -m "perf: replace the probe's fixed sleep with a wait handshake

The 10.5 s Start-Sleep existed only to keep the async exec cell in flight
until the real Codex wait tool was issued. Elapsed time was never the
safety property. The cell now publishes a started marker, the harness
verifies it before issuing wait, and arms a sentinel so the cell completes
during the wait. Coverage of async exec plus wait is retained and better
evidenced."
git push -u origin codex/phase-1-task-2-wait-handshake
```

---

### Task 3: One verified lease per operation

**Files:**
- Modify: `src/agent/executors/codexNativeFullComputer.js:88-129` and the returned method bodies
- Modify: `src/agent/nativeCliDiscovery.js` (accept a caller-supplied inspection session)
- Test: `tests/nativeFullComputerExecutors.test.js`
- Test: `tests/nativeCliDiscovery.test.js`

**Interfaces:**
- Consumes: `discoverSignedNativeCli({ provider, workspacePath })` and `openVerifiedNativeCliLaunchLease(binding)` as they exist after Tasks 1 and 2.
- Produces: `withVerifiedCodex(connection, operation, signal)` inside the Codex Full Computer executor. It performs exactly one inspection-helper open, yields `{ binding, lease }` to `operation`, and cleans up once. `discoverSignedNativeCli` gains an optional `session` option so discovery can reuse an already-open inspection session instead of opening its own.

- [ ] **Step 1: Write the failing test**

Add to `tests/nativeFullComputerExecutors.test.js`:

```js
test('codex status opens the inspection helper exactly once', async () => {
  let opens = 0;
  const executor = createCodexNativeFullComputerExecutor({
    runner: {
      capture: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      launch: async () => ({}),
      streamJsonl: async () => {},
    },
    codexHome: 'C:\\owned\\home',
    fixtureRoot: 'C:\\owned\\fixtures',
    discoverSignedNativeCli: async () => { opens += 1; return signedBinding(); },
    openVerifiedNativeCliLaunchLease: async () => { opens += 1; return { cleanup: async () => {} }; },
    verifyNativeToolSurface: async () => ({ available: true, allowed: true }),
    writeFullComputerConfig: async () => ({ path: 'C:\\owned\\home\\config.toml', sha256: 'a'.repeat(64) }),
    ensureCodexCompatibility: async () => ({ compatible: true, version: '0.146.0', cached: true }),
  });
  const status = await executor.getStatus(fullComputerConnection());
  assert.equal(status.installed, true);
  assert.equal(opens, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/nativeFullComputerExecutors.test.js`
Expected: FAIL with `opens` equal to 2, because `getStatus` calls `discover` and then `withLease`.

- [ ] **Step 3: Add the single-open helper**

In `src/agent/executors/codexNativeFullComputer.js`, replace `compatibleBinding` and `withLease` usage inside the returned methods with:

```js
  async function withVerifiedCodex(connection, operation, signal) {
    validateConnection(connection);
    let binding;
    try {
      binding = await discoverSignedNativeCli({
        provider: 'codex-cli', workspacePath: connection.workspacePath,
      });
      if (!validBinding(binding)) throw new Error('Invalid Codex CLI binding');
    } catch (error) {
      if (error instanceof AgentError
          && ['UNSUPPORTED_OPTION', 'FULL_COMPUTER_CONFIRMATION_REQUIRED'].includes(error.code)) throw error;
      throw new AgentError('CLI_NOT_INSTALLED', { cause: error });
    }
    await ensureCodexCompatibility(binding, { signal });
    let lease;
    let operationError;
    try {
      lease = await openVerifiedNativeCliLaunchLease(binding);
      return await operation({ binding, lease });
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      if (lease?.cleanup) {
        try { await lease.cleanup(); } catch (error) { if (!operationError) throw error; }
      }
    }
  }
```

`discoverSignedNativeCli` and `openVerifiedNativeCliLaunchLease` still each open a session at this point. Step 4 collapses them.

- [ ] **Step 4: Let discovery hand its verified session to the lease**

In `src/agent/nativeCliDiscovery.js`, have `discoverSignedNativeCli` accept and return an optional live session so the caller can pass it to `openVerifiedNativeCliLaunchLease`:

```js
async function discoverSignedNativeCli({ provider, workspacePath, retainSession = false } = {}) {
```

When `retainSession` is true, return `{ binding, session }` where `session` is the still-open inspection session whose facts already satisfied every identity check. In `src/agent/nativeCliLaunchLease.js`, `openVerifiedNativeCliLaunchLease(binding, { session })` uses the supplied session instead of calling `helper.open(expected.path)`, and skips the redundant re-verification because the handle is still held under `FILE_SHARE_READ` and the bytes therefore cannot have changed. It still runs the `--version` capture.

Wire `withVerifiedCodex` to use `retainSession: true` and pass the session through.

- [ ] **Step 5: Update the returned methods to use the helper**

```js
    async getStatus(connection) {
      try {
        return await withVerifiedCodex(connection, async ({ binding, lease }) => {
          const login = await runner.capture({
            command: binding.path, launchLease: lease, args: ['login', 'status'],
            env: environment, timeoutMs: 5000,
          });
          const authenticated = login?.exitCode === 0;
          return { installed: true, compatible: true, authenticated, fullComputerAvailable: authenticated };
        });
      } catch (error) {
        if (error instanceof AgentError && error.code === 'CLI_NOT_INSTALLED') {
          return { installed: false, authenticated: false, fullComputerAvailable: false };
        }
        if (error instanceof AgentError && error.code === 'CLI_VERSION_UNSUPPORTED') {
          return { installed: true, compatible: false, authenticated: false, fullComputerAvailable: false };
        }
        if (error instanceof AgentError && error.code === 'CLI_COMPATIBILITY_CHECK_FAILED') throw error;
        return { installed: true, compatible: true, authenticated: false, fullComputerAvailable: false };
      }
    },
```

Apply the same single-open pattern to `beginSetup`, `verifyPermissionProfile`, and `runGoal`. In `runGoal`, keep `prepare()` immediately before the launch so `config.toml` is rewritten from current bytes on every real run.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm.cmd test -- tests/nativeFullComputerExecutors.test.js tests/nativeCliDiscovery.test.js tests/nativeCliLaunchLease.test.js`
Expected: PASS

- [ ] **Step 7: Measure and record**

Launch the app with `npm.cmd start`, press Test on the saved Codex connection, and record the wall-clock time. Expected: about 5-6 s, down from 13-15 s. Task 4 takes it to about 2 s.

- [ ] **Step 8: Run the full suite, then commit and open the pull request**

Run: `npm.cmd test`
Expected: 0 failing, 1 intentional live-provider skip.

```bash
git push -u origin codex/phase-1-task-3-single-lease
```

---

### Task 4: Precompiled inspection helper

**Files:**
- Create: `resources/windows/native-cli-inspector.cs`
- Create: `scripts/build-native-cli-inspector.js`
- Modify: `package.json` (`build:helpers` script, referenced by `prestart` and `prepackage:win`)
- Modify: `src/agent/nativeCliLaunchLease.js:440-529` (`createNativeCliInspectionHelper`)
- Delete: `resources/windows/inspect-native-cli.ps1`
- Test: `tests/buildNativeCliInspector.test.js`
- Test: `tests/nativeCliLaunchLease.test.js`

**Interfaces:**
- Consumes: the csc.exe resolution, bounded compile, and SHA-256 recording approach in `scripts/build-provider-job-host.js`.
- Produces: `resources/windows/generated/native-cli-inspector.exe` plus `native-cli-inspector.build.json` containing `protocolVersion`, `architecture`, `compilerPath`, `compilerVersion`, `sourceSha256`, `executableSha256`. `createNativeCliInspectionHelper` spawns that executable instead of `powershell.exe` and keeps its existing newline-delimited JSON contract unchanged: one `{ "path": "..." }` request in, one `{ "type": "ready", "facts": { ... } }` response out, then `{ "action": "release" }` or EOF.

The C# source performs exactly what the PowerShell script did: open the file `FILE_SHARE_READ` with `SequentialScan`, `GetFileInformationByHandle`, `GetFinalPathNameByHandle`, `GetFileType`, walk and normalize the reparse chain, SHA-256 the stream, `Get-AuthenticodeSignature` equivalent via `X509Certificate.CreateFromSignedFile` plus `WinVerifyTrust`, read `FileVersionInfo`, and emit the same `facts` keys: `path`, `regularFile`, `reparsePoint`, `reparseChain`, `sha256`, `volumeSerial`, `fileId`, `fileVersion`, `publisher`, `signatureValid`.

- [ ] **Step 1: Write the failing build test**

Create `tests/buildNativeCliInspector.test.js`, modeled on `tests/buildProviderJobHost.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildNativeCliInspector } = require('../scripts/build-native-cli-inspector.js');

test('build emits a deterministic inspector and records both hashes', () => {
  const record = buildNativeCliInspector();
  assert.equal(record.protocolVersion, 1);
  assert.equal(record.architecture, 'x64');
  assert.match(record.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(record.executableSha256, /^[a-f0-9]{64}$/);
  const generated = path.join(__dirname, '..', 'resources', 'windows', 'generated', 'native-cli-inspector.exe');
  assert.equal(fs.existsSync(generated), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/buildNativeCliInspector.test.js`
Expected: FAIL with `Cannot find module '../scripts/build-native-cli-inspector.js'`.

- [ ] **Step 3: Write the C# inspector and the build script**

Port `resources/windows/inspect-native-cli.ps1` to C# line by line. Read that file first; it is deleted in Step 6 of this same task, so port before deleting (it also remains in git history at `a435732`). The port must be behavior-identical, not a reinterpretation — every check, bound, and thrown condition carries over.

Required P/Invoke surface, already present in the PowerShell script's inline `ClaudePetNativeCliInspection` type and to be reused verbatim:

```csharp
[DllImport("kernel32.dll", SetLastError = true)]
static extern bool GetFileInformationByHandle(SafeFileHandle handle, out BY_HANDLE_FILE_INFORMATION information);

[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint pathLength, uint flags);

[DllImport("kernel32.dll", SetLastError = true)]
static extern uint GetFileType(SafeFileHandle handle);
```

Behavior to preserve exactly:

- Open with `FileMode.Open`, `FileAccess.Read`, `FileShare.Read`, buffer 4096, `FileOptions.SequentialScan`. Hold the handle until release.
- Reject any request whose single key is not `path`, or whose path is not rooted, or does not end in `.exe`, or exceeds 32768 UTF-8 bytes.
- `regularFile` is `GetFileType(handle) == 1` and not a directory.
- Reparse chain walk: bounded to depth 8, reject cycles, reject any `LinkType` other than `Junction` or `SymbolicLink`, normalize `\??\` and `\\?\` prefixes, reject a terminal path that does not equal the handle's final path, reject any normalized entry over 16384 UTF-8 bytes.
- SHA-256 computed over the same held stream from position 0.
- `signatureValid` is true only when Authenticode status is `Valid`. Use `WinVerifyTrust` via `wintrust.dll` with `WINTRUST_ACTION_GENERIC_VERIFY_V2`, and read the signer organization from the `O=` field of the signer certificate's decoded subject, returning empty string when absent.
- `fileVersion` is `ProductVersion`, falling back to `FileVersion`, then empty string.
- Emit one compact JSON line, reject any result over 32768 UTF-8 bytes, then block reading one further line that must be exactly `{"action":"release"}` or EOF. Exit 0 only on a clean release.
- On any pre-ready failure emit `{"type":"error","code":"INSPECTION_FAILED"}` and exit 1. Never emit an exception message.

Write `scripts/build-native-cli-inspector.js` following `scripts/build-provider-job-host.js` exactly: `defaultCompilerCandidates`, `resolveCompiler`, bounded `spawnCompiler` with a 30 s timeout and 64 KiB max buffer, `sha256File`, atomic write of the `.build.json` record, and recovery-directory cleanup. Compile with `/platform:x64 /optimize+ /nologo /target:exe /deterministic`.

- [ ] **Step 3b: Prove the port is behavior-identical before deleting the script**

Add to `tests/nativeCliLaunchLease.test.js` a test that runs both the compiled inspector and the PowerShell script against the same real `codex.exe` and asserts the two `facts` objects are deeply equal. This test exists only for this task and is removed in Step 6 together with the script; record that removal in the commit body.

Run: `npm.cmd test -- tests/nativeCliLaunchLease.test.js`
Expected: PASS with the two fact objects identical.

Add to `package.json`:

```json
    "build:helpers": "node scripts/build-provider-job-host.js && node scripts/build-native-cli-inspector.js",
    "prestart": "npm run build:helpers",
    "prepackage:win": "npm run build:helpers",
```

- [ ] **Step 4: Run the build test to verify it passes**

Run: `npm.cmd test -- tests/buildNativeCliInspector.test.js`
Expected: PASS

- [ ] **Step 5: Point the helper at the compiled executable**

In `src/agent/nativeCliLaunchLease.js`, change `createNativeCliInspectionHelper` so `spawn` targets `resources/windows/generated/native-cli-inspector.exe` with no arguments, instead of `powershell.exe` with `-File`. Keep `minimalHelperEnvironment`, `windowsHide: true`, `stdio: ['pipe','pipe','pipe']`, the bounded line reader, the release protocol, and `stopHelper` exactly as they are.

- [ ] **Step 6: Delete the PowerShell script**

```bash
git rm resources/windows/inspect-native-cli.ps1
```

Confirm no remaining reference: `grep -rn "inspect-native-cli" src scripts tests resources` returns nothing.

- [ ] **Step 7: Run the lease and discovery tests**

Run: `npm.cmd test -- tests/nativeCliLaunchLease.test.js tests/nativeCliDiscovery.test.js`
Expected: PASS

- [ ] **Step 8: Measure against the targets**

Launch with `npm.cmd start`. Record Test Connection and official-login launch times. Targets: Test Connection about 2 s, login about 2.5 s, task preflight about 3 s. If a target is not met, report the measured boundary in the pull request rather than weakening any verification step.

- [ ] **Step 9: Verify packaging integrity**

Run: `npm.cmd run package:win` then `npm.cmd run verify:package`
Expected: verification passes. Update the verifier's expected file count and byte total in the same commit, and confirm the generated `.exe` is included while `.cs` sources and `.pdb` files are excluded.

- [ ] **Step 10: Run the full suite, then commit and open the pull request**

```bash
git push -u origin codex/phase-1-task-4-precompiled-inspector
```

---

### Task 5: Stage timing and fixed public outcomes

**Files:**
- Create: `src/agent/stageTiming.js`
- Modify: `src/agent/executors/codexNativeFullComputer.js`
- Modify: `src/agent/agentErrors.js`
- Test: `tests/stageTiming.test.js`
- Test: `tests/appWindow.test.js`

**Interfaces:**
- Consumes: `withVerifiedCodex` from Task 3.
- Produces: `createStageTimer({ enabled })` returning `{ stage(name, fn), report() }`. `report()` returns a frozen array of `{ name, ms, outcome }` where `name` is drawn from the fixed set `discovery`, `evidence-lookup`, `qualification`, `login-status`, `config`, `lease`, `provider-start`, and `outcome` is one of `ok`, `failed`, `cancelled`. Enabled only when the app is unpackaged and the diagnostic flag is set.

- [ ] **Step 1: Write the failing test**

Create `tests/stageTiming.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createStageTimer } = require('../src/agent/stageTiming.js');

test('disabled timer records nothing and still returns the value', async () => {
  const timer = createStageTimer({ enabled: false });
  assert.equal(await timer.stage('discovery', async () => 7), 7);
  assert.deepEqual(timer.report(), []);
});

test('enabled timer records fixed stage names and outcomes only', async () => {
  const timer = createStageTimer({ enabled: true });
  await timer.stage('discovery', async () => 'binding');
  await assert.rejects(timer.stage('qualification', async () => { throw new Error('C:\\secret\\path'); }));
  const report = timer.report();
  assert.deepEqual(report.map((row) => row.name), ['discovery', 'qualification']);
  assert.deepEqual(report.map((row) => row.outcome), ['ok', 'failed']);
  assert.equal(report.every((row) => Number.isInteger(row.ms)), true);
  assert.equal(JSON.stringify(report).includes('secret'), false);
});

test('unknown stage names are rejected', () => {
  const timer = createStageTimer({ enabled: true });
  assert.rejects(() => timer.stage('arbitrary', async () => 1));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/stageTiming.test.js`
Expected: FAIL with `Cannot find module '../src/agent/stageTiming.js'`.

- [ ] **Step 3: Implement the timer**

Create `src/agent/stageTiming.js`:

```js
'use strict';

const STAGES = Object.freeze([
  'discovery', 'evidence-lookup', 'qualification', 'login-status',
  'config', 'lease', 'provider-start',
]);

function createStageTimer({ enabled = false } = {}) {
  const rows = [];
  return Object.freeze({
    async stage(name, fn) {
      if (!STAGES.includes(name)) throw new TypeError('Unknown stage');
      if (!enabled) return fn();
      const started = process.hrtime.bigint();
      let outcome = 'ok';
      try {
        return await fn();
      } catch (error) {
        outcome = error?.name === 'AbortError' ? 'cancelled' : 'failed';
        throw error;
      } finally {
        rows.push(Object.freeze({
          name,
          ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
          outcome,
        }));
      }
    },
    report() { return Object.freeze([...rows]); },
  });
}

module.exports = { STAGES, createStageTimer };
```

Only the fixed name, an integer duration, and a fixed outcome category are retained. The error itself is rethrown but never recorded, so no path, hash, credential, command line, or provider output can enter the report.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm.cmd test -- tests/stageTiming.test.js`
Expected: PASS

- [ ] **Step 5: Wrap the Codex stages**

In `src/agent/executors/codexNativeFullComputer.js`, wrap the `withVerifiedCodex` internals in `timer.stage('discovery', ...)`, `timer.stage('qualification', ...)`, and `timer.stage('lease', ...)`, and wrap the `login status` capture, the `prepare` call, and the provider launch in `login-status`, `config`, and `provider-start`. The timer is constructed disabled unless the app is unpackaged and the diagnostic flag is set. The report never crosses IPC.

- [ ] **Step 6: Add the fixed public outcomes**

In `src/agent/agentErrors.js`, ensure the seven outcomes from spec section 1.7 each map to a distinct fixed public code: not installed, verifying update, incompatible update, verification temporarily failed, not signed in, local configuration unavailable, provider launch failed. Add an `appWindow` regression proving only the public code survives IPC, matching the existing Task 6 regression pattern in `tests/appWindow.test.js`.

- [ ] **Step 7: Run the full suite, then commit and open the pull request**

Run: `npm.cmd test`
Expected: 0 failing, 1 intentional live-provider skip.

```bash
git push -u origin codex/phase-1-task-5-stage-timing
```

---

### Task 6: Stop cancels the active bounded operation and cleans its owned tree

Covers spec section 1.8. Task 3 introduced a lease held across a whole operation, so cancellation now has to unwind more than a single spawn.

**Files:**
- Modify: `src/agent/executors/codexNativeFullComputer.js` (`withVerifiedCodex` abort handling)
- Modify: `src/agent/agentManager.js` (`stop`)
- Test: `tests/nativeFullComputerExecutors.test.js`
- Test: `tests/windowsProcessTree.test.js`

**Interfaces:**
- Consumes: `withVerifiedCodex` from Task 3, `terminateWindowsProcessTree({ pid, execFile })` from `src/agent/windowsProcessTree.js`, and `AgentError('RUN_STOPPED')`.
- Produces: no new exported surface. `withVerifiedCodex` accepts the run signal, aborts the in-flight stage, releases the lease exactly once, and terminates the owned provider process tree before resolving.

- [ ] **Step 1: Write the failing test**

Add to `tests/nativeFullComputerExecutors.test.js`:

```js
test('stop during a run releases the lease once and terminates the owned tree', async () => {
  const controller = new AbortController();
  let releases = 0;
  let terminated = 0;
  const executor = createCodexNativeFullComputerExecutor({
    runner: {
      capture: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      launch: async () => ({}),
      streamJsonl: async (spec) => {
        controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 10));
        terminated += 1;
        const error = new Error('Aborted');
        error.name = 'AbortError';
        throw error;
      },
    },
    codexHome: 'C:\\owned\\home',
    fixtureRoot: 'C:\\owned\\fixtures',
    discoverSignedNativeCli: async () => signedBinding(),
    openVerifiedNativeCliLaunchLease: async () => ({ cleanup: async () => { releases += 1; } }),
    verifyNativeToolSurface: async () => ({ available: true, allowed: true }),
    writeFullComputerConfig: async () => ({ path: 'C:\\owned\\home\\config.toml', sha256: 'a'.repeat(64) }),
    ensureCodexCompatibility: async () => ({ compatible: true, version: '0.146.0', cached: true }),
  });
  await assert.rejects(() => executor.runGoal(
    fullComputerRequest(), () => {}, controller.signal, fullComputerRun(),
  ));
  assert.equal(releases, 1);
  assert.equal(terminated, 1);
});
```

Reuse the existing `fullComputerRequest()` and `fullComputerRun()` helpers in this file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/nativeFullComputerExecutors.test.js`
Expected: FAIL, because the lease is released more than once or the abort escapes before cleanup.

- [ ] **Step 3: Make cancellation unwind exactly once**

In `withVerifiedCodex`, guard `lease.cleanup()` with a `released` boolean so an abort racing a normal finish cannot release twice, and forward the run signal into `ensureCodexCompatibility` and the provider launch so an abort during qualification is also bounded. Preserve the existing rule that a cleanup error is only rethrown when the operation itself succeeded.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm.cmd test -- tests/nativeFullComputerExecutors.test.js tests/windowsProcessTree.test.js tests/agentManager.test.js`
Expected: PASS

- [ ] **Step 5: Verify with a real cancelled run**

Launch with `npm.cmd start`, begin a Full Computer Codex task against `C:\Users\eklip\Desktop\a`, press Stop, then confirm no orphaned processes remain:

Run: `powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='codex.exe' or Name='codex-code-mode-host.exe'\" | Select-Object ProcessId,CreationDate"`
Expected: no process created during the cancelled run survives. Record the before and after listing in the pull request.

- [ ] **Step 6: Run the full suite, then commit and open the pull request**

```bash
git push -u origin codex/phase-1-task-6-stop-cleanup
```

---

## Phase 1 exit gates

Do not call Phase 1 complete until all of these pass and are recorded:

- [ ] `npm.cmd test` — 0 failing, 1 intentional live-provider skip
- [ ] `py -3.12 -m pytest -q` — 3/3
- [ ] `node --check` on every changed source file
- [ ] `git diff --check`
- [ ] Fresh `npm.cmd run package:win` and `npm.cmd run verify:package`, with updated expected file count and byte total
- [ ] Package scan confirms no `.workbuddy-ai`, `LOCAL_PR.html`, `.superpowers`, `.github`, `.gitattributes`, `.gitignore`, source maps, `.cs` sources, or `.pdb` files
- [ ] Real-app measurement recorded for cached Test Connection, cached official login launch, and cached task preflight
- [ ] `node scripts/diagnose-codex-compatibility.js` reports compatible official Codex with `cleanup: true`
- [ ] A real Full Computer Codex task runs to completion against `C:\Users\eklip\Desktop\a` without `PERMISSION_PROFILE_UNAVAILABLE`
- [ ] `docs/BUILD_LOG.md` field notes and `PROJECT_CHECKLIST.html` refreshed
- [ ] All six pull requests merged remotely; local `master` never edited directly
