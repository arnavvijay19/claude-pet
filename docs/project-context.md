# Claude Pet — Project Context

Read this first every session. It is the durable one-page framework for an agent-first Windows
desktop pet.

Details live in [superpowers/specs/claude-pet-spec.md](superpowers/specs/claude-pet-spec.md) (what
and why),
[superpowers/specs/2026-07-22-agent-first-provider-redesign.md](superpowers/specs/2026-07-22-agent-first-provider-redesign.md)
(approved redesign), [superpowers/plans/2026-07-13-claude-pet.md](superpowers/plans/2026-07-13-claude-pet.md)
(exact tasks), [RESEARCH.md](RESEARCH.md) (evidence), and [BUILD_LOG.md](BUILD_LOG.md) (history).

## One sentence

A transparent always-on-top Electron pet accepts user-initiated goals, runs one multi-step Offline
Demo, Codex, or Claude Code agent inside a visible permission boundary, and shows its work live in
Simple or Comprehensive form.

## Current state

- Tasks 1-8 are complete and merged on `master`; Task 9 is complete on its dedicated branch and
  awaits the user's integration decision.
- The 192x208 transparent pet window, tray, preload bridge, sprite state machine, and loopback prompt
  server exist.
- The approved agent-first redesign is committed at `354e8cb`.
- Its reviewed security-boundary correction is committed at `0f6f9ba`.
- The next incomplete task is **Task 10: Codex CLI runner and enforceable permission profiles**.
  Its clean task branch must contain final Task 9 commit `39893b2`.
- No AI account is required for canonical Task 10 tests. Task 9 shipped the built-in Offline Demo
  runtime, normal Settings/response flows, and the visible pet renderer; fake processes cover CLI
  adapters.
- Real Codex or Claude Code runs are optional smoke tests when the tester is already signed in.

## Architecture

~~~text
Electron main process
├─ main.js                    pet, response, and Settings windows; tray; IPC wiring
├─ preload.js                 pet-only bridge
├─ settings-preload.js        settings bridge
├─ response-preload.js        response/activity actions
├─ bridge/promptServer.js     loopback POST /prompt (complete foundation)
├─ agent/agentManager.js      immutable run, busy guard, stop, attribution
├─ agent/activitySanitizer.js recursive redaction before validation/storage/IPC
├─ agent/activityStore.js     discriminated current-run activity
├─ agent/connectionStore.js   public agent metadata and future encrypted secrets
├─ agent/cliRunner.js         bounded official-CLI process boundary
├─ agent/windowsProcessTree.js verified Windows child/grandchild termination
└─ agent/executors/
   ├─ offlineDemoExecutor.js
   ├─ codexCli.js
   └─ claudeCodeCli.js

Context-isolated vanilla-JS renderers
├─ renderer/                  192x208 pet canvas and deliberate file drop
├─ response/                  response plus Simple/Comprehensive live activity
└─ settings/                  connection/workspace/permissions/model UI
~~~

## Architectural rules

1. **Agent-first.** One goal may perform many tool actions; there is still only one run at a time.
2. **Workspace is the default boundary.** Reads, writes, and child network outside the selected
   workspace are denied except for minimal runtime/auth paths. Codex ignores hostile project config,
   hooks, and rules; Claude uses safe mode. A prompt instruction is not a security boundary.
3. **Full Computer is advanced opt-in.** It requires a main-owned native warning bound to the
   connection and remains visibly badged; renderer state is never confirmation proof.
4. **Provider login stays official.** The app launches official CLI auth and never reads tokens.
5. **Connection changes are snapshot-safe.** Workspace, permissions, model, and effort changes affect
   only the next run.
6. **Activity is structured.** Both live views consume recursively sanitized discriminated events;
   renderers never parse raw CLI streams.
7. **Sensitive output stays in main.** No credentials, environment dumps, hidden reasoning, raw
   stderr, or unbounded command output crosses IPC.
8. **Direct APIs wait for a real tool loop.** Do not ship chat-only OpenAI, Anthropic, or custom
   endpoints as substitutes.
9. **The pet renderer stays unprivileged.** No Node, direct filesystem, provider CLI, or network.
10. **Every milestone is runnable.** Do not stack invisible backend phases until the end.

## Remaining build phases

| Milestone | Plan tasks | Runnable deliverable | Canonical proof |
|---|---:|---|---|
| Complete foundation | 1-5 | Assets, Electron shell, state machine, tray, prompt server | Existing tests and Task 4 screenshot |
| Agent core | 6-8 | Contract, secure metadata, activity, shipped Offline Demo Agent | Offline Node tests |
| Offline agent shell | 9 | Workspace/text Settings, response window, Simple activity | Runnable Offline Demo screenshot and checklist |
| Codex Workspace Agent | 10-11 | Isolated Codex execution plus Comprehensive activity | Sandbox probes, fake-process tests, optional live smoke |
| Claude Code Agent | 12 | Claude executor behind the same contract | Parity tests and optional live smoke |
| Advanced permissions | 13 | Full Computer opt-in, warnings, permission switching | Adversarial boundary tests and screenshot |
| Pet integration | 14 | Renderer, file drop, terminal goals, tray switching, Stop | Offline end-to-end run and visual evidence |
| Shareable test build | 15 | Unsigned Windows x64 package and first-run guide | Packaged launch with empty connection store |

Direct API agent loops, multiple agents, schedules, and persistent history remain deferred.

## Working method

- One implementation session executes one numbered task, verifies it, updates BUILD_LOG.md, and
  commits it.
- Start each task with a concise ETA and revise it only when the estimate materially changes.
- Read this file, BUILD_LOG.md, the exact task, and only its linked research/design sections.
- Use `npm.cmd` from PowerShell. Remove inherited `ELECTRON_RUN_AS_NODE` only in the Electron child.
- Evidence before done: focused tests, full Node suite, pytest, clean Git status, and visual proof
  for runnable UI gates.
- Reviews use repository-local tests and the Superpowers spec/quality workflow; no external review
  CLI is required.
- After every verified implementation-plan step, refresh `PROJECT_CHECKLIST.html` from the canonical
  project context and build log before continuing to the next step.
- Each major milestone includes exact launch instructions and a manual checklist for the user.
- Do not begin the next milestone until the current runnable state is demonstrated and logged.
- Two failed fixes for the same problem means return to the last verified checkpoint.

## Model and effort policy

Any capable coding model may execute a task. Use higher reasoning for agent contracts, secret
storage, permission isolation, process parsing, IPC, and packaging. Model choice never changes
authentication, permission, redaction, or verification rules.

The product registries are separate and exact: Codex CLI `>=0.144.6` exposes `gpt-5.6-sol`,
`gpt-5.6-terra`, and `gpt-5.6-luna`; Claude Code `>=2.1.217` exposes `fable`, `opus`, and `sonnet`;
Offline Demo exposes only `offline-demo`. Unlisted values and silent fallback are rejected.

## Order

Tasks 6-15 are serial because each consumes contracts and files from prior tasks. Do not run them
in parallel worktrees unless the plan explicitly isolates a correction.

## Standard entry prompt

> Read Claude Pet/docs/project-context.md and Claude Pet/docs/BUILD_LOG.md, then execute the next
> incomplete task in Claude Pet/docs/superpowers/plans/2026-07-13-claude-pet.md. One task only.
> Follow the session contract and stop at every user test gate.

## Session contract

Every implementation session must:

1. Start from a clean branch/worktree whose base contains the prior task's final commit.
2. State a realistic ETA before implementation.
3. Read this file, BUILD_LOG.md, and only the exact task plus linked sources.
4. Record surprises immediately in BUILD_LOG.md field notes.
5. Execute the task's red-green cycle and required runnable/visual checks.
6. Refresh `PROJECT_CHECKLIST.html` after every verified implementation-plan step.
7. End with exact test output, Git status, evidence paths, and a commit or explicit blocker.
8. Stop at milestone user-test gates instead of silently beginning the next layer.
9. Never claim next-task readiness until the current final commit is an ancestor of its base.

## Document routing

- Product requirements: `superpowers/specs/claude-pet-spec.md`
- Approved agent-first design: `superpowers/specs/2026-07-22-agent-first-provider-redesign.md`
- Exact implementation tasks: `superpowers/plans/2026-07-13-claude-pet.md`
- Evidence and rationale: `RESEARCH.md`
- Session history and handoffs: `BUILD_LOG.md`
