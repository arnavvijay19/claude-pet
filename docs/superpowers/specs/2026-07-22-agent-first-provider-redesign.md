# Claude Pet Agent-First Provider Redesign

**Date:** 2026-07-22

**Status:** Approved design; canonical implementation plan established

**Supersedes:** The chat-first assumptions introduced by the 2026-07-21 provider-neutral redesign

## Purpose

Claude Pet is an all-purpose desktop agent, not a small chat client. A user should be able to give
the pet a goal, let it inspect and change a selected workspace, watch its work live at either a
simple or comprehensive level, stop it, and test useful milestones before later features are added.

The first release uses official Codex CLI and Claude Code CLI agent loops plus a built-in Offline
Demo Agent behind one shared executor contract. The demo is a deliberately limited product feature:
it requires no account, credentials, or network, uses Workspace Agent authority only, and emits a
fixed deterministic run so setup, activity, Stop, and packaging can be tested safely. Direct OpenAI,
Anthropic, and custom API executors remain compatible future additions, but they are not presented as
reduced chat-only substitutes. Adding them requires a real app-owned tool loop that satisfies the
same activity, permission, cancellation, and verification contracts.

## Product principles

1. **Agent-first.** One user request may perform many model and tool actions to complete a goal.
2. **One run at a time.** There is no queue, silent retry, provider fallback, scheduled prompting,
   or concurrent agent run.
3. **Useful by milestones.** Every major milestone leaves a runnable application that the user can
   test before later features are layered on.
4. **Visible authority.** The active connection, workspace, model, and permission profile are always
   understandable from Settings and the response window.
5. **Observable work.** Simple and Comprehensive live views are two presentations of the same
   structured activity stream.
6. **Explicit expansion.** Workspace authority is normal; full-computer authority is an advanced,
   deliberate opt-in.
7. **Provider-owned authentication.** Official CLIs own consumer login and credentials. The pet
   launches official login flows and treats credential files as opaque.

## Architecture

The Electron main process owns agent execution and privileged state:

~~~text
terminal prompt / deliberate file drop
                 |
                 v
          promptController
                 |
                 v
           agentManager
      selection, busy guard,
      immutable run snapshot,
      stop, normalized errors
                 |
                 v
          executor registry
      /          |             \
 Codex CLI   Claude Code   Offline Demo
      \          |             /
         structured activity
                 |
        +--------+---------+
        |                  |
 response window       activity store
 Simple/Comprehensive   current run only
~~~

Each saved agent connection contains:

- executor type;
- provider-owned login status;
- selected workspace path;
- permission profile;
- model and supported reasoning effort;
- display label, health, and diagnostics;
- active/inactive state.

The manager snapshots these fields before execution. Changes made during a run apply only to the
next run. The main process, not a renderer, validates connection state, workspace state, activity
events, and permission selection.

Public connection snapshots omit executor-private `options` entirely. A renderer receives only the
explicit public fields required to display or select a connection. Future executor-specific display
metadata requires a new named allowlisted public field and adversarial serialization tests; it is
never exposed by recursively cloning an internal options object.

## Permission profiles

### Workspace Agent

Workspace Agent is the default. It may inspect, create, edit, delete, and run commands inside one
user-selected workspace. Filesystem reads and writes outside that workspace and child-command
network access remain blocked, apart from the minimum executable, runtime, and opaque authentication
paths required to start the official CLI. This boundary must be enforced by the executor, operating
system, or a verified permission profile; a prompt instruction is not a security boundary. An
executor that cannot prove this isolation cannot advertise the Workspace Agent profile.

Codex Workspace Agent runs from an app-owned `CODEX_HOME` with the selected project explicitly
marked untrusted, project and user exec-policy rules ignored, hooks disabled, web search disabled,
and non-interactive approvals set to `never`. The project must therefore be unable to activate its
own `.codex/config.toml`, hooks, or rules or to override the app-owned permission profile. Claude
Workspace Agent runs with `--safe-mode`, strict empty MCP configuration, a minimal child environment,
and `--permission-mode dontAsk`. Hostile `.codex` and `.claude` configuration, hooks, plugins,
instructions, and settings are required isolation fixtures. If either installed CLI cannot preserve
these invariants and pass direct outside-read, outside-write, and child-network probes, Workspace
Agent is unavailable for that executor.

Non-interactive runs have no approval/resume channel in the first release. Any action that would
require additional authority is rejected by the CLI permission boundary and becomes a sanitized
`PERMISSION_BLOCKED` result. The app never waits invisibly for a terminal confirmation.

The selected workspace is visible before and during every run. A missing, moved, or inaccessible
workspace prevents the run and produces a recoverable workspace error.

### Full Computer Agent

Full Computer Agent is an advanced per-connection opt-in. It may receive broad filesystem, command,
and network authority supported by the executor. Enabling it requires a separate warning and
explicit confirmation. Settings and the live response window display a persistent Full Computer
badge while it is active.

Only the Electron main process can authorize this transition. It handles a sender-validated request
containing the connection ID and requested profile, re-reads the current connection, and opens a
native confirmation dialog parented to Settings. A renderer cannot submit `fullAccessConfirmed`, a
confirmation token, or a persisted boolean as proof. Main records confirmation only after the native
dialog accepts the same connection and requested Full Computer profile; cancellation or any changed
input fails closed.

Switching into or out of this profile never changes an in-flight run. The saved connection setting
applies to the next run snapshot.

### Deliberate attachments

A deliberate UTF-8 text-file drop remains a one-time attachment and does not silently expand the
workspace boundary. The app validates and wraps supported file content as untrusted data. Dropping
a file outside the workspace does not grant the agent traversal rights to its parent directory.

## Connection setup

The Codex/Claude setup flow is:

1. Choose Codex CLI or Claude Code CLI.
2. Launch the installed provider's official login command.
3. Check non-secret login status through the official CLI.
4. Select a workspace directory.
5. Choose Workspace Agent or advanced Full Computer Agent.
6. Select a provider-supported model and reasoning effort.
7. Test, save, and activate the connection.

Offline Demo Agent instead asks only for a label and workspace, fixes the permission profile to
Workspace Agent, advertises one `offline-demo` model with no reasoning-effort selector, and performs
no authentication, secret storage, provider lookup, or network request.

The first release does not advertise direct API connections as chat-only alternatives. A future
API executor must implement the complete agent executor contract, including tool execution,
permissions, structured activity, cancellation, and sanitized errors.

## Run lifecycle

1. A user submits a terminal prompt or deliberately drops a supported text file.
2. Main snapshots the active connection, workspace, permission profile, model, and effort.
3. No active connection opens the agent setup path.
4. A second request while a run is active returns busy and is not queued.
5. The selected executor performs a multi-step agent run within the snapshot's authority.
6. Structured activity events update both live views. Before a submitted run promise rejects to the
   loopback HTTP adapter, the prompt controller publishes one sanitized terminal failure state. The
   HTTP layer may isolate the already-published rejection after returning 202, but it may not be the
   only error observer.
7. Stop terminates the active executor and produces a stopped result without retry.
8. The final response includes executor/model attribution and a changed-file summary when known.
9. Busy state clears in a `finally` path.

## Live activity views

The response window provides a remembered Simple/Comprehensive toggle.

### Simple view

Simple is the default and shows:

- current phase, such as preparing, inspecting, editing, running, or responding;
- a short plain-language activity message;
- active executor and model;
- workspace name and permission badge;
- elapsed time and Stop.

### Comprehensive view

Comprehensive shows a timestamped, collapsible timeline containing:

- tool and command activity;
- files read, created, modified, or deleted;
- commands and exit status;
- network destinations when the executor exposes them;
- permission decisions and blocked operations;
- sanitized command output;
- token or usage information when available;
- final changed files and total duration.

Both views consume the same normalized activity events. Renderers never parse raw CLI streams.
Activity excludes credentials, authentication payloads, environment dumps, hidden model reasoning,
unsafe raw stderr, and unbounded output. Provider-visible reasoning summaries may be shown only when
they are an explicit supported output, not private chain of thought.

The normalized activity contract is a discriminated union with common `phase`, `kind`, `summary`,
optional bounded `detail`, and optional `status` fields. Exact variants add only these fields:

- `status`: no variant fields;
- `tool`: `toolName`;
- `file`: workspace-relative `path` and `operation` (`read`, `create`, `modify`, or `delete`);
- `command`: bounded `command` and optional finite integer `exitCode`;
- `network`: origin-only `destination`, with user info, path, query, and fragment removed;
- `permission`: `permission` and `decision` (`allowed` or `blocked`);
- `usage`: a numeric `usage` object with allowlisted token fields only;
- `message`: no variant fields.

One recursive sanitizer runs in main before validation, storage, subscription publication, or IPC.
It accepts only bounded strings, finite numbers, arrays, and plain objects; bounds recursion depth,
node count, string length, and event size; replaces values under credential-shaped keys; removes URL
credentials and queries; redacts tokens, authorization headers, cookies, secret-bearing command
arguments, profile paths, and environment assignments; and rejects unsupported types. Validation
then rejects unknown union fields, absolute/traversing file paths, invalid enums, and over-limit
events. Every executor mapper and the Offline Demo Agent pass through this same path.

Activity stays in memory for the current run and is cleared when dismissed or when the application
exits. Persistent run history is deferred.

Streaming JSONL has bounded individual lines and a bounded undecoded partial-line buffer, but no
whole-run byte ceiling. The activity store retains only its newest bounded event window, so a long
legitimate run does not accumulate unbounded memory or fail merely because cumulative output passes
1 MiB. Stop and timeout terminate the entire Windows process tree through a verified tree-kill
operation, then wait for exit. Killing only the immediate child is not a successful stop.

## Errors and recovery

Stable categories cover:

- CLI not installed;
- authentication required;
- workspace unavailable;
- operation blocked by permissions;
- command failure;
- request timeout;
- request stopped;
- malformed activity or provider output;
- provider connection, quota, billing, or model failure;
- encrypted store failure.

If Electron safeStorage encryption is unavailable, CLI-only and Offline Demo connection metadata
continues to load and save because it contains no secret. Any secret-bearing save, encrypted-secret
read, rotation, or migration fails closed with `SECRET_STORE_FAILED`. There is no plaintext fallback,
and an unavailable secret is never treated as an empty or disconnected credential.

The response window shows concise text and one useful recovery action. Raw stacks, credentials,
environment values, unsafe stderr, and arbitrary provider response bodies never reach a renderer.

## Incremental delivery gates

### Milestone 1: Existing pet foundation

Keep the pet window, tray, animation contract, and loopback text-prompt endpoint runnable. File-drop
integration is not part of the existing foundation.

### Milestone 2: Offline agent shell

Add Settings, workspace selection, response window, Simple activity view, and the built-in Offline
Demo Agent. This milestone is Workspace/text-only: it does not expose file submission or Full
Computer controls. The complete text-prompt experience is testable without an account or provider.

### Milestone 3: Codex Workspace Agent

Add official Codex login/status and execution inside a disposable sample workspace. Offline command
boundary tests remain canonical. When the tester is already signed in, an optional real smoke test
demonstrates file inspection, edits, commands, Stop, sanitized failures, and Comprehensive activity.

### Milestone 4: Claude Code Agent

Add the Claude Code executor behind the same contract and verify behavioral parity rather than
creating a parallel product path.

### Milestone 5: Advanced permissions and polish

Add Full Computer opt-in through the main-owned native warning, persistent permission badges, and
switching. Then add the pet renderer and deliberate safe file integration as a separate gate before
packaging. Adversarial permission/redaction tests cover both gates.

### Milestone 6: Packaged test build

Produce a Windows x64 package with clean first-run setup, offline diagnostics, repeatable test
instructions, and no embedded credentials or development-only material.

Every milestone ends with:

- a runnable application state;
- exact launch and manual-test instructions;
- focused and full automated tests;
- visual evidence;
- a BUILD_LOG checkpoint and commit;
- a user test gate before the next milestone begins.

The ownership map is singular: Tasks 6-8 own contracts, storage prerequisites, and Offline Demo;
Task 9 owns only the Workspace/text offline shell; Tasks 10-12 own hermetic Codex/Claude execution
and Comprehensive mapping; Task 13 owns every Full Computer control and authorization path; Task 14
owns every file-drop and pet-renderer path; Task 15 packages those completed product paths. No
earlier task exposes an interface whose security boundary is owned by a later task.

## Supported CLI and model baseline

The first implementation baseline is explicit and fail-closed:

- Codex CLI `>=0.144.6`; models `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`; efforts `none`,
  `low`, `medium`, `high`, `xhigh`, and `max`.
- Claude Code `>=2.1.217`; model aliases `fable`, `opus`, and `sonnet`; efforts `low`, `medium`,
  `high`, `xhigh`, and `max`.
- Offline Demo Agent model `offline-demo`; no effort values.

Registries are exact constants covered by tests. Setup diagnostics reject older CLI versions before
login or execution, and a listed model that is unavailable to the current account produces
`MODEL_UNAVAILABLE`; the app neither invents model IDs nor silently falls back. Updating a registry
or minimum version is an explicit tested product change.

## Required corrections from plan review

The canonical spec, context, research, and implementation plan must incorporate these verified
corrections while adopting the agent-first design:

1. Electron asynchronous safeStorage decryption returns `{ result, shouldReEncrypt }`; the crypto
   wrapper must return `result`, handle re-encryption deliberately, and test the real return shape.
2. Public connection metadata must be constructed from an explicit field allowlist, omit internal
   options, and never expose data by recursively cloning an executor-private object.
3. Codex tool use is intentional. The plan must replace the old no-tool assumption with the
   permission profiles and agent observability contract above.
4. The Offline Demo Agent must support a deterministic delayed run so Stop and cancellation are
   testable.
5. Task ownership tables must assign the pet renderer/file boundary and response/activity window to
   their actual milestones consistently.
6. The packaged application directory must use one canonical name in interfaces, scripts, tests,
   verification instructions, and README text.
7. Workspace executors must ignore hostile project configuration and use explicit fail-closed
   non-interactive permission policies.
8. Activity must use the discriminated union and recursive sanitizer defined above before storage or
   IPC; public connection snapshots must omit internal options.
9. Full Computer authorization must be main-owned and native-dialog-backed; renderer state is never
   proof of confirmation.
10. Task 9 remains Workspace/text-only, Task 13 solely owns Full Computer, and Task 14 solely owns
    file integration.
11. Stream limits must be per-line/per-retained-window, and Windows Stop must prove child and
    grandchild termination.
12. Offline Demo Agent is a supported first-release executor, not an accidentally exposed test mock.
13. Prompt-controller failures must publish sanitized terminal state before HTTP rejection isolation.
14. safeStorage unavailability must preserve non-secret metadata while secret operations fail closed
    without plaintext fallback.

## Verification contract

Required automated and manual coverage includes:

- safeStorage asynchronous return shape, unavailable encryption, rotation signal, corruption,
  removal, and no plaintext fallback;
- public connection allowlisting against unexpected secret-bearing properties;
- immutable run snapshots and one-run busy behavior;
- Workspace Agent write denial outside the selected workspace;
- Full Computer Agent confirmation and visible warning;
- permission changes affecting only the next run;
- CLI environment minimization and provider-profile isolation;
- hostile `.codex`/`.claude` config, hook, rule, plugin, instruction, and settings fixtures that
  cannot change permissions, add tools, or execute a sentinel;
- explicit Codex `never` and Claude `dontAsk` non-interactive denial behavior;
- Simple and Comprehensive parity over one structured activity stream;
- recursive redaction of keys, tokens, credentials in commands/URLs/headers/cookies/paths/nested
  values, environment dumps, hidden reasoning, raw stderr, and oversized output;
- exact union rejection for unknown fields and unsafe file/network representations;
- deterministic delayed-run Stop without retry;
- a real Windows child/grandchild process-tree Stop test;
- no-provider/offline shell behavior through the shipped Offline Demo Agent;
- controller-level terminal failure publication before the prompt server isolates rejection;
- signed-out Codex visual evidence through a deterministic development-only fake runner that is
  rejected by packaged builds;
- real Codex and Claude execution only as optional smoke tests when accounts already exist;
- Windows package launch with an empty connection store and no embedded credentials.

No milestone is complete until its runnable state, automated results, visual evidence, manual test
checklist, clean Git state, and commit are recorded.

## Deferred work

- App-owned tool loops for direct OpenAI, Anthropic, and custom compatible API executors.
- Multiple simultaneous agents or queued runs.
- Scheduled autonomous work.
- Persistent activity or conversation history.
- Remote control, cloud sync, telemetry, or team sharing.
- Signed installer and public distribution.
