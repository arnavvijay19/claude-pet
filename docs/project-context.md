# Claude Pet — Project Context

Read this first every session. It is the durable one-page framework for an agent-first Windows
desktop pet.

Details live in [superpowers/specs/claude-pet-spec.md](superpowers/specs/claude-pet-spec.md) (what
and why),
[superpowers/specs/2026-07-22-agent-first-provider-redesign.md](superpowers/specs/2026-07-22-agent-first-provider-redesign.md)
(original approved redesign),
[superpowers/specs/2026-07-26-wsl-workspace-full-computer-redesign.md](superpowers/specs/2026-07-26-wsl-workspace-full-computer-redesign.md)
(approved written redesign; implementation-plan review next),
[superpowers/plans/2026-07-13-claude-pet.md](superpowers/plans/2026-07-13-claude-pet.md)
(Tasks 1-12 only until the tail is rewritten), [RESEARCH.md](RESEARCH.md) (evidence), and
[BUILD_LOG.md](BUILD_LOG.md) (history).

## One sentence

A transparent always-on-top Electron pet accepts user-initiated goals, runs one multi-step Offline
Demo, Codex, or Claude Code agent inside a visible permission boundary, and shows its work live in
Simple or Comprehensive form.

## Current state

- Tasks 1-12 are complete. The written redesign is approved; application implementation remains
  paused while the contradictory old Tasks 13-15 tail is replaced and reviewed.
- The 192x208 transparent pet window, tray, preload bridge, sprite state machine, and loopback prompt
  server exist.
- The approved agent-first redesign is committed at `354e8cb`.
- Its reviewed security-boundary correction is committed at `0f6f9ba`.
- The WSL Workspace + default Full Computer redesign is committed at `759afe4` and approved by the
  user. The next gate is the replacement implementation-plan review.
- The redesign makes warned **Full Computer** the default selection for new Codex/Claude connections.
  Genuine **Workspace** uses a dedicated, locked WSL2 Ubuntu distribution and never falls back to
  Full Computer.
- No WSL2 kernel or Linux distribution is installed yet. WSL and Virtual Machine Platform features
  are enabled; setup is a later approved implementation milestone, not part of this docs checkpoint.
- No AI account is required for canonical Task 10 tests. Task 9 shipped the built-in Offline Demo
  runtime, normal Settings/response flows, and the visible pet renderer; fake processes cover CLI
  adapters. The native Codex/Claude foundation is not currently runnable in production because
  `resolveWithWhere()` references undefined `spec.visible`; tests inject a resolver and miss it.
- The production Codex outside-read target is invalid because it lives in intentionally readable
  `CODEX_HOME`, and its early failure skipped later hostile checks. A separate sibling-path probe still
  proves native `Z:\` outside reads are possible. Do not advertise native Windows as Workspace-safe.
- Claude safe mode isolates customization, not the operating system. Workspace remains unavailable
  until the dedicated WSL boundary and complete hostile gate are implemented and pass.
- Claude Pet still ships only the six-frame idle strip. The prepared Post-Hoc Banana Baron run has
  complete base/idle sources; seven distinct generated rows and the derived or independently
  generated left-running row remain pending. The full nine-state atlas is a separate milestone.
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

Planned security boundary (not implemented): Electron main selects an immutable native Full Computer
run or launches the exact app-owned `ClaudePetWorkspace` WSL2 distro. A root-owned broker mounts only
the selected project at `/workspace`, hides Windows/WSL integration surfaces, drops to a no-`sudo`
user, and requires the official Codex or Claude WSL sandbox plus complete hostile probes.

## Architectural rules

1. **Agent-first.** One goal may perform many tool actions; there is still only one run at a time.
2. **Full Computer is the default selection for new real-provider connections.** It remains optional:
   one main-owned native warning per saved connection is required, and every run stays visibly badged.
   Renderer state is never confirmation proof.
3. **Workspace is a real WSL boundary or unavailable.** Only the selected project is exposed from
   Windows; automount, interop, lower policy sources, unsafe tool surfaces, and child network are off.
   A prompt, safe mode, Windows ACL tweak, or setup marker is not a security boundary.
4. **No fallback.** Each immutable run uses exactly the selected mode or fails with a public error.
5. **Provider login stays official.** The app launches official CLI auth and never reads tokens.
6. **Connection changes are snapshot-safe.** Workspace, permissions, model, and effort changes affect
   only the next run.
7. **Activity is structured.** Both live views consume recursively sanitized discriminated events;
   renderers never parse raw CLI streams.
8. **Sensitive output stays in main.** No credentials, environment dumps, hidden reasoning, raw
   stderr, or unbounded command output crosses IPC.
9. **Direct APIs wait for a real tool loop.** Do not ship chat-only OpenAI, Anthropic, or custom
   endpoints as substitutes.
10. **The pet renderer stays unprivileged.** No Node, direct filesystem, provider CLI, or network.
11. **Animations switch atomically.** Keep the idle MVP until the complete nine-state atlas passes
    deterministic and visual QA.
12. **Every milestone is runnable.** Do not stack invisible backend phases until the end.

## Remaining build phases

| Milestone | Plan tasks | Runnable deliverable | Canonical proof |
|---|---:|---|---|
| Complete foundation | 1-5 | Assets, Electron shell, state machine, tray, prompt server | Existing tests and Task 4 screenshot |
| Agent core | 6-8 | Contract, secure metadata, activity, shipped Offline Demo Agent | Offline Node tests |
| Offline agent shell | 9 | Workspace/text Settings, response window, Simple activity | Runnable Offline Demo screenshot and checklist |
| Codex Workspace Agent | 10-11 | Isolated Codex execution plus Comprehensive activity | Sandbox probes, fake-process tests, optional live smoke |
| Claude Code Agent | 12 | Claude executor behind the same contract | Parity tests and fail-closed Settings diagnostic |
| Written redesign | approved | WSL/Full Computer/animation boundary and milestones | `759afe4` plus user approval |
| Prerequisite repair | pending replan | Production CLI resolution and valid aggregate probes | Real default resolver and sibling-target regressions |
| Full Computer | pending replan | Warned native mode, default for new real connections | Native cancel/accept/badge adversarial gate |
| Genuine Workspace | pending replan | Dedicated WSL broker plus Codex/Claude sandboxes | Complete generic and provider hostile matrices |
| Complete animations | pending replan | Validated nine-state Post-Hoc Banana Baron atlas | Contact sheet, previews, manifest tests, real Electron QA |
| Final integration/package | pending replan | Pet/files/tray flow and unsigned Windows test build | Offline E2E, secret scan, packaged first run |

Direct API agent loops, multiple agents, schedules, and persistent history remain deferred.

## Working method

- One implementation session executes one numbered task, verifies it, updates BUILD_LOG.md, and
  commits it.
- Do not start another implementation session until the writing-plans workflow replaces the
  contradictory old Tasks 13-15 tail and the user approves that replacement plan.
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

Tasks 1-12 remain complete. The written redesign is approved. The existing Tasks 13-15 are paused and
must not be executed; the writing-plans workflow now replaces only that unfinished tail with serial
prerequisite, Full Computer, WSL Workspace, animation, integration, and packaging milestones.

## Standard entry prompt

> Read Claude Pet/docs/project-context.md, Claude Pet/docs/BUILD_LOG.md, and
> Claude Pet/docs/superpowers/specs/2026-07-26-wsl-workspace-full-computer-redesign.md. Do not execute
> old Task 13 or install WSL. Wait for the replacement implementation plan to be committed and
> explicitly approved, then execute its next incomplete numbered task only.

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
- Current boundary/animation redesign: `superpowers/specs/2026-07-26-wsl-workspace-full-computer-redesign.md`
- Exact implementation tasks: `superpowers/plans/2026-07-13-claude-pet.md` (Tasks 1-12 only until
  the approved plan rewrite)
- Evidence and rationale: `RESEARCH.md`
- Session history and handoffs: `BUILD_LOG.md`
