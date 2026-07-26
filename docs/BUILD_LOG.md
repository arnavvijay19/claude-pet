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
