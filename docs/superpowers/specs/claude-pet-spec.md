# Claude Pet Agent-First Spec

> **Current boundary amendment (2026-07-26):**
> [WSL Workspace and Full Computer Redesign](2026-07-26-wsl-workspace-full-computer-redesign.md)
> supersedes this document wherever it discusses the default permission mode, native Windows
> Workspace safety, authentication placement, animation scope, or the old Tasks 13-15 delivery tail.
> Warned Full Computer is the default selection for new Codex/Claude connections; genuine Workspace
> is optional and available only through the dedicated verified WSL2 boundary.

## What this is

Claude Pet is a Windows Electron desktop agent built around the existing Post-Hoc Banana Baron
sprite. It is a transparent, always-on-top companion that accepts user-initiated goals from a
loopback terminal endpoint or deliberate text-file drop, performs multi-step work through a
selected official CLI agent, and shows its work live in a nearby response window.

The product is agent-first rather than chat-first. One user request may inspect files, edit a
workspace, run commands, and use supported tools. There is still only one run at a time: no queue,
silent retry, provider fallback, scheduled prompting, or concurrent agent session.

This spec supersedes the chat-first assumptions introduced after completed plan Tasks 1-5. The
approved design record is
[2026-07-22-agent-first-provider-redesign.md](2026-07-22-agent-first-provider-redesign.md).

## User-visible goals

- Reuse the existing Banana Baron art; do not commission replacement art.
- Accept goals through `POST /prompt` on `127.0.0.1:47611` and deliberate text-file drop.
- Configure an official Codex CLI or Claude Code CLI agent in a normal-sized Settings window.
- Select a workspace, permission profile, model, and supported reasoning effort per connection.
- Default new Codex/Claude drafts to clearly warned Full Computer while offering genuine Workspace
  only through the verified dedicated WSL2 boundary; never fall back between them.
- Show Simple and Comprehensive live views of the same structured activity stream.
- Make every major milestone runnable and manually testable before adding the next layer.
- Package an unsigned Windows x64 test build containing no user credentials or development data.
- Leave a provider-neutral executor boundary for future app-owned API agent loops.

## Initial agent connections

The first release supports three agent executors:

1. Offline Demo — a deterministic account-free, network-free Workspace-only executor.
2. Codex CLI — exact native and dedicated-WSL installs with separate official login state.
3. Claude Code CLI — exact native and dedicated-WSL installs with separate official login state.

Direct OpenAI, Anthropic, and custom compatible API connections are deferred until the app owns a
real tool loop that satisfies the same permission, activity, cancellation, and error contracts.
They must not ship as reduced chat-only substitutes for the agent experience.

## Authentication invariant

The app never authenticates directly to a provider consumer account.

- It never asks for a consumer email, password, MFA code, cookie, access token, or refresh token.
- It never embeds provider OAuth, intercepts callbacks, exchanges codes, or refreshes tokens.
- A login button launches only the installed provider's official authentication command.
- The official CLI exclusively owns and refreshes consumer credentials.
- The app checks status only through documented CLI commands.
- Credential files remain opaque; app-owned executor configuration is stored separately from them.
- The pet, response, and Settings renderers never receive provider credentials.
- Unrelated credentials and environment overrides never enter real-provider children.

## Agent authority

### Workspace Agent

Workspace Agent is optional for real providers and available only through the app-owned
`ClaudePetWorkspace` WSL2 distribution after its complete generic/provider hostile gate passes. It
can read, create, edit, delete, and run Linux commands inside one selected workspace. Reads and
writes outside that workspace plus child-command network access are denied; controlling-CLI provider
traffic and opaque authentication remain outside the model-command sandbox.

This boundary must be enforced by an executor, operating-system sandbox, or verified permission
profile. Prompt instructions are not a security boundary. An executor that cannot prove workspace
isolation cannot advertise Workspace Agent for that installation.

### Full Computer Agent

Full Computer Agent is the default selection for new real-provider drafts but remains optional. It
may receive broad filesystem, command, and network access supported by its native executor. Saving
or running it requires a separate main-owned connection-bound warning and explicit confirmation.
Settings, tray, activity, and every live response display a persistent broad-access badge.

Permission changes affect only the next run. The active run retains its immutable snapshot.

### Deliberate attachments

A deliberate text-file drop is a one-time attachment, not a workspace grant. Main accepts only a
regular UTF-8 file up to 262144 bytes, wraps its basename and contents inside an explicit untrusted
data boundary, and never sends its full local path. Dropping a file outside the workspace grants no
traversal rights to its parent directory.

## Compliance and account safety

- One user action starts at most one agent run.
- One run may contain many model and tool actions needed to finish the requested goal.
- There is no queue, background loop, scheduled run, account pooling, or concurrent provider run.
- The app never silently retries, changes executor, changes model, or invokes fallback.
- Authentication, quota, timeout, failed command, and stopped-run retries require another user
  action.
- The app does not modify unrelated CLI configuration.
- Provider branding, source code, and assets are not copied.
- Public distribution retains provider-terms and Windows-signing review gates.

## Architecture

~~~text
promptServer / deliberate file drop
                 |
                 v
          promptController
                 |
                 v
            agentManager <---- Settings IPC
                 |
       +---------+----------+
       |                    |
 connectionStore       activityStore
 public metadata       current run only
       |                    |
       +---------+----------+
                 |
          executor registry
           /            \
     Codex CLI      Claude Code CLI
                 |
                 v
 selected workspace and permission boundary
~~~

The transparent pet renderer remains context isolated with Node integration disabled. A separate
Settings renderer configures agent connections through a narrow preload. A separate response
window shows state, activity, replies, errors, and actions without enlarging the proven 192x208 pet
window.

## Main-process components

### agentManager

`agentManager` owns the executor registry, selected connection, one-run busy guard, immutable run
snapshot, cancellation controller, normalized errors, response attribution, and validated activity
stream. It never contains provider-specific login or process-parsing code.

### connectionStore

`connectionStore` persists versioned non-secret connection metadata: executor type, label,
workspace, permission profile, full-access confirmation state, model, effort, and options. It also
supports future safeStorage-encrypted API secrets without exposing ciphertext or unexpected fields.

Electron asynchronous safeStorage decryption returns `{ result, shouldReEncrypt }`. The crypto
boundary returns the string result and explicitly handles a rotation signal. Public connection
objects are constructed from an allowlist, not by removing a known secret field.

### Executors

Every executor provides:

- `getStatus(connection)`
- `beginSetup(connection)`
- `listModels(connection)`
- `getCapabilities(connection, modelId)`
- `verifyPermissionProfile(connection)`
- `runGoal(request, emitActivity, abortSignal)`

`runGoal` returns `{ text, changedFiles }`. It receives a frozen snapshot containing goal,
workspace, permission profile, model, effort, and sanitized options.

Codex uses a dedicated `CODEX_HOME`, app-owned permission profiles, JSONL execution output, a
minimal child environment, and official login/status commands. Claude Code uses a dedicated
`CLAUDE_CONFIG_DIR`, stream JSON output, a minimal child environment, and official login/status
commands. An executor exposes Workspace Agent only when its local boundary passes deterministic
isolation probes; otherwise it offers Full Computer only with the advanced warning.

### activityStore

Activity is current-run memory only. It accepts validated normalized events, assigns sequence and
time metadata, publishes them to the response window, and clears them when dismissed or on exit.
Persistent run history is deferred.

## Live activity views

The response window has a remembered Simple/Comprehensive toggle.

Simple view shows:

- preparing, inspecting, editing, running, or responding phase;
- one plain-language activity summary;
- executor, model, workspace, and permission badge;
- elapsed time and Stop.

Comprehensive view shows a timestamped, collapsible timeline of:

- normalized tool and command activity;
- files read, created, modified, or deleted;
- commands and exit status;
- network destinations when exposed;
- permission decisions and blocked actions;
- sanitized bounded command output;
- provider usage when exposed;
- final changed files and total duration.

Both views consume the same normalized events. Renderers never parse raw CLI streams. Activity
excludes credentials, authentication payloads, environment dumps, hidden model reasoning, unsafe
raw stderr, and unbounded output. Supported public reasoning summaries may be shown; private chain
of thought may not.

## Setup and switching

The initial setup flow is:

1. Choose Offline Demo, Codex CLI, or Claude Code CLI and a workspace/model/effort.
2. For Codex/Claude, see Full Computer preselected or deliberately choose Workspace.
3. Full Computer opens its exact native warning before save, then uses separate native official login.
4. Workspace provisions/repairs only the owned WSL distro, deploys the current hashed stage, and runs
   the complete fresh boundary/provider gate.
5. Only after that gate, Workspace offers its separate official WSL login.
6. Save and activate the connection; unavailable setup/auth/gate states fail closed without changing
   modes or silently falling back.

Settings always shows active executor, health, workspace, permission profile, model, effort, Test,
Change, and Manage connections. The tray exposes quick connection and model choices plus the active
permission badge. Changes made during a run apply to the next run only.

## Run lifecycle

1. A user submits a terminal goal or deliberately drops a supported text file.
2. Main snapshots connection, workspace, permissions, model, effort, and options.
3. No active connection returns `AGENT_REQUIRED` and opens setup.
4. A second request returns `AGENT_BUSY`; nothing is queued.
5. The executor performs one multi-step run and emits structured activity.
6. Stop aborts or terminates the executor and returns `RUN_STOPPED` without retry.
7. The response window receives normalized running, needs-input, response, stopped, or error state.
8. The final result includes executor/model attribution and known changed files.
9. Busy state clears in a `finally` path.

## Error and privacy requirements

Stable categories include `AGENT_REQUIRED`, `CLI_NOT_INSTALLED`, `AUTH_REQUIRED`,
`WORKSPACE_UNAVAILABLE`, `PERMISSION_PROFILE_UNAVAILABLE`, `PERMISSION_BLOCKED`, `AGENT_BUSY`,
`COMMAND_FAILED`, `REQUEST_TIMEOUT`, `RUN_STOPPED`, `MODEL_UNAVAILABLE`, `UNSUPPORTED_OPTION`,
`RATE_LIMITED`, `QUOTA_OR_BILLING`, `PROVIDER_OUTPUT_INVALID`, `ACTIVITY_INVALID`,
`SECRET_STORE_FAILED`, and the fixed bounded-attachment categories defined by Task 20.

The response window shows a short explanation and one useful action. Main-to-renderer IPC returns
only allowlisted connection metadata, normalized activity, and public errors. Logs omit goal text by
default and redact credentials, cookies, authorization headers, secret-bearing URLs, environment
dumps, raw provider output, raw CLI stderr, and unsafe command output.

## Incremental delivery gates

1. Completed Tasks 1-12 preserve the pet/agent/activity/Settings foundation and fail-closed native
   diagnostics.
2. Task 13 repairs signed CLI discovery and complete native evidence.
3. Task 14 adds default warned native Full Computer with exact non-local-tool denial.
4. Tasks 15-18 deploy the staged dedicated WSL boundary and fresh Codex/Claude gates.
5. Tasks 19-20 integrate the validated nine-state atlas, token-safe activity animation, and bounded
   deliberate file path.
6. Task 21 provides the non-following scanned unsigned Windows test package and first-run/removal docs.

Every gate ends with a runnable app, exact test instructions, focused and full automated tests,
visual evidence, a BUILD_LOG checkpoint, a commit, and an explicit user test opportunity before the
next gate.

## Offline verification and packaging

Canonical automated tests use fake processes and a deterministic mock executor. They require no
provider account, API key, subscription, or paid generation. Real Codex and Claude runs are
optional smoke tests when the tester is already signed in.

Required coverage includes:

- executor contract, immutable snapshots, busy guard, cancellation, and no fallback;
- async safeStorage result/rotation handling and public metadata allowlisting;
- permission-profile generation and read/write/network isolation probes;
- full-access confirmation and visible warning;
- minimal child environments and opaque credential profiles;
- JSONL/stream event normalization, output bounds, and redaction;
- Simple/Comprehensive parity over one activity stream;
- deterministic delayed-run Stop without retry;
- no-agent setup, switching, errors, recovery, and both prompt inputs;
- packaged Windows x64 launch with an empty connection store and no embedded credentials.

## Non-goals

- macOS or Linux packaging.
- Direct API chat-only connections.
- App-owned OpenAI, Anthropic, or custom API tool loops in the first release.
- Multiple concurrent agents, queues, scheduled runs, or autonomous background goals.
- Persistent prompt, response, or activity history.
- Cloud sync, telemetry, remote control, or team sharing.
- New sprite generation or full Shimeji movement physics.
- Signed installer or public distribution before separate review.

## Source material

- `docs/RESEARCH.md` — evidence and architectural rationale.
- `docs/project-context.md` — per-session execution contract.
- `docs/superpowers/plans/2026-07-13-claude-pet.md` — canonical task sequence.
- `docs/superpowers/specs/2026-07-22-agent-first-provider-redesign.md` — approved design record.
- Electron safeStorage documentation and installed Electron 43 type definitions.
- Official Codex CLI, permissions, non-interactive, SDK, authentication, and model documentation.
- Official Claude Code CLI and authentication documentation.
