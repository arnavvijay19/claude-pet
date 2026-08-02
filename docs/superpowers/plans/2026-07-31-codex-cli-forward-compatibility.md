# Codex CLI Forward-Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude Pet automatically accept future official Codex CLI updates that preserve its
required behavior, while rejecting incompatible or unverifiable updates with accurate public
feedback.

**Architecture:** Native discovery will bind a strict official installer layout to a dynamically
derived semantic version and exact held file identity. A shared compatibility coordinator will
qualify each new identity with the existing account-free loopback probe, persist only successful
identity-bound evidence, and gate every Codex status, setup, permission, and run path.

**Tech Stack:** Electron 43, Node.js CommonJS, `node:test`, Windows Authenticode/native inspection
helper, existing CLI runner and local provider probe, Electron `safeStorage`, vanilla JavaScript.

## Global Constraints

- Work only in `codex/codex-cli-multi-version`, based on `master` commit `36cdf34`.
- Keep `.workbuddy-ai/`, `LOCAL_PR.html`, the WorkBuddy worktree, and provider-lifecycle Task 2
  untouched and unstaged.
- Support the official Windows x64 Codex Desktop launcher rooted at
  `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`.
- Require the exact publisher `OpenAI OpCo, LLC`, valid Authenticode signature, regular-file facts,
  SHA-256, volume serial, file ID, held path, and strict two-junction installer shape.
- Require Codex CLI `>=0.145.0`; do not use an upper version allowlist.
- A version number or publisher alone never establishes compatibility.
- Do not generalize to a future installer root, platform suffix, executable name, or extra reparse
  hop.
- Qualification uses an isolated app-owned workspace/home, a synthetic bearer, the loopback
  provider fixture, no real credentials, no real provider request, and no user-selected workspace.
- Qualification is not a network sandbox and does not claim to detect unrelated telemetry.
- Do not depend on provider-lifecycle Tasks 2-7; use the current shared bounded runner/probe
  boundary so later Job Object integration can cover it naturally.
- Persist only successful evidence; transient and deterministic failures never become success.
- Public renderer data contains no path, hash, file ID, junction target, raw output, environment, or
  probe diagnostic.
- Use `npm.cmd` from PowerShell and serialized Node tests.
- Each task uses witnessed red-green tests, commits only its named files, and pushes the commit to
  draft PR #2.
- Do not sign in, run a real Codex task, or mutate `C:\Users\eklip\Desktop\a` without a later
  explicit user gate.

## File structure

- `src/agent/nativeCliDiscovery.js` — restrict candidates to the official launcher, validate the
  dynamic release shape, and return an immutable eligible identity.
- `src/agent/nativeCliLaunchLease.js` — inspect a dynamic Codex version while holding the exact
  executable and re-prove that same identity before every launch.
- `src/agent/codexFeaturePolicy.js` — define the version-neutral required feature safety contract.
- `src/agent/localProviderProbe.js` — exercise the version-neutral Codex behavioral contract through
  the existing bounded loopback fixture.
- `resources/probes/codex-required-code-mode-tools.json` — canonical required tool projection,
  renamed from the historical version-specific filename.
- `resources/probes/codex-probe-config.toml` — canonical loopback configuration template, renamed
  from the historical version-specific filename.
- `src/agent/codexCompatibilityStore.js` — protected, bounded, identity-digest success cache.
- `src/agent/codexCompatibility.js` — deduplicate qualification, map deterministic/transient
  outcomes, and authorize only exact qualified identities.
- `src/agent/executors/codexCli.js` — use the shared compatibility gate for the optional Workspace
  executor.
- `src/agent/executors/codexNativeFullComputer.js` — use the same gate for current native status,
  setup, permission verification, and runs.
- `src/agent/agentRuntime.js` — create and initialize one shared store/coordinator and inject it into
  both Codex executors.
- `src/agent/agentErrors.js` — stable unsupported-update and retryable-check public errors.
- `src/agent/agentManager.js` — check compatibility before authentication and permission state.
- `src/app/app.js` — display accurate connection-test feedback.
- `tests/codexCompatibilityStore.test.js` — cache schema, encryption, identity binding, corruption,
  eviction, and restart coverage.
- `tests/codexCompatibility.test.js` — coordinator qualification, concurrency, caching, and failure
  mapping coverage.
- Existing discovery, lease, feature-policy, probe, executor, manager, runtime, app-window, and
  renderer test files — focused regressions at their current boundaries.
- `docs/project-context.md`, `docs/BUILD_LOG.md`, and `PROJECT_CHECKLIST.html` — update only after
  implementation, live account-free proof, full tests, and package verification pass.

---

### Task 1: Dynamic official Codex identity and launch lease

**Files:**
- Modify: `src/agent/nativeCliDiscovery.js`
- Modify: `src/agent/nativeCliLaunchLease.js`
- Modify: `tests/nativeCliDiscovery.test.js`
- Modify: `tests/nativeCliLaunchLease.test.js`

**Interfaces:**
- Consumes: existing `discoverSignedNativeCli(options)`,
  `inspectNativeCliCandidate(path, options)`, and
  `openVerifiedNativeCliLaunchLease(binding, options)`.
- Produces: eligible Codex bindings with exact keys
  `{ path, sha256, volumeSerial, fileId, version, publisher }`, where `version` is derived from the
  held executable and strict release directory.
- Produces: `NATIVE_CLI_POLICY['codex-cli'].minimumVersion === '0.145.0'` and a dynamic release
  policy limited to `*-x86_64-pc-windows-msvc`.
- Produces an exact `blockedVersions` emergency denylist, initially empty; it is never used as a
  positive version allowlist.

- [ ] **Step 1: Add failing dynamic-version discovery tests**

Extend the existing Codex constants with a fixture builder rather than a second copied policy:

```js
function codexRelease(version) {
  const release = `C:\\Users\\Tester\\.codex\\packages\\standalone\\releases\\${version}-x86_64-pc-windows-msvc`;
  return Object.freeze({
    version,
    release,
    canonical: `${release}\\bin\\codex.exe`,
    junctionTarget: `${release}\\bin`,
    chain: Object.freeze([
      Object.freeze({
        path: CODEX_JUNCTION.path,
        rawTarget: `${CODEX_CURRENT}\\bin`,
        type: 'junction',
      }),
      Object.freeze({
        path: CODEX_CURRENT,
        rawTarget: release,
        type: 'junction',
      }),
    ]),
  });
}
```

Add tests proving `0.145.0`, `0.146.0`, and synthetic `0.200.1` identities bind without changing a
version allowlist. Add table cases rejecting:

```js
[
  '0.144.9',
  'v0.146.0',
  '0.146',
  '0.146.0-arm64-pc-windows-msvc',
  '0.146.0-x86_64-pc-windows-msvc-extra',
  '..\\0.146.0-x86_64-pc-windows-msvc',
]
```

Also assert that the version passed back by inspection must equal both the canonical release name
and the immutable binding.

Test the pure version-policy helper with `blockedVersions: ['0.146.0']`: `0.146.0` is rejected,
`0.145.0` and `0.200.1` remain allowed, and malformed/below-floor versions remain rejected. The
production block list stays empty unless a witnessed release defect requires an emergency rule.

- [ ] **Step 2: Add failing held-inspection and lease tests**

In `tests/nativeCliLaunchLease.test.js`, introduce:

```js
const FUTURE_BINDING = Object.freeze({
  ...BINDING,
  path: BINDING.path.replace('0.145.0', '0.146.0'),
  version: '0.146.0',
  sha256: '7'.repeat(64),
  fileId: '8899AABBCCDDEEFF',
});
```

Cover:

- blank PE file version for a correctly signed OpenAI `0.146.0` executable;
- exact `codex-cli 0.146.0` held-path output;
- release-directory/output mismatch;
- changed SHA, file ID, publisher, or version between discovery and lease;
- oversized, multiline, malformed, below-floor, and mismatched version output; and
- the real installed launcher test deriving its expected version from the strict release directory
  instead of pinning `0.145.0`.

- [ ] **Step 3: Run focused tests and witness the red state**

Run:

```powershell
npm.cmd test -- tests/nativeCliDiscovery.test.js tests/nativeCliLaunchLease.test.js
```

Expected: new dynamic-version cases fail because policy and held inspection still require
`0.145.0`; existing security cases remain green.

- [ ] **Step 4: Implement strict dynamic release parsing**

Replace the Codex exact release entry with immutable structural policy:

```js
const CODEX_MINIMUM_VERSION = '0.145.0';
const CODEX_BLOCKED_VERSIONS = Object.freeze([]);
const CODEX_RELEASE_SUFFIX = '-x86_64-pc-windows-msvc';
const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
```

Add pure helpers:

```js
function parseStrictVersion(value) {
  const match = typeof value === 'string' ? STRICT_SEMVER.exec(value) : null;
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(first, second) {
  for (let index = 0; index < 3; index += 1) {
    if (first[index] !== second[index]) return first[index] - second[index];
  }
  return 0;
}
```

Add and unit-test:

```js
function codexVersionAllowed(value, {
  minimumVersion = CODEX_MINIMUM_VERSION,
  blockedVersions = CODEX_BLOCKED_VERSIONS,
} = {}) {
  const parsed = parseStrictVersion(value);
  return parsed !== null
    && compareVersions(parsed, parseStrictVersion(minimumVersion)) >= 0
    && !blockedVersions.includes(value);
}
```

The dynamic junction validator must require:

```js
{
  firstPath: installerBin,
  firstRawTarget: `${standaloneCurrent}\\bin`,
  secondPath: standaloneCurrent,
  releaseRoot,
  releaseSuffix: CODEX_RELEASE_SUFFIX,
}
```

The second raw target must be one direct child of `releaseRoot`; its basename must split into one
strict semantic version plus the exact suffix. Construct the expected canonical
`<release>\bin\codex.exe` from that validated target and compare every normalized path
case-insensitively.

- [ ] **Step 5: Make held inspection derive and re-prove the version**

Extend `inspectNativeCliCandidate` with one mutually exclusive option:

```js
codexReleasePolicy: Object.freeze({
  minimumVersion: '0.145.0',
  releaseRoot,
  releaseSuffix: '-x86_64-pc-windows-msvc',
  installerBin,
  standaloneCurrent,
})
```

Keep the existing `expectedVersion`/exact-chain path for Claude Code. Reject calls that mix the
dynamic and exact policies.

For dynamic Codex:

1. validate signature and publisher before invoking `--version`;
2. derive the version from the held canonical release path;
3. require it to meet the floor;
4. run the held exact path with `--version`;
5. require bounded exact output for the derived version; and
6. return the derived version in the inspection.

Change `fileVersionMatches` so a blank PE version is permitted only for the expected signed OpenAI
publisher and remains bound by the exact held `--version` check:

```js
function fileVersionMatches(fileVersion, cliVersion, publisher) {
  return (fileVersion === '' && publisher === 'OpenAI OpCo, LLC')
    || fileVersion === cliVersion
    || fileVersion === `${cliVersion}.0`;
}
```

`openVerifiedNativeCliLaunchLease` continues to compare every final fact to `binding`, including
`binding.version`, before allowing a launch.

- [ ] **Step 6: Run focused and adjacent tests**

Run:

```powershell
npm.cmd test -- tests/nativeCliDiscovery.test.js tests/nativeCliLaunchLease.test.js tests/cliRunner.test.js
```

Expected: all selected tests pass, including the live installed launcher test on `0.146.0`.

- [ ] **Step 7: Commit and publish Task 1**

```powershell
git add src/agent/nativeCliDiscovery.js src/agent/nativeCliLaunchLease.js tests/nativeCliDiscovery.test.js tests/nativeCliLaunchLease.test.js
git commit -m "Support dynamic verified Codex identities"
git push
```

Stop at the Task 1 review gate. Do not begin feature/probe changes until the commit and PR diff are
reviewed.

---

### Task 2: Version-neutral feature and loopback probe contract

**Files:**
- Modify: `src/agent/codexFeaturePolicy.js`
- Modify: `src/agent/localProviderProbe.js`
- Move: `resources/probes/codex-0.145.0-code-mode-tools.json` to
  `resources/probes/codex-required-code-mode-tools.json`
- Move: `resources/probes/codex-0.145.0-probe-config.toml` to
  `resources/probes/codex-probe-config.toml`
- Modify: `tests/codexFeaturePolicy.test.js`
- Modify: `tests/localProviderProbe.test.js`

**Interfaces:**
- Consumes: `parseCodexFeatureList(output)`, `assertCodexFeaturePolicy(records)`,
  `validateCodexCodeModeProjection(value)`, and `verifyNativeToolSurface(input)`.
- `verifyNativeToolSurface` accepts optional `signal` and forwards it unchanged to
  `probe.run({ cliBinding, workspacePath, fixtureRoot, signal })`.
- Produces: a version-neutral required-subset policy that tolerates bounded disabled additions but
  rejects unknown enabled capability, missing required controls, and any changed model-visible tool
  projection.
- Produces: loopback proof for any eligible binding version without looking up a version-named
  resource.
- `verifyNativeToolSurface({ purpose: 'compatibility', ...input })` returns
  `{ compatible: false }` only for a deterministic required-contract mismatch. It throws an
  internal fixed-kind `LocalProviderProbeFailure('check-failed')` for bind, fixture, I/O, timeout,
  abort, spawn, or cleanup uncertainty.
- The default `purpose: 'permission'` preserves the existing
  `PERMISSION_PROFILE_UNAVAILABLE` behavior for executor permission checks.

- [ ] **Step 1: Write failing forward-feature tests**

Keep the complete `0.145.0` feature-list fixture as regression evidence. Add:

```js
const current = parseCodexFeatureList(COMPLETE_0145_FEATURE_LIST);
assert.doesNotThrow(() => assertCodexFeaturePolicy([
  ...current,
  { name: 'future_disabled_surface', stage: 'experimental', enabled: false },
]));
assert.throws(
  () => assertCodexFeaturePolicy([
    ...current,
    { name: 'future_enabled_surface', stage: 'experimental', enabled: true },
  ]),
  (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE',
);
```

Add cases for duplicate names, malformed records, a required disabled feature enabled, and removal
of a historical non-required disabled record. Preserve exact rejection of additional,
collaboration, and nested exec tools.

- [ ] **Step 2: Write failing version-neutral probe-resource tests**

Update fixture assertions to require exactly:

```text
resources/probes/codex-required-code-mode-tools.json
resources/probes/codex-probe-config.toml
```

Run the same canonical Codex probe with bindings `0.145.0`, `0.146.0`, and `0.200.1`. Assert the
spawn specifications, synthetic bearer, loopback origin, cleanup, output parser, feature
inspection, blocked authority controls, forwarded AbortSignal, and sentinel results are identical
across versions.

Add witnessed deterministic cases for missing flags, unsafe enabled features, changed tool
projection, unexpected control requests, and invalid production-parser events. Add retryable cases
for server bind, fixture read/hash, timeout, abort, spawn, temporary I/O, and cleanup failure.

- [ ] **Step 3: Run focused tests and witness the red state**

Run:

```powershell
npm.cmd test -- tests/codexFeaturePolicy.test.js tests/localProviderProbe.test.js
```

Expected: the disabled additive-feature case and new resource paths fail.

- [ ] **Step 4: Implement required-subset feature validation**

Retain `CODEX_DISABLED_FEATURES` and `CODEX_SAFE_ENABLED_FEATURES`. Replace exact registry-length
and ordering acceptance with:

```js
function assertCodexFeaturePolicy(records) {
  if (!Array.isArray(records) || records.length === 0) throw unavailable();
  const names = records.map((record) => record?.name);
  if (names.some((name) => typeof name !== 'string' || !name)
      || new Set(names).size !== names.length) throw unavailable();
  for (const record of records) {
    if (typeof record.stage !== 'string' || !record.stage
        || typeof record.enabled !== 'boolean') throw unavailable();
    if (record.enabled && !CODEX_SAFE_ENABLED_FEATURES.includes(record.name)) throw unavailable();
    if (record.enabled && CODEX_DISABLED_FEATURES.includes(record.name)) throw unavailable();
  }
  return true;
}
```

Keep `--strict-config` plus every explicit disable argument. If a future CLI removes or changes a
flag, the actual qualification invocation must fail rather than deleting the control silently.

- [ ] **Step 5: Rename canonical resources and remove version lookup**

Use filesystem move operations limited to the two exact tracked resources. Update
`localProviderProbe.js` to read:

```js
path.join(input.fixtureRoot, 'codex-probe-config.toml')
path.join(input.fixtureRoot, 'codex-required-code-mode-tools.json')
```

Do not select resources from `cliBinding.version`. The files define Claude Pet's required
behavior, not a claim about one installed release.

- [ ] **Step 6: Implement fixed probe-outcome classification**

Add an internal error with exact enumerable data:

```js
class LocalProviderProbeFailure extends Error {
  constructor(kind, options = {}) {
    super('Local provider probe failed', options.cause ? { cause: options.cause } : undefined);
    this.name = 'LocalProviderProbeFailure';
    this.kind = kind === 'incompatible' ? 'incompatible' : 'check-failed';
  }
}
```

Construct `incompatible` only after the loopback server and fixtures are healthy and the CLI
deterministically violates a required flag, feature, tool, request, event, or sentinel contract.
Classify bind, fixture integrity/read, timeout, abort, spawn, filesystem, and cleanup uncertainty as
`check-failed`.

For `purpose: 'compatibility'`, convert only `incompatible` to the frozen result
`{ compatible: false }`; rethrow `check-failed` for Task 4 to map. For default permission purpose,
preserve the existing `PERMISSION_PROFILE_UNAVAILABLE` public boundary. No raw cause or internal
kind crosses IPC.

- [ ] **Step 7: Run focused and probe-adjacent tests**

Run:

```powershell
npm.cmd test -- tests/codexFeaturePolicy.test.js tests/localProviderProbe.test.js tests/codexPermissionProfile.test.js
```

Expected: all selected tests pass and no real account or provider endpoint is configured.

- [ ] **Step 8: Commit and publish Task 2**

```powershell
git add src/agent/codexFeaturePolicy.js src/agent/localProviderProbe.js resources/probes/codex-required-code-mode-tools.json resources/probes/codex-probe-config.toml tests/codexFeaturePolicy.test.js tests/localProviderProbe.test.js
git add -u -- resources/probes/codex-0.145.0-code-mode-tools.json resources/probes/codex-0.145.0-probe-config.toml
git commit -m "Define a version-neutral Codex probe contract"
git push
```

Stop at the Task 2 review gate.

---

### Task 3: Protected identity-bound compatibility evidence

**Files:**
- Create: `src/agent/codexCompatibilityStore.js`
- Create: `tests/codexCompatibilityStore.test.js`

**Interfaces:**
- Consumes: existing crypto adapter methods `isAvailable()`, `encrypt(string)`, and
  `decrypt(buffer)`, whose decrypt result is `{ value, shouldReEncrypt }`.
- Produces:

```js
createCodexCompatibilityStore({
  filePath,
  crypto,
  clock = () => new Date().toISOString(),
  maximumEntries = 8,
  fileSystem = fs,
})
```

- Produces methods:

```js
initialize(): Promise<void>
hasSuccessful(identity, policyRevision): Promise<boolean>
rememberSuccessful(identity, policyRevision): Promise<boolean>
```

- [ ] **Step 1: Write failing cache schema and identity tests**

Build exact identities with:

```js
const IDENTITY = Object.freeze({
  path: 'C:\\Users\\Tester\\.codex\\packages\\standalone\\releases\\0.146.0-x86_64-pc-windows-msvc\\bin\\codex.exe',
  sha256: 'a'.repeat(64),
  volumeSerial: 'A1B2C3D4',
  fileId: '0011223344556677',
  version: '0.146.0',
  publisher: 'OpenAI OpCo, LLC',
});
```

Test:

- success is false before `rememberSuccessful`;
- success survives a new store instance and `initialize`;
- changing any one identity field or policy revision returns false;
- path case normalization does not create a second identity on Windows;
- only a digest and bounded metadata appear after decryption, not raw path or identity fields;
- the ninth distinct identity evicts the oldest of eight;
- duplicate remember updates recency without growing the list; and
- returned values are booleans with no cache record exposed.

- [ ] **Step 2: Write failing corruption and unavailable-storage tests**

Cover empty, oversized, invalid base64, undecryptable, invalid JSON, wrong schema, extra keys,
duplicate digest, invalid timestamp, and partial temp file. Each must initialize as an empty cache.

With `crypto.isAvailable()` false or encryption failure:

- in-process `rememberSuccessful` returns false;
- no plaintext file is written; and
- the caller can still hold its own memory-only success.

- [ ] **Step 3: Run the new test and witness the red state**

Run:

```powershell
npm.cmd test -- tests/codexCompatibilityStore.test.js
```

Expected: module-not-found failure.

- [ ] **Step 4: Implement exact identity validation and digesting**

Use exact own keys and validate path, SHA-256, non-empty file facts, strict semantic version, and
publisher. Derive:

```js
const digestInput = JSON.stringify({
  policyRevision,
  path: path.win32.normalize(identity.path).toLowerCase(),
  sha256: identity.sha256.toLowerCase(),
  volumeSerial: identity.volumeSerial,
  fileId: identity.fileId,
  version: identity.version,
  publisher: identity.publisher,
});
const digest = cryptoModule.createHash('sha256').update(digestInput, 'utf8').digest('hex');
```

Never use version alone as a key.

- [ ] **Step 5: Implement bounded protected persistence**

Use schema:

```js
{
  schemaVersion: 1,
  entries: [
    { digest: '64 lowercase hex', qualifiedAt: 'ISO-8601 string' }
  ]
}
```

Serialize, encrypt, base64-wrap, write to an exact sibling temporary file with `wx`, and atomically
rename. Bound encrypted input before base64 decoding and cap entries at eight. On malformed input,
discard in memory; do not rewrite until a later successful qualification.

- [ ] **Step 6: Run focused and crypto-store tests**

Run:

```powershell
npm.cmd test -- tests/codexCompatibilityStore.test.js tests/connectionStore.test.js tests/sessionStore.test.js
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit and publish Task 3**

```powershell
git add src/agent/codexCompatibilityStore.js tests/codexCompatibilityStore.test.js
git commit -m "Cache qualified Codex identities safely"
git push
```

Stop at the Task 3 review gate.

---

### Task 4: Shared compatibility coordinator and account-free qualifier

**Files:**
- Create: `src/agent/codexCompatibility.js`
- Create: `scripts/diagnose-codex-compatibility.js`
- Create: `tests/codexCompatibility.test.js`
- Create: `tests/codexCompatibilityDiagnostic.test.js`
- Modify: `src/agent/agentErrors.js`
- Modify: `tests/agentManager.test.js`

**Interfaces:**
- Consumes: Task 1 eligible binding, Task 2 `verifyNativeToolSurface`, Task 3 store, existing
  `createCliRunner`, and an app-owned `workspacePath`/`fixtureRoot`.
- Produces:

```js
createCodexCompatibility({
  store,
  qualify,
  policyRevision = 1,
})
```

- Produces:

```js
ensureCompatible(binding, { signal } = {}):
  Promise<Object.freeze({ compatible: true, version: string, cached: boolean })>
```

- `qualify(binding, { signal })` returns `true` only after the complete loopback contract, returns
  `false` for deterministic incompatibility, and throws for retryable infrastructure failure.
- Produces:

```js
runCodexCompatibilityDiagnostic({ discover, ensureCompatible, workspacePath }):
  Promise<boundedDiagnostic>
```

- [ ] **Step 1: Add failing public-error tests**

Require:

```js
toPublicError(new AgentError('CLI_VERSION_UNSUPPORTED'))
// {
//   code: 'CLI_VERSION_UNSUPPORTED',
//   message: 'This Codex update is not compatible with Claude Pet yet.',
//   action: 'Update Claude Pet or install a compatible Codex version.',
//   requestId: null
// }

toPublicError(new AgentError('CLI_COMPATIBILITY_CHECK_FAILED'))
// {
//   code: 'CLI_COMPATIBILITY_CHECK_FAILED',
//   message: 'Claude Pet could not finish checking this Codex update.',
//   action: 'Retry the compatibility check.',
//   requestId: null
// }
```

Assert neither result includes path, hash, raw output, or cause.

- [ ] **Step 2: Add failing coordinator tests**

Test:

- first identity invokes `qualify` once and stores success;
- later ensure in the same process returns memory-cached success;
- a fresh coordinator uses protected success without invoking `qualify`;
- file ID/hash/version/policy change invokes a new qualification;
- five concurrent ensures for one identity share one promise;
- `qualify === false` throws `CLI_VERSION_UNSUPPORTED` and stores nothing;
- timeout, abort, fixture failure, and cleanup failure throw
  `CLI_COMPATIBILITY_CHECK_FAILED` and store nothing;
- a failed promise is removed so Retry invokes a fresh qualification; and
- successful storage failure still permits memory-only success for the current process.

- [ ] **Step 3: Add failing account-free qualifier tests**

Inject a fake `verifyNativeToolSurface` and assert the qualifier supplies:

```js
{
  provider: 'codex-cli',
  purpose: 'compatibility',
  cliBinding: binding,
  workspacePath: compatibilityWorkspace,
  fixtureRoot,
  signal,
}
```

The workspace must be beneath the app-owned compatibility root and not equal the user's saved
workspace. Assert the qualifier cleans its root on success, incompatibility, error, abort, and
timeout. A probe result is success only when:

```js
result.available === true
&& result.allowed === true
&& result.cleanup === true
&& result.credentialScrubbed === true
```

Add diagnostic tests requiring exact output keys:

```js
{
  publisher: 'OpenAI OpCo, LLC',
  version: '0.146.0',
  staticIdentity: 'verified',
  compatibility: 'compatible',
  providerEndpoint: 'loopback',
  realCredentialUsed: false,
  realModelRequestUsed: false,
  cleanup: true,
}
```

Reject extra keys and assert serialized output excludes path, hash, file ID, junction, environment,
bearer, raw stdout/stderr, and causes. The script's main path builds only the real discovery and
account-free qualifier dependencies; importing the module must not execute a diagnostic.

- [ ] **Step 4: Run focused tests and witness the red state**

Run:

```powershell
npm.cmd test -- tests/agentManager.test.js tests/codexCompatibility.test.js tests/codexCompatibilityDiagnostic.test.js
```

Expected: missing error codes and module.

- [ ] **Step 5: Implement the coordinator**

Validate dependencies at construction. Compute the same identity digest shape as the store through
one exported pure helper from `codexCompatibilityStore.js`; do not duplicate normalization.

Use:

```js
const successful = new Set();
const pending = new Map();
```

Check memory, then protected store, then pending. Create one qualification promise, delete it in
`finally`, add memory success only after qualification passes, and call
`store.rememberSuccessful`. Do not turn store failure into incompatibility.

- [ ] **Step 6: Implement the bounded qualifier**

Export `createCodexCompatibilityQualifier` from the same module. It creates one app-owned workspace
under the configured compatibility root, calls the injected `verifyNativeToolSurface`, and removes
the workspace in `finally`.

Classify only an explicit complete-but-incompatible probe result as `false`. Map abort, timeout,
spawn, fixture, I/O, malformed output, and cleanup uncertainty to a thrown retryable error. Do not
inspect a user workspace or load a real Codex home.

- [ ] **Step 7: Run focused and probe tests**

Run:

```powershell
npm.cmd test -- tests/agentManager.test.js tests/codexCompatibility.test.js tests/codexCompatibilityDiagnostic.test.js tests/localProviderProbe.test.js
```

Expected: all selected tests pass.

- [ ] **Step 8: Commit and publish Task 4**

```powershell
git add src/agent/codexCompatibility.js src/agent/codexCompatibilityStore.js src/agent/agentErrors.js scripts/diagnose-codex-compatibility.js tests/codexCompatibility.test.js tests/codexCompatibilityDiagnostic.test.js tests/codexCompatibilityStore.test.js tests/agentManager.test.js
git commit -m "Qualify updated Codex executables"
git push
```

Stop at the Task 4 review gate.

---

### Task 5: Executor and runtime compatibility gating

**Files:**
- Modify: `src/agent/executors/codexCli.js`
- Modify: `src/agent/executors/codexNativeFullComputer.js`
- Modify: `src/agent/agentRuntime.js`
- Modify: `tests/codexCli.test.js`
- Modify: `tests/nativeFullComputerExecutors.test.js`
- Modify: `tests/agentRuntime.test.js`
- Modify: `tests/appLifecycle.test.js`

**Interfaces:**
- Consumes: Task 4 `ensureCompatible(binding, { signal })`.
- Produces: one runtime-owned compatibility coordinator injected into both Codex executors as
  `ensureCodexCompatibility`.
- Produces status objects:

```js
{ installed: false, authenticated: false, workspaceAvailable: false }
{ installed: true, compatible: false, authenticated: false, workspaceAvailable: false }
{ installed: true, compatible: true, authenticated: boolean, workspaceAvailable: boolean }
```

and equivalent `fullComputerAvailable` objects for native Full Computer.

- [ ] **Step 1: Write failing executor compatibility tests**

Replace the exact-version assertion:

```js
assert.equal(CODEX_FULL_COMPUTER_VERSION, '0.145.0');
```

with an assertion that `CODEX_FULL_COMPUTER_VERSION` is no longer exported. Add `0.146.0` bindings
and record every `ensureCodexCompatibility` call.

Cover status, setup, permission verification, and run. Each must qualify the exact discovered
binding before authentication or provider launch. Test:

- compatible `0.145.0`;
- compatible `0.146.0`;
- deterministic incompatible status;
- retryable compatibility failure;
- discovery missing/unsafe;
- identity changes between status and later operation; and
- Claude executor behavior remains unchanged.

- [ ] **Step 2: Write failing runtime wiring tests**

Assert `createAgentRuntime` constructs:

```js
createCodexCompatibilityStore({
  filePath: path.join(userDataPath, 'codex-compatibility.json'),
  crypto,
})
```

and one qualifier rooted at:

```js
path.join(userDataPath, 'codex-compatibility-probe')
```

Both Codex executors receive the same bound `ensureCodexCompatibility` function from the shared
coordinator. `runtime.initialize()` awaits store initialization along with connections and
sessions. Test mode keeps the deterministic executor account-free and does not run live
qualification.

- [ ] **Step 3: Run focused tests and witness the red state**

Run:

```powershell
npm.cmd test -- tests/codexCli.test.js tests/nativeFullComputerExecutors.test.js tests/agentRuntime.test.js tests/appLifecycle.test.js
```

Expected: new injection/status tests fail and the old exact-version export still exists.

- [ ] **Step 4: Replace duplicate executor version checks**

Both Codex executors require:

```js
ensureCodexCompatibility
```

Validate it with `typeof ensureCodexCompatibility === 'function'`; do not install a permissive or
throwing default. Production runtime and every executor test must inject the intended function.
Remove local `installedVersion`, `exactVersion`, and `CODEX_FULL_COMPUTER_VERSION`.

Add a private helper:

```js
async function compatibleBinding(connection, signal) {
  const binding = await discover(connection);
  await ensureCodexCompatibility(binding, { signal });
  return binding;
}
```

Use it in setup, permission verification, and run. In `getStatus`, preserve:

- discovery rejection as `installed: false`;
- `CLI_VERSION_UNSUPPORTED` as `installed: true, compatible: false`;
- successful qualification as `installed: true, compatible: true`; and
- retryable compatibility errors as thrown errors, not signed-out state.

- [ ] **Step 5: Wire the shared runtime objects**

Create the store and coordinator before executors. Pass the runtime crypto adapter and paths
defined in Step 2. Initialize the compatibility store in the existing `Promise.all`.

The qualifier must use the shared `createCliRunner`/`verifyNativeToolSurface` boundary currently on
`master`; do not call the provider-job helper directly or begin lifecycle Task 2.

- [ ] **Step 6: Run focused and adjacent executor tests**

Run:

```powershell
npm.cmd test -- tests/codexCli.test.js tests/nativeFullComputerExecutors.test.js tests/agentRuntime.test.js tests/appLifecycle.test.js tests/claudeCodeCli.test.js
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit and publish Task 5**

```powershell
git add src/agent/executors/codexCli.js src/agent/executors/codexNativeFullComputer.js src/agent/agentRuntime.js tests/codexCli.test.js tests/nativeFullComputerExecutors.test.js tests/agentRuntime.test.js tests/appLifecycle.test.js
git commit -m "Gate Codex operations on compatibility"
git push
```

Stop at the Task 5 review gate.

---

### Task 6: Accurate manager and renderer feedback

**Files:**
- Modify: `src/agent/agentManager.js`
- Modify: `src/app/app.js`
- Modify: `src/settings/settingsStatus.js`
- Modify: `tests/agentManager.test.js`
- Modify: `tests/appRenderer.test.js`
- Modify: `tests/appWindow.test.js`
- Modify: `tests/settingsStatus.test.js`

**Interfaces:**
- Consumes: Task 4 public errors and Task 5 status `compatible` boolean.
- Produces: compatibility checks before authentication/permission mapping and safe user-facing
  connection feedback.

- [ ] **Step 1: Write failing manager-order tests**

For run preflight, return:

```js
{
  installed: true,
  compatible: false,
  authenticated: false,
  fullComputerAvailable: false,
}
```

Assert `runGoal` throws `CLI_VERSION_UNSUPPORTED`, not `AUTH_REQUIRED` or
`NATIVE_FULL_COMPUTER_LAUNCH_FAILED`. Keep missing first:

```js
if (status.installed === false) CLI_NOT_INSTALLED
else if (status.compatible === false) CLI_VERSION_UNSUPPORTED
else if (status.authenticated === false) AUTH_REQUIRED
```

Also assert a thrown `CLI_COMPATIBILITY_CHECK_FAILED` preserves its code and Retry action through
`app:intent`.

- [ ] **Step 2: Write failing renderer-copy tests**

For `test-connection`, require:

```text
This Codex update is not compatible with Claude Pet yet. Update Claude Pet or install a compatible Codex version.
```

and:

```text
Claude Pet could not finish checking this Codex update. Retry the compatibility check.
```

Assert neither includes `AgentError`, remote-method text, a versioned local path, hash, publisher,
or raw output. Preserve existing missing, signed-out, unavailable, blocked, and ready messages.

- [ ] **Step 3: Run focused tests and witness the red state**

Run:

```powershell
npm.cmd test -- tests/agentManager.test.js tests/appRenderer.test.js tests/appWindow.test.js tests/settingsStatus.test.js
```

Expected: incompatible status is currently mislabeled as authentication/permission failure.

- [ ] **Step 4: Implement manager ordering**

Insert the compatibility check immediately after `installed`:

```js
if (status?.installed === false) throw new AgentError('CLI_NOT_INSTALLED');
if (status?.compatible === false) throw new AgentError('CLI_VERSION_UNSUPPORTED');
if (status?.authenticated === false) throw new AgentError('AUTH_REQUIRED');
```

Offline Demo and Claude statuses may omit `compatible`; omission must preserve their current
behavior.

- [ ] **Step 5: Implement safe renderer feedback**

In `connectionResultMessage`, check `result.failure` first as today, then check
`result.status.compatible === false` before authentication. Use the public fixed copy; do not
construct messages from a path, raw version output, or internal cause.

Keep `settingsStatus.js` consistent for retained tests even though the unified app is the current
production renderer.

- [ ] **Step 6: Run focused and complete UI-boundary tests**

Run:

```powershell
npm.cmd test -- tests/agentManager.test.js tests/appRenderer.test.js tests/appWindow.test.js tests/settingsStatus.test.js tests/appSnapshot.test.js
```

Expected: all selected tests pass and existing public snapshot exactness remains unchanged.

- [ ] **Step 7: Commit and publish Task 6**

```powershell
git add src/agent/agentManager.js src/app/app.js src/settings/settingsStatus.js tests/agentManager.test.js tests/appRenderer.test.js tests/appWindow.test.js tests/settingsStatus.test.js
git commit -m "Explain incompatible Codex updates"
git push
```

Stop at the Task 6 review gate.

---

### Task 7: Live `0.146.0`, package, documentation, and PR completion gate

**Files:**
- Modify only if evidence requires: implementation/test files from Tasks 1-6
- Modify: `docs/project-context.md`
- Modify: `docs/BUILD_LOG.md`
- Modify: `PROJECT_CHECKLIST.html`
- Add: `docs/evidence/codex-compatibility-account-free.json`

**Interfaces:**
- Consumes: all prior task commits.
- Produces: bounded machine-readable current-CLI evidence, complete automated/package evidence,
  canonical documentation, and a ready-for-review PR #2.

- [ ] **Step 1: Run the real installed identity and account-free qualification**

First confirm without signing in or running a model:

```powershell
where.exe codex.exe
codex --version
npm.cmd test -- tests/nativeCliLaunchLease.test.js
```

Run the dedicated Task 4 diagnostic against the exact installed binding:

```powershell
node scripts/diagnose-codex-compatibility.js
```

Expected bounded JSON:

```json
{"publisher":"OpenAI OpCo, LLC","version":"0.146.0","staticIdentity":"verified","compatibility":"compatible","providerEndpoint":"loopback","realCredentialUsed":false,"realModelRequestUsed":false,"cleanup":true}
```

Write only those bounded fields plus policy revision and test timestamp to
`docs/evidence/codex-compatibility-account-free.json`. Do not store paths, hashes, file IDs,
environment values, bearer tokens, raw CLI output, or credentials.

If `0.146.0` deterministically fails a required flag, tool, event, or permission contract, stop and
report the witnessed incompatibility. Do not weaken a security control merely to make the installed
version pass.

- [ ] **Step 2: Run focused compatibility matrix**

Run:

```powershell
npm.cmd test -- tests/nativeCliDiscovery.test.js tests/nativeCliLaunchLease.test.js tests/codexFeaturePolicy.test.js tests/localProviderProbe.test.js tests/codexCompatibilityStore.test.js tests/codexCompatibility.test.js tests/codexCli.test.js tests/nativeFullComputerExecutors.test.js tests/agentManager.test.js tests/appRenderer.test.js tests/appWindow.test.js
```

Expected: every selected test passes.

- [ ] **Step 3: Run complete automated verification**

Run:

```powershell
npm.cmd test
py -3.12 -m pytest -q
git diff --check
```

Expected: all Node and Python tests pass. Record exact counts in `docs/BUILD_LOG.md`; do not predict
counts in advance.

- [ ] **Step 4: Build and verify a fresh Windows package**

Run:

```powershell
npm.cmd run package:win
npm.cmd run verify:package
```

Expected:

- package is freshly rebuilt from the current commit;
- verifier passes with exact reported file/byte totals;
- compatibility modules and renamed probe resources are present;
- `.workbuddy-ai/`, `LOCAL_PR.html`, docs, tests, and development-only artifacts are absent; and
- a fresh-profile Offline Demo launch remains account-free and runnable.

- [ ] **Step 5: Perform packaged account-free Codex status QA**

Using a fresh temporary app profile, create a saved Codex Full Computer connection pointing to the
user-approved test workspace only for display; invoke **Test connection**, not Send.

Expected visible state:

- no “agent command is not installed” error for official `0.146.0`;
- first encounter may display a short checking state;
- compatible plus signed-out displays the existing official sign-in guidance;
- compatible plus signed-in displays ready only after permission proof;
- no automatic login or real model run occurs; and
- renderer console has no error or rejected IPC payload.

Save bounded visual evidence only if it materially differs from existing Settings evidence. Do not
capture credentials, browser content, or local path details beyond the already approved workspace
label.

- [ ] **Step 6: Update canonical documentation and checklist**

In `docs/project-context.md`, replace the single-version statement with:

- strict official dynamic release identity;
- minimum protocol floor `0.145.0`;
- account-free behavioral qualification per changed identity;
- exact identity/policy-bound success cache;
- accurate incompatible/retryable feedback; and
- the explicit network/lifecycle limits.

In `docs/BUILD_LOG.md`, record root cause, task commits, exact tests, live `0.146.0` outcome,
package totals, and any human gates not run.

In `PROJECT_CHECKLIST.html`, mark only evidence actually witnessed. Keep real sign-in, real model
smoke, public signing/reputation, enterprise policy, and later Job Object integration visibly
separate and uncompleted unless independently performed.

- [ ] **Step 7: Re-run documentation and final cleanliness checks**

Run:

```powershell
node --check src/agent/codexCompatibility.js
node --check src/agent/codexCompatibilityStore.js
npm.cmd test
py -3.12 -m pytest -q
npm.cmd run verify:package
git diff --check
git status --short --branch
```

Expected: all checks pass and status shows only the intended Task 7 documentation/evidence changes.

- [ ] **Step 8: Commit and publish Task 7**

```powershell
git add docs/project-context.md docs/BUILD_LOG.md PROJECT_CHECKLIST.html docs/evidence/codex-compatibility-account-free.json
git commit -m "Document Codex compatibility evidence"
git push
```

- [ ] **Step 9: Review GitHub PR #2**

Run:

```powershell
gh pr diff 2
gh pr checks 2
gh pr view 2 --json isDraft,mergeable,reviewDecision,statusCheckRollup,url
```

Confirm:

- branch targets `master`;
- no WorkBuddy/review artifact appears;
- every plan task commit is present;
- GitHub checks are successful or an absent-CI limitation is stated;
- all review comments are triaged; and
- local `master` remains unchanged.

Mark PR #2 ready for review only after the user approves the verified runnable result. Do not merge
or update local `master` until that separate approval.

---

## Plan self-review checklist

- [ ] Every static identity requirement maps to Task 1.
- [ ] Safe additive feature behavior and exact tool projection map to Task 2.
- [ ] Protected bounded identity evidence and restart/rollback behavior map to Task 3.
- [ ] Qualification, concurrency, Retry, memory fallback, and public errors map to Task 4.
- [ ] Both Codex executors and runtime initialization map to Task 5.
- [ ] Error ordering and renderer-safe copy map to Task 6.
- [ ] Live `0.146.0`, full tests, package, docs, checklist, and GitHub gates map to Task 7.
- [ ] No task depends on unimplemented provider-lifecycle Tasks 2-7.
- [ ] No task signs in, runs a real model, weakens Full Computer warnings, or changes Workspace
  availability.
- [ ] No task touches `.workbuddy-ai/`, `LOCAL_PR.html`, or the WorkBuddy worktree.
- [ ] Function names, status keys, policy revision, schema version, cache bound, paths, and error
  codes are consistent across tasks.
