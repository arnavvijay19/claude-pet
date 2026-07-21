# Claude Pet — Project Context

Read this first every session. It is the durable one-page framework for a provider-neutral Windows desktop pet.

Details live in [superpowers/specs/claude-pet-spec.md](superpowers/specs/claude-pet-spec.md) (what and why), [superpowers/plans/2026-07-13-claude-pet.md](superpowers/plans/2026-07-13-claude-pet.md) (exact tasks), [RESEARCH.md](RESEARCH.md) (evidence and rationale), and [BUILD_LOG.md](BUILD_LOG.md) (history and field notes).

## One sentence

A transparent always-on-top Electron pet draws the existing Banana Baron sprite, accepts user-initiated prompts through file drop or a loopback POST, and routes one prompt at a time through a visibly selected, user-configured AI adapter while remaining fully usable with no provider configured.

## Current state

- Tasks 1-5 are complete and merged on master.
- The 192x208 transparent pet window, tray, preload bridge, sprite state machine, and loopback prompt server exist.
- The next incomplete task is **Task 6: provider contract, errors, and manager core**.
- No AI account, API key, subscription, or account-appeal outcome is required to execute Tasks 6-15.
- Real-provider smoke tests are optional; mocks and a local compatible server are canonical verification.

## Architecture

~~~text
Electron main process
├─ main.js                    pet, response, Settings windows; tray; IPC wiring
├─ preload.js                 pet-only context bridge
├─ settings-preload.js        settings bridge; one-way API-key submission
├─ response-preload.js        response actions
├─ bridge/promptServer.js     loopback POST /prompt (complete)
├─ providers/providerManager.js
├─ providers/providerStore.js
├─ providers/cliRunner.js
└─ providers/adapters/
   ├─ openaiApi.js
   ├─ anthropicApi.js
   ├─ codexCli.js
   ├─ claudeCodeCli.js
   └─ openAiCompatible.js

Context-isolated vanilla-JS renderers
├─ renderer/                  proven 192x208 pet canvas and drag/drop
├─ response/                  nearby speech bubble and recovery actions
└─ settings/                  normal-sized provider/model/effort UI

Assets
├─ pet.json                   animation contract
└─ spritesheet-mvp.png        existing idle sprite row
~~~

## Architectural rules

1. **The pet works without AI.** Launch, animation, movement, Settings, diagnostics, tests, visual QA, and packaging cannot require a provider.
2. **Consumer authentication is never implemented by the app.** CLI login buttons only launch installed official provider auth flows. The app never asks for account passwords, embeds OAuth, intercepts callbacks, or reads consumer tokens.
3. **API keys are user-supplied and local.** The Settings renderer may submit a newly typed key once; main encrypts it with Electron safeStorage. Stored keys never return to a renderer and there is no plaintext fallback.
4. **The pet renderer stays unprivileged.** It has no credentials, Node access, filesystem access, CLI access, or network access; all work crosses narrow preload IPC.
5. **One visible route, one prompt.** providerManager snapshots the selected connection/model/options, runs one user-initiated request, and provides no queue, automatic retry, or fallback.
6. **Provider capabilities drive UI.** Models and effort values come from the selected adapter/model. Unsupported controls are hidden.
7. **Credentials never mix.** Dedicated CODEX_HOME and CLAUDE_CONFIG_DIR profiles are opaque; child envs strip freemodel.dev and unrelated provider overrides.
8. **The 192x208 pet window remains small.** A separate response window provides speech and actions without expanding the transparent click-blocking rectangle.
9. **pet.json remains the animation contract.** Provider additions do not change sprite/state-machine APIs.
10. **No autonomous prompting.** Future hooks may animate locally but never submit AI requests.

## Initial connection methods

- OpenAI API key through the Responses API.
- Anthropic API key through the Messages API.
- Official Codex CLI with its own ChatGPT or API-key login.
- Official Claude Code CLI with its own login.
- Custom OpenAI-compatible endpoint with optional API key and manual-model fallback.

Remote custom endpoints require HTTPS. Explicitly confirmed loopback HTTP is allowed for local gateways.

## Remaining build phases

| Phase | Plan tasks | Deliverable | Canonical proof |
|---|---:|---|---|
| Complete foundation | 1-5 | Assets, Electron shell, state machine, tray, prompt server | Existing tests and Task 4 screenshot |
| Provider core | 6-7 | Adapter contract, error taxonomy, one-prompt manager, encrypted store | Mocked Node tests; no Electron renderer secrets |
| Direct APIs | 8-9 | OpenAI, custom compatible, and Anthropic adapters | Mocked HTTP contract/capability/error tests |
| Official CLIs | 10-11 | Codex and Claude Code status/login/prompt adapters | Command-shape, env-isolation, timeout, and cancellation tests |
| Configuration UI | 12 | Settings window and capability-aware switching | DOM/unit tests plus visual screenshot |
| Pet response UI | 13 | Pet animation/drop renderer and separate response bubble | Renderer tests plus visual screenshot |
| Integration | 14 | Both prompt paths, tray switching, stop/retry/setup routing | Local compatible end-to-end run and visual evidence |
| Shareable build | 15 | Unsigned Windows x64 package, first-run docs, secret scan | Packaged launch with empty provider store |

Deferred animation rows and hook-driven reactions are not selected by the standard entry prompt and require a separate explicit request after Task 15.

## Working method

- One session or architect chat executes one numbered task, verifies it, updates BUILD_LOG.md, and commits it.
- Read only this file, BUILD_LOG.md, and the exact next task before implementation; use RESEARCH.md sections linked by that task when needed.
- Evidence before done: run the specified focused tests and the full suite. Visual tasks require durable screenshots because Electron can fail silently.
- On PowerShell use npm.cmd. Remove inherited ELECTRON_RUN_AS_NODE only in the child shell before live Electron runs.
- Two failed fixes for the same problem means stop stacking changes and return to the last verified checkpoint.
- Do not start the next numbered task in the same implementation chat.
- Do not make a real-provider credential mandatory merely because one is available.

## Model and effort policy

Any capable coding model may execute a task. Use the strongest available model and higher reasoning effort for Task 6 contract design, Task 7 secret storage, Tasks 10-11 CLI security, Task 12 IPC/settings, Task 14 integration, and Task 15 packaging. Tasks 8-9 and 13 are narrower but still require exact protocol or Electron verification.

Model choice never changes authentication, credential, no-fallback, or verification rules.

## Order

Tasks 6 through 15 are serial. Each consumes contracts or files from the prior task. Do not run them in parallel worktrees unless the plan explicitly identifies a truly independent correction.

## Standard entry prompt

> Read Claude Pet/docs/project-context.md and Claude Pet/docs/BUILD_LOG.md, then execute the next incomplete task in Claude Pet/docs/superpowers/plans/2026-07-13-claude-pet.md.
> One task only. Follow the session contract and working method in project-context.md.

## Session contract

Every implementation session must:

1. Start from a clean branch/worktree whose base contains the previous task's final commit.
2. Read this file, BUILD_LOG.md, and only the exact plan task plus its linked research.
3. Record surprises immediately in BUILD_LOG.md field notes.
4. Execute the task's red-green test cycle and required visual or packaging checks.
5. End with exact test output, git status, a session-log entry, and a commit or explicit blocker.
6. Never claim readiness for the next task until the current task's final commit is an ancestor of the branch the next architect will use.

## Document routing

- Product requirements and settled invariants: superpowers/specs/claude-pet-spec.md
- Exact implementation tasks and code contracts: superpowers/plans/2026-07-13-claude-pet.md
- Evidence, source comparisons, and rationale: RESEARCH.md
- Session history, discoveries, fixes, and handoff state: BUILD_LOG.md
- This file changes only when architecture, task order, or the session contract changes.
