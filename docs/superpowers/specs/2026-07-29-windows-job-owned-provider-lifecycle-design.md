# Windows Job-Owned Provider Lifecycle Design

**Status:** Approved direction; implementation not started
**Date:** 2026-07-29
**Scope:** Native Windows Codex/Claude process launch, Stop, timeout, and cleanup

## Decision

Claude Pet will not merge hypothetical commit `1f55f90` as written. That patch retains a verified
handle to the provider root, but normal production calls do not supply descendant PIDs. A
production-like diagnostic killed a PowerShell root while leaving its `ping.exe` child alive.
The optional descendant-PID path also opens each PID without binding it to executable identity,
creation time, or ancestry, so PID reuse can still target an unrelated process.

Instead, every real native provider run and provider probe will start inside an app-owned Windows
Job Object. The app will terminate the job as one kernel-managed unit. No provider or descendant
will be killed through a PID that was validated earlier and reused later.

## Goals

1. Stop, timeout, provider-output failure, probe cancellation, helper failure, and app exit
   terminate the complete provider process tree.
2. Assign the provider to its Job Object before it can execute user or provider code.
3. Preserve the existing verified native-CLI lease through successful provider creation.
4. Preserve byte-for-byte stdin, stdout, and stderr behavior expected by `cliRunner`.
5. Preserve hidden normal runs and the existing explicitly visible setup/login path.
6. Fail closed if the Job Object, launch handshake, executable assignment, or cleanup cannot be
   proven.
7. Keep the implementation reviewable and packageable without a new external runtime or downloaded
   dependency.

## Non-goals

- This task does not redesign the window, pet, composer, Settings, sessions, or provider UX.
- It does not enable real-provider Workspace mode, WSL, parallel agents, schedules, or direct APIs.
- It does not change provider model registries, login ownership, goal limits, or activity schemas.
- It does not modify `.workbuddy-ai/`, `LOCAL_PR.html`, or the hypothetical review worktree.
- It does not treat PowerShell execution policy as a security boundary.

User-visible deficiencies will receive a separate runnable UX audit after this security lifecycle
repair is implemented and verified.

## Approaches considered

### 1. Merge the retained-root-handle patch

Rejected. It closes the root identity-to-kill gap but kills only the root in normal production
calls. Its test injects descendant PIDs that production does not normally know.

### 2. Enumerate descendants and retain individual process handles

Rejected. Enumeration must race process creation, process exit, and PID reuse. Adding executable,
creation-time, and parent-chain checks narrows the window but still does not make a dynamic tree one
kernel-owned unit. It also creates substantially more policy and test surface.

### 3. Own the provider tree with a Windows Job Object

Selected. Windows Job Objects are designed to manage processes as a unit. A provider assigned
before resume brings ordinary descendants into the same job unless breakaway is explicitly enabled.
Claude Pet will set no breakaway permission and will terminate or close the job on every terminal
path.

## Architecture

### `resources/windows/provider-job-host.ps1`

An app-owned Windows PowerShell 5.1 host will:

1. Load a source-controlled, bounded C# interop type from
   `resources/windows/provider-job-host.cs`.
2. Decode one bounded base64url JSON argument containing only the already-validated provider
   executable path, arguments, working directory, visibility flag, Electron owner PID, and expected
   Electron executable path. Goals, credentials, and environment values are forbidden from this
   envelope. The host inherits the already-bounded minimal provider environment and passes that
   environment through unchanged.
3. Create a private Job Object and set `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` without either
   breakaway flag.
4. Create the exact provider executable suspended with redirected standard handles.
5. Assign the suspended provider to the job. Any failure terminates the suspended process and
   returns a fixed failure without resuming it.
6. Open and retain a synchronization handle to the still-running expected Electron owner before the
   provider resumes. If owner identity cannot be bound, the provider never runs.
7. Emit one bounded ASCII readiness record on stderr only after successful assignment, then resume
   the provider.
8. Wait for either the provider root or Electron owner handle. Owner exit terminates the job.
   Provider-root exit calls `TerminateJobObject` to remove any remaining descendants. Both paths
   wait for the job to become empty before closing handles; normal completion then returns the
   provider root exit code.

The host is invoked with `-ExecutionPolicy Bypass`. Its path is resolved beneath the installed
application resources, its launch envelope is produced only by Electron main, and package
verification covers both source files. `RemoteSigned` is deliberately not used because a portable
download may mark unsigned embedded scripts as Internet-origin files.

### `resources/windows/provider-job-host.cs`

The interop type will contain only the Windows APIs needed to:

- create and configure the Job Object;
- create the provider suspended with inherited standard handles;
- assign the provider before resume;
- resume its primary thread;
- retain and wait on the Electron owner handle;
- wait for and obtain the provider root exit code;
- terminate the job and wait for it to become empty; and
- close every native handle deterministically.

The helper will use explicit safe-handle ownership and exact Win32 error checks. It will not query,
enumerate, or terminate arbitrary PIDs, and it will not enable breakaway.

### `src/agent/windowsJobProcess.js`

This main-process-only adapter will:

- validate and bound the nested launch envelope;
- launch the absolute system `powershell.exe` with a minimal environment, no shell, and the
  app-owned host script;
- consume and remove exactly one readiness record without exposing it as provider stderr;
- preserve output emitted immediately after readiness;
- return the host `ChildProcess` plus the absolute host executable used for later identity
  verification; and
- abort and reap the host on malformed output, premature exit, timeout, or stream-bound failures.

The returned standard streams remain the provider streams from `cliRunner`'s point of view.
The readiness parser pauses stderr and restores any bytes received after the record before returning
the child, so a fast provider cannot lose or reorder output.

### Existing lifecycle integration

`cliRunner` and `localProviderProbe` will use the Job Object adapter for real provider processes.
The existing native executable lease remains held until the job host reports that the exact
provider process was created and assigned. The lease can then release because Windows has already
opened the provider image for that process.

`windowsProcessTree` becomes a narrow last-resort host terminator: it validates the PowerShell host
identity and kills only the retained host handle. Host death closes its Job Object handle, which
terminates the assigned provider tree. Production code will no longer accept caller-supplied
descendant PIDs.

Short-lived app-owned system tools that do not execute provider or user work, such as the bounded
absolute `where.exe` resolver, remain outside this provider Job Object path.

## Data flow

1. Electron main validates the provider connection, permission, model, workspace, and exact
   executable lease.
2. `cliRunner` asks `windowsJobProcess` to launch the already-validated provider specification.
3. The PowerShell/C# host binds the live Electron owner, creates the Job Object and suspended
   provider, assigns it, reports ready, and resumes it.
4. `cliRunner` attaches its existing bounded stream handlers and sends the goal only through stdin.
5. Normal completion returns the provider root exit code only after the job reports empty and its
   handles have been closed.
6. Stop, timeout, malformed output, probe abort, or app cleanup terminates the retained host.
   Closing the host-owned Job Object terminates the complete provider tree.

No renderer receives launch envelopes, PIDs, native handles, raw provider streams, or helper
diagnostics.

## Failure behavior

- Owner binding, Job Object creation, limit configuration, provider creation, assignment, or resume
  failure:
  `COMMAND_FAILED`; the provider never runs unassigned.
- Invalid or oversized host readiness output: `COMMAND_FAILED`; terminate and reap the host/job.
- Provider timeout or user Stop: preserve the existing public `REQUEST_TIMEOUT` or `RUN_STOPPED`
  result only after job cleanup succeeds.
- Cleanup cannot be proven: return fixed `COMMAND_FAILED`; never report successful Stop.
- Host exits before readiness: fixed `COMMAND_FAILED`, with no raw PowerShell or Win32 error crossing
  the public error boundary.
- Enterprise policy prevents Job Object assignment: fail closed and show the existing stable public
  failure; do not fall back to direct spawn or PID enumeration.

## Test design

Implementation must use witnessed red-green tests.

### Focused unit and integration coverage

- A real PowerShell parent that starts `ping.exe`, with no descendant PIDs supplied: abort must
  terminate both.
- A provider that launches two generations of descendants: Stop, timeout, malformed output, and
  helper termination must leave none alive.
- Provider creation is suspended until successful job assignment.
- Assignment failure proves the provider fixture never executes.
- No implementation path invokes `taskkill`, accepts descendant PIDs, or enumerates the system
  process table.
- Fast provider stdout/stderr immediately after readiness is neither lost nor polluted by the host
  record.
- Split and oversized readiness records fail closed within bounds.
- Stdin goals remain byte-exact and absent from arguments, environment, and public activity.
- Hidden and explicitly visible launches retain their current behavior.
- Lease release occurs only after exact provider creation and assignment.
- Host PID replacement cannot redirect retained-handle termination.
- Natural provider-root exit still removes a surviving descendant before reporting completion.

### Full verification

- Focused lifecycle tests.
- Full serialized Node suite.
- Python tests when the configured Python runtime is available.
- Source syntax and `git diff --check`.
- Fresh Windows package build, not reuse of a package built from an earlier commit.
- Package verifier confirms the two job-host sources are present and forbidden development/review
  artifacts are absent.
- Fresh-profile packaged Offline Demo smoke test to prove the non-provider path is unchanged.
- Packaged fake-provider Stop/timeout test proving complete real process-tree cleanup.

No real Codex or Claude goal, provider sign-in, or user workspace mutation is required for this
security repair.

## Acceptance criteria

The implementation is acceptable only when:

1. The reproduced PowerShell-parent orphan case is red before the change and green afterward.
2. Every real native provider/probe launch is assigned to a non-breakaway Job Object before resume.
3. Every terminal path proves the job is empty or reports a fixed cleanup failure.
4. No provider or descendant termination depends on a previously observed bare PID.
5. The exact executable lease, stdin-only goal contract, minimal environment, public error boundary,
   and renderer isolation remain intact.
6. A freshly rebuilt package contains and successfully exercises the job host.
7. Canonical architecture documentation and `PROJECT_CHECKLIST.html` are refreshed only after the
   implementation and package evidence pass.

## Implementation boundary

This document authorizes planning, not code changes. The next step after user review is a detailed
implementation plan with explicit red-green checkpoints. Implementation begins only after that plan
is reviewed through the normal project gate.
