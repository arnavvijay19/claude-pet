# Claude Pet Security and UI Hardening Design

**Date:** 2026-07-29  
**Status:** Approved direction; written specification awaiting user review  
**Base:** `f2ce720`

## Purpose

Make Claude Pet safer and easier to use without changing what its agent runtime does. This work
first closes the twelve findings recorded in the read-only local review, then improves attachments,
Settings, session management, and visible feedback in the unified window.

The implementation must not read from, write to, launch, stop, or otherwise alter WorkBuddy AI.
It must not edit `.workbuddy-ai/`, `LOCAL_PR.html`, or
`C:\Users\eklip\Desktop\review_findings.json`.

## Product decisions

1. Security fixes land before renderer improvements.
2. The loopback prompt endpoint is disabled in normal packaged launches because it has no current
   in-app consumer. An explicit integration launch must supply a fresh high-entropy token; the
   server never generates a token that then needs a new distribution channel.
3. Attachments remain one deliberate file at a time and contain bounded UTF-8 text. Common source,
   configuration, data, Markdown, and log formats are supported. PDF, Office, archives, audio,
   video, and images remain unsupported until a separate extraction and multimodal design exists.
4. Choosing a file stages it in the composer. It does not immediately submit a standalone agent
   request.
5. Settings uses two primary scopes: **Agent settings** and **Session settings**. Connections are
   edited in the Agent scope because the selected participant determines the provider, model, and
   access boundary for its next turn.
6. Existing encrypted stores, sequential selected-participant routing, Full Computer confirmation,
   official provider authentication, activity sanitization, and single-run behavior remain
   authoritative.

## Phase 1: security stabilization

### Authenticated, bounded loopback prompt

`POST /prompt` is not started unless an explicit integration launch supplies:

- an allowed loopback port; and
- a high-entropy prompt token through a non-persisted launch environment value.

The launcher is responsible for generating a fresh token for that launch. The token must never
enter renderer state, logs, errors, snapshots, provider environments, or persisted app files.
Starting an explicit prompt port without a valid token fails closed.

An enabled server:

- binds only to `127.0.0.1`;
- accepts only `POST /prompt`;
- requires an exact loopback `Host`, no browser `Origin`, `application/json`, and an exact custom
  token header compared without timing-dependent string equality;
- counts raw bytes before concatenation and rejects the request before the cap is exceeded;
- applies short header, request, keep-alive, and socket limits plus a bounded number of requests per
  connection; and
- returns a bounded public error without echoing submitted content or credentials.

This preserves an explicit hook/integration path without leaving an unauthenticated Full Computer
command surface open for every user.

### One goal-size contract

A small shared module defines `MAX_GOAL_BYTES = 8192` and validates a well-formed, non-empty UTF-8
goal before state changes. The HTTP route, app intent boundary, visible request tracker,
coordinator/session persistence, retries, and attachment-combined submission use that validator.
Validation is byte-based, not character-based.

The visible request tracker mutates only after validation succeeds. Snapshot notice construction
also bounds its optional request independently, so a bad internal caller cannot prevent later
snapshot publication.

### Provider process lifecycle

The CLI runner installs stdin error handling before writing the goal. An early provider exit or
`EPIPE` becomes `COMMAND_FAILED` only while the run remains unsettled; it cannot become an uncaught
main-process stream error or double-settle a completed run.

The local provider probe uses one owned abort controller for caller cancellation and its deadline.
The default spawn path retains the child handle, handles stdin failure, terminates the complete
verified process tree when cancellation wins, waits for exit, and only then closes loopback
servers and removes temporary files.

Before invoking process-tree termination, main verifies that the PID still resolves to the exact
canonical executable captured for the run. A missing original process is success. A mismatched or
unverifiable replacement fails closed without targeting it. `taskkill.exe` is invoked by its
absolute System32 path with no shell. Regression coverage includes original-process exit followed
by simulated PID reuse.

### Production encryption and persisted input limits

Production imports and uses `createSafeStorageCrypto(safeStorage)` rather than an inline adapter.
The shipped wiring therefore exercises asynchronous decryption and stale-ciphertext rotation.

Ciphertext validation rejects canonical base64 whose encoded length exceeds the bounded plaintext
limit plus a documented encryption-overhead allowance before cloning, decoding, decrypting, or
parsing it.

### Probe environment and package verification

The provider probe builds a minimal environment allowlist containing only required Windows process,
temporary-directory, owned provider-home, and fixed probe variables. Generic credentials,
passwords, tokens, cloud keys, proxy/certificate overrides, and unrelated host configuration are
not inherited.

Package verification stream-scans every file with a text/source extension regardless of size. A
read or decoding failure is a verification failure. There is no silent size-based bypass.

### Attachment authorization boundary

One shared attachment policy owns:

- the accepted extension allowlist;
- the 256 KiB cap;
- regular-file and exact-size checks;
- fatal UTF-8 decoding and NUL rejection; and
- the public accepted-format description.

The main-window picker and pet drop use the same policy. A filtered picker improves discovery but
is not treated as enforcement.

Pet drops never authorize a renderer-supplied absolute path by themselves. Main opens and validates
the file, presents a native confirmation naming only the file and bounded disclosure, then creates
a one-use main-owned pending attachment. Cancellation or any file change closes the handle and
invalidates the pending attachment.

## Phase 2: unified-window improvements

### Composer and attachment experience

The composer changes `Attach text file` to **Attach file** and presents the accepted readable
formats and 256 KiB limit in plain language. A selected file appears as a removable chip with its
basename and size.

Send combines the user's current text with the main-owned attachment content at submission time.
The visible user turn shows the user's text plus safe attachment metadata, not the escaped internal
prompt envelope or absolute path. A staged attachment is single-use and is cleared only after a
successful handoff. Retry repeats the same visible request and authorized attachment content
without reopening an arbitrary path.

The initial allowlist includes:

- text and documentation: `.txt`, `.md`, `.rst`, `.log`;
- data and configuration: `.json`, `.jsonl`, `.csv`, `.tsv`, `.xml`, `.yaml`, `.yml`, `.toml`,
  `.ini`, `.cfg`, `.conf`;
- web and styles: `.html`, `.htm`, `.css`, `.scss`;
- common source and scripts: `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.tsx`, `.py`, `.java`, `.c`,
  `.cc`, `.cpp`, `.h`, `.hpp`, `.cs`, `.go`, `.rs`, `.rb`, `.php`, `.sql`, `.sh`, `.ps1`.

Files still have to pass bounded fatal UTF-8 validation; an allowed extension never authorizes
binary content.

### Settings information architecture

Settings opens with two keyboard-accessible tabs:

#### Agent settings

- **Active agent:** edit name and encrypted instruction, with byte count and explicit Save.
- **Assigned connection:** choose the saved connection used by this agent in the selected session.
- **Provider connections:** readable cards showing provider, workspace, model, effort, access, and
  readiness actions.
- **Add or edit a connection:** one guided editor for Codex or Claude Code with provider-specific
  allowlisted models and efforts, a main-owned folder picker, permanent Full Computer warning, Test,
  and official sign-in.
- **Agent library:** create another named agent and add an eligible agent to the session.

Offline Demo stays visibly account-free and Workspace-only. Real-provider Workspace remains
unavailable until its separate WSL boundary exists and never silently falls back.

#### Session settings

- **Session details:** rename the selected session, show its workspace and update information, and
  provide a main-owned folder chooser only where a new connection/session flow supports changing
  the workspace safely.
- **Participants:** show each participant and its assigned connection; select or remove a
  non-final participant using existing coordinator rules.
- **Danger zone:** delete the selected session only after a main-owned confirmation. The next
  surviving session becomes selected; an empty state provides one valid next action.

Destructive actions are not represented as already authorized renderer state.

### Missing daily-use behavior

The implementation also restores small, previously designed capabilities that the current
renderer never exposed:

- rename and delete the selected session;
- edit the active agent's instruction rather than creating instruction-empty agents forever;
- browse for project folders instead of requiring manual Windows path entry; and
- show connection/session action failures visibly instead of only in the screen-reader status node.

No agent deletion control is added in this pass. The store correctly prevents deleting identities
still referenced by participants or history, and exposing a mostly unavailable destructive action
would add confusion without solving a current workflow.

### Draft and feedback preservation

Incoming activity snapshots must not erase:

- an unsent composer message;
- a staged attachment;
- an active connection edit;
- an active agent edit; or
- the selected Settings tab.

Renderer draft state is keyed to the relevant session, agent, or connection ID and is never
security-authoritative. It resets after a successful mutation, an explicit cancel/clear, or a
genuine selection change.

The hidden polite live region remains for assistive technology. A visible bounded status banner
adds plain-language success, failure, pending, and recovery feedback near the current action.
Focus moves to a meaningful target after tab switches, confirmed deletion, and validation errors.

## Components and data flow

### Main-owned components

- `goalLimits`: byte-based validation shared by every submission path.
- `promptServer`: optional authenticated integration boundary.
- `attachmentPolicy` and attachment authorization: accepted formats, bounded reading, native
  confirmation, and one-use pending content.
- `appWindow`: narrow intents for folder choice, attachment stage/clear, session rename/delete,
  agent update, and existing provider actions.
- process lifecycle helpers: stdin failure handling, abort ownership, executable identity check,
  and absolute process-tree termination.
- production runtime wiring: tested safeStorage adapter.

### Renderer-owned presentation

- `conversation`: draft-preserving composer, pending attachment chip, visible submission errors.
- `settings`: Agent/Session tabs and scoped forms.
- `sidebar`: session menu with rename/delete entry points while retaining quick selection.
- `app`: bounded draft and visible feedback coordinator.

The renderer may hold text drafts and presentation selection. It never holds an attachment path,
file bytes, authorization token, encryption state, process identity, provider credential, or
Full Computer confirmation proof.

## Error handling

- Invalid goals and attachments fail before visible-request or session mutation.
- An attachment that changes between selection and consumption is rejected and cleared.
- Cancellation leaves the composer text intact and does not start a run.
- Provider process failures settle once and always release listeners, timers, handles, and owned
  temporary state.
- A failed executable identity check does not kill a process.
- Failed Settings actions retain the user's draft and show a nearby recovery message.
- Session deletion cannot occur while busy or without native confirmation.
- Snapshot publication remains possible even when optional notice data is malformed or oversized.

## Testing and evidence

Implementation follows red-green tests in this order:

1. Prompt authentication, Host/Origin/content-type checks, body cap, timeouts, and disabled default.
2. Shared goal-byte validation and fail-safe notice publication.
3. CLI stdin `EPIPE`, probe timeout/abort cleanup, process identity, and absolute `taskkill`.
4. Production safeStorage rotation wiring, ciphertext cap, probe environment allowlist, and
   large-file package scan.
5. Attachment extension enforcement, pet confirmation, changed-file rejection, stage/clear/send,
   visible metadata, and retry.
6. Agent/Session Settings tabs, agent editing, provider-specific connection editor, session
   rename/delete, folder picker, visible feedback, focus behavior, and draft preservation.

Final verification requires:

- focused tests for every review finding;
- the complete serial Node suite and Python suite;
- package verification and a fresh package build;
- `git diff --check`;
- exact 900×650 and 1440×900 screenshots of conversation, staged attachment, Agent settings, and
  Session settings;
- an account-free fresh-profile Offline Demo walkthrough covering first run, follow-up, staged
  attachment, agent edit, session rename, restart/restore, and confirmed session deletion; and
- a repository check proving `.workbuddy-ai/`, `LOCAL_PR.html`, and
  `review_findings.json` were not modified.

Real Codex/Claude execution, provider sign-in, WSL installation, PDF/Office/image extraction,
parallel agents, schedules, cloud sync, and WorkBuddy integration are outside this scope.

## Review finding coverage

| Finding | Design response |
|---|---|
| R1 | Disable loopback by default; explicit fresh-token integration launch and strict request authentication |
| R2 | Raw-byte cap plus header/request/socket/keep-alive/request-count limits |
| R3 | Shared 8192-byte goal validator before mutation and independently bounded notices |
| R4 | Install stdin error handling before write and settle `EPIPE` safely |
| R5 | Owned deadline abort, verified tree termination, awaited exit before cleanup |
| R6 | Exact executable identity check plus absolute System32 `taskkill.exe` |
| R7 | Production `createSafeStorageCrypto(safeStorage)` wiring and rotation test |
| R8 | Minimal probe environment allowlist |
| R9 | Encoded ciphertext cap before clone/decode/decrypt |
| R10 | Shared extension policy and main-owned pet-drop confirmation/one-use authorization |
| R11 | Fail-closed streaming scan for all package text/source files |
| R12 | Update the canonical architecture map to the unified app window and preload |

