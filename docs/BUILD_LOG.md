# Build log & field notes

Two sections. Every session appends; no session rewrites history (fix mistakes by adding a
correcting line, or — for field notes — editing the stale note in place and noting the edit).

## Session log

One entry per session, appended at the **bottom**, written **before the session ends** (not
optional — an unlogged session is a failed session even if its code worked). Format:

```
- **YYYY-MM-DD · <model> · <task/phase>** — what got done (with commit hash), what's verified
  (name the evidence: test output, screenshot), what's blocked/next. One to three lines.
```

<!-- entries below -->

- **2026-07-15 · claude (freemodel) · docs** — Research integration finished (`866abff`), AI
  deployment strategy + this log added. No code yet; next unstarted work is plan Task 1.

- **2026-07-16 · Fable 5 (freemodel) · Task 1 (MVP sprite extraction)** — Done, on worktree
  branch `worktree-task-1-mvp-sprite-extraction` (no remote exists; user merges to master).
  Delivered `scripts/extract_mvp_sprite.py`, `tests/test_extract_mvp_sprite.py` (pytest,
  1 passed ~2.4s), and generated `assets/spritesheet-mvp.png` (1152x208), `assets/pet.json`,
  `assets/tray-icon.png` (32x32). Verified: green test + visual inspection of atlas over a
  checkerboard (6 clean transparent frames, no magenta halo, aspect preserved). The plan's
  original Step 3 snippet was wrong 3 ways (magenta bg kept, aspect squashed, off-grid frames
  sliced) — superseded in place; see the Task 1 correction block in the plan. Next: Task 2.

- **2026-07-16 · Fable 5 (freemodel) · post-Task-1 docs** — Follow-up on the Task 1 branch
  before handing off to Task 2: re-ran the suite (1 passed), moved the Task 1 entry above out
  of Field notes into this section (placement fix, content verbatim), and expanded plan Task
  2's `.gitignore` snippet to cover the Python/worktree artifacts Task 1 introduced
  (`__pycache__/`, `.pytest_cache/`, `.claude/worktrees/`). The `pet.json` contract is
  untouched — Tasks 3/4/7 consume it exactly as planned. NEXT (user, before the Task 2
  session): commit the uncommitted `project-context.md` edit in the main checkout, then from
  `Z:\Downloads\Code\Claude Pet` on `master` run
  `git merge worktree-task-1-mvp-sprite-extraction` — an unmerged Task 1 would make the next
  session redo it. Then Task 2 via the standard entry prompt (hard task — Fable high/xhigh
  per the model policy; xhigh is better saved for Tasks 4/6/7 where the silent failures live).

- **2026-07-16 · Fable 5 (freemodel) · integration** — The NEXT items above are done (user
  delegated them): `master` fast-forwarded to `9b160dc`, his `project-context.md` tweak
  committed as `87ff927`, suite green on merged `master` (1 passed, 2.30s). Nothing pending —
  the next session starts plan Task 2 directly via the standard entry prompt.

- **2026-07-16 · Fable 5 (freemodel) · Task 2 (Electron scaffold)** — Done, on worktree branch
  `worktree-task-2-electron-scaffold` (`17f4e57` = package.json + .gitignore exactly per plan;
  docs commit follows). Verified: `npm install` completed, `node_modules/.bin/electron` exists,
  and `./node_modules/.bin/electron --version` → `v33.4.11` (pasted output, not assumed —
  needed because of the allowScripts warning, see field note). `package-lock.json` left
  untracked per the plan's Step 4 note. No `npm start` smoke test — `src/main.js` doesn't exist
  until Task 4, exactly as the plan expects. NEXT (user): from `Z:\Downloads\Code\Claude Pet`
  on `master` run `git merge worktree-task-2-electron-scaffold`, then re-run `npm install` in
  the main checkout (node_modules lives only in the worktree and is git-ignored). Then Task 3.

- **2026-07-16 · Fable 5 (freemodel) · integration** — The NEXT items above are done (user
  delegated them, same session): `master` fast-forwarded to `e8bb227`, `npm install` re-run in
  the main checkout, `./node_modules/.bin/electron --version` → `v33.4.11` there too (pasted).
  Nothing pending — the next session starts plan Task 3 directly via the standard entry prompt
  (mechanical task per the model policy; worktree recommended, branch off `master`).

- **2026-07-16 · Fable 5 (freemodel) · Task 3 (sprite state machine + renderer shell)** — Done,
  on worktree branch `worktree-task-3-sprite-renderer`, based on the task-2 branch tip
  (`0fe4d64`, verified descendant of `master` — merging task-3 brings the unmerged task-2
  docs commit along, history stays linear). `c4e167f` = `src/renderer/pet.js` +
  `src/renderer/index.html` + `tests/petStateMachine.test.js`, exactly per plan (TDD: watched
  the test fail on missing module first). `c99ccbb` = fix for a Task 2 latent bug found here:
  `npm test`'s `node --test tests/` breaks on Node 24 (see the SUPERSEDE field note). Verified:
  `npm test` → 4 pass / 0 fail (pasted), pytest → 1 passed. `renderer-main.js` deliberately
  doesn't exist yet (Task 7). NEXT (user): from `Z:\Downloads\Code\Claude Pet` on `master` run
  `git merge worktree-task-3-sprite-renderer` (fast-forward), then Task 4 via the standard
  entry prompt (hard task — Fable high/xhigh; first window on screen, visual verification
  mandatory).

- **2026-07-16 · Fable 5 (freemodel) · integration + electron bump** — Task 3 branch merged
  to `master` by the user (fast-forward to `df488b2`), `npm install` re-run there. User then
  ran `npm audit fix --force` → electron 33.4.11→43.1.1; session verified the bump is safe
  and committed it (`512a2c4`, stale `allowScripts` removed — see the two field notes) plus
  these docs. Verified on merged `master`: `npm test` 4 pass / 0 fail, pytest 1 passed,
  `electron --version` → v43.1.1, `git status` clean. Nothing pending — next session starts
  plan Task 4 via the standard entry prompt (hard task — Fable high/xhigh effort; first
  visible window, visual verification mandatory, now doubly so on electron 43).

- **2026-07-17 · Codex (GPT-5) · Task 4 pass 1/2 (overlay window + tray)** — Fresh worktree
  `worktree-task-4-overlay-window` created from `master` at `55f88e5`; `src/main.js` and
  `src/preload.js` implemented and deliberately left uncommitted for the requested checkpoint.
  Verified: `npm.cmd test` 4 pass / 0 fail, pytest 1 passed, both `node --check` commands and
  `git diff --check` exited 0. NEXT: queued pass 2 must run `npm.cmd start`, capture visual
  window + tray evidence, update this log with the result, then commit Task 4.

- **2026-07-17 · Codex (GPT-5) · Task 4 pass 2/2 (overlay window + tray)** — Done on
  `worktree-task-4-overlay-window`; implementation commit `5111ebf` (`src/main.js` +
  `src/preload.js`), with this evidence/docs commit following. Live Electron 43 verification:
  renderer `index.html` reached `complete` at exact 192x208 bounds `(2044,818)`, 24px from the
  2260x1050 work area's bottom-right; transparent body and all five preload APIs confirmed;
  Banana Baron tray icon visible in [`evidence/task-4-tray.png`](evidence/task-4-tray.png).
  Fresh verification: `npm.cmd test` 4 pass / 0 fail, pytest 1 passed, both `node --check`
  commands + `git diff --check` exited 0. NEXT: merge this branch to `master`, then Task 5.

- **2026-07-17 · Codex (GPT-5) · Task 5 (local prompt bridge)** — Done on
  `worktree-task-5-prompt-bridge`; implementation `1cfef44`, review fix `3e75862`, and docs
  `5471cd3` plus this evidence/docs commit. TDD verified the missing-module, JSON `null`, and
  split-UTF-8 RED cases; fresh verification: focused Node 4 pass / 0 fail, full Node 8 pass /
  0 fail, pytest 1 passed, both `node --check` commands and `git diff --check` exited 0.
  Task review clean; final re-review follows. NEXT: merge to `master`, then Task 6.

- **2026-07-21 · Codex (GPT-5) · provider-neutral redesign and replanning** — Reworked the
  canonical spec, research, project context, and existing implementation plan in 6458d6b:
  completed Tasks 1-5 stay intact and the old Claude-only/appeal-blocked tail is replaced by
  serial provider-neutral Tasks 6-15. The temporary separate provider design was folded into
  the canonical docs and deleted. Verified: exact task sequence 6-15, 73 executable unchecked
  steps, balanced plan fences, no placeholder/truncation markers, five-file docs-only staged
  set, and git diff --check exit 0. NEXT: a fresh architect executes Task 6 only via the
  standard entry prompt; no provider account or key is needed.

- **2026-07-21 · Codex (GPT-5) · Task 6 plan review fixes** — Corrected the Task 6 reference
  implementation to reserve the busy state before async preflight and map every public error
  to fixed text; added both regression cases. Focused plan checks and `git diff --check` passed.

- **2026-07-22 · Codex · agent-first design** — Replaced the chat-client assumption with an
  approved all-purpose agent design: Codex/Claude CLI executors, Workspace Agent default,
  separately confirmed Full Computer access, Simple/Comprehensive live activity, and runnable
  user-test gates. Design commit: `354e8cb`.

- **2026-07-22 · Codex · canonical agent plan reconciliation** — Rewrote the canonical spec,
  project context, research, and Tasks 6-15 around the approved design. Incorporated review fixes
  for Electron async safeStorage shape, explicit public metadata allowlisting, deterministic
  delayed cancellation, Task ownership, and one canonical package path. Fresh verification: Node
  8 pass / 0 fail, pytest 1 pass, ten serial Tasks 6-15, 45 unchecked execution steps, balanced
  plan fences, no missing relative Markdown links, no placeholder markers, and `git diff --check`
  exit 0. Final commit is recorded in the session handoff.

- **2026-07-22 · Codex (GPT-5) · Task 6 (agent manager + activity core)** — Added the six-method
  executor contract, stable public errors, recursive activity sanitizer/schema/store, and one-run
  manager in `feat: add agent manager and activity core` (final SHA recorded in the handoff report).
  TDD RED was missing `src/agent`; fresh verification: focused Node 21/21, full Node 29/29, pytest
  1/1, all six source syntax checks, and `git diff --check` exit 0. Repository-local review found
  four contract-boundary defects; the following entry records their fixes and clean re-review.

- **2026-07-22 · Codex (GPT-5) · Task 6 repository-local review fixes** — Hardened executor
  signatures, the exact run-request boundary, per-run activity emission, and credential file-path
  rejection in `fix: harden agent manager contract boundaries` (final SHA in the handoff report).
  TDD regressions witnessed RED then GREEN; fresh verification: focused Node 25/25, full Node 33/33,
  pytest 1/1, changed-source syntax checks, and `git diff --check` exit 0. Repository-local re-review:
  spec compliant, task quality approved, zero issues. NEXT: merge Task 6, then Task 7 may begin only
  from a base containing Task 6's final commit.

- **2026-07-22 · Codex (GPT-5) · Task 6 final-audit fixes** — Aligned the manager with the canonical
  Task 7 connection-store/public-field contract and hardened prototype, path, Basic-auth,
  subscriber, credential-walk, and plain-JSON boundaries in `fix: align agent core with secure
  store contract` (final SHA in the handoff report). Every finding had a witnessed RED/GREEN;
  fresh verification: focused Node 30/30, full Node 38/38, pytest 1/1, four changed-source syntax
  checks, and `git diff --check` exit 0. Repository-local re-review is pending. NEXT: re-review the
  complete Task 6 range; do not start Task 7 until that gate passes.

- **2026-07-22 · Codex (GPT-5) · Task 6 final sanitizer fixes** — Closed the last two review gaps:
  sparse arrays now fail before sanitizer allocation/traversal bounds can be bypassed, and attached
  curl `-uUSER:PASS` credentials redact before activity storage or publication. TDD RED/GREEN and
  fresh final verification are recorded in the Task 6 handoff. Direct final repository-local audit
  found no remaining issues; Task 6 is complete on its branch. NEXT: merge Task 6 before Task 7.

- **2026-07-23 · Codex (GPT-5) · Task 7 (allowlisted connection store and safeStorage boundary)** —
  Implementation commit `18af9e1` adds the async Electron safeStorage adapter and atomically persisted v1 connection store. Public
  connection metadata is explicitly allowlisted; secrets stay base64 ciphertext on disk, unavailable
  safeStorage blocks every secret path while preserving metadata/ciphertext, and stale ciphertext
  rotates only after successful decrypt. TDD RED observed the missing modules; fresh verification:
  focused Node 8/8, canonical Node 48/48, pytest 1/1, two source syntax checks, and `git diff --check`.
  NEXT: merge this task branch, then execute Task 8 only.

- **2026-07-23 · Codex (GPT-5) · Task 7 review correction** — Commit `4af6855` closes the
  unavailable-safeStorage clear path: `secret: null` and `secret: ''` now return
  `SECRET_STORE_FAILED` and preserve the existing ciphertext. TDD RED/GREEN: focused Node 8/8;
  fresh canonical Node 48/48, pytest 1/1, syntax check, and `git diff --check` all passed.

- **2026-07-23 · Codex (GPT-5) · Task 7 integration** — `master` fast-forwarded through final
  Task 7 commit `cdd7c2a`; the stale checklist instruction was reconciled to Task 8. NEXT: begin
  Task 8 only from a clean worktree based on this merged `master` state.

- **2026-07-23 · Codex (GPT-5) · Task 8 (Offline Demo executor implementation)** — Added the
  deterministic, credential-free, network-free Workspace-only executor. It exposes only the
  `offline-demo` model, rejects Full Computer and reasoning-effort requests, emits bounded normalized
  activity, supports deterministic delayed Stop, and returns the fixed Banana Baron result. TDD RED
  observed the missing executor module; focused Node 6/6, canonical Node 54/54, pytest 1/1, and
  `git diff --check` passed. The task review found a scope conflict: the global requirement that
  Offline Demo be visible in normal Settings/package flows cannot be met until Task 9's exclusively
  owned runtime and Settings composition. NEXT: resolve this Task 8 review finding before merge; do
  not begin Task 9 without an explicit decision.

- **2026-07-23 · Codex (GPT-5) · Task 8 review resolution** — The task boundary governs: Task 8
  ships and verifies the real built-in executor; Task 9 exclusively owns runtime registration and
  normal Settings/package visibility. No Task 9 files were changed. The Task 8 scope is complete;
  merge it, then prepare a clean worktree for Task 9 only.

- **2026-07-24 · Codex (GPT-5) · Task 9 (runnable Offline Demo shell)** — Added the normal
  Settings, response, runtime, and terminal-prompt path for the built-in Workspace-only Offline
  Demo agent, restored the missing pet sprite renderer, and removed the premature file-submit bridge.
  Fresh verification: canonical Node 68/68, pytest 1/1, syntax, and diff checks pass; Electron
  launches and serves the loopback prompt on `127.0.0.1:47611`. The visual user-test gate remains
  pending because this session's Windows-control connector could not start.

- **2026-07-24 · Codex (GPT-5) · Task 9 Settings lifecycle correction** — Closing Settings then
  choosing the tray item previously called `show()` on Electron's destroyed window. The tray and
  response actions now recreate Settings first; the focused regression test is green.

- **2026-07-24 · Codex (GPT-5) · Task 9 Settings IPC correction** — Recreating Settings then
  attempted to register the five `ipcMain.handle` channels a second time. Recreated windows now
  replace their prior Settings handlers before registration; the duplicate-handler regression is green.

- **2026-07-24 · user acceptance · Task 9 manual gate** — User confirmed the runnable Offline Demo
  shell and Settings reopen behavior are good. Task 9 is complete on `39893b2`; prepare Task 10
  from that commit only. The local visual screenshot remains uncommitted because it includes unrelated
  desktop content.

### Task 9 manual user-test checklist (completed)

1. Launch with the command in the Task 9 handoff, then enter a temporary workspace in Settings and
   choose **Save Offline Demo**.
2. Use the terminal prompt path to submit an ordinary goal, then confirm the response shows the
   selected workspace, Workspace permission badge, phase, elapsed time, and Offline Demo model.
3. Switch **Simple** and **Comprehensive**; the latter shows the normalized activity timeline.
4. Submit the deterministic delayed goal and select **Stop**; confirm it stops without retrying.
5. Confirm there is no Full Computer control or file-submission path. Keep any desktop-inclusive
   screenshot local unless it can be safely redacted before committing.

- **2026-07-25 · Codex (GPT-5) · Task 10 (Codex process and permission boundary)** — Added the
  bounded official-CLI runner, app-owned untrusted Workspace profile, deterministic fail-closed
  sandbox-probe boundary, and verified Windows child/grandchild Stop in `218954e`. TDD RED observed
  the three missing modules; focused Node 10/10 (including real process-tree termination), canonical
  Node 79/79, pytest 1/1, source syntax checks, and `git diff --check` passed. Local `codex-cli`
  is 0.144.5, below the 0.144.6 baseline, so live Workspace availability remains fail-closed until
  it is updated; no login or live model run was required. NEXT: integrate this branch, then Task 11.

- **2026-07-25 · Codex (GPT-5) · Task 10 live sandbox diagnostic** — After Codex CLI updated to
  0.145.0, the real app-owned `codex sandbox -P pet-workspace` probe was run against a hostile
  temporary workspace. It failed before executing the workspace-read command with `Restricted
  read-only access requires the elevated Windows sandbox backend`; `probeCodexWorkspace` therefore
  correctly returns `PERMISSION_PROFILE_UNAVAILABLE`. The normal-shell Codex Workspace Agent remains
  fail-closed; no Task 11 code was started.

- **2026-07-25 · Codex (GPT-5) · Task 10 elevated-profile correction** — The app-owned profile was
  missing the official `[windows] sandbox = "elevated"` setting, so `fdb48f3` adds it with a witnessed
  RED/GREEN regression. Fresh canonical verification: Node 79/79, pytest 1/1, syntax, and diff checks
  passed. The real probe now reaches the elevated backend but fails its administrator-owned helper
  setup at `helper_firewall_policy_ineffective`; user must run `/setup-default-sandbox` as administrator
  and approve its UAC prompt before this Task 10 gate can pass. No Task 11 work started.

- **2026-07-25 · Codex (GPT-5) · Task 10 Windows-helper follow-up** — The active Private profile
  had `AllowInboundRules=False`, making every helper firewall allow-rule ineffective; the user
  authorized restoring it to normal block-unless-allowed behavior and Windows now reports
  `LocalPolicyModifyState=0`. Codex created `CodexSandboxOffline` and `CodexSandboxOnline` plus its
  setup marker, but both the app-owned and built-in `:workspace` sandbox commands still fail before
  their child starts with `CreateProcessWithLogonW failed: 2`. The elevated `/setup-default-sandbox`
  result must be inspected; Task 10 remains fail-closed and Task 11 has not begun.

- **2026-07-26 - Codex (GPT-5) - Task 10 final Windows boundary** - Repaired the standalone
  `codex-cli 0.145.0` installation by placing its matching `codex-command-runner.exe` beside the
  launcher (SHA-256 `65905BDE57F03520EC791950EF622EF579440A507383A9C2272DFDF84128BDA6`);
  the built-in `:workspace` profile now launches `sandbox-ok`. The app probe now creates a complete
  disposable hostile project, marks that exact project untrusted without touching the selected
  workspace's `.codex`, uses a host-preflighted non-loopback network target, and restores/removes all
  owned probe state on every path. The real hostile probe reaches command execution and correctly
  returns `PERMISSION_PROFILE_UNAVAILABLE` because inherited `Z:\` ACLs allow the sandbox account to
  read outside the selected workspace (`outside-read returned 0; expected 1`); profile, hook sentinel,
  and fixture residue checks pass. Review fixes also make malformed JSONL terminate the verified
  Windows tree immediately, retain at most 1 MiB of streaming stderr, test abort through the real
  runner child/grandchild path, and close failed network preflights. Final evidence: focused Task 10
  Node 19/19, canonical Node 88/88, pytest 1/1, syntax and diff checks, plus an independent no-findings
  re-review after its cleanup findings were fixed. Task 11 remains untouched.

- **2026-07-25 · Codex (GPT-5) · Task 11 (Codex Workspace Agent)** — Added the
  exact Codex 0.144.6 model/effort registry, dedicated-`CODEX_HOME` executor, hermetic JSONL
  invocation, sanitized event mapping, Workspace-only Settings setup, and timestamped collapsible
  Comprehensive activity rows derived from the same activity snapshot as Simple. The deterministic
  `CLAUDE_PET_TEST_EXECUTOR=1` path is enabled only in an unpackaged `NODE_ENV=test` process and
  is rejected when packaged. Fresh verification passed: Node 98/98, pytest 1/1, syntax checks, and
  `git diff --check`. The manual deterministic Codex test passed: its Comprehensive view showed the
  Codex executor/model, Workspace profile, elapsed duration, changed file, and timestamped command,
  usage, and response rows; evidence is `docs/evidence/task-11-codex-workspace-agent.png`. No account
  login or live model run occurred. Stop here for the Task 11 user test gate; do not begin Task 12.

- **2026-07-26 · Codex (GPT-5) · Task 12 (Claude Code agent parity)** — Added the exact Claude
  Code 2.1.217 model/effort registry, dedicated `CLAUDE_CONFIG_DIR`, stdin-only safe-mode stream
  invocation, strict empty MCP configuration, sanitized event mapping, official visible sign-in,
  and Claude-aware Settings controls/diagnostics. Workspace verification deliberately returns
  `PERMISSION_PROFILE_UNAVAILABLE`: safe mode prevents hostile `.claude` configuration, but it is
  not represented as an operating-system boundary for outside reads, writes, or child network.
  TDD recorded missing executor/mapper modules and the Claude Settings rejection; focused Node 13/13,
  full Node 105/105, pytest 1/1, and `git diff --check` passed. Visual QA verified the fail-closed
  Settings diagnostic and one-row control layout in `docs/evidence/task-12-claude-agent.png`; no live
  model run occurred. Stop here for the Task 12 user test gate; do not begin Task 13.

- **2026-07-26 · Codex (GPT-5) · Task 12 Settings diagnostic correction** — A saved active
  Codex connection correctly reached the fail-closed permission probe, but Settings caught that
  public error and incorrectly displayed “Select a saved connection first.” Settings now returns
  the allowlisted `toPublicError()` result and displays its public message; no raw process output
  crosses IPC. Regression test: focused Node 8/8; final Node 106/106, pytest 1/1, and diff check
  passed. Restart the app before re-running the manual Task 12 gate.

- **2026-07-26 · Codex · Task 13 (native CLI discovery and evidence repair)** — Replaced the broken
  production resolver with bounded absolute `where.exe` discovery, bound Codex and Claude status,
  setup, diagnostics, and runs to fresh single-use signed executable leases, and held the verified
  file against overwrite/rename/delete through child creation. The only Codex reparse exception is
  the exact ordered installer `bin` → standalone `current\\bin` → pinned `0.145.0` release chain;
  Claude 2.1.217 remains non-reparse. Real account-free discovery verified OpenAI publisher/hash
  `83751f15cb6a0a7b97df67752c001e3fe1c20e18ffbfec3ff63567296205eb6c` and Anthropic publisher/hash
  `6e4a3a4679f381178a90cf741de9ce924a3274304b09277695ac3a679628ca17` without exposing paths.
  The complete native matrix passed workspace read/write, outside-write denial, hostile-project
  isolation, hook isolation, and cleanup; outside-read and child-network denial failed, so native
  Windows remains fail-closed as not Workspace-safe. Fresh evidence: focused Node 67/67, canonical
  Node 150/150, pytest 1/1, JavaScript/PowerShell/checklist syntax, and `git diff --check`. No login,
  model run, Full Computer enablement, WSL installation, or Task 14 implementation occurred.

- **2026-07-26 · user acceptance and integration · Task 13** — The user accepted the signed-provider,
  complete native-matrix, and held-executable evidence. `codex/workspace-boundary-redesign` was
  fast-forwarded into local `master` at `e02a58d`. Task 14 is the only next task; no Task 14 source,
  Full Computer authorization, WSL installation, provider login, or model run has begun.

- **2026-07-26 - Codex - WSL Workspace / Full Computer redesign checkpoint** - Committed the
  approved direction as written design `759afe4`: warned Full Computer is the default selection for
  new real-provider connections; genuine Workspace uses a dedicated locked WSL2 distro with no mode
  fallback; the complete nine-state Banana Baron atlas is a separate milestone. Security review added
  explicit Claude/Codex non-local-tool gates, NTFS hardlink/path-race defenses, WSL host-integration
  probes, and revision/nonce-bound native confirmation. Docs only: no app code, WSL install, provider
  login, or image generation occurred. The user approved the written spec. NEXT: rewrite and review
  the canonical plan tail before any application code or WSL installation.

- **2026-07-26 · Fable 5 (freemodel) · docs reconciliation (no task executed)** — Session launched
  with the stale Task 13 standard entry prompt; verified Task 13 is already accepted and integrated
  (all five plan steps `[x]`, `e02a58d` on `master`, fresh suite evidence: canonical Node 150/150,
  pytest 1/1, clean status). Did not re-execute Task 13, start Task 14, enable Full Computer, or
  install WSL. Reconciled the "Task 13 only next" leftovers `acb14a7` missed — project-context.md
  (header link, Working method, Order, Standard entry prompt, Document routing) and the redesign
  spec's Status/decomposition lines — to Task 14. NEXT: Task 14 via the refreshed entry prompt.

- **2026-07-26 · Codex · Task 14 (warned native Full Computer mode)** — Added serialized
  connection-store schema v2, main-owned connection-bound native confirmation, immutable mode/run
  snapshots with no fallback, exact Codex/Claude native Full Computer executors, permanent warning
  badges in Settings/tray/response/Simple/Comprehensive, and narrow sender-validated Settings IPC.
  The account-free local-provider gate pins Codex 0.145.0 code-mode tools and Claude 2.1.217
  Messages/SSE fixtures, scrubs credentials/endpoints, isolates hostile project configuration, and
  removes every listener/config/transcript/sentinel. Final review additionally bound acknowledgement
  reuse to the same executor, required exact fail-closed Codex control results plus Claude read/Bash
  sentinels, and rejected changed fixture bytes before spawn. Canonical fixture SHA-256 values are
  `def11e55005d2506beafa7535c331562f02f73a1bb654a761086a929914ff2d7` (Codex Responses),
  `d9bf3d2be500b5c4d6d9fae43dfe0ca51467b64802ec94ca8fef8c43862ccf82` (Claude Messages/SSE),
  `dab9fdc7c18ce3176bf7c0ae9a5c44fbf8125a52e81ff2614578205cb6524f72` (code-mode tools),
  `5f0f07a4f88477c899aa9075cc6bb3ed31f84dfc3e5447bae62a2be8b4e1e3e6` (Codex config), and
  `ce7c7c76689890dc85c97c4b678f91e8a1b0c44f05ca54bcac4fd74accc79169` (Claude env).
  Fresh evidence: focused Task 14 Node 119/119, full Node 214/214, pytest 1/1; real Codex report
  4 control requests / 7 rejected upgrades / 4 turns / 7 exact blocked controls / 1 child canary;
  cached signed Claude report 3 control requests / 2 turns / 1 child canary; both exit 0 with clean
  scrub/cleanup. Installed Claude 2.1.220 correctly failed the production 2.1.217 pin. The temporary-
  profile Electron gate proved cancel/no save, acceptance, all five badges, immutable current-run mode,
  next-run Workspace fail-closed behavior, and delete/recreate re-warning; evidence is
  `docs/evidence/task-14-full-computer-warning.png`. No provider account/model run or WSL install occurred.

- **2026-07-26 · user acceptance and integration · Task 14** — The user confirmed the warned native
  Full Computer flow works, including the manual gate recorded above. The
  `worktree-task-14-full-computer-mode` branch is accepted for fast-forward into local `master`,
  carrying the verified implementation at `baa73e3`. Task 15 is the only next task; no Task 15
  source, WSL installation, provider login, or model run has begun.

- **2026-07-26 · Codex · core-first roadmap checkpoint** — Reconciled the plan, redesign, context,
  research, and interactive checklist to core Tasks 15-19: complete Banana Baron atlas, encrypted
  provider-neutral agents/sessions, Hermes-style agent/session/next-provider switching, final
  integration, then the unsigned non-WSL package. WSL provisioning/broker/Codex/Claude Workspace are
  physically last as optional Tasks 20-23 and require a separate post-v1 opt-in. A focused RED run
  exposed CRLF checkout corruption of Task 14's byte-pinned fixtures; `.gitattributes` now keeps only
  `resources/probes/*` LF-stable. Fresh verification: focused Node 19/19, full Node 214/214, pytest
  1/1, checklist JavaScript 23 tasks, ordered unique Task 6-23 headings, balanced fences, optional WSL
  block last, and `git diff --check`. No app behavior, WSL/system state, provider login, or provider
  agent run changed; Task 15 atlas work is the only next implementation.

- **2026-07-27 · user-directed scope change + Codex · Task 16 (encrypted provider-neutral sessions)** —
  The user deferred Task 15's image generation until ImageGen is available and explicitly authorized
  the already-started storage-only Task 16 as the one ordering exception. Task 15 remains incomplete:
  its unmerged asset worktree is preserved and its external run has exactly six pending rows
  (`waving`, `jumping`, `failed`, `waiting`, `running`, `review`). Task 16 adds an atomic serialized
  `sessions.json` schema v1 with strict public metadata, whole-turn safeStorage ciphertext, no
  plaintext fallback, caps, safe-storage-unavailable errors, and stale-ciphertext rotation; it also
  adds XML-escaped, provider-attributed bounded neutral context and initializes the service beside
  connection storage. Fresh verification: focused Node 11/11; canonical Node 223/223; pytest 1/1;
  three changed-source syntax checks; `git diff --check`; and a temporary restart probe with
  ciphertext SHA-256 `e357bea20a7c604b7dccf8bd92342b7cad010d07b60ecd650b402cd80e26e951`, 1 agent,
  1 session, 1 turn, and restored selection/connection/turn equality. No plaintext was recorded,
  no image was generated, no provider was run, and Task 17 has not begun. NEXT: Task 16 user gate.

- **2026-07-27 · Codex · Task 17 (explicit agent/session/provider switching)** — Implemented
  `sessionCoordinator` over the encrypted Task 16 store: selected agent/session snapshots, guarded
  agent/session mutations, next-provider synchronization, cross-family disclosure/cancel, immutable
  expected connection/revision checks, and provider-neutral bounded attributed context. Settings has
  separate Agent, Session, and Next run provider controls; response renders stable agent/session labels
  and per-turn provider/model attribution. Fresh evidence: RED focused command failed 6 intended
  contract tests (40 pass / 6 fail); GREEN focused Node 47/47; full Node 231/231; pytest 1/1; syntax and
  diff checks passed. Final review also repaired session-selection provider reconciliation and a failed
  cross-store provider-switch rollback. No provider was signed into or run. The required Electron visual/restart screenshot
  is blocked because the mandated Computer Use bootstrap cannot load
  `@oai/sky/dist/project/cua/sky_js/src/targets/windows/internal/computer_use_client_base.js`; no image
  evidence was fabricated. STOP: do not start Task 18 until this user gate is resolved.

- **2026-07-27 · Codex · Task 17 fix round 1** — Hardened the coordinator against deleted/edited
  provider metadata, unknown provenance, cross-agent session mutation, workspace drift, stale agent/session
  selection, and pre-run active-connection writes. Settings now receives main-owned busy snapshots and
  restores a canceled provider selection. TDD evidence: coordinator RED 3/8 pass (five intended contract
  failures), Settings RED 12/14, coordinator/Settings GREEN 22/22, focused Task 17 55/55, canonical Node
  239/239, pytest 1/1, syntax and diff checks. A final prompt-controller RED 3/4 / GREEN 26/26 regression
  confirms Settings receives busy state immediately after reservation. The known Computer Use visual/restart blocker remains
  pending; no screenshot or real-provider execution was attempted.

- **2026-07-27 · Codex · Task 17 fix round 2 and final review** — Moved Settings busy publication
  onto the real Agent Manager reservation, server-guarded and renderer-disabled every legacy and
  Task 17 mutation, added forged-delete and real-store restart regressions, and proved the actual
  Settings controls disable/re-enable in `d3cb5b3`. Final scoped review found all findings addressed.
  Fresh focused evidence is 30/30 and pytest is 1/1. The full current-head Node run passed 242/243;
  its sole failure was the unrelated live Codex-helper timeout, whose exact rerun passed 1/1.
  Syntax and diff checks pass. The Computer Use module blocker still prevents the required desktop
  visual/restart screenshot, so Task 17 remains at its user gate and Task 18 has not started.

## Field notes

Things discovered mid-work that the plan/research didn't predict: a solution to a surprise
problem, a gotcha, an idea worth doing later, a better approach than the planned one. **Write
these the moment they come up, not at session end** — a note not written down is lost to the
next session. Keep each note 1–3 lines, dated. Prefix with one of:

- `FIX:` — a problem hit and how it was actually solved
- `GOTCHA:` — something that looks broken/fine but isn't (save the next session the hunt)
- `IDEA:` — new feature/improvement thought of on the fly (do NOT act on it mid-task; log it here)
- `SUPERSEDE:` — a planned approach that turned out wrong, and what replaced it (also update the plan)

If a note changes a decision recorded in RESEARCH.md or the plan, update **that** doc too and
link the note to it — this file is the inbox, not the archive.

<!-- notes below -->

- 2026-07-22 `FIX:` Repository-local Task 6 review found four contract-boundary bugs: executor
  argument drift, overbroad run requests, stale activity callbacks, and credential-path sentinels.
  Its no-remaining-issues claim was superseded by the later final audit; the new fixes are in
  `fix: align agent core with secure store contract`, with re-review pending.

- 2026-07-22 `SUPERSEDE:` The later final-audit re-review found two remaining sanitizer gaps:
  sparse arrays bypassed node accounting and attached curl `-uUSER:PASS` leaked Basic-auth data.
  The final sanitizer follow-up fixes both; direct final audit passed on the final commit range.

- 2026-07-22 `GOTCHA:` Task 6 intentionally leaves public error prose and activity phase/status
  enums open. The implementation uses immutable fixed copy per code, bounded non-empty phase/status
  strings, and the canonical Task 7 `getActiveSelection()`/`setActiveSelection(id)`/
  `getConnection(id)` protocol; no extra variants.

- 2026-07-15 `GOTCHA:` This machine's session env header may claim macOS/darwin with a fake
  `/Users/dev/...` cwd — it's Windows 10 via Git Bash. Use `Z:\...` / `/z/...` paths. Backslash
  paths break in double-quoted Bash strings; use forward slashes.
- 2026-07-15 `GOTCHA:` Python stdout here defaults to cp1252 — Unicode output needs
  `python -X utf8`.
- 2026-07-16 `SUPERSEDE:` Plan Task 1's naive slot-crop extractor replaced with chroma-key +
  connected-components + aspect-fit (details in the plan's Task 1 correction block). Root
  facts: idle.png is RGB on noisy #FF00FF, sprites drift off the 362px grid and cross slot
  boundaries.
- 2026-07-16 `GOTCHA:` LANCZOS downscale of keyed sprites rings alpha back up to 1-8 and
  recreates #FF00FF specks from despilled edges — scrub resized output (alpha<=8 -> drop,
  re-despill min(r,b)-g) or magenta survives. Implemented as clean_resized() in the extractor.
- 2026-07-16 `GOTCHA:` The Read/Bash tools can't stat files inside the references folder the
  user added at 01:30 ("I just noticed these...") — path >260 chars (Windows MAX_PATH) once
  the ig_*.png names are included. Directory listing works; per-file access fails. Copy/rename
  with short names via Explorer, or use \?\ paths.
- 2026-07-16 `IDEA:` (logged, not acted on) That folder holds 3 never-decoded row strips from
  the 2026-07-12 Codex run — one confirmed 8-frame running-right + 2 unidentified. Task 8 can
  skip generating those rows; note added to Task 8 in the plan. The other 2 files are
  md5-identical dupes of decoded/idle.png and decoded/base.png — safe to delete.
- 2026-07-16 `GOTCHA:` ~~`npm install` here warns `electron@33.4.11 (postinstall: node install.js)`
  is "not yet covered by allowScripts"~~ **Obsolete since the same-day electron 43 bump (see
  SUPERSEDE below):** electron 43 has no postinstall script at all, so the allowScripts warning
  is gone for good; the stale `allowScripts` entry was removed from package.json in `512a2c4`.
- 2026-07-16 `GOTCHA:` A session whose cwd starts inside an old task worktree is write-locked to
  it — Write to the shared checkout is refused ("session is now isolated"). Fix: `git worktree
  add` a new task worktree from `master` and switch into it; don't work on the stale branch.
- 2026-07-16 `SUPERSEDE:` Plan Task 2 Step 4's "don't commit package-lock.json" note was wrong
  (it claimed `.gitignore`'s `node_modules/` excluded it — it doesn't; the file just sat
  untracked, permanently dirtying `git status`). Lockfile committed in `92d5738` (pins electron
  33.4.11); plan note struck through in place.
- 2026-07-16 `SUPERSEDE:` Electron pin 33.4.11 → **43.1.1** (`512a2c4`). The user ran
  `npm audit fix --force` after merging Task 3; verified OK to keep rather than revert:
  electron 33 is EOL (the audit hits were real), 43 still supports Win10 x64 (only 32-bit
  builds are dropped — electronjs.org/blog/electron-43-0), `--version` runs, both suites
  green. RESEARCH §B2/§B4 traps were written against 32/33-era Electron and still apply
  (File.path removal, webUtils, transparency flags). Task 4 must visually verify on 43 —
  already mandatory. Rollback if 43 misbehaves: `git revert 512a2c4 && npm install`.
- 2026-07-16 `SUPERSEDE:` Plan Task 2's `"test": "node --test tests/"` script is broken on
  Node 24/Windows — an explicit directory arg makes Node `require()` the directory as a module
  (`Cannot find module ...\tests`, 1 phantom failing "test") instead of scanning it. Direct
  file runs (`node --test tests/x.test.js`) work, which masked it until Task 3 added the first
  JS test. Fixed to plain `node --test` (default glob finds `**/*.test.js`, skips
  node_modules); plan snippet corrected in place.
- 2026-07-16 `GOTCHA:` `npm start` between Task 2 and Task 4 fails with "Unable to find
  Electron app" — **expected, not a regression or a faked Task 2**. `package.json` declares
  `"main": "src/main.js"` up front (per plan Task 2 Step 1) but that file is a *Task 4*
  deliverable (plan line 393: "Create: src\main.js, src\preload.js"); Task 2's own test line
  says "none (config-only task; verified by npm install + npm start ... in Task 4)". A review
  session on 2026-07-16 misread Task 4's file list (plan lines ~396+) as Task 2's spec and
  called Task 2 a fake completion — verified wrong: `17f4e57` contains exactly what Task 2
  promised, and the Task 2 log entry explicitly stated main.js doesn't exist until Task 4.
  Also: the empty `src/bridge/` + `src/renderer/` dirs in the main checkout are dated Jul 13
  (planning day), untracked-by-git leftovers — not evidence any session created-then-abandoned
  code. Don't "fix" the npm start error; it disappears when Task 4 lands.
- 2026-07-17 `GOTCHA:` PowerShell's execution policy blocks the `npm.ps1` shim on this
  machine. Invoke `npm.cmd` for install, test, and start commands from PowerShell; it resolves
  to the same Node installation without requiring an execution-policy change.
- 2026-07-17 `GOTCHA:` Codex's restricted shell denies child-process creation (`spawn EPERM`),
  which makes Node's default isolated test workers fail even though `node --test
  --test-isolation=none` passes 4/4. Run the canonical `npm.cmd test` with approved elevated
  execution; Git commands in an elevated-created worktree also need a per-command
  `-c safe.directory=<worktree>` because Windows records its owner as Administrators.
- 2026-07-17 `GOTCHA:` Codex Desktop's shell exports `ELECTRON_RUN_AS_NODE=1`; inherited by
  `npm.cmd start`, it makes Electron run as plain Node and `ipcMain` is undefined. Remove only
  that child-shell variable (`Remove-Item Env:ELECTRON_RUN_AS_NODE`) before live Electron runs.
- 2026-07-17 `FIX:` Task 5's original test helper was unreliable on Node 24/Windows because
  `http.globalAgent` now defaults to keep-alive and reused a socket while the fixed-port server
  was closing, producing `read ECONNRESET` even though both tests passed alone. Corrected after
  follow-up: test requests use `agent: false`, and both cleanups await `server.close()`; the
  Task 5 plan snippet was updated in place before the implementation was committed.
- 2026-07-17 `FIX:` Task 5's first final review found two input-boundary bugs before merge:
  valid JSON `null` reached `parsed.text` and threw, while implicit per-chunk Buffer decoding
  corrupted a UTF-8 character split across chunks. Commit `3e75862` adds both regressions,
  rejects non-object JSON, and puts the request stream in UTF-8 text mode before collection;
  focused 4/4 and full Node 8/8 verified after the fix, and the plan was corrected in place.
- 2026-07-21 SUPERSEDE: The unimplemented Claude-only Tasks 6-8, consumer-account appeal
  blocker, and single claudeClient architecture are obsolete. Canonical spec/research/context
  now define providerManager + encrypted providerStore + five adapters + Settings/response
  windows; the canonical plan's next task is Task 6, and provider purchase/login is optional.
- 2026-07-22 SUPERSEDE: The 2026-07-21 five-adapter chat-first tail is obsolete. The user wants
  an all-purpose tool-using agent rather than a small chat connection. Canonical Tasks 6-15 now
  build testable vertical milestones using the shipped Offline Demo Agent, Codex CLI, and Claude
  Code CLI executors; direct API tool loops are deferred. The approved design was committed as
  `354e8cb`; the first canonical agent-first Tasks 6-15 plan handoff was committed as `650f3ea`.
- 2026-07-22 SECURITY PLAN REVIEW: A read-only review of `b45d578..650f3ea` found workspace-config
  isolation, activity redaction/schema, public metadata, native Full Computer confirmation,
  non-interactive approvals, task ownership, long-stream/Windows Stop, Offline Demo product status,
  prompt error publication, and safeStorage-unavailable gaps. The approved corrected design is
  committed as `0f6f9ba`; the canonical plan, research, and this handoff were corrected before Task
  6 implementation. Review-fix verification: canonical Node suite 8/8 passed (the restricted first
  attempt hit the known worker `spawn EPERM`, then the approved canonical rerun passed), pytest 1/1
  passed, and the 26-item plan/spec/docs coverage scan plus `git diff --check` passed. Provider login
  remains optional and Task 6 remains next.

- 2026-07-23 `GOTCHA:` In Codex's restricted shell, canonical Node tests fail before loading test
  files with `spawn EPERM`; use the approved elevated `npm.cmd test` for canonical evidence. The
  default `python` is a Hermes virtual environment without pytest; use `py -m pytest -q` here.

- 2026-07-25 `GOTCHA:` The locally installed `codex-cli 0.144.5` is below the required `0.144.6`
  baseline. Task 10's canonical fake-process/profile tests remain account-free, but this installation
  must fail closed and cannot be advertised for a live Workspace Agent until it is updated.

- 2026-07-25 `SUPERSEDE:` The CLI was updated to `0.145.0`, so the version field note above is no
  longer current. The real native-Windows sandbox probe still fails in this non-elevated shell before
  the target command, requiring an elevated Windows sandbox backend; keep Workspace Agent unavailable
  rather than weakening the restricted profile.

- 2026-07-25 `GOTCHA:` Adding `[windows] sandbox = "elevated"` to the app-owned profile turns the
  first live failure from missing backend to `helper_firewall_policy_ineffective`. This is a required
  Codex administrator setup/UAC step, not a profile permission to bypass; retain the fail-closed
  `PERMISSION_PROFILE_UNAVAILABLE` result until `/setup-default-sandbox` succeeds.

- 2026-07-25 `GOTCHA:` The setup marker and sandbox users alone do not prove a usable native Windows
  sandbox. After local firewall policy was restored, the direct built-in `:workspace` probe still
  fails with `CreateProcessWithLogonW failed: 2`; retain the executable probe as the gate.

- 2026-07-26 `FIX:` Production CLI discovery is currently broken: `resolveWithWhere()` references
  undefined `spec.visible`. Codex/Claude tests inject a resolver and miss the default path; repair it
  with a real default-resolution regression before either native executor is advertised.

- 2026-07-26 `SUPERSEDE:` Task 10's production outside-read target is inside intentionally readable
  `CODEX_HOME`, so that check is invalid, and its early throw skipped outside-write/network/hostile
  checks. A separate sibling-path `Z:\` probe still proves native outside reads; aggregate every
  future probe result and never use runtime/auth/temp paths as outside fixtures.

- 2026-07-26 `SUPERSEDE:` The unimplemented Tasks 13-15 tail assumes Workspace-default native
  execution and only adds Full Computer UI. The reviewed redesign at `759afe4` instead makes warned
  Full Computer the default for new real connections and requires a dedicated WSL2 boundary for
  genuine Workspace. Do not execute the old tail before the written-spec and plan gates.

- 2026-07-26 `GOTCHA:` This Windows 10 Home machine has WSL and Virtual Machine Platform enabled, but
  no WSL2 kernel file or distro. The dedicated Ubuntu setup, Linux CLIs, bubblewrap/socat, locked
  policies, mount broker, and hostile probes are future implementation work, not current capability.

- 2026-07-26 `IDEA:` The prepared Post-Hoc Banana Baron run has complete base/idle assets and uses
  `canonical-base-small.png` to avoid the prior 5 MB/413 failures. Generate and validate the remaining
  rows as a separate milestone before atomically replacing Claude Pet's idle-only atlas.

- 2026-07-26 `PLAN CHECKPOINT:` The user approved the replacement Tasks 13-21 tail: warned Full
  Computer is the default selection for new Codex/Claude connections, genuine Workspace requires the
  dedicated verified WSL2 boundary, and the complete nine-state Banana Baron animation remains a
  later serial milestone. Task 13 is the only next implementation task; do not start Task 14 or WSL
  setup before its user gate. *(Superseded by the Task 13 acceptance entry above: Task 13 is now
  integrated and Task 14 is the only next task.)*

- 2026-07-26 `SUPERSEDE:` A live account-free Codex 0.145.0 loopback probe invalidated the draft
  classic five-tool allowlist before implementation. GPT-5.6 Sol/Terra/Luna send a developer
  `input[type=additional_tools]` code-mode envelope with a nested `exec` registry; collaboration and
  user-input controls remain surfaced even when their features are disabled. The canonical plan/spec
  now pin the exact envelope/registries, require per-run authenticated local harness paths, exercise
  every registered behavior, and require collaboration/input to fail closed. Native probes use
  Electron-main loopback; WSL probes use broker-owned listeners inside the Linux outer namespace and
  retain the production security profile. Historical checklist plans are marked do-not-execute.

- 2026-07-26 `VERIFY:` The approved-plan checkpoint passed three scoped consistency/protocol/security
  re-reviews with no P0/P1 findings, their targeted 16/17-assertion boundary scans, Markdown fence/
  link/task-heading checks, checklist JavaScript syntax, `git diff --check`, canonical Node 106/106,
  and pytest 1/1.

- 2026-07-26 `SUPERSEDE:` Live raw-target inspection corrected the earlier one-junction note: Codex
  Desktop 0.145.0 uses an exact two-junction chain, launcher `bin` to standalone `current\\bin`, then
  standalone `current` to `releases\\0.145.0-x86_64-pc-windows-msvc`; the held final executable is in
  that versioned release. Task 13 must match both raw targets plus the canonical target, not merely
  allow any reparse component. The signed Codex PE still has empty FileVersion/ProductVersion and
  requires held-path `codex --version`; Claude 2.1.217 is non-reparse with PE version 2.1.217.0.

- 2026-07-26 `FIX:` A successful launch lease waited for inspection-helper release before returning
  the child, so a fast `--version` process could finish before capture listeners attached. Successful
  leases now stay held until caller cleanup; failure paths still release immediately and exactly once.

- 2026-07-26 `SUPERSEDE:` Codex 0.145.0 rejects run-only `--strict-config` on `codex features`, and
  sending HTTP 426 causes only one WebSocket attempt. Feature inspection omits that one flag; a closed
  no-response upgrade rejection reproduces the pinned seven attempts before the four-turn fallback.

- 2026-07-26 `SUPERSEDE:` Claude 2.1.217's control-path HEAD preflight has no API key. The local
  harness now accepts only that nonce-secret route with its exact five header names; both Messages
  POSTs still require the independent dummy `x-api-key`, and the cached signed probe passes 3/3.

- 2026-07-26 `IDEA:` The user wants Hermes-style provider-neutral continuity: multiple providers
  serving one persistent agent/session, plus explicit switching among agents and sessions. Revisit
  the later roadmap after the Task 14 gate; do not fold this into Task 14 or silently start Task 15.

- 2026-07-26 `FIX:` Fast-forwarding Task 14 into a Windows checkout with global
  `core.autocrlf=true` converted five SHA-pinned `resources/probes` fixtures from LF to CRLF without
  showing a normal source diff, causing 5/214 cascading failures. Repository `.gitattributes` now
  forces that exact fixture directory to LF; the focused 19/19 and canonical 214/214 suites pass.

- 2026-07-26 `GOTCHA:` Task 15 recovered the interrupted compact-reference `running-right` output
  from its exact saved generation directory, verified its eight-frame identity/gait, and derived
  `running-left` frame by frame. This Codex surface exposes no built-in image generator to parent or
  workers; the six remaining distinct rows require either a built-in-ImageGen surface or separate
  approval for the credentialed CLI fallback. `OPENAI_API_KEY` is currently unset; no fallback ran.

- 2026-07-27 `VERIFY:` Task 15 resumed the preserved run with built-in ImageGen, generated all six
  deferred rows, repaired only the incoherent `running` work loop, and passed deterministic PNG/WebP
  validation plus final visual QA for all nine rows. The integrated `1536x1872` WebP passes Node
  221/221 and pytest 3/3, including zero visible chroma-key pixels; real Electron evidence is
  `evidence/task-15-banana-baron-idle.png`.

- 2026-07-27 `GOTCHA:` The bundled Computer Use bridge was missing
  `computer_use_client_base.js`, so the real Electron gate used the documented local CDP fallback.
  The renderer reloaded at exactly `192x208`, drew 18,224 visible canvas pixels with zero visible
  magenta pixels, and emitted no page or console errors. No WSL install, provider sign-in, or real
  provider run occurred.
## 2026-07-27 — Core V1 Task 18-19 implementation checkpoint

- Implemented main-owned activity animation, bounded text attachment handling, response dismissal capability, and tray/package support on `codex/task-18-19-core-v1`.
- Verified 258 Node tests and 3 Python tests. The unsigned Windows package verifier scanned 150 files / 367250041 bytes; `Claude-Pet-win32-x64.zip` SHA-256 is `E6FB587B45A6D69B54D159C16F83FD23BF0A3BF630580E864C5427AC079FBEAD`.
- Windows Graphics Capture rejected Electron's border interface, so the actual pet canvas was captured through the local DevTools protocol at `docs/evidence/task-18-animation-e2e.png`; no provider sign-in or WSL setup occurred.

- **2026-07-27 · GPT-5.6 · Core V1 UX redesign and plan** — Audited community-built GitHub
  interfaces including Agent Deck, opcode, Palot, Kanna, OpenChamber, and CloudCLI. The user
  approved a minimal unified-window direction and clarified that shared sessions may contain
  multiple named agents while exactly one provider/model owns each sequential turn. The amended
  design and six-task implementation plan are committed at `509f4af`; UX Task 1 is next, and
  optional WSL/multi-model work remains untouched.

## 2026-07-27 — UX Task 1 shared-session persistence checkpoint

- Started from clean `master` at `e298293` in the isolated
  `codex/ux-task-1-shared-sessions` worktree. The pre-change canonical Node suite passed 262/262.
- Added session-store schema version 2 with top-level shared sessions, encrypted agent
  instructions, agent-attributed encrypted turns, a maximum of eight unique participants, active
  participant selection, and public shapes that expose no ciphertext.
- Added one-time version-1 migration that preserves nested history and selected session, makes the
  former owner the first participant, encrypts the new attributed turn array and empty migrated
  instruction, writes atomically, and replaces in-memory state only after the durable write.
- TDD evidence: the exact focused command first failed for the missing schema/API contract, then
  passed 15/15 after direct-review regressions. Validation, decryption, encryption, and replacement
  failures each leave the
  original version-1 file byte-for-byte untouched; scans find neither turn text nor agent
  instructions on disk.
- Direct review found and fixed two attribution-integrity gaps with failing tests first: removing a
  participant now preserves their historical turns and prevents deletion of the referenced agent,
  while new turns must belong to the currently selected participant rather than any participant.
- UX Task 2, optional WSL work, provider sign-in, real provider runs, and multi-model work were not
  started. UX Task 1 remains at the user acceptance gate after direct review and final commit.

## 2026-07-28 — UX Task 2 sequential routing checkpoint

- Fast-forwarded the verified UX Task 1 commit `1436234` into clean `master`. Its focused
  session-store/context suite passed 15/15 after the merge.
- Removed the stale Task 15 (`979a7a2`) and Task 17 (`12e1ba2`) worktrees and branch refs only after
  verifying that their shipped implementation/evidence already exists on `master`; no delivered
  atlas, session, or provider-switching content was removed.
- Started UX Task 2 from `1436234` in the isolated
  `codex/ux-task-2-sequential-routing` worktree. The exact focused RED command reported 9 expected
  failures out of 12 tests because active-participant routing, agent-attributed prompt context, and
  the new snapshot contract did not exist yet.
- Implemented sequential active-participant routing. Each run resolves exactly one participant and
  immutable connection, rechecks session/agent/connection/workspace state before provider
  execution, attributes the user and assistant turns to the same agent, and rejects participant
  changes while busy. Cross-provider changes disclose both agent names exactly once and cancellation
  leaves durable and active selections unchanged.
- The neutral prompt now includes only escaped, bounded active-agent instructions, public agent
  names, attributed session turns, and the current request. Encrypted fields, native resume IDs,
  authentication directories, configuration directories, and connection secrets never enter it.
  Temporary public aliases remain only for the legacy Settings/Response renderers and are scheduled
  for removal with those windows in UX Task 6.
- Verification: the focused Task 2 suite passed 12/12. Intermittent canonical attempts each passed
  264/265 while one of two unrelated real Windows process-tree fixtures missed its timing window;
  each exact fixture immediately passed 1/1 in isolation. A subsequent complete canonical rerun
  passed 265/265 with zero failures.
- Direct review found no Task 2 correctness defect after checking the routing, disclosure,
  persistence, stale-state, bounded-context, and compatibility paths against the approved plan.
  UX Task 3, optional WSL work, provider sign-in, real provider runs, and multi-model work were not
  started.

## 2026-07-28 — UX Task 3 unified application boundary

- Fast-forwarded UX Task 2 into clean `master` at `e0f6f5a`, removed its merged worktree/branch,
  and created `codex/ux-task-3-app-snapshot` from that exact base. The clean baseline passed
  265/265 Node tests.
- TDD RED produced the three intended missing-file failures for `appSnapshot`, `appWindow`, and
  `app-preload`. GREEN passes 9/9 focused snapshot/window/preload tests.
- Added an exact deeply frozen public snapshot with no encrypted fields, permission proof, native
  resume/auth/config state, or response dismissal capability. One sender-validated `app:intent`
  handler validates all 20 initial intents, rejects malformed/secret-bearing/cross-session/busy
  mutations before side effects, and publishes only `app:snapshot`.
- Added one reusable native 1080x720 window controller with a 900x650 minimum and one activity
  subscription. The main process wires existing coordinator, connection, Full Computer,
  attachment, setup, run, stop, and retry boundaries without removing legacy windows before parity.
- Direct review found and repaired one lifecycle defect with a witnessed regression: `stop-run`
  now routes through the prompt controller so response/animation state changes to stopped, rather
  than aborting only the lower-level manager. No WSL, provider sign-in, real provider, parallel
  agent, or multi-model work occurred.

## 2026-07-28 — UX Task 4 minimal main shell

- TDD RED produced the intended missing unified-renderer failures; GREEN passes 6/6 focused
  presentation/renderer tests. The shell uses native controls and landmarks, a 264 px sidebar,
  inline forms, visible focus, main-owned running/waiting/idle/error statuses, and no native prompt
  dialogs or internal executor/permission-profile language.
- A clean profile now opens one native 1080x720 main window and presents one valid start path:
  project folder, optional agent name, first task, and Workspace-only Offline Demo with no account.
  Direct visual review removed the unusable pre-agent New session action with a witnessed regression.
- Electron/CDP checks at both required sizes report exact 900x650 and 1440x900 viewports, matching
  scroll widths/heights, visible first-run content, and no clipping or horizontal overflow. Evidence:
  `docs/evidence/ux-task-4-900x650.png` and `docs/evidence/ux-task-4-1440x900.png`.

## 2026-07-28 — UX Task 5 conversation, activity, and secondary Settings

- TDD RED recorded the intended missing conversation/Settings modules; GREEN passes 15/15 focused
  UI tests. Every turn keeps agent/provider/model attribution and provider text is assigned only
  through `textContent`, including a bounded-layout 20,000-character response case.
- Added a persistent participant-only `Ask <agent>` composer, Send/Stop switching, text attachment,
  retry/continue recovery, workspace/provider/model/access header, and a temporary Activity drawer.
  One collapsed card is rendered for each sanitized file, command, tool, permission, network,
  usage, or message event; 100-event containment is covered.
- Secondary Settings groups Connections, Access, Model, session participants, Agents, and Advanced.
  Full Computer remains permanently warned, busy mutations are disabled and main-guarded, a second
  named agent can be created and added inline, and removing a participant leaves attributed history
  intact. No provider sign-in or real provider run occurred.

## 2026-07-28 — UX Task 6 lifecycle parity, legacy removal, and package gate

- TDD RED produced six expected lifecycle/parity failures. GREEN passes 9/9 focused lifecycle,
  tray, and package tests; later regressions cover fresh-profile storage binding, Stop remaining
  terminal after abort rejection, shared-session controlled failure, and legitimate token-usage
  counters.
- First launch, pet click, tray `Open Claude Pet`, and tray Settings now reuse the unified window.
  Closing hides it without cancelling work. Retry stores only the visible user request and submits
  through the currently selected participant. The legacy Settings/Response windows, preloads,
  renderers, IPC channels, and superseded tests are removed.
- Direct packaged fresh-profile exercise created Researcher and Reviewer in one shared session,
  ran both participants, stopped and retried a run, recovered from `fail:COMMAND_FAILED`, attached
  one bounded UTF-8 file, reopened through the pet, restarted, and restored the selected session,
  participants, attributed history, Workspace badge, and composer. Restore console/page errors:
  0. Responsive evidence has exact 900x650 and 1440x900 viewports with matching scroll dimensions:
  `docs/evidence/ux-task-6-900x650.png` and `docs/evidence/ux-task-6-1440x900.png`.
- The walkthrough exposed and fixed an application-snapshot false positive: validated
  `inputTokens`/`outputTokens`/`cachedTokens`/`totalTokens` counters were incorrectly treated as
  credential keys. The exact regression now passes without weakening rejection of secret-shaped
  activity fields.
- Verification: stable serial `npm.cmd test` passed 276/276 before the final controlled-failure
  regression. Final canonical attempts reached 276/277 and 275/277; only unrelated live Windows
  process/helper fixtures missed their timing windows, while the exact Codex helper immediately
  passed 1/1 and the affected three-file group passed 30/30 in isolation. Changed-area verification
  passed 20/20 and Python passed 3/3. The final package scan passed with 149 files and 367,302,463
  bytes. `dist/Claude-Pet-win32-x64.zip` is 147,080,497 bytes with SHA-256
  `20BE53521F79839454D27B00612388F5ACF1A0946260E0FE306AD0508393F369`.
- No WSL work, provider sign-in, real provider run, parallel agent execution, or multi-model work
  occurred. The remaining gate is user judgment of clarity and taste, not technical verification.

## 2026-07-28 — Packaged startup crash repair

- Reproduced the reported startup boundary: the prompt server called `listen` without returning an
  awaitable startup result, so an occupied `127.0.0.1:47611` emitted an uncaught `EADDRINUSE` error
  in Electron's main process.
- TDD regressions now prove that prompt-server listen failures reject to their caller and that a
  second packaged launch exits successfully while asking the primary instance to reveal its shared
  conversation window. A genuinely unavailable prompt port is caught by main and shown as a short
  Claude Pet startup explanation rather than Electron's JavaScript exception dialog.
- Direct verification passed 280/280 Node tests and the package verifier passed 150 files /
  367,303,994 bytes. A real same-profile two-launch exercise kept the primary process and prompt
  listener alive while the second process exited with code 0. The refreshed
  `dist/Claude-Pet-win32-x64.zip` is 147,174,961 bytes with SHA-256
  `AFC4970942D6112F162BA3FA4EA6FE33EEF613E19A6AF7EB6BDCDCCA9825C1A0`.
- No WSL work, provider sign-in, real provider run, parallel agent execution, or multi-model work
  occurred. The user gate remains clarity and taste only.

## 2026-07-28 — Codex-first connection recovery

- Audited the visible unified controls end-to-end. The real Codex executor, encrypted storage,
  signed native CLI discovery, authorization dialog, status, setup, activity, Stop, and session
  boundaries already existed, but first run created Offline Demo only and Settings could not create
  or edit a real provider connection. Its old generic Test/sign-in actions used the global active
  connection, usually Offline Demo, so real Codex setup was unreachable.
- Added the smallest accepted Settings slice: create/edit a Codex connection with project folder,
  allowlisted GPT-5.6 model and effort, permanent Full Computer warning, explicit unavailable
  Workspace copy, and card-specific Test/official sign-in actions. Save still passes through the
  existing main-owned native authorization boundary; no renderer credentials, silent permission
  grant, or Workspace fallback was added. Exact saved-connection delegates avoid mutating the
  active selection, and visible feedback survives snapshot re-renders.
- Witnessed TDD RED/GREEN for exact saved-connection routing, the editor, durable feedback,
  cancellation copy, status-only Test, and isolated prompt-port parsing. Final verification passed
  286/286 Node tests and 3/3 Python tests. The normal Windows package verifier passed 151 files /
  367,314,883 bytes; the isolated QA package verifier passed 151 files / 367,314,837 bytes.
- Fresh-profile packaged CDP verification saved and restored a Codex card, displayed `Codex is
  installed but not signed in yet`, retained unrelated Offline Demo/session controls, and launched
  the official visible `codex.exe login` flow. The account action remains open for the user; no
  credentials were handled and no real task was run.

## 2026-07-28 — User-flow audit and tray Quit repair

- The user-selected test workspace is `C:\\Users\\eklip\\Desktop\\a`; the user-flow harness now
  defaults to it instead of the repository folder. A fresh packaged Offline Demo flow completed
  first run, two participants, Stop/Retry, controlled failure/recovery, a bounded attachment, and
  pet reopen using that workspace. Its legacy screenshot watchdog timed out only after the pet
  reopen checkpoint; it does not indicate that the completed app action failed.
- Root cause for tray Quit: the tray correctly called `app.quit()`, but the shared main window
  cancelled every close and hid itself, including Electron's explicit quit close. `before-quit`
  now marks an intentional exit; only ordinary window closes hide to tray, while app quit closes
  normally. Focused regressions cover both paths.
- Removed the obsolete generic `Test active connection` and `Provider sign-in` controls. They
  dispatched empty requests after connection actions became card-specific, so they could only fail
  silently. The live Codex card remains the sole honest Test/sign-in route.
- Audit note: `src/trayController.js` is an unused older tray helper; production uses
  `src/trayMenu.js` from `src/main.js`. It was left untouched because it has no runtime path and
  the repair pass stayed focused on user-visible behavior.

## 2026-07-28 — Live Codex session and response recovery

- A direct packaged Codex run showed that a new session could carry an arbitrary workspace while
  the active connection remained elsewhere. New-session UI now explicitly selects a saved
  connection; the main-owned coordinator derives both the participant connection and workspace
  from that one saved record. A browser-only regression also covers the real DOM `HTMLCollection`
  behavior that had made the visible New session button a no-op despite passing fake-DOM tests.
- The first bounded user-authorized Codex smoke wrote only
  `C:\\Users\\eklip\\Desktop\\a\\claude-pet-live-smoke.txt` with the requested 28-byte UTF-8
  content, but the UI then showed `The agent returned an invalid response.` The native CLI had
  emitted a completed command with `exit_code: null`; the mapper now retains that event as an
  honest unknown-exit status instead of discarding the already-received agent response. Missing or
  malformed exit codes remain rejected.
- After the user completed official OAuth, a fresh package (`151` files, `367315664` bytes) was
  exercised through CDP using the quoted persisted test profile. A contained Full Computer boundary
  proof passed, and the visible Retry control completed the same read-only Codex request with
  attributed `Reviewer · Codex · gpt-5.6-terra` output and activity. The target file's length and
  UTC write time were unchanged. An initial visible `The permission profile is unavailable.`
  preflight result was retained for recovery testing; its retry completed after the contained proof,
  rather than silently falling back or weakening Full Computer checks.

## 2026-07-29 — Review security hardening gate

- Incorporated the local review findings without modifying either review source. R1-R3 now use an
  opt-in, capability-authenticated loopback server with exact Host/Origin/content-type checks,
  bounded sockets/body, and the same 8192-byte UTF-8 goal contract as IPC, snapshots, and sessions.
  R4-R6 install stdin error handling before writes, retain executable identity through exact
  process inspection, invoke absolute `taskkill.exe`, and treat exited or reused PIDs safely.
- R5/R8 provider probes now own one abort/deadline lifecycle, terminate the verified process tree
  before cleanup, and inherit only a minimal Windows environment. R7 production now uses the tested
  `createSafeStorageCrypto` adapter. R9 bounds ciphertext before base64 decoding. R11 stream-scans
  every packaged text/source file, regardless of size. R12 replaces the stale legacy-window
  architecture map. R10's shared 48 KiB extension/UTF-8 policy is complete; its main-owned visible
  pet-drop confirmation remains paired with the approved attachment UI phase.
- TDD commits through `c57cefc` passed the 76/76 review-focused suite and 312/312 complete Node
  suite; `py -3.12 -m pytest -q` passed 3/3. The first package verification correctly exposed that
  local `LOCAL_PR.html` and `.workbuddy-ai/` paths were package-eligible; the package ignore rule
  now excludes both without editing or staging them. The rebuilt package verified 154 files and
  367,327,757 bytes, and a normal isolated packaged launch had zero listeners on port 47611.

## 2026-07-29 — Attachment and scoped Settings UI gate

- Finished the review's visible attachment path without changing the provider runtime: file choice
  and pet-drop handoff are main-owned, pet drops require native confirmation, only shared-policy
  UTF-8 text/source/config types up to 48 KiB are accepted, and the renderer receives safe
  name/extension/size metadata. One attachment stays staged in the composer until Send or Remove;
  provider prompt construction treats its bounded contents as untrusted current-request data, while
  encrypted history retains only the visible attachment name.
- Split Settings into keyboard-accessible **Agent settings** and **Session settings**. Agent scope
  contains the active profile, assigned connection, provider cards/editor, model/effort/access
  controls, and agent library. Session scope contains name, project folder, participants, and
  main-confirmed deletion. Composer and Settings drafts survive snapshot refreshes, connection
  feedback names Codex or Claude Code correctly, and only the selected session exposes Rename/Delete.
- Live Electron/CDP QA used the user-selected `C:\Users\eklip\Desktop\a` workspace and the
  deterministic unpackaged test executor; it did not sign in or run a real provider. The 900x650
  screenshot exposed a fourth-grid-item composer defect, which was fixed with a witnessed
  regression and recaptured with three semantic composer children, a 446 px message field, matching
  viewport/scroll widths, and no horizontal overflow. Evidence:
  `docs/evidence/security-ui-conversation-900x650.png`,
  `docs/evidence/security-ui-conversation-1440x900.png`,
  `docs/evidence/security-ui-attachment-900x650.png`,
  `docs/evidence/security-ui-attachment-1440x900.png`,
  `docs/evidence/security-ui-agent-settings-900x650.png`,
  `docs/evidence/security-ui-agent-settings-1440x900.png`,
  `docs/evidence/security-ui-session-settings-900x650.png`, and
  `docs/evidence/security-ui-session-settings-1440x900.png`.
- Final verification passed 325/325 Node tests and 3/3 Python tests. The rebuilt Windows package
  verified 156 files and 367,356,576 bytes; a normal isolated packaged launch used the expected
  executable and had zero prompt listeners on port 47611. The local review HTML/JSON sources and
  `.workbuddy-ai/` were neither edited nor staged.

- **2026-07-29 · Codex (GPT-5) · Windows provider lifecycle design** — Rejected hypothetical
  `1f55f90` after reproducing a root-only kill that left a non-Node descendant alive; the full
  proposed suite still passed 327/327, proving its test gap. The approved Job Object design is
  committed as `9cd3f1a`; no application code or WorkBuddy artifacts changed. NEXT: user reviews
  the written spec, then Codex creates the implementation plan.

- **2026-07-29 · Codex (GPT-5) · Provider lifecycle limits revision** — Human/operational review
  found that Job Objects own the assigned job but are not a security sandbox: WMI, services,
  scheduled tasks, brokers, and already-running applications can remain outside that boundary, and
  Stop cannot undo completed side effects. Revision `4c53496` replaces runtime PowerShell
  `Add-Type` with a precompiled helper design, restricts inherited handles, and adds explicit
  real-login, enterprise-policy, signing/reputation, accessibility, crash, and provider-version
  human gates. No application code or WorkBuddy artifacts changed. NEXT: user reviews the revised
  limits, then Codex creates the red-green implementation plan.

- **2026-07-29 · Codex (GPT-5) · Provider lifecycle plan approved** — The user approved the revised
  lifecycle boundary. Plan `7cc789d` decomposes implementation into seven reviewable TDD gates:
  offline helper compilation, native Job Object ownership, the Node readiness adapter, verified
  lease/runner integration, provider/probe coverage, fresh-package integrity, and canonical
  evidence plus human release gates. Plan self-review corrected two pre-code defects: provider
  environment values remain inherited rather than entering the launch envelope, and lease release
  waits for explicit `providerAssigned: true` readiness rather than a Node `spawn` event that
  already occurred. No application code or WorkBuddy artifacts changed. NEXT: choose inline or
  subagent-driven execution and begin Task 1 in an isolated worktree.

## 2026-08-02 — Codex CLI forward compatibility Tasks 1-2

- GitHub PR #2 merged Task 1 remotely at `3e4d1a6` without changing the local `master` checkout.
  Dynamic discovery now accepts strict official x64 Codex releases at or above `0.145.0`, derives
  the version from the held release path, and re-proves the exact signed identity and held
  `--version`; Claude Code's exact behavior is unchanged.
- Task 2 witnessed five intended RED failures, then replaced the exact `0.145.0` feature registry
  gate with a required-subset policy. Bounded disabled additions and removed historical disabled
  entries are tolerated, while duplicate/malformed records and every unknown enabled capability
  remain rejected. The app-owned config and tool-projection resources are now version-neutral.
- The installed August 2026 CLI exposed two reviewed changes. `in_app_updates` is explicitly
  disabled because it is a separate update/network surface. The removed `item_ids` compatibility
  flag is allowed, and bounded unique optional message IDs are ignored only for envelope-key
  comparison; tool schemas, collaboration controls, exec registry, event flow, and sentinels stay
  exact. This matches the current official OpenAI Codex feature registry and removed-flag handling.
- Compatibility probes now return frozen `{ compatible: false }` only for deterministic contract
  mismatch. Independent review caught that the first implementation treated every nonzero CLI exit
  as deterministic; the corrected contract recognizes only a narrowly evidenced missing required
  flag/feature diagnostic. Opaque crashes and other nonzero exits remain retryable `check-failed`,
  alongside bind, fixture, spawn, abort, temporary I/O, and cleanup uncertainty. The existing
  permission path still exposes only `PERMISSION_PROFILE_UNAVAILABLE`, and caller cancellation is
  forwarded into the owned probe lifecycle.
- Review remediation also replaced a superficial three-version spawn comparison with a complete
  deterministic loopback lifecycle for `0.145.0`, `0.146.0`, and `0.200.1`: identical normalized
  arguments, synthetic bearer, rendered app-owned config, authenticated control traffic, seven
  rejected WebSocket upgrades, child canary, sentinel writes, complete scenario report, and cleanup.
  Direct boundary cases now cover absent, 256-byte, empty, oversized, NUL-containing, non-string,
  and duplicate optional message IDs.
- Fresh-head review then found two additional fail-closed gaps. The feature policy now requires
  every safety control present at the `0.145.0` protocol floor to remain listed and disabled while
  still permitting removal of historical non-required entries; the later `in_app_updates` control
  remains explicitly disabled without making its registry presence a false requirement for the
  minimum version. Optional `id` keys are stripped only from message projections. An `id` on
  `additional_tools` or any other projected item is rejected, including through the full envelope
  validator rather than only the narrow identifier helper.
- A live account-free run completed the full current Codex loopback contract with synthetic
  credentials and no real provider endpoint. Later loaded attempts reached the unchanged 30-second
  deadline during WebSocket rejection/fallback, correctly producing retryable `check-failed`; the
  live gate is therefore explicit opt-in rather than a flaky mandatory suite test.
- Verification after review remediation: required focused/adjacent suite passed 42 with one opt-in
  live skip; complete Node suite passed 348 with one opt-in live skip; Python passed 3/3;
  `git diff --check` passed. No WSL,
  provider sign-in, real model request, local `master`, `.workbuddy-ai/`, or `LOCAL_PR.html` change
  occurred. NEXT: publish and merge Task 2, then begin compatibility evidence-store Task 3.

## 2026-08-02 — Codex CLI forward compatibility Task 3

- GitHub PR #3 merged Task 2 remotely at `3366a03` without changing the local `master` checkout.
  Task 3 then began from that exact remote merge in the isolated
  `codex/codex-compat-evidence-store-task-3` worktree.
- The protected compatibility store keys success to the exact normalized executable path, SHA-256,
  volume serial, file ID, semantic version, exact `OpenAI OpCo, LLC` publisher, and policy revision.
  Persisted state contains only a bounded digest and qualification timestamp; version alone can
  never authorize a future executable.
- Evidence is encrypted through the supplied protected-storage boundary, canonical-base64 encoded,
  limited to 64 KiB before reading/decoding, capped at eight entries, and committed through a
  sibling `wx` temporary file plus atomic rename. Corrupt state initializes empty, and unavailable
  protected storage, encryption failure, or persistence failure returns false without plaintext or
  memory-only authorization.
- Independent review found four fail-closed/boundedness gaps in the first commit: arbitrary
  publishers, lookup after protected storage became unavailable, a post-read file-size check, and a
  caller-bypassable entry cap. Commit `25daede` corrects all four; scoped re-review approved every
  finding with no new breakage. The stale-temporary-file recovery suggestion remains a non-blocking
  final-review question because the required `wx` behavior already fails safely.
- Whole-branch review then found that statting a path before an unbounded path read left a
  time-of-check/time-of-use allocation gap. Commit `2c5939b` instead opens one handle and uses one
  fixed 64-KiB-plus-one buffer. Controller inspection caught that a single handle read can legally
  be short; regression commit `a039a63` now loops within that same fixed buffer until EOF or the cap,
  so a valid-looking prefix cannot hide raced trailing bytes. The reviewer explicitly cleared stale
  sibling-temp recovery as non-blocking under the required fail-closed `wx` behavior. Re-encryption
  on protected-storage key rotation remains deferred as a Minor outside the Task 3 requirements.
- Fresh controller verification on final head passed 49/49 focused/adjacent Node tests, 363
  complete-suite Node tests with one intentional live-Codex skip, and Python 3/3; `node --check`
  and `git diff --check` also passed. No WSL, provider sign-in, real model request, local `master`,
  `.workbuddy-ai/`, or `LOCAL_PR.html` change occurred. Scoped re-review approved the bounded-read
  finding with no new Critical or Important breakage. NEXT: publish Task 3 as a GitHub PR before
  Task 4 begins.

## 2026-08-03 — Codex CLI forward compatibility Task 4

- GitHub PR #4 merged Task 3 remotely at `cb9fca7` without changing the local `master` checkout.
  Task 4 began from that exact remote merge in isolated branch
  `codex/codex-compat-coordinator-task-4`.
- Commit `a1279c5` adds the shared coordinator, account-free qualifier, bounded diagnostic, and two
  fixed public compatibility errors. Exact identities share protected and in-process success,
  deterministic incompatibility never persists, retryable infrastructure uncertainty remains
  retryable, and a protected-write failure grants only current-process memory success.
- The plan required positive `available` and `allowed` probe facts that Task 2 did not emit. The
  necessary bridge adds those two exact booleans only to healthy compatibility-purpose probe output;
  permission-purpose behavior is unchanged. Qualification also requires cleanup and credential
  scrubbing, uses an app-owned temporary workspace, and removes it on every outcome.
- Independent review reproduced a delayed protected-store race that could start a second probe after
  the first caller had already qualified and cleared the pending promise. Commit `4db62c9` adds a
  witnessed regression and rechecks memory success after the awaited store lookup; scoped re-review
  approved the fix with no new breakage.
- Fresh controller verification passed 61/61 focused Task 4/probe tests with one intentional live
  skip, 379/379 complete-suite Node tests with one intentional live skip, and Python 3/3; five
  changed-source syntax checks and `git diff --check` also passed. `npm install` reported two high
  severity advisories in the existing dependency graph; Task 4 made no dependency change. No WSL,
  provider sign-in, real model/provider request, user-workspace mutation, local `master`,
  `.workbuddy-ai/`, or `LOCAL_PR.html` change occurred. A fresh whole-branch reviewer then approved
  `cb9fca7..ead7157` with no Critical, Important, or Minor findings and independently confirmed the
  focused/full test results. NEXT: publish Task 4 as a new GitHub PR before Task 5 begins.

## 2026-08-03 — Codex CLI forward compatibility Task 5

- GitHub PR #5 merged Task 4 remotely at `278a8c7` without changing the local `master` checkout.
  Task 5 began from that exact remote merge in isolated branch
  `codex/codex-compat-runtime-task-5`.
- Commit `daf8a93` creates one runtime-owned compatibility store at
  `codex-compatibility.json`, one account-free qualifier rooted at
  `codex-compatibility-probe`, and one shared coordinator injected into both Codex executors.
  Runtime initialization awaits the protected store with connections and sessions. Status, setup,
  permission verification, and run rediscover and qualify their exact executable before
  authentication or provider launch; test mode performs no live qualification and Claude behavior
  is unchanged.
- Independent task review found that a qualified but signed-out native Codex status still reported
  `fullComputerAvailable: true`. Commit `a90436a` derives availability from the same authentication
  result and adds a witnessed signed-out regression; scoped re-review approved the fix with no new
  breakage. The final whole-branch reviewer ruled explicit compatibility-call signal assertions a
  nonblocking test-strengthening Minor because production run paths forward the supplied signal;
  Task 3 protected-key rewrapping remains out of this branch.
- Fresh controller verification passed 37/37 focused Task 5 and adjacent executor tests, 388/388
  complete-suite Node tests with one intentional live-provider skip, and Python 3/3; three changed
  source syntax checks and `git diff --check` also passed. `npm install` still reports two high
  severity advisories in the existing dependency graph; Task 5 made no dependency change. No WSL,
  provider sign-in, live qualification, real model/provider request, user-workspace mutation, local
  `master`, `.workbuddy-ai/`, or `LOCAL_PR.html` change occurred. A fresh whole-branch reviewer
  approved `278a8c7..b1250ca` with no Critical or Important findings and declared the branch ready
  to merge. NEXT: publish Task 5 as a new GitHub PR before Task 6 begins.

## 2026-08-03 — Codex CLI forward compatibility Task 6

- GitHub PR #6 merged Task 5 remotely at `eb1332b` without changing the local `master` checkout.
  Task 6 began from that exact remote merge in isolated branch
  `codex/codex-compat-feedback-task-6`.
- Commit `c02a842` orders manager preflight as CLI installed, compatible, then authenticated. The
  unified renderer and retained Settings status helper now distinguish a deterministically
  unsupported update from a retryable compatibility-check failure using fixed safe copy. The
  `app:intent` regression confirms that only the public retryable error survives IPC; internal
  paths, hashes, file identities, causes, and raw output remain absent. Claude and Offline Demo
  behavior are unchanged.
- TDD witnessed 35 passing and three intended failing focused tests before implementation, then
  38/38 focused tests after it. The independent task reviewer found no Critical, Important, or
  Minor findings and approved both specification compliance and code quality. The pre-existing
  passing IPC regression legitimately re-proves the Task 4 public-error boundary while the other
  three tests witnessed the Task 6 defects.
- Fresh controller verification passed 42/42 focused Task 6 and adjacent renderer tests, 392/392
  complete-suite Node tests with one intentional live-provider skip, and Python 3/3; three changed
  source syntax checks and `git diff --check` also passed. `npm install` still reports two high
  severity advisories in the existing dependency graph; Task 6 made no dependency change. No WSL,
  provider sign-in, live qualification, real model/provider request, user-workspace mutation,
  local `master`, `.workbuddy-ai/`, or `LOCAL_PR.html` change occurred. Fresh whole-branch review
  found only that this heading initially used GitHub's next-day UTC date instead of the local build
  date; this update corrects it. NEXT: publish Task 6 as a new GitHub PR before Task 7 begins.

## 2026-08-04 - Codex CLI forward compatibility Task 7

- TDD repaired the documented `node scripts/diagnose-codex-compatibility.js` entrypoint. Under
  Node, `require('electron')` is the Electron executable path rather than the Electron API, so the
  previous `app.whenReady()` access failed before qualification. The first real-boundary test RED
  was `npm.cmd test -- tests/codexCompatibilityDiagnostic.test.js` (2 passed, 1 failed: documented
  Node diagnostic exited 1). A first relaunch attempt passed a JavaScript file where Electron
  expects an app directory and therefore started Electron's default app; it was bounded, cleaned,
  and replaced with an owned temporary Electron app/profile wrapper. GREEN was the same command:
  3/3 passed, including the real Node-to-Electron entrypoint in 29.5 seconds. The wrapper removes
  only its temporary profile, bounds its owned Electron child to 60 seconds, clears inherited
  `ELECTRON_RUN_AS_NODE`, and forces Electron to exit after either outcome.
- Live, account-free identity evidence: `where.exe codex.exe`, `codex --version`,
  `npm.cmd test -- tests/nativeCliLaunchLease.test.js`, and
  `node scripts/diagnose-codex-compatibility.js` reported official Codex `0.146.0`; the lease suite
  passed 17/17. The bounded diagnostic reported publisher `OpenAI OpCo, LLC`, verified static
  identity, compatible loopback contract, no real credential, no real model request, and cleanup.
  `docs/evidence/codex-compatibility-account-free.json` records only that bounded contract,
  policy revision 1, and its UTC test timestamp.
- Focused compatibility matrix: 143 passed, 0 failed, 1 intentional live-installed-Codex skip.
  Complete verification: Node 393 passed, 0 failed, 1 intentional skip; Python 3/3 passed;
  `git diff --check` passed. The initial fresh `package:win` and `verify:package` count was 165
  files and 367398380 bytes; its development-artifact exclusion claim is superseded by the final
  package-integrity correction below.
- Packaged Codex status QA with a saved Full Computer connection, real sign-in/model smoke, public
  signing/reputation, enterprise-policy validation, and future Windows Job Object lifecycle work
  were not run in this task and remain visibly incomplete. No WSL, provider sign-in, real model
  request, user-workspace mutation, local `master`, `.workbuddy-ai/`, or `LOCAL_PR.html` change
  occurred.
- Final Task 7 package-integrity correction closed a controller-verified gap: `.superpowers`,
  `.github`, `.gitattributes`, and `.gitignore` are now both packager-excluded and verifier-forbidden.
  TDD RED was 12 passing and 2 failing policy tests; GREEN was 14/14. A fresh package contains 159
  files / 367390918 bytes, verifies cleanly, and has none of those four paths. Final Node verification
  passed 402/402 with one intentional skip; Python passed 3/3.
