# Claude Pet Product Repair Handoff

## Checkpoint

- Date: 2026-08-05
- Branch: `codex/claude-pet-product-repair-handoff`
- Baseline: verified local and GitHub `master` at `a435732a6afbef890d1c514f07254b80d97248d2`
- This branch contains diagnosis and requirements only. No product implementation has started.
- The later WorkBuddy latency/theme experiment was removed completely. Do not recover or copy it.
- The earlier independently reviewed stale compatibility-cache recovery on `master` remains valid.

## User request

Act as the main architect and repair Claude Pet as a real product. The urgent problem is that Codex Test Connection, official login, and task startup feel extremely slow; an attempted task ended with `PERMISSION_PROFILE_UNAVAILABLE`. The broader app feels slow, unclear, and unpleasant to use, and the UI needs functional redesign rather than cosmetic decoration.

Do not add a Light/Dark/System theme feature. Keep the established dark appearance unless a later user-approved design explicitly replaces it.

## Confirmed code-path evidence

1. `src/appWindow.js` handles Test Connection by calling only `manager.getStatusFor(connectionId)`.
2. `src/agent/agentManager.js` runs task preflight sequentially: status, capabilities, models, then permission verification.
3. `src/agent/executors/codexNativeFullComputer.js` gates status and official login on exact signed discovery plus the compatibility coordinator.
4. First-time compatibility qualification runs the canonical account-free probe in `src/agent/localProviderProbe.js`.
5. The canonical Codex probe command deliberately contains `Start-Sleep -Milliseconds 10500`.
6. `codexNativeFullComputer.verifyPermissionProfile()` runs a second permission-purpose instance of that same synthetic probe before every real task, even when exact identity-bound compatibility evidence already exists.
7. Any bind, fixture, process, protocol, timeout, cleanup, or I/O failure in the permission-purpose probe is normalized to `PERMISSION_PROFILE_UNAVAILABLE`. Therefore that public error does not prove the user's actual Codex account or Windows permissions are wrong.
8. Protected compatibility evidence is already keyed to the exact normalized path, SHA-256, volume serial, file ID, semantic version, exact `OpenAI OpCo, LLC` publisher, and policy revision. It must remain fail-closed.

## Root-cause status

- Confirmed latency cause: the intentionally long synthetic probe is used during first-identity compatibility qualification and is unnecessarily repeated as per-task permission verification.
- Confirmed UX cause: the UI exposes one generic pending state and generic feedback instead of named stages and per-connection state, so expected waits look frozen.
- Not yet confirmed: which exact permission-probe sub-step failed in the user's real run. Reproduce once with bounded internal stage timing and fixed-category diagnostics before changing error handling. Do not log raw paths, hashes, credentials, command lines, environment values, or provider output.
- The Electron process observed during this investigation started before the WorkBuddy undo and may have retained old code in memory. Stop it normally and restart from this branch/master before collecting UI or runtime evidence.

## Required product architecture

Decompose the repair into reviewable phases; do not bundle an unbounded “improve everything” rewrite.

### Phase 1: Codex reliability and startup latency

- Add main-owned stage timing for discovery, protected evidence lookup, behavioral qualification, login status, config preparation, final lease, and provider start.
- Preserve qualification before every Codex process launch, including official login.
- Qualify each exact identity/policy once and reuse only the existing protected evidence or the coordinator's shared pending promise.
- Determine which behaviors genuinely require the 10.5-second wait. If elapsed time itself is not a safety property, replace the arbitrary sleep with a short deterministic coordination proof; do not silently delete behavioral coverage.
- Remove the redundant per-task permission-purpose probe only after a failing test proves the compatibility contract already supplies every fact used for Full Computer readiness.
- Always rewrite the small app-owned `config.toml` immediately before the real run. Never treat an in-memory marker as proof of current disk bytes.
- Rediscover the exact executable and open a fresh verified launch lease immediately before every real process.
- Distinguish fixed public outcomes: not installed, verifying update, incompatible update, verification temporarily failed, not signed in, local configuration unavailable, and provider launch failed.
- Stop must cancel the active bounded operation and clean its complete owned process tree.

### Phase 2: Connection workflow

- Replace generic Test/Login buttons with one understandable connection state machine: `Not checked`, `Verifying installed Codex`, `Sign-in required`, `Ready`, `Starting`, `Running`, or a specific recoverable failure.
- Show which step is active and whether it is a one-time identity check.
- Keep pending state and final feedback keyed to the exact saved connection; unrelated connections remain usable.
- Never claim a background check is happening unless its completion or failure is surfaced.
- A saved Codex connection should be testable without changing the active agent or sending a model request.
- Official sign-in stays provider-owned; Claude Pet never reads or renders credentials.
- Keep the permanent Full Computer warning and keep Workspace unavailable unless the separately approved WSL boundary is built.

### Phase 3: Main UI repair

- Inspect the real app before designing. Automated CSS assertions are not visual proof.
- Preserve one main window and the persistent composer, but simplify hierarchy around: selected session, selected agent/provider, conversation, current run, and one obvious next action.
- Make Settings secondary and task-oriented. Connection setup should read like a short guided flow, not a form plus unrelated controls.
- Reduce technical activity noise by default while retaining an expandable, timestamped diagnostic view.
- Keep drafts, encrypted history, participant attribution, attachment limits, warnings, Stop/Retry, and responsive behavior.
- Do not add theme controls, glass styling, decorative gradients, dashboards, schedules, cloud sync, WSL, or multi-agent concurrency in this repair.
- Validate keyboard navigation, focus visibility, screen-reader labels, reduced motion, 900x650, and 1440x900.

## Initial performance targets

Measure before and after on the installed official Codex identity. Treat these as app-overhead targets, excluding browser/provider/network time:

- Cached Test Connection: result begins visibly immediately and completes in about 2 seconds when `codex login status` is responsive.
- Cached official login: visible login process launches within about 3 seconds.
- Cached task preflight: real provider process begins within about 3 seconds; no deliberate 10.5-second permission probe occurs.
- First identity qualification may take longer, but must show a named stage, occur once per exact identity/policy, be cancellable, and never be mislabeled as ordinary login or task execution.

If live measurements show these targets are incompatible with required signed discovery or process startup, report the measured boundary and revise the target rather than weakening verification.

## Fresh Claude Code bootstrap

This machine was checked on 2026-08-05 with Claude Code `2.1.220`. The two useful user-scoped plugins are already installed and enabled:

- `superpowers@superpowers-dev` `6.1.1`
- `chrome-devtools-mcp@claude-plugins-official` `1.5.0`

At the start of a fresh Claude session, run `claude plugin list`. If either plugin is absent, install only the missing one:

```powershell
claude plugin install superpowers@superpowers-dev
claude plugin install chrome-devtools-mcp@claude-plugins-official
```

If present but disabled, use `claude plugin enable <plugin-id>`. Do not install broad MCP, WSL, cloud, theme, or multi-agent packages for this repair.

Use the Superpowers skills deliberately and in this order as the work reaches each stage:

1. `systematic-debugging` for the measured reproduction and root cause.
2. `brainstorming` to present the product and UI approaches before implementation.
3. `writing-plans` after the user approves the direction.
4. `using-git-worktrees` before product edits so `master` remains untouched.
5. `test-driven-development` for each behavior change.
6. `verification-before-completion` before claiming any phase works.
7. `requesting-code-review` and `finishing-a-development-branch` when preparing each PR.

Use the Chrome DevTools `a11y-debugging` or `chrome-devtools` skill only where it can inspect the real Electron renderer. It supplements, but does not replace, launching the packaged app and visually testing the two required window sizes. Do not use `dispatching-parallel-agents` or `subagent-driven-development` unless the user explicitly asks; the repair needs one coherent owner.

## Required debugging sequence

1. Read `docs/project-context.md`, `docs/BUILD_LOG.md`, the Codex compatibility spec/plan, and the complete current executor/manager/probe code.
2. Confirm the checkout is this branch at the recorded baseline and that tracked state is clean.
3. Stop the stale Electron instance normally; restart the app from the current checkout.
4. Add bounded internal timing instrumentation behind an unpackaged diagnostic/test flag. Do not expose sensitive evidence to the renderer.
5. Reproduce Test Connection twice and compare first-identity versus cached behavior.
6. Reproduce official login launch timing without automating authentication.
7. Reproduce the permission failure without sending a real model task if possible. If a real task is required, ask the user immediately before it.
8. State one root-cause hypothesis per failure and test it minimally.
9. Present 2-3 implementation approaches and a coherent UI design to the user before implementation.
10. After approval, write the spec and TDD plan, implement on a non-`master` feature branch, run full/package/visual verification, and open reviewable PRs.

## Testing and release gates

- Witness red-green tests for every behavior change.
- Focused tests must cover first identity, protected-cache hit, changed identity, retryable failure, deterministic incompatibility, abort, cleanup, config write failure, and exact per-connection UI state.
- Final gates: `npm.cmd test`, `py -3.12 -m pytest -q`, JavaScript syntax checks, `git diff --check`, fresh `package:win`, `verify:package`, and real-window visual/accessibility QA.
- Package scans must continue excluding `.workbuddy-ai`, `LOCAL_PR.html`, development metadata, source maps, runtime state, and secret-shaped text.
- Do not call the work complete based only on unit tests or package creation. Demonstrate the visible saved-connection workflow and an account-free readiness flow in the real app.

## First next action

Begin with bounded timing instrumentation and a fresh-master reproduction. Do not restore the deleted WorkBuddy patch and do not start with CSS.
