# Claude Pet — Project Context

Read this first every session. It is the durable one-page framework for an agent-first Windows
desktop pet.

Details live in [superpowers/specs/claude-pet-spec.md](superpowers/specs/claude-pet-spec.md) (what
and why),
[superpowers/specs/2026-07-22-agent-first-provider-redesign.md](superpowers/specs/2026-07-22-agent-first-provider-redesign.md)
(historical agent-first foundation),
[superpowers/specs/2026-07-26-wsl-workspace-full-computer-redesign.md](superpowers/specs/2026-07-26-wsl-workspace-full-computer-redesign.md)
(approved current boundary/animation redesign),
[superpowers/specs/2026-07-27-core-v1-ux-rebuild-design.md](superpowers/specs/2026-07-27-core-v1-ux-rebuild-design.md)
(approved current UX rebuild),
[superpowers/specs/2026-07-28-codex-first-connection-design.md](superpowers/specs/2026-07-28-codex-first-connection-design.md)
(focused Codex connection recovery),
[superpowers/plans/2026-07-13-claude-pet.md](superpowers/plans/2026-07-13-claude-pet.md)
(Tasks 1-19 implemented on the Core V1 branch; optional WSL Tasks 20-23 require a later opt-in),
[superpowers/plans/2026-07-27-core-v1-ux-rebuild.md](superpowers/plans/2026-07-27-core-v1-ux-rebuild.md)
(next implementation sequence),
[RESEARCH.md](RESEARCH.md)
(evidence), and
[BUILD_LOG.md](BUILD_LOG.md) (history).

## One sentence

A transparent always-on-top Electron pet accepts user-initiated goals, runs one multi-step Offline
Demo, Codex, or Claude Code agent inside a visible permission boundary, and shows its work live in
Simple or Comprehensive form.

## Current state

- Tasks 1-19 are implemented and verified on `codex/task-18-19-core-v1`. Task 15 supplies the
  validated nine-state atlas; Task 16 supplies encrypted app-owned sessions; Task 17 supplies
  explicit agent/session/next-provider switching; Tasks 18-19 complete core integration and the
  unsigned Windows package.
- The user rejected the finished Settings/Response experience as cluttered and functionally weak.
  The approved UX rebuild keeps the tested runtime but replaces those primary workflows with one
  minimal main window. UX Task 1 now supplies schema-version-2 top-level shared sessions, encrypted
  agent instructions, attributed encrypted turns, a maximum of eight participants per session, and
  atomic one-time migration from the Task 16 version-1 store. Only one run still executes in the
  app at a time. Removing a participant preserves their attributed history and identity, while new
  turns must match the currently selected participant. UX Task 1 was fast-forwarded to `master` at
  `1436234`. UX Task 2 now routes each run through only the selected participant's immutable
  connection, attributes both turns to that participant, asks once before cross-provider context
  disclosure, rejects mismatched workspaces and stale selections before provider execution, and
  builds a bounded escaped prompt with the active agent's instruction. UX Task 2 was merged to
  `master` at `e0f6f5a`. UX Task 3 adds one deeply frozen, allowlisted application snapshot and one
  sender-validated `app:intent` boundary for the future unified window. It publishes coordinator,
  connection, run, sanitized activity, and presentation state through only `app:snapshot`. UX
  Task 6 removed the superseded Settings/Response windows and channels after parity coverage. UX Task 4 adds the
  native framed 1080x720 main shell, responsive 264 px sidebar, main-owned agent statuses, shared
  session navigation, and an account-free first-run Offline Demo path. UX Task 5 fills that shell
  with attributed conversation turns, a persistent participant-aware composer, compact expandable
  activity, terminal recovery actions, participant management, and secondary grouped Settings.
  UX Task 6 routes first launch, pet, and tray into the same reusable window; close hides to tray,
  visible-request retry stays on the selected participant, and the packaged fresh-profile flow
  restores its shared session and attributed history. Startup is single-instance: launching the
  package again reveals the existing app instead of opening a second prompt server, while a
  genuinely occupied loopback prompt port is caught and explained without a main-process crash.
- The 192x208 transparent pet window, tray, preload bridge, sprite state machine, and loopback prompt
  server exist.
- The approved agent-first redesign is committed at `354e8cb`.
- Its reviewed security-boundary correction is committed at `0f6f9ba`.
- The WSL Workspace + default Full Computer redesign is committed at `759afe4`, and the earlier
  replacement Tasks 13-21 checkpoint is committed at `b28d9bb`. The user then approved a core-first
  continuation: Tasks 15-19 finish the atlas, app-owned sessions/provider switching, integration,
  and packaging; WSL is optional Tasks 20-23 and requires a separate post-v1 opt-in.
- The redesign makes warned **Full Computer** the default selection for new Codex/Claude connections.
  Genuine **Workspace** uses a dedicated, locked WSL2 Ubuntu distribution and never falls back to
  Full Computer.
- No WSL2 kernel or Linux distribution is installed yet. WSL and Virtual Machine Platform features
  are enabled, but core Tasks 15-19 perform no WSL/system mutation. Optional Tasks 20-23 are the only
  WSL setup path and may begin only after Task 19 plus a separate explicit request.
- No AI account is required for canonical tests. Task 9 shipped the built-in Offline Demo runtime,
  normal Settings/response flows, and the visible pet renderer. Tasks 13-14 repaired production CLI
  discovery and added warned native Full Computer executors; provider sign-in and real agent smoke
  runs remain optional.
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
  classic five-tool array. The exact top-level/nested registries are now pinned, and Task 14 plus
  optional Task 22 must
  actively prove the still-surfaced collaboration and user-input controls fail closed without a
  subagent, process/request, UI wait, authority change, or residue.
- Claude safe mode isolates customization, not the operating system. Real-provider Workspace remains
  unavailable in core v1; it becomes available only if the optional dedicated WSL boundary and
  complete hostile gates are implemented and pass.
- The Post-Hoc Banana Baron run now has all nine approved rows. Its `1536x1872` PNG/WebP atlas passes
  deterministic validation and model visual QA, and the WebP is visible in the real `192x208`
  Electron pet window with clean transparency and no renderer errors.
- Real Codex or Claude Code runs are optional smoke tests when the tester is already signed in.
- Codex-first Settings recovery is implemented and package-verified: a saved Codex connection can
  be created or edited with a project folder, allowlisted model/effort, permanent Full Computer
  warning, and the existing main-owned authorization dialog. Test and official sign-in target the
  explicit saved connection without changing the active agent. The renderer receives no
  credentials; Workspace remains unavailable and never falls back to Full Computer. A fresh
  packaged profile restored the saved connection, reported the real signed-out status, and opened
  the official Codex sign-in. Account completion is the sole remaining user gate before a bounded
  live Codex task can be authorized.

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
├─ agent/sessionStore.js      encrypted profiles/shared sessions (UX Task 1 schema v2)
├─ agent/sessionCoordinator.js sequential active-participant routing (UX Task 2)
├─ app/appSnapshot.js          frozen presentation-safe application state (UX Task 3)
├─ appWindow.js               one app:snapshot/app:intent IPC boundary (UX Task 3)
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

Optional post-v1 Workspace boundary (not implemented): Electron main selects an immutable native Full Computer
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
3. **Workspace is an optional real WSL boundary or unavailable.** Only the selected project is exposed from
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
14. **Shared sessions stay sequential.** A session may contain multiple named agents, but one
    selected participant snapshots one saved connection/provider/model for each turn. Multi-model
    or parallel-agent skills require a separate later design and cannot silently bypass this rule.

## Remaining build phases

| Milestone | Plan tasks | Runnable deliverable | Canonical proof |
|---|---:|---|---|
| Complete foundation | 1-5 | Assets, Electron shell, state machine, tray, prompt server | Existing tests and Task 4 screenshot |
| Agent core | 6-8 | Contract, secure metadata, activity, shipped Offline Demo Agent | Offline Node tests |
| Offline agent shell | 9 | Workspace/text Settings, response window, Simple activity | Runnable Offline Demo screenshot and checklist |
| Codex Workspace Agent | 10-11 | Isolated Codex execution plus Comprehensive activity | Sandbox probes, fake-process tests, optional live smoke |
| Claude Code Agent | 12 | Claude executor behind the same contract | Parity tests and fail-closed Settings diagnostic |
| Written redesign | approved | Core-first sessions/animation/package plus optional WSL boundary | `759afe4` plus the 2026-07-26 core-first approval |
| Prerequisite repair | 13 | Production CLI resolution and complete native diagnostic evidence | Real default resolver and sibling-target regressions |
| Full Computer | 14 | Warned native mode, default for new real connections | Native cancel/accept/badge adversarial gate |
| Complete animations | 15 | Validated nine-state Post-Hoc Banana Baron atlas | Contact sheet, previews, manifest tests, real Electron QA |
| Encrypted continuity | 16 | App-owned agents, sessions, and bounded visible context | Restart/tamper/plaintext-leak tests |
| Hermes-style switching | 17 | Explicit agent/session selection and same-session next-provider switching | Stale/busy/cross-provider disclosure tests and UI evidence |
| Final core integration | 18 | Token-safe pet states, deliberate file input, consistent tray | Offline text/file/Stop E2E and all-nine-state evidence |
| Unsigned core package | 19 | Bounded Windows test package with no WSL dependency | Secret scan, packaged fresh-profile run, canonical zip hash |
| Core V1 UX rebuild | UX 1-6 | Shared-agent sessions and one usable minimal main window | Store migration, sequential routing, unified IPC, Offline Demo E2E, packaged visual gate |
| Optional WSL installation and generic boundary | 20-21 | Pinned dedicated distro, held NTFS path, private broker | Supply-chain, mount, hostile, Stop, and recovery gates |
| Optional Codex Workspace | 22 | Linux named profile through the verified WSL boundary | Complete generic and Codex hostile matrices |
| Optional Claude Workspace | 23 | Locked managed sandbox through the verified WSL boundary | Complete policy, dependency, and Claude hostile matrices |

Direct API agent loops, simultaneous/queued runs, schedules, raw activity history, and cloud sync
remain deferred. Multiple named agents and bounded persistent sessions are core Tasks 16-17.

## Working method

- One implementation session executes one numbered task, verifies it, updates BUILD_LOG.md, and
  commits it.
- Core Tasks 15-19 are implemented and verified on the Core V1 branch. Never begin optional WSL
  Tasks 20-23 without a separate post-v1 opt-in.
- UX Tasks 1-6 from `superpowers/plans/2026-07-27-core-v1-ux-rebuild.md` are implemented.
  UX Tasks 1-2 are merged; UX Tasks 3-6 are verified on the current rebuild branch.
- Start each task with a concise ETA and revise it only when the estimate materially changes.
- Use `C:\\Users\\eklip\\Desktop\\a` as the user-selected project workspace for manual and packaged
  user-flow tests, unless the user changes it. Do not substitute the repository folder.
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

Tasks 1-19 and UX Tasks 1-2 are complete on `master`. UX Tasks 3-6 are implemented and verified on
the current rebuild branch. Optional WSL Tasks 20-23 remain preserved and
are never automatic.

## Standard entry prompt

> Read Claude Pet/docs/project-context.md, Claude Pet/docs/BUILD_LOG.md,
> Claude Pet/docs/superpowers/specs/2026-07-27-core-v1-ux-rebuild-design.md,
> Claude Pet/docs/superpowers/plans/2026-07-27-core-v1-ux-rebuild.md, and the final Core V1
> evidence. Tasks 1-19 and UX Tasks 1-2 are complete; UX Tasks 3-6 are implemented and verified.
> Review or integrate the completed UX rebuild. Do not install WSL, sign into a provider CLI, or run a real
> Codex/Claude agent unless a
> later task explicitly requires it.

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
- Current UX rebuild: `superpowers/specs/2026-07-27-core-v1-ux-rebuild-design.md`
- Current UX implementation tasks: `superpowers/plans/2026-07-27-core-v1-ux-rebuild.md`
- Exact implementation tasks: `superpowers/plans/2026-07-13-claude-pet.md` (Core Tasks 1-19
  implemented and verified on `codex/task-18-19-core-v1`; optional WSL Tasks 20-23 require a
  separate opt-in)
- Evidence and rationale: `RESEARCH.md`
- Session history and handoffs: `BUILD_LOG.md`
