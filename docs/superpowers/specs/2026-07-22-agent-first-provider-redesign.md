# Claude Pet Agent-First Provider Redesign

**Date:** 2026-07-22

**Status:** Approved design; canonical plan update pending

**Supersedes:** The chat-first assumptions introduced by the 2026-07-21 provider-neutral redesign

## Purpose

Claude Pet is an all-purpose desktop agent, not a small chat client. A user should be able to give
the pet a goal, let it inspect and change a selected workspace, watch its work live at either a
simple or comprehensive level, stop it, and test useful milestones before later features are added.

The first release uses official Codex CLI and Claude Code CLI agent loops behind a shared executor
contract. Direct OpenAI, Anthropic, and custom API executors remain compatible future additions, but
they are not presented as reduced chat-only substitutes. Adding them requires a real app-owned tool
loop that satisfies the same activity, permission, cancellation, and verification contracts.

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
        /                 \
 Codex CLI executor   Claude Code executor
        \                 /
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

## Permission profiles

### Workspace Agent

Workspace Agent is the default. It may inspect, create, edit, delete, and run commands inside one
user-selected workspace. Filesystem reads and writes outside that workspace and child-command
network access remain blocked, apart from the minimum executable, runtime, and opaque authentication
paths required to start the official CLI. This boundary must be enforced by the executor, operating
system, or a verified permission profile; a prompt instruction is not a security boundary. An
executor that cannot prove this isolation cannot advertise the Workspace Agent profile.

The selected workspace is visible before and during every run. A missing, moved, or inaccessible
workspace prevents the run and produces a recoverable workspace error.

### Full Computer Agent

Full Computer Agent is an advanced per-connection opt-in. It may receive broad filesystem, command,
and network authority supported by the executor. Enabling it requires a separate warning and
explicit confirmation. Settings and the live response window display a persistent Full Computer
badge while it is active.

Switching into or out of this profile never changes an in-flight run. The saved connection setting
applies to the next run snapshot.

### Deliberate attachments

A deliberate UTF-8 text-file drop remains a one-time attachment and does not silently expand the
workspace boundary. The app validates and wraps supported file content as untrusted data. Dropping
a file outside the workspace does not grant the agent traversal rights to its parent directory.

## Connection setup

The initial setup flow is:

1. Choose Codex CLI or Claude Code CLI.
2. Launch the installed provider's official login command.
3. Check non-secret login status through the official CLI.
4. Select a workspace directory.
5. Choose Workspace Agent or advanced Full Computer Agent.
6. Select a provider-supported model and reasoning effort.
7. Test, save, and activate the connection.

The first release does not advertise direct API connections as chat-only alternatives. A future
API executor must implement the complete agent executor contract, including tool execution,
permissions, structured activity, cancellation, and sanitized errors.

## Run lifecycle

1. A user submits a terminal prompt or deliberately drops a supported text file.
2. Main snapshots the active connection, workspace, permission profile, model, and effort.
3. No active connection opens the agent setup path.
4. A second request while a run is active returns busy and is not queued.
5. The selected executor performs a multi-step agent run within the snapshot's authority.
6. Structured activity events update both live views.
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

Activity stays in memory for the current run and is cleared when dismissed or when the application
exits. Persistent run history is deferred.

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

The response window shows concise text and one useful recovery action. Raw stacks, credentials,
environment values, unsafe stderr, and arbitrary provider response bodies never reach a renderer.

## Incremental delivery gates

### Milestone 1: Existing pet foundation

Keep the pet window, tray, animation contract, prompt endpoint, and deliberate file drop runnable.

### Milestone 2: Offline agent shell

Add Settings, workspace selection, permission profiles, response window, Simple activity view, and
a deterministic mock executor. The complete experience is testable without an account or provider.

### Milestone 3: Codex Workspace Agent

Add official Codex login/status and execution inside a disposable sample workspace. Offline command
boundary tests remain canonical. When the tester is already signed in, an optional real smoke test
demonstrates file inspection, edits, commands, Stop, sanitized failures, and Comprehensive activity.

### Milestone 4: Claude Code Agent

Add the Claude Code executor behind the same contract and verify behavioral parity rather than
creating a parallel product path.

### Milestone 5: Advanced permissions and polish

Add Full Computer opt-in, persistent permission warnings, switching, richer activity details,
recovery paths, and adversarial permission/redaction tests.

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

## Required corrections from plan review

The canonical spec, context, research, and implementation plan must incorporate these verified
corrections while adopting the agent-first design:

1. Electron asynchronous safeStorage decryption returns `{ result, shouldReEncrypt }`; the crypto
   wrapper must return `result`, handle re-encryption deliberately, and test the real return shape.
2. Public connection metadata must be constructed from an explicit field allowlist rather than by
   removing only the encrypted key.
3. Codex tool use is intentional. The plan must replace the old no-tool assumption with the
   permission profiles and agent observability contract above.
4. The offline mock executor/server must support a deterministic delayed run so Stop and
   cancellation are testable.
5. Task ownership tables must assign the pet renderer/file boundary and response/activity window to
   their actual milestones consistently.
6. The packaged application directory must use one canonical name in interfaces, scripts, tests,
   verification instructions, and README text.

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
- Simple and Comprehensive parity over one structured activity stream;
- redaction of keys, tokens, environment dumps, hidden reasoning, raw stderr, and oversized output;
- deterministic delayed-run Stop without retry;
- no-provider/offline shell behavior through the mock executor;
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
