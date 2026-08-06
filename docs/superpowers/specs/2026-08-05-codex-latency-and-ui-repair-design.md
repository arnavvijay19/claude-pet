# Codex latency and UI repair design

- Date: 2026-08-05
- Branch: `codex/claude-pet-product-repair-handoff`
- Baseline: `master` at `a435732a6afbef890d1c514f07254b80d97248d2`
- Supersedes nothing. Amends the UI direction of
  `2026-07-27-core-v1-ux-rebuild-design.md` for the main window only.
- Inputs: `CLAUDE_PRODUCT_REPAIR_HANDOFF.md`, measured reproduction recorded below.

## Scope

Claude Pet is personal, local-only software for one machine. It is not a product, is not
distributed, and has no other users. Public code signing, reputation gates, enterprise-policy
validation, multi-user threat modeling, and release polish are therefore out of scope and are
not completion blockers.

The fail-closed exact Codex identity verification is **not** relaxed by this. It protects this
machine rather than a distribution channel: Full Computer mode has real access to the user's own
files, so the exact signed-publisher, path, SHA-256, volume-serial, and file-ID chain still has
to stop a tampered or spoofed `codex.exe`. Phase 1 removes the *cost* of that verification, never
its strength. Local packaging verification also stays, because the user installs from it.

## Problem

Codex Test Connection, official login, and task startup are extremely slow, and an attempted
task ended with `PERMISSION_PROFILE_UNAVAILABLE`. The app also exposes one generic pending
state and generic feedback, so expected waits look frozen.

## Measured evidence

All timings taken on 2026-08-05 against installed official Codex `0.146.0`, account-free, with
no real model request.

### Provider cost is negligible

| Operation | Measured |
|---|---:|
| `codex --version` | 55 ms |
| `codex login status` | 55 ms |

### App verification cost dominates

One inspection-helper open costs 4.5-5.6 s, composed of:

| Component | Measured |
|---|---:|
| `powershell.exe` startup | 1,100-1,300 ms |
| `Add-Type` runtime C# compile | 530 ms |
| SHA-256 over codex.exe (342 MB) | 550 ms |
| `Get-AuthenticodeSignature` | 2,270 ms (no warm-up benefit) |
| `FileVersionInfo` | 9 ms |

Claude Pet opens that helper twice per Test Connection and about eight times per task.
Measured Test Connection: 13-15 s, of which roughly 0.06 s is Codex.

### `PERMISSION_PROFILE_UNAVAILABLE` is a deadline abort, not an account problem

Reproduced deterministically twice (32.6 s, 32.9 s) with cause chain
`PERMISSION_PROFILE_UNAVAILABLE <- check-failed <- RUN_STOPPED`.

Against the probe's own 30,000 ms deadline (`PROBE_LIMITS.deadlineMs`):

| Event | Elapsed |
|---|---:|
| spawn 1 lease open | 5,337 ms |
| spawn 1 process (`codex features list`) | 93 ms |
| spawn 2 lease open | 4,908 ms |
| spawn 2 provider scenario | aborted at deadline |

Two lease opens consume 10,376 ms (35 %) of the budget before the real provider process
starts, leaving about 19,600 ms for a scenario that needs 24,367 ms.

Control: the identical scenario without lease wrapping completes in 24,367 ms. This is why
compatibility qualification succeeded and persisted on 2026-08-04 at 21:28 while the task run
failed at 21:33.

### The repeated permission probe supplies no fact

`localProviderProbe.js` attaches `available` and `allowed` **only** when
`purpose === 'compatibility'`. In permission mode both keys are absent, so the agent manager's
`permission?.available === false` and `permission?.allowed === false` checks can never fire.
The probe is a pure pass-or-throw gate whose facts the already-required compatibility contract
supplies.

### The 10.5 s sleep is a coordination device, not a safety property

`buildCodexExec` runs `Start-Sleep -Milliseconds 10500` inside the async exec cell so the cell
is still in flight when the harness issues the real Codex `wait` tool with `yield_time_ms:
10000`. The property under test is "exec is asynchronous and `wait` returns the completed cell
output", not elapsed time. The current construction only *hopes* the timings line up.

## Goals

- Cached Test Connection completes in about 2 s and shows a result immediately.
- Cached official login launches the visible provider flow within about 3 s.
- Cached task preflight starts the real provider process within about 3 s, with no deliberate
  10.5 s permission probe.
- First-identity qualification stays account-free, happens once per exact identity and policy
  revision, shows a named stage, and is cancellable.
- Connection state is legible per connection, where the user acted.
- The main window reads as an agent run log, not a chat clone.

## Non-goals

Explicitly out of scope for this repair: theme controls of any kind, glass styling, decorative
gradients, dashboards, schedules, cloud sync, WSL, multi-agent concurrency, restoring any
deleted WorkBuddy material, weakening exact Codex identity verification, and converting the
codebase to TypeScript.

## Phase 1: Codex reliability and startup latency

### 1.1 One verified lease per operation

Today `discover()` and `withLease()` each independently open the inspection helper, and the
executor rediscovers for every operation. Replace with a single main-owned verified binding per
operation, held across the process launches that operation authorizes. Discovery consumes the
lease's facts instead of opening its own helper.

Result: Test Connection 2 helper opens to 1; a task about 8 to 1.

Qualification before every Codex process launch is preserved, including official login. A fresh
rediscovery and a fresh verified lease still occur immediately before every real provider
process, per the handoff rule.

### 1.2 Precompiled inspection helper

Replace `resources/windows/inspect-native-cli.ps1` plus runtime `Add-Type` with a precompiled
helper produced by an offline build step that mirrors `scripts/build-provider-job-host.js`:
`csc.exe`, recorded `sourceSha256` and `executableSha256`, deterministic output. Removes about
1.6-1.8 s per open (PowerShell startup plus runtime C# compile).

The helper keeps its current contract: bounded newline-delimited JSON, one path per session,
a held `FILE_SHARE_READ` handle, and explicit release.

### 1.3 Authenticode verified once per held handle

The file is held `FILE_SHARE_READ` with no write sharing, so its bytes cannot change while
held. Re-verifying the signature inside a single operation proves nothing new. Verify once per
held handle; a fresh handle and a real verification still precede every real process launch.

### 1.4 Remove the redundant per-task permission probe

Remove `verifyPermissionProfile`'s synthetic probe from the task preflight path, gated behind a
witnessed failing test that proves the compatibility contract already supplies every fact the
Full Computer readiness decision uses. The compatibility qualification requirement is unchanged.

### 1.5 Deterministic sentinel handshake replaces the sleep

Replace `Start-Sleep -Milliseconds 10500` with a sentinel handshake: the exec cell's shell
command waits for a sentinel file that the probe's control server writes when it receives the
`wait` turn, then completes promptly.

This proves the cell was genuinely in flight at the moment `wait` was issued, which is strictly
stronger than the current timing assumption, and removes the arbitrary wait. Behavioral
coverage of async exec plus `wait` is retained, not deleted. Qualification drops from about
24.4 s to about 13 s, restoring headroom under the 30 s deadline.

### 1.6 Stage timing instrumentation

Add bounded main-owned stage timing behind an unpackaged diagnostic or test flag for:
discovery, protected evidence lookup, behavioral qualification, login status, config
preparation, final lease, and provider start.

Emits fixed stage names, durations, and fixed outcome categories only. Never emits raw paths,
hashes, credentials, command lines, environment values, or provider output. Not exposed to the
renderer.

### 1.7 Fixed public outcomes

Distinguish, with fixed safe copy: not installed, verifying update, incompatible update,
verification temporarily failed, not signed in, local configuration unavailable, provider
launch failed.

### 1.8 Config and lifecycle invariants

The small app-owned `config.toml` is rewritten immediately before every real run; an in-memory
marker is never treated as proof of current disk bytes. Stop cancels the active bounded
operation and cleans its complete owned process tree.

## Phase 2: Connection workflow

Replace the generic Test / Sign in / Edit trio and the single global pending flag with one
per-connection state machine:

`Not checked` · `Verifying installed Codex` · `Sign-in required` · `Ready` · `Starting` ·
`Running` · a specific recoverable failure.

Requirements:

- Pending state and final feedback are keyed to the exact saved connection. Unrelated
  connections remain usable. This replaces the current global `connectionActionPending` boolean
  and the global `connectionFeedback` string.
- Feedback renders on the card the user acted on. Today the Test button lives in
  `renderConnectionCards` while its result renders inside `renderConnectionEditor`, which is
  frequently off-screen.
- The active step is named, and a one-time identity check is labelled as one-time.
- Long verification is cancellable.
- No background check is claimed unless its completion or failure is surfaced.
- A saved Codex connection stays testable without changing the active agent or sending a model
  request.
- Official sign-in stays provider-owned. Claude Pet never reads or renders credentials.
- The permanent Full Computer warning is kept, and Workspace remains unavailable with no
  fallback.

## Phase 3: Main UI repair

### 3.1 Renderer technology

Adopt Preact plus htm, vendored through a build step that mirrors `build:job-host` and records
SHA-256 for each emitted file. Vendoring avoids bare-specifier ESM resolution under `file://` in
an `asar=false` package and keeps package integrity deterministic. The vendor step emits only
runtime ESM files; `.map` files are not emitted, because the package scan forbids source maps.

Renderer tests move from the hand-written fake DOM stub to jsdom as a **devDependency only**,
pruned from the package.

Component modules, one responsibility each: Sidebar, StatusRibbon, Conversation, RunCard,
Trace, RunScrubber, Composer, CommandPalette, Connections, Activity. A design-token stylesheet
supplies the spacing, type, and color scale.

### 3.2 One morphing status ribbon

A single strip in a fixed position is the only status surface. It absorbs what are currently
four separate things: the connection chip, the Full Computer chip, the hidden connection
feedback line, and the Stop / Activity controls.

The ribbon always shows the current truth and, when one exists, exactly one obvious next
action: `Check now`, `Sign in to Codex`, `Cancel`, or `Stop`. The existing nine-state pet atlas
mirrors the ribbon so status is ambient without extra chrome.

### 3.3 Runs, not chat bubbles

The conversation is a sequence of run cards: goal, compact trace chips for the tool actions,
inline unified diffs, then the agent's answer. This matches architectural rule 1, that one goal
may perform many tool actions.

Traces are collapsed by default to `N steps · M files changed · duration` and expand to
commands with exit codes and diffs with `+`/`-` line coloring. No third-party syntax
highlighter is added; structural markup, monospace, and diff coloring carry it. This keeps the
supply chain small and satisfies the "show more of the agent's real work" requirement.

### 3.4 The pet becomes the agent

The 192x208 pet window and its validated nine-state atlas currently exist but carry almost no
information. The pet becomes the ambient expression of the same state the ribbon shows, so the
two windows are one product rather than a toy beside an app:

- Pet state is driven by the run and connection state machine, not by a separate concept.
- A thin progress ring around the pet advances as run steps complete.
- `Sign-in required` and terminal failures use a distinct attention state, so a blocked run is
  visible without the main window open.
- Clicking the pet reveals the main window focused on the active run.

No new animation rows are authored. This wires the nine states that Task 15 already validated.

### 3.5 Run scrubber

A completed run card can be scrubbed step by step: moving through the steps shows the trace,
command output, and diff as they stood at that point. This is a read-only view over the
existing discriminated activity events; it adds no new data collection and no provider calls.

### 3.6 Re-run with edits

Any past goal can be reopened in the composer, edited, and run again against the currently
selected participant. This reuses the existing retry path and the existing stale-selection
guards; it never silently reuses an expired connection revision.

### 3.7 Command palette

`Ctrl+K` opens a palette that replaces the composer's participant dropdown and carries actions,
not just navigation: switch agent, session, or connection; re-run with edits; open the project
folder; copy a diff; export the session. The palette is keyboard-first and each entry states
the exact target it will act on.

Run navigation is keyboard-first throughout: `j` and `k` move between runs, `Enter` expands a
trace, `Escape` collapses.

### 3.8 Export session

A session exports to a local Markdown run log containing goals, steps, diffs, and answers.
Export is a local file write to a user-chosen path. No cloud, no network, no telemetry.

### 3.9 Settings

Settings becomes secondary and task-oriented, with provider connections first and agent profile
fields below, because connection setup is the blocking task. Connection setup reads as a short
guided flow, not a form plus unrelated controls.

Activity noise is reduced by default while an expandable, timestamped diagnostic view is
retained.

### 3.10 Preserved behavior and known defect

Preserved: one main window, the persistent composer, drafts, encrypted history, participant
attribution, attachment limits, warnings, Stop and Retry, and responsive behavior.

Fixed: the conversation pane currently clips text at the right edge (stray glyphs at x≈1070 at
1080x720).

Validated: keyboard navigation, focus visibility, screen-reader labels, reduced motion, 900x650
and 1440x900.

## Error handling

Public errors stay fixed and safe. `PERMISSION_PROFILE_UNAVAILABLE` must no longer be produced
by infrastructure uncertainty in a probe the readiness decision does not consult. Deterministic
contract mismatch remains `CLI_VERSION_UNSUPPORTED`; infrastructure uncertainty remains
retryable `CLI_COMPATIBILITY_CHECK_FAILED`. Protected compatibility evidence stays fail-closed
and keyed to the exact normalized path, SHA-256, volume serial, file ID, semantic version,
exact `OpenAI OpCo, LLC` publisher, and policy revision.

## Testing

Every behavior change is witnessed red then green.

Focused coverage: first identity, protected-cache hit, changed identity, retryable failure,
deterministic incompatibility, abort, cleanup, config write failure, and exact per-connection
UI state.

Final gates: `npm.cmd test`, `py -3.12 -m pytest -q`, `node --check` on changed sources,
`git diff --check`, a fresh `package:win`, `verify:package`, and real-window visual and
accessibility QA at 900x650 and 1440x900.

Package scans continue to exclude `.workbuddy-ai`, `LOCAL_PR.html`, development metadata,
source maps, runtime state, and secret-shaped text. Unit tests and package creation alone do
not constitute completion; the visible saved-connection workflow and an account-free readiness
flow must be demonstrated in the real app.

## Risks

- Adding runtime dependencies shifts `verify:package` file-count and byte expectations. The
  verifier's expected values must be updated in the same change that adds them.
- Preact and htm ship `.map` files that the forbidden-path scan rejects. The vendor step emits
  runtime ESM only.
- jsdom must remain a devDependency and stay pruned from the package.
- Removing the redundant permission probe must not weaken the compatibility gate. The gate is
  the witnessed failing test in 1.4.

## Sequencing and GitHub workflow

Phase 1, then Phase 2, then Phase 3.

All work is published to GitHub. Every implementation task follows the workflow already
established for forward-compatibility Tasks 1-7:

1. Start the task in an isolated worktree on a fresh `codex/...` branch whose base is the exact
   remote merge commit of the previous task.
2. Implement with witnessed red-green tests.
3. Run the full verification gates.
4. Push the branch and open a reviewable pull request against `master`.
5. Merge that pull request remotely. The local `master` checkout is never edited directly.
6. Begin the next task from the new remote merge commit.

Pull request bodies follow the existing repository convention: a `## Summary` section, a
`## Verification` section reporting exact test counts and package figures, and no AI-credit
trailer. Commits carry no `Co-Authored-By` trailer.

Phase 3 is substantially larger than Phases 1 and 2. Its implementation plan is expected to
split into at least three separately reviewed pull requests: the vendored renderer foundation
and jsdom test migration, then the ribbon plus run cards and traces, then the pet coupling,
scrubber, palette, and export. Each must leave the app runnable, per architectural rule 12.
