# Claude Pet — Project Context

Read this first every session. It is the durable one-page framework for an agent-first Windows
desktop pet.

Details live in [superpowers/specs/claude-pet-spec.md](superpowers/specs/claude-pet-spec.md) (what
and why),
[superpowers/specs/2026-07-22-agent-first-provider-redesign.md](superpowers/specs/2026-07-22-agent-first-provider-redesign.md)
(historical agent-first foundation),
[superpowers/specs/2026-07-26-wsl-workspace-full-computer-redesign.md](superpowers/specs/2026-07-26-wsl-workspace-full-computer-redesign.md)
(approved current boundary/animation redesign),
[superpowers/plans/2026-07-13-claude-pet.md](superpowers/plans/2026-07-13-claude-pet.md)
(Tasks 1-13 complete; replacement Tasks 14-21 approved; Task 14 only next), [RESEARCH.md](RESEARCH.md)
(evidence), and
[BUILD_LOG.md](BUILD_LOG.md) (history).

## One sentence

A transparent always-on-top Electron pet accepts user-initiated goals, runs one multi-step Offline
Demo, Codex, or Claude Code agent inside a visible permission boundary, and shows its work live in
Simple or Comprehensive form.

## Current state

- Tasks 1-13 are complete and integrated into local `master` at `e02a58d`. Task 14 is the only
  permitted next task; its implementation has not started.
- The 192x208 transparent pet window, tray, preload bridge, sprite state machine, and loopback prompt
  server exist.
- The approved agent-first redesign is committed at `354e8cb`.
- Its reviewed security-boundary correction is committed at `0f6f9ba`.
- The WSL Workspace + default Full Computer redesign is committed at `759afe4`, the approved
  replacement Tasks 13-21 plan checkpoint is committed at `b28d9bb`. The user accepted Task 13's
  evidence gate and it is integrated; the next gate is Task 14 only.
- The redesign makes warned **Full Computer** the default selection for new Codex/Claude connections.
  Genuine **Workspace** uses a dedicated, locked WSL2 Ubuntu distribution and never falls back to
  Full Computer.
- No WSL2 kernel or Linux distribution is installed yet. WSL and Virtual Machine Platform features
  are enabled; setup is a later approved implementation milestone, not part of this docs checkpoint.
- No AI account is required for canonical Task 10 tests. Task 9 shipped the built-in Offline Demo
  runtime, normal Settings/response flows, and the visible pet renderer; fake processes cover CLI
  adapters. The native Codex/Claude foundation is not currently runnable in production because
  Task 13 repairs the production resolver and binds status, login, diagnostics, and runs to freshly
  verified signed native executable leases.
- Task 13 replaced the invalid `CODEX_HOME` outside target with an owned sibling fixture and ran the
  complete real matrix. Workspace read/write, hostile-project isolation, hook isolation, outside-write
  denial, and cleanup passed; outside reads and child network still escaped. Native Windows therefore
  remains unavailable as Workspace-safe.
- The genuine Codex 0.145.0 install uses an exact ordered two-junction chain: installer `bin` to
  standalone `current\\bin`, then standalone `current` to the pinned versioned release. It has no PE
  version metadata. Task 13 allows only those two raw targets and proves the version via the signed,
  hash/file-ID-bound canonical executable's held-path `--version`; all other reparse targets remain
  rejected. Claude's installed executable is non-reparse and has PE version 2.1.217.0.
- A 2026-07-26 account-free Codex 0.145.0 loopback probe corrected the approved tail before
  implementation: GPT-5.6 uses a developer `input[type=additional_tools]` code-mode envelope, not a
  classic five-tool array. The exact top-level/nested registries are now pinned, and Tasks 14/17 must
  actively prove the still-surfaced collaboration and user-input controls fail closed without a
  subagent, process/request, UI wait, authority change, or residue.
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
user, and requires the official Codex or Claude WSL sandbox plus complete hostile probes. Installed
component stages are hash-verified after each repair; provider readiness uses a fresh main-owned
workspace/installation/recovery-bound attestation, never caller-supplied probe results.

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
13. **Attachments are one-file disclosures.** Workspace files outside the selected project require a
    native warning; only bounded UTF-8 text crosses, acceptance is snapshot-bound, and the parent is
    never mounted or shared.

## Remaining build phases

| Milestone | Plan tasks | Runnable deliverable | Canonical proof |
|---|---:|---|---|
| Complete foundation | 1-5 | Assets, Electron shell, state machine, tray, prompt server | Existing tests and Task 4 screenshot |
| Agent core | 6-8 | Contract, secure metadata, activity, shipped Offline Demo Agent | Offline Node tests |
| Offline agent shell | 9 | Workspace/text Settings, response window, Simple activity | Runnable Offline Demo screenshot and checklist |
| Codex Workspace Agent | 10-11 | Isolated Codex execution plus Comprehensive activity | Sandbox probes, fake-process tests, optional live smoke |
| Claude Code Agent | 12 | Claude executor behind the same contract | Parity tests and fail-closed Settings diagnostic |
| Written redesign | approved | WSL/Full Computer/animation boundary and milestones | `759afe4` plus user approval |
| Prerequisite repair | 13 | Production CLI resolution and complete native diagnostic evidence | Real default resolver and sibling-target regressions |
| Full Computer | 14 | Warned native mode, default for new real connections | Native cancel/accept/badge adversarial gate |
| WSL installation and generic boundary | 15-16 | Pinned dedicated distro, held NTFS path, private broker | Supply-chain, mount, hostile, Stop, and recovery gates |
| Codex genuine Workspace | 17 | Linux named profile through the verified WSL boundary | Complete generic and Codex hostile matrices |
| Claude genuine Workspace | 18 | Locked managed sandbox through the verified WSL boundary | Complete policy, dependency, and Claude hostile matrices |
| Complete animations | 19 | Validated nine-state Post-Hoc Banana Baron atlas | Contact sheet, previews, manifest tests, real Electron QA |
| Final integration | 20 | Token-safe pet states, deliberate file input, consistent tray | Offline text/file/Stop E2E and all-nine-state evidence |
| Unsigned package | 21 | Bounded Windows test package and first-run/removal docs | Secret scan, packaged fresh-profile run, canonical zip hash |

Direct API agent loops, multiple agents, schedules, and persistent history remain deferred.

## Working method

- One implementation session executes one numbered task, verifies it, updates BUILD_LOG.md, and
  commits it.
- The replacement Tasks 13-21 plan is approved and Task 13 is accepted and integrated. Execute
  Task 14 only and stop at its user gate; do not start Task 15 or later work until Task 14 is
  accepted and integrated.
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

Tasks 1-13 remain complete. The written redesign is approved. Replacement Tasks 13-21 define serial
prerequisite, Full Computer, WSL Workspace, animation, integration, and packaging milestones. The
plan is approved; Task 14 is next, and no later task may begin before its predecessor is accepted and
integrated.

## Standard entry prompt

> Read Claude Pet/docs/project-context.md, Claude Pet/docs/BUILD_LOG.md,
> Claude Pet/docs/superpowers/specs/2026-07-26-wsl-workspace-full-computer-redesign.md, and Task 14 in
> Claude Pet/docs/superpowers/plans/2026-07-13-claude-pet.md. The replacement plan is explicitly
> approved; execute Task 14 only. Do not install WSL or perform a real broad-access provider run.

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

- Base product requirements: `superpowers/specs/claude-pet-spec.md` (amended by the current redesign)
- Historical agent-first foundation: `superpowers/specs/2026-07-22-agent-first-provider-redesign.md`
- Current boundary/animation redesign: `superpowers/specs/2026-07-26-wsl-workspace-full-computer-redesign.md`
- Exact implementation tasks: `superpowers/plans/2026-07-13-claude-pet.md` (Tasks 1-13 complete;
  replacement Tasks 14-21 approved; Task 14 only next)
- Evidence and rationale: `RESEARCH.md`
- Session history and handoffs: `BUILD_LOG.md`
