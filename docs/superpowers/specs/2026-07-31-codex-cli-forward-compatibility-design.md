# Codex CLI Forward-Compatibility Design

**Status:** User-approved design; implementation not started
**Date:** 2026-07-31
**Scope:** Native Windows Codex CLI discovery, compatibility qualification, cached evidence, status,
setup, permission verification, and run preflight

## Decision

Claude Pet will stop treating one exact Codex CLI release as the only valid installation. An
official Codex update will be accepted automatically when the installed executable:

1. passes the existing fail-closed file, path, signature, publisher, junction, and held-identity
   checks;
2. reports a well-formed version at or above the minimum protocol generation Claude Pet supports;
3. is not covered by a locally defined emergency block rule; and
4. passes an account-free compatibility qualification against the exact commands, flags, models,
   tool surface, event protocol, and permission behavior Claude Pet depends on.

Qualification runs once for a newly observed executable identity and is cached against that exact
identity and the compatibility-policy revision. A changed file, update, rollback, policy change, or
unverifiable cache entry triggers qualification again.

Codex `0.146.0`, which is installed on the current test machine, will be the first forward version
exercised by the implementation. It is not declared compatible merely because its number is newer:
the new qualification must pass before Claude Pet offers setup or runs it.

This is behavioral compatibility, not a version allowlist. Future Codex updates can work without a
Claude Pet code change when they preserve the required contract.

## Problem

Claude Pet currently pins Codex `0.145.0` in native discovery, native launch-lease inspection, and
the Full Computer executor. Codex Desktop updated the local official CLI to `0.146.0`. Discovery
rejects the new version and the executor collapses that rejection into `CLI_NOT_INSTALLED`, so the
app tells the user:

> The agent command is not installed.

The command is installed, signed, and runnable. The message is false, and every future compatible
Codex update would cause the same outage until Claude Pet's source code was edited.

## Goals

1. Let future official Codex versions work automatically when they satisfy Claude Pet's required
   behavior.
2. Preserve the existing exact executable-identity, signature, publisher, package-root, and launch
   lease guarantees.
3. Detect a Codex update or rollback from stable file identity rather than trusting a version
   string alone.
4. Qualify a new identity without a provider login, provider credentials, real model request, user
   workspace, or inherited customization.
5. Reuse successful qualification across restarts while binding it to the exact executable and
   current policy.
6. Distinguish absent, incompatible, transient-check, authentication, and permission failures at
   the main-process public-error boundary.
7. Use one shared compatibility decision for status, setup, permission verification, probes, and
   real runs.
8. Keep compatibility output bounded and renderer-safe: no local paths, hashes, raw CLI output,
   credentials, environment dumps, or internal probe diagnostics cross IPC.

## Non-goals

- This task does not trust every newer version solely because its semantic version is higher.
- It does not accept unsigned, wrongly signed, misplaced, copied, workspace-local, temporary, or
  structurally unexpected executables.
- It does not support a future installer layout that cannot be proven within the current official
  package-root and junction design. Such a layout requires a separate Claude Pet update.
- It does not make the official CLI or Full Computer mode a sandbox.
- It does not sign the user in, read provider credentials, make a billable model request, or run a
  real task during qualification.
- It does not silently change models, effort, approval policy, sandbox mode, feature flags, or
  permission profile to make an update pass.
- It does not redesign sessions, attachments, the pet, the composer, or provider lifecycle.
- It does not modify `.workbuddy-ai/`, `LOCAL_PR.html`, or any WorkBuddy worktree.
- It does not begin provider-lifecycle Task 2.

## Approaches considered

### 1. Add every compatible version to an exact allowlist

Rejected as the primary mechanism. It preserves the current security posture but guarantees
another Claude Pet source change after every compatible Codex update. Exact known versions may
remain test fixtures or emergency metadata, but they will not be the normal acceptance gate.

### 2. Accept a semantic-version range

Rejected. Codex is still in the `0.x` series, where a minor version can change behavior. A version
number cannot prove that command flags, feature policy, tool schemas, JSONL events, authentication,
or permission behavior remain compatible.

### 3. Trust any executable signed by the expected publisher

Rejected. A valid publisher establishes origin, not compatibility. Official software can
legitimately introduce breaking command or protocol changes.

### 4. Verify official identity, then qualify the required behavior

Selected. Static identity checks decide whether Claude Pet may inspect the candidate. A bounded,
account-free behavioral qualification then decides whether that exact executable satisfies the
Claude Pet contract. The result is cached by exact identity, not merely by path or version.

## Compatibility definition

A Codex executable is **compatible** only when every applicable static and behavioral gate passes.
Additive CLI output is permitted when Claude Pet's bounded parser can safely ignore it. Removal,
renaming, semantic changes, malformed output, unexpected tools, weakened permission behavior, or
loss of a required model/effort fails closed.

### Static identity gates

The candidate must:

- resolve from the official Codex Desktop lexical launcher under
  `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`;
- remain outside the selected workspace, repository, and temporary roots;
- follow the expected two-junction shape: the installer `bin` targets standalone `current\bin`,
  and standalone `current` targets one direct release directory;
- target a direct release child whose name contains one strict semantic version and the expected
  Windows x64 platform suffix, with no traversal or additional reparse hop;
- be a regular `codex.exe` file with a valid Authenticode signature from `OpenAI OpCo, LLC`;
- have a stable SHA-256, volume serial, file ID, canonical path, and held launch identity;
- report `codex-cli <version>` from the held exact executable, with the reported version exactly
  matching the release directory; and
- meet the minimum supported protocol floor and no emergency block rule.

The dynamic release-directory check broadens only the version token, not the package root,
publisher, platform, chain shape, executable name, or launch identity. No provider operation may
run from a candidate that has not passed all static gates.

### Behavioral qualification gates

The qualification must prove the required subset rather than require byte-for-byte equality with
one historical release. It will:

1. use a main-owned isolated temporary home and workspace, not the user's selected workspace;
2. inherit only the existing minimal Windows environment and no user Codex configuration,
   credentials, hooks, instructions, or provider API keys;
3. configure the intended provider protocol endpoint as an app-owned loopback fixture and fail if
   the expected protocol exchange does not occur there;
4. verify the required feature/command surface used by `codexFeaturePolicy`;
5. verify every Claude Pet model and effort value that the executor exposes, without silently
   substituting a different value;
6. verify the exact `exec`, JSONL, color, repository-check, approval, sandbox, ephemeral, and
   configuration flags used by the Full Computer executor;
7. verify the code-mode additional-tool envelope and reject unexpected authority-changing tool
   surfaces;
8. exercise representative thread, turn, response, activity, command, and terminal events through
   the production parser, including bounded additive fields;
9. prove malformed, missing, or semantically changed required output is rejected;
10. prove the probe workspace and configuration are removed after success, failure, cancellation,
    timeout, and app exit; and
11. make no real provider request and perform no sign-in.

The existing account-free native tool-surface probe is the starting point. Its historical
`0.145.0` exact fixtures will be separated into:

- a version-neutral required-capability contract;
- version-specific captured fixtures retained as regression evidence; and
- live qualification assertions that accept safe additive behavior but reject missing or changed
  requirements.

## Architecture

### `src/agent/nativeCliDiscovery.js`

`NATIVE_CLI_POLICY['codex-cli']` will describe a strict dynamic release shape and minimum protocol
floor instead of one exact release directory. Discovery will return an immutable identity record
only after all static gates pass.

The returned record will include only main-process data needed to bind qualification and launch:
canonical path, SHA-256, volume serial, file ID, parsed version, publisher, and verified junction
evidence. Raw inspection failures remain private.

Discovery classifications are:

- **absent:** no candidate exists at the official lexical location;
- **unverifiable:** a candidate exists but fails path, reparse, signature, publisher, file, held
  identity, or version-consistency checks;
- **eligible:** static identity passes and behavioral qualification may run.

Both absent and unverifiable remain non-launchable. The renderer must not receive enough detail to
distinguish a security rejection from an absent command.

### `src/agent/codexCompatibility.js`

A new main-process compatibility coordinator will:

- validate the immutable discovery identity;
- form a cache key from compatibility schema/policy revision, canonical executable identity,
  SHA-256, file ID, volume serial, version, and publisher;
- return a still-valid successful qualification when the key matches exactly;
- otherwise run the bounded account-free qualification;
- persist only a successful, schema-valid qualification;
- return a small internal result enum such as `compatible`, `incompatible`, or `check-failed`; and
- deduplicate concurrent checks for the same identity so status and Send cannot launch parallel
  qualifications.

No caller may mark a version compatible. Tests inject the probe; production always uses the real
main-owned qualifier.

### Compatibility evidence store

Successful evidence will be stored through the app's existing main-owned protected-storage
boundary. The record is bounded, versioned, atomic, and contains no credentials or raw CLI output.
It contains only the cache key, policy revision, success state, and bounded timestamp metadata.

The store is an optimization, not executable trust:

- discovery and held-identity checks still run before every provider operation;
- a path match without the same file identity and hash is a cache miss;
- a Claude Pet policy change is a cache miss;
- malformed, oversized, undecryptable, or partially written evidence is ignored and replaced only
  after a new successful qualification; and
- unsuccessful or transient results are not treated as permanent compatibility evidence.

The store keeps a bounded number of recent identities so a verified rollback can reuse its own
evidence without allowing the current path to impersonate it.

If protected persistence is temporarily unavailable, a successful qualification may remain in
memory for the current app process, but it is not written elsewhere and must run again after
restart. Persistence failure does not turn unqualified evidence into success and does not require
weakening discovery.

### `src/agent/nativeCliLaunchLease.js`

The launch lease will stop comparing Codex against one module-level version. Instead, it will
re-prove that the opened executable's held path, file identity, hash, publisher, and reported
version match the immutable eligible binding supplied by discovery.

The binding version is data to verify, not authority to launch. Authority comes from a successful
compatibility result for the same complete identity and current policy revision.

### Executors and manager

The Codex Workspace and native Full Computer executors will call one shared
`ensureCodexCompatibility` path. Their duplicate exact-version checks and exported single-version
constants will be removed.

Every status, setup, permission verification, and real run follows this order:

1. validate the saved connection and immutable run snapshot;
2. discover and bind the current official executable identity;
3. obtain or create successful compatibility evidence for that exact identity;
4. open the existing verified launch lease for the intended operation;
5. check authentication and permission readiness as applicable; and
6. perform the requested provider operation.

No setup or real run starts while qualification is pending or after it fails. Updating Codex during
a check or between check and launch changes the identity and causes a retry or fixed failure; it
does not reuse stale evidence.

### Status and public errors

The provider status contract gains a bounded compatibility state. It will not expose raw reasons,
paths, hashes, or command output.

Public behavior becomes:

- no official candidate, or an unverifiable candidate:
  `CLI_NOT_INSTALLED`;
- statically valid candidate that deterministically fails the required behavior:
  `CLI_VERSION_UNSUPPORTED`;
- compatibility check cannot complete because of timeout, cancellation, temporary I/O, or fixture
  startup failure:
  `CLI_COMPATIBILITY_CHECK_FAILED`, with Retry;
- compatible but signed out:
  `AUTH_REQUIRED`;
- compatible and signed in but permission proof unavailable:
  the existing permission error; and
- compatible, signed in, and permission-ready:
  normal setup or run.

User-facing copy will identify Codex without exposing internals. For example:

- “This Codex update is not compatible with Claude Pet yet.”
- “Claude Pet could not finish checking this Codex update. Retry the check.”

`agentManager` will check compatibility before authentication and permission fields so an
incompatible update is never mislabeled as missing, signed out, or permission-blocked.

## Data flow after an update

1. Codex Desktop updates the standalone `current` junction to a new release.
2. The next Claude Pet status/setup/run request discovers a new canonical identity and cache miss.
3. Claude Pet performs static identity verification.
4. Claude Pet runs the bounded account-free compatibility qualification.
5. On success, protected evidence is stored for that exact identity and the original user action
   continues.
6. On deterministic incompatibility, the action stops with the unsupported-update message.
7. On a transient check failure, the action stops with Retry and stores no success.
8. Later actions rediscover the executable; unchanged successful identities use cached
   qualification, while another update repeats the process.

## Failure and race behavior

- **Executable changes during inspection:** reject the identity and restart discovery once within a
  bound; repeated change returns a fixed check failure.
- **Executable changes after qualification but before launch:** launch-lease identity mismatch
  fails closed; rediscovery is required.
- **Signature or publisher failure:** never run qualification; retain the generic missing/invalid
  public result.
- **Unexpected junction target or installer layout:** never run qualification; require a Claude
  Pet update to support the new layout safely.
- **Version below the protocol floor or emergency-blocked:** deterministic unsupported result.
- **Required flag, model, effort, tool, or event behavior missing:** deterministic unsupported
  result.
- **Only additive bounded output appears:** qualification may pass when the production parser
  safely ignores it.
- **Probe timeout, abort, crash, malformed cache, or cleanup uncertainty:** no compatibility
  evidence; return a retryable check failure.
- **Concurrent status and run:** one qualification promise per identity; all callers receive the
  same bounded result.
- **App exits during qualification:** provider lifecycle cleanup terminates the assigned probe and
  no evidence is committed.
- **Rollback:** treated as its own identity; it may reuse only evidence previously created for that
  exact identity and current policy revision.

## Security and human limits

The qualification is strong evidence for the specific machine-readable contract it exercises. It
cannot prove:

- that running an official but previously unseen signed CLI for qualification is containment-safe;
- that the CLI made no unrelated telemetry or other outbound connection, because a Windows Job
  Object is not a network sandbox;
- that an official future CLI has no unrelated vulnerability;
- that every provider-side model or account policy remains available;
- that login browser handoff remains understandable or accessible;
- that Windows, antivirus, enterprise policy, proxies, or unusual user customization will behave
  identically;
- that Full Computer actions are contained or reversible; or
- that a future installer layout is safe merely because the publisher is unchanged.

The existing Full Computer warning remains unchanged. Human release checks remain necessary for
real login, browser handoff, accessibility, enterprise policy, reputation, and a contained
user-authorized smoke run. Automated qualification is not permission to sign in or make a real
model request. The isolated home, workspace, minimal environment, absent credentials, and loopback
provider endpoint reduce disclosure and side effects; they are not operating-system containment.

## Test design

Implementation must use witnessed red-green tests.

### Discovery and identity

- `0.145.0` and the installed `0.146.0` release shapes pass the same strict structural policy.
- A later syntactically valid version can reach qualification without a source allowlist edit.
- Below-floor, malformed, mismatched directory/output, wrong platform, extra reparse hop, sibling
  package root, copied executable, workspace/temp candidate, invalid signature, wrong publisher,
  changed file ID, changed hash, and junction race all fail closed.
- Unknown installer layouts are rejected rather than generalized.
- Public results contain no absolute path, hash, file ID, raw target, or raw inspection error.

### Qualification

- A synthetic future version with the complete required subset and additive bounded fields passes.
- Missing or changed required flags, features, models, efforts, tool envelope, event types, or
  permission behavior fails as incompatible.
- Unexpected authority-changing tools fail.
- The expected provider exchange reaches only the configured loopback fixture; no credentials or
  inherited user configuration are supplied, and the user workspace is not selected.
- Tests do not claim to detect unrelated telemetry or every possible outbound connection without a
  separate network sandbox.
- Timeout, abort, malformed output, fixture failure, and cleanup uncertainty are retryable and
  never write successful evidence.
- The exact production parsers consume representative qualification events.
- Codex `0.146.0` passes the account-free live qualification before the PR claims it is supported.

### Cache and concurrency

- The first exact identity qualifies once; later status/setup/run requests reuse success.
- Restart restores valid protected evidence.
- Version, hash, file ID, volume, canonical target, publisher, policy revision, or evidence schema
  change causes a cache miss.
- Corrupt, oversized, undecryptable, partial, forged-shape, and stale records are ignored.
- Concurrent callers share one qualification and cannot skip its result.
- The bounded eviction policy cannot turn one identity's evidence into another's.

### Executors, UI, and errors

- Status, setup, permission verification, Workspace executor, and Full Computer executor share one
  compatibility decision.
- The old exact `CODEX_FULL_COMPUTER_VERSION` gate is absent.
- Missing/unverifiable, incompatible, transient-check, signed-out, and permission-unavailable paths
  map to distinct stable public behavior.
- The screenshot scenario with official `0.146.0` no longer says the command is not installed.
- Renderer snapshots and feedback expose only the allowlisted compatibility state and safe copy.
- Retry reruns only transient or uncached checks and never bypasses qualification.

### Full verification

- Focused discovery, launch-lease, compatibility, executor, manager, Settings, snapshot, and
  renderer tests.
- Complete serialized Node suite.
- Python suite.
- `git diff --check`.
- Fresh Windows package build and package verification.
- Fresh-profile packaged Offline Demo regression.
- Packaged, account-free `0.146.0` compatibility/status check.
- Optional user-authorized real Codex smoke in `C:\Users\eklip\Desktop\a`; no real run is required
  to prove the automatic qualification mechanism.

## Acceptance criteria

The PR is acceptable only when:

1. the current `0.146.0` installation is statically verified and passes the account-free
   qualification;
2. `0.145.0` regression fixtures remain compatible without being the sole accepted version;
3. a synthetic compatible future version passes without changing an exact version allowlist;
4. synthetic breaking future versions fail before setup or a real run;
5. every provider operation rebinds the current exact executable identity even when successful
   compatibility evidence is cached;
6. no unsigned, wrongly signed, misplaced, structurally unexpected, changed, or stale executable
   can reuse another version's evidence;
7. the UI distinguishes incompatible and retryable compatibility failures from a missing command,
   without disclosing security internals;
8. qualification uses no real account, provider credential, user workspace, inherited
   customization, or intentionally configured billable request;
9. the complete automated and package verification passes; and
10. canonical project context, build log, and `PROJECT_CHECKLIST.html` are refreshed only after the
    implementation and runnable evidence are verified.

## Implementation boundary

This document authorizes planning, not application-code changes. The next step after user review is
a detailed implementation plan with explicit red-green checkpoints. Implementation begins only
after that plan is reviewed through the normal project gate.
