# Claude Pet Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close review findings R1-R9, R11, and R12 while preserving the current unified app workflow.

**Architecture:** Introduce shared goal and attachment policies, make the unused loopback server explicitly authenticated and opt-in, harden provider child lifecycles, and route production through already-tested encryption helpers. Every privileged boundary validates before mutating state and fails closed without exposing secrets to renderers.

**Tech Stack:** Electron 43, Node.js CommonJS, `node:test`, Windows PowerShell helper scripts, native `safeStorage`, vanilla JavaScript.

## Global Constraints

- Work only on branch `codex/security-ui-hardening`, based on design commit `adb48be`.
- Do not read, edit, stage, launch, stop, or otherwise alter `.workbuddy-ai/`, `LOCAL_PR.html`, WorkBuddy AI, or `C:\Users\eklip\Desktop\review_findings.json`.
- Use `npm.cmd`, not `npm`, from PowerShell.
- Keep packaged production free of test executors, credentials, prompt tokens, runtime stores, source maps, and development trees.
- Keep the loopback prompt server disabled unless both an explicit port and a fresh token of at least 32 UTF-8 bytes are supplied.
- Use `MAX_GOAL_BYTES = 8192` for HTTP, IPC, retry, notices, and persisted turns.
- Keep one attachment at or below 48 KiB (`49152` bytes), require an allowlisted extension, fatal UTF-8 decoding, and NUL rejection.
- Do not install WSL, sign into a provider, or run a real Codex/Claude task.
- Preserve single-run sequential participant routing and all existing Full Computer confirmation rules.
- Follow red-green TDD and commit after each task.

---

## File Structure

### New files

- `src/agent/goalLimits.js`: one byte-based goal validation contract.
- `src/bridge/attachmentPolicy.js`: attachment extension, size, and public-format policy.
- `resources/windows/inspect-process.ps1`: bounded exact executable-path lookup for a PID.
- `tests/goalLimits.test.js`: shared goal validation coverage.
- `tests/attachmentPolicy.test.js`: extension and metadata policy coverage.

### Modified files

- `src/bridge/promptServer.js`, `src/runtimeArguments.js`, `src/main.js`: opt-in authenticated server.
- `src/appWindow.js`, `src/app/appSnapshot.js`: validate goals before request/notice mutation.
- `src/agent/cliRunner.js`, `src/agent/windowsProcessTree.js`: stdin and PID identity lifecycle.
- `src/agent/localProviderProbe.js`: owned abort deadline, process cleanup, minimal environment.
- `src/agent/safeStorageCrypto.js`, `src/agent/sessionStore.js`, `src/agentRuntime.js`: production crypto and ciphertext bounds.
- `src/bridge/fileContext.js`, `src/bridge/attachmentAuthorization.js`: shared attachment enforcement.
- `scripts/verify_package.js`: streaming fail-closed text scan.
- `docs/project-context.md`, `docs/BUILD_LOG.md`, `PROJECT_CHECKLIST.html`: canonical state.

---

### Task 1: Shared goal contract and fail-safe visible requests

**Files:**
- Create: `src/agent/goalLimits.js`
- Create: `tests/goalLimits.test.js`
- Modify: `src/appWindow.js`
- Modify: `src/app/appSnapshot.js`
- Modify: `tests/appLifecycle.test.js`
- Modify: `tests/appWindow.test.js`
- Modify: `tests/appSnapshot.test.js`

**Interfaces:**
- Produces: `MAX_GOAL_BYTES: 8192`
- Produces: `validateGoal(value): string`, returning the original valid string or throwing `AgentError('GOAL_REQUIRED')` / `AgentError('UNSUPPORTED_OPTION')`
- Produces: `boundedNoticeRequest(value): string | undefined`
- Consumes later: Task 2 prompt server and the UI plan submission boundary.

- [ ] **Step 1: Write failing goal-limit tests**

```js
const { MAX_GOAL_BYTES, validateGoal } = require('../src/agent/goalLimits.js');

test('uses one 8192-byte well-formed UTF-8 goal contract', () => {
  assert.equal(MAX_GOAL_BYTES, 8192);
  assert.equal(validateGoal('é'.repeat(4096)), 'é'.repeat(4096));
  assert.throws(() => validateGoal('é'.repeat(4097)), /UNSUPPORTED_OPTION/);
  assert.throws(() => validateGoal(''), /GOAL_REQUIRED/);
  assert.throws(() => validateGoal('\0'), /UNSUPPORTED_OPTION/);
});
```

Add request-tracker coverage proving an invalid value does not replace the last valid retry request,
and snapshot coverage proving an oversized optional notice request is omitted while publication
continues.

- [ ] **Step 2: Run the focused tests and witness RED**

Run:

```powershell
node --test tests/goalLimits.test.js tests/appLifecycle.test.js tests/appWindow.test.js tests/appSnapshot.test.js
```

Expected: failure because `goalLimits.js` does not exist and current boundaries use 65,536
characters.

- [ ] **Step 3: Implement the shared validator**

```js
'use strict';
const { AgentError } = require('./agentErrors.js');
const MAX_GOAL_BYTES = 8192;

function validateGoal(value) {
  if (typeof value !== 'string' || value.length === 0) throw new AgentError('GOAL_REQUIRED');
  if (value.includes('\0')
      || (typeof value.isWellFormed === 'function' && !value.isWellFormed())
      || Buffer.byteLength(value, 'utf8') > MAX_GOAL_BYTES) {
    throw new AgentError('UNSUPPORTED_OPTION');
  }
  return value;
}

function boundedNoticeRequest(value) {
  try { return value === undefined ? undefined : validateGoal(value); }
  catch { return undefined; }
}

module.exports = { MAX_GOAL_BYTES, validateGoal, boundedNoticeRequest };
```

Call `validateGoal` before `createVisibleRequestTracker` assigns `request`, before `submit-goal`
dispatch, and before retry. Sanitize optional `notice.request` with `boundedNoticeRequest` before
snapshot validation.

- [ ] **Step 4: Run focused tests and witness GREEN**

Run the Step 2 command.

Expected: all selected tests pass with the exact byte limit.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- src/agent/goalLimits.js src/appWindow.js src/app/appSnapshot.js tests/goalLimits.test.js tests/appLifecycle.test.js tests/appWindow.test.js tests/appSnapshot.test.js
git commit -m "fix: enforce one bounded goal contract"
```

---

### Task 2: Opt-in authenticated loopback prompt server

**Files:**
- Modify: `src/bridge/promptServer.js`
- Modify: `src/runtimeArguments.js`
- Modify: `src/main.js`
- Modify: `tests/promptServer.test.js`
- Modify: `tests/runtimeArguments.test.js`
- Modify: `tests/singleInstance.test.js`

**Interfaces:**
- Consumes: `validateGoal(text)` and `MAX_GOAL_BYTES`.
- Produces: `start(onPrompt, { port, token })`.
- Produces: `promptTokenFromEnvironment(environment): string | null`.
- Runtime contract: no explicit token means no server; explicit port without token is a startup error.

- [ ] **Step 1: Write failing authentication and limit tests**

Update the request helper to set:

```js
headers: {
  Host: `127.0.0.1:${server.address().port}`,
  Origin: undefined,
  'Content-Type': 'application/json',
  'X-Claude-Pet-Token': TOKEN,
}
```

Add cases for missing/wrong token (`401`), wrong Host (`403`), any Origin (`403`), wrong content
type (`415`), over-limit chunked bytes (`413` and socket closed), more than eight requests per
socket, and server timeout properties. Add runtime-argument tests for missing, short, and valid
environment tokens.

- [ ] **Step 2: Run focused prompt tests and witness RED**

```powershell
node --test tests/promptServer.test.js tests/runtimeArguments.test.js tests/singleInstance.test.js
```

Expected: current server accepts unauthenticated requests and starts by default.

- [ ] **Step 3: Implement strict request handling**

Use constant-time token comparison:

```js
function tokenMatches(actual, expected) {
  const left = Buffer.from(String(actual || ''), 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
```

Count raw `Buffer` bytes before JSON decoding. Allow only `application/json` with an optional
`charset=utf-8`. Reject any `Origin` header and require the exact actual loopback Host. Configure:

```js
server.headersTimeout = 2_000;
server.requestTimeout = 5_000;
server.keepAliveTimeout = 1_000;
server.maxRequestsPerSocket = 8;
```

Do not echo request text or token in any response.

- [ ] **Step 4: Make startup explicitly opt-in**

Implement:

```js
function promptTokenFromEnvironment(environment) {
  const value = environment?.CLAUDE_PET_PROMPT_TOKEN;
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 32
    && !value.includes('\0') ? value : null;
}
```

In `main.js`, start the server only when token and explicit `--prompt-port` are both present. A port
without a valid token uses the existing bounded startup error dialog and exits. A normal packaged
launch starts no HTTP listener.

- [ ] **Step 5: Run focused tests and witness GREEN**

Run the Step 2 command.

Expected: all authentication, body, timeout, opt-in, and startup cases pass.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- src/bridge/promptServer.js src/runtimeArguments.js src/main.js tests/promptServer.test.js tests/runtimeArguments.test.js tests/singleInstance.test.js
git commit -m "fix: authenticate and bound prompt ingress"
```

---

### Task 3: Provider stdin and Windows process identity

**Files:**
- Create: `resources/windows/inspect-process.ps1`
- Modify: `src/agent/cliRunner.js`
- Modify: `src/agent/windowsProcessTree.js`
- Modify: `tests/cliRunner.test.js`
- Modify: `tests/windowsProcessTree.test.js`

**Interfaces:**
- Produces: `terminateWindowsProcessTree({ pid, execFile, grandchildPids, inspectProcess, waitForExit, spawn })`.
- `inspectProcess(pid)` returns `{ exists: boolean, executablePath: string | null }`.
- The original already-exited PID returns `true`; an identity mismatch throws `COMMAND_FAILED`
  without invoking taskkill.

- [ ] **Step 1: Write failing stdin and PID-reuse regressions**

Create a fake writable stdin that emits `EPIPE` after `end()` and assert runner rejection is
`COMMAND_FAILED` without `uncaughtException`. Add termination tests:

```js
assert.equal(await terminateWindowsProcessTree({
  pid: 321,
  execFile: 'C:\\Provider\\provider.exe',
  inspectProcess: async () => ({ exists: false, executablePath: null }),
  spawn: () => { throw new Error('must not kill'); },
}), true);
```

Add mismatch coverage proving `spawn` is not called, and exact-match coverage asserting the command
is the absolute `%SystemRoot%\System32\taskkill.exe`.

- [ ] **Step 2: Run focused lifecycle tests and witness RED**

```powershell
node --test tests/cliRunner.test.js tests/windowsProcessTree.test.js
```

Expected: unhandled stdin error behavior and discarded `execFile` identity.

- [ ] **Step 3: Install stdin handling before writes**

Register `child.stdin.once('error', onStdinError)` before `end()`. Route an unsettled error into the
same single-settlement path as child errors, ignore only post-settlement stream errors, and remove
the listener in cleanup.

- [ ] **Step 4: Add exact process inspection and absolute taskkill**

The PowerShell helper accepts one numeric PID, reads
`[System.Diagnostics.Process]::GetProcessById($pid).MainModule.FileName`, and emits one bounded JSON
object. It emits `{"exists":false,"executablePath":null}` only for the documented process-not-found
case; other lookup failures exit nonzero.

Normalize both expected and actual paths with `path.win32.resolve` and compare case-insensitively.
Resolve taskkill from `process.env.SystemRoot` plus `System32\taskkill.exe`; reject a missing or
non-absolute SystemRoot.

- [ ] **Step 5: Run focused and real Windows tests**

```powershell
node --test tests/cliRunner.test.js tests/windowsProcessTree.test.js
```

Expected: all simulated cases pass and the existing real child/grandchild fixture terminates.

- [ ] **Step 6: Commit Task 3**

```powershell
git add -- resources/windows/inspect-process.ps1 src/agent/cliRunner.js src/agent/windowsProcessTree.js tests/cliRunner.test.js tests/windowsProcessTree.test.js
git commit -m "fix: verify provider process lifecycle"
```

---

### Task 4: Provider probe cancellation and minimal environment

**Files:**
- Modify: `src/agent/localProviderProbe.js`
- Modify: `tests/localProviderProbe.test.js`

**Interfaces:**
- Consumes: verified `terminateWindowsProcessTree`.
- Produces: `sanitizeProbeEnvironment(source)` containing only the exact system allowlist.
- Produces: default probe spawn that honors `spec.signal`, terminates on abort, and resolves only
  after child close.

- [ ] **Step 1: Write failing environment and timeout tests**

Extend the environment fixture with `AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, `PASSWORD`,
`DATABASE_SECRET`, and an unrelated ordinary variable. Assert none survive. Assert only
`SystemRoot`, `SystemDrive`, `ComSpec`, `PATH`, `PATHEXT`, `TEMP`, `TMP`, `USERPROFILE`,
`LOCALAPPDATA`, and `APPDATA` may be inherited before owned probe variables are added.

Use a fake child that remains open until termination and assert deadline/caller abort calls the
terminator, awaits close, then closes servers and removes the workspace in that order.

- [ ] **Step 2: Run focused probe tests and witness RED**

```powershell
node --test tests/localProviderProbe.test.js
```

Expected: host secrets survive and the timeout Promise loses the child handle.

- [ ] **Step 3: Implement one owned abort lifecycle**

Replace `Promise.race` with an owned `AbortController`. Forward caller abort into it, schedule the
30-second deadline to abort it, and clear both listeners/timer in `finally`.

The default spawn stores the child, installs stdin/error/close handlers before writing, and on
abort calls the injected verified tree terminator. It resolves or rejects only after close and
never leaves an unobserved stdin error.

- [ ] **Step 4: Implement the minimal environment allowlist**

```js
const REQUIRED_HOST_ENVIRONMENT = new Set([
  'SystemRoot', 'SystemDrive', 'ComSpec', 'PATH', 'PATHEXT',
  'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA',
]);
```

Match keys case-insensitively while preserving their canonical source spelling. Add only the
existing owned dummy/provider probe values after sanitization.

- [ ] **Step 5: Run focused probe tests and witness GREEN**

Run the Step 2 command.

Expected: all protocol, abort, timeout, cleanup, and environment tests pass.

- [ ] **Step 6: Commit Task 4**

```powershell
git add -- src/agent/localProviderProbe.js tests/localProviderProbe.test.js
git commit -m "fix: contain provider probe lifecycle"
```

---

### Task 5: Production crypto, ciphertext caps, and package scanning

**Files:**
- Modify: `src/main.js`
- Modify: `src/agent/sessionStore.js`
- Modify: `src/agent/safeStorageCrypto.js`
- Modify: `tests/agentRuntime.test.js`
- Modify: `tests/sessionStore.test.js`
- Modify: `scripts/verify_package.js`
- Modify: `tests/verifyPackage.test.js`

**Interfaces:**
- Produces: production `createSafeStorageCrypto(safeStorage)` wiring.
- Produces: `MAX_ENCODED_SESSION_CIPHERTEXT_BYTES` before base64 decode/decrypt.
- Produces: streaming text scan with the existing secret and legacy-channel patterns.

- [ ] **Step 1: Write failing production-wiring and ciphertext tests**

Add a source-wiring test asserting `main.js` imports and invokes `createSafeStorageCrypto` and no
longer contains `shouldReEncrypt: false`. Add a session file containing canonical base64 longer
than the encoded cap and assert initialization fails before `crypto.decrypt` is called.

- [ ] **Step 2: Write failing large-package-text test**

Create a test package containing a `.js` file larger than 1 MiB with a secret-shaped suffix and
assert `verifyPackage` rejects it. Add a read-failure case and assert fail-closed behavior.

- [ ] **Step 3: Run focused persistence/package tests and witness RED**

```powershell
node --test tests/agentRuntime.test.js tests/sessionStore.test.js tests/verifyPackage.test.js
```

Expected: inline production adapter, decrypt call for oversized ciphertext, and skipped large file.

- [ ] **Step 4: Wire tested crypto and cap ciphertext**

Import:

```js
const { createSafeStorageCrypto } = require('./agent/safeStorageCrypto.js');
```

Pass `crypto: createSafeStorageCrypto(safeStorage)` to `createAgentRuntime`.

Define an encoded cap from `MAX_SESSION_BYTES + 64 * 1024` encryption overhead:

```js
const MAX_ENCODED_SESSION_CIPHERTEXT_BYTES =
  Math.ceil((MAX_SESSION_BYTES + 64 * 1024) / 3) * 4;
```

Reject longer strings before `Buffer.from`.

- [ ] **Step 5: Stream-scan every text/source file**

Use bounded chunks with a carry window long enough for the longest secret pattern. Decode as UTF-8
with fatal handling. Apply the current replacement for the single owner bearer fixture and the
existing secret/legacy patterns to the streamed content. A file read or decode error calls `fail`.

- [ ] **Step 6: Run focused tests and witness GREEN**

Run the Step 3 command.

Expected: rotation wiring, pre-decrypt cap, large secret, and scanner failure cases pass.

- [ ] **Step 7: Commit Task 5**

```powershell
git add -- src/main.js src/agent/sessionStore.js src/agent/safeStorageCrypto.js tests/agentRuntime.test.js tests/sessionStore.test.js scripts/verify_package.js tests/verifyPackage.test.js
git commit -m "fix: harden persistence and package scanning"
```

---

### Task 6: Shared attachment policy and canonical documentation

**Files:**
- Create: `src/bridge/attachmentPolicy.js`
- Create: `tests/attachmentPolicy.test.js`
- Modify: `src/bridge/fileContext.js`
- Modify: `src/bridge/attachmentAuthorization.js`
- Modify: `tests/fileContext.test.js`
- Modify: `tests/attachmentAuthorization.test.js`
- Modify: `docs/project-context.md`
- Modify: `docs/BUILD_LOG.md`
- Modify: `PROJECT_CHECKLIST.html`

**Interfaces:**
- Produces: `MAX_ATTACHMENT_BYTES = 49152`.
- Produces: `TEXT_ATTACHMENT_EXTENSIONS: ReadonlySet<string>`.
- Produces: `validateAttachmentName(name): { name, extension }`.
- Produces: `attachmentFormatDescription(): string`.
- Consumed by: UI/attachment plan and both main-window/pet authorization paths.

- [ ] **Step 1: Write failing extension-policy tests**

```js
test('accepts readable source/config types and rejects binary or disguised names', () => {
  assert.equal(validateAttachmentName('query.SQL').extension, '.sql');
  assert.equal(validateAttachmentName('notes.md').extension, '.md');
  for (const name of ['photo.png', 'report.pdf', 'archive.zip', '.env', 'notes.txt.exe']) {
    assert.throws(() => validateAttachmentName(name), /ATTACHMENT_INVALID/);
  }
});
```

Add authorization coverage proving disallowed extensions fail before `open`, and an allowlisted
extension containing binary/NUL data still fails.

- [ ] **Step 2: Run focused attachment tests and witness RED**

```powershell
node --test tests/attachmentPolicy.test.js tests/fileContext.test.js tests/attachmentAuthorization.test.js
```

Expected: no shared extension enforcement exists.

- [ ] **Step 3: Implement and consume the policy**

Create the frozen allowlist exactly as specified in the design. Validate `path.basename(name) ===
name`, lowercase the final extension, reject dotfiles and compound executable suffixes, and keep
the existing regular-file, exact-size, fatal UTF-8, and NUL checks.

Return bounded public metadata `{ name, extension, size }` alongside text only after consumption.

- [ ] **Step 4: Correct canonical architecture documentation**

Replace legacy Settings/Response window entries with:

```text
├─ appWindow.js               unified app:snapshot/app:intent boundary
├─ app-preload.js             unified renderer bridge
└─ app/                       sidebar, conversation, activity, and Settings renderer
```

Describe `src/settings` and `src/response` only as retained view-model/helper modules if still
consumed. Record review findings R1-R12, the exact implemented mitigations, and test evidence in
`BUILD_LOG.md`. Refresh `PROJECT_CHECKLIST.html` from canonical docs without adding a dashboard.

- [ ] **Step 5: Run focused tests and documentation checks**

```powershell
node --test tests/attachmentPolicy.test.js tests/fileContext.test.js tests/attachmentAuthorization.test.js
git diff --check
rg -n "settings-preload|response-preload|Settings/Response windows" docs/project-context.md
```

Expected: tests pass, diff check is clean, and the final search has no stale architecture claims.

- [ ] **Step 6: Commit Task 6**

```powershell
git add -- src/bridge/attachmentPolicy.js src/bridge/fileContext.js src/bridge/attachmentAuthorization.js tests/attachmentPolicy.test.js tests/fileContext.test.js tests/attachmentAuthorization.test.js docs/project-context.md docs/BUILD_LOG.md PROJECT_CHECKLIST.html
git commit -m "fix: enforce shared attachment policy"
```

---

### Task 7: Security-phase verification gate

**Files:**
- Modify only if verification exposes a regression in Task 1-6 scope.

**Interfaces:**
- Produces: a verified security baseline for the UI plan.

- [ ] **Step 1: Run all review-focused tests**

```powershell
node --test tests/goalLimits.test.js tests/promptServer.test.js tests/runtimeArguments.test.js tests/cliRunner.test.js tests/windowsProcessTree.test.js tests/localProviderProbe.test.js tests/agentRuntime.test.js tests/sessionStore.test.js tests/verifyPackage.test.js tests/attachmentPolicy.test.js tests/fileContext.test.js tests/attachmentAuthorization.test.js
```

Expected: zero failures.

- [ ] **Step 2: Run the complete serial suites**

```powershell
npm.cmd test
python -m pytest -q
```

Expected: zero Node and Python failures. If a live Windows timing fixture fails, rerun that exact
fixture once, record both outputs, and fix only if it reproduces.

- [ ] **Step 3: Verify the package boundary**

```powershell
npm.cmd run package:win
npm.cmd run verify:package
```

Expected: package creation and verification exit 0; normal packaged launch has no listener on
47611.

- [ ] **Step 4: Verify protected paths and repository state**

```powershell
git diff --check
git status --short
git diff --name-only f2ce720...HEAD
```

Expected: `.workbuddy-ai/`, `LOCAL_PR.html`, and the desktop JSON are absent from the diff. Existing
untracked protected paths may remain visible in status and must not be staged.

- [ ] **Step 5: Record and commit verification evidence**

Append exact counts, package file/byte totals, and any isolated timing rerun to `docs/BUILD_LOG.md`,
refresh `PROJECT_CHECKLIST.html`, then:

```powershell
git add -- docs/BUILD_LOG.md PROJECT_CHECKLIST.html
git commit -m "docs: verify security hardening"
```
