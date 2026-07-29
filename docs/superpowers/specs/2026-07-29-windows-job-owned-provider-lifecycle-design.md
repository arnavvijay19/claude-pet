# Windows Job-Owned Provider Lifecycle Design

**Status:** User-approved revision; implementation not started
**Date:** 2026-07-29
**Scope:** Native Windows Codex/Claude process launch, Stop, timeout, cleanup, and the limits of those guarantees

## Decision

Claude Pet will not merge hypothetical commit `1f55f90` as written. That patch retains a verified
handle to the provider root, but normal production calls do not supply descendant PIDs. A
production-like diagnostic killed a PowerShell root while leaving its `ping.exe` child alive.
The optional descendant-PID path also opens each PID without binding it to executable identity,
creation time, or ancestry, so PID reuse can still target an unrelated process.

Instead, each real native provider run and provider probe will start inside an app-owned Windows
Job Object. The app will terminate the assigned job as one kernel-managed unit. No assigned
provider process will be killed through a PID that was validated earlier and reused later.

This is lifecycle ownership, not a security sandbox. It strongly owns the provider root and
ordinary `CreateProcess` descendants that Windows associates with the job. It cannot prove
ownership of work deliberately or incidentally created through WMI, services, scheduled tasks,
shell brokers, already-running applications, or another mechanism outside the job. It cannot undo
filesystem, registry, network, account, or remote side effects that occurred before Stop.

## Goals

1. Stop, timeout, provider-output failure, probe cancellation, helper failure, and app exit
   terminate every process that Windows assigned to the provider Job Object.
2. Assign the provider root to its Job Object before it can execute provider or user code.
3. Preserve the existing verified native-CLI lease through successful provider creation.
4. Preserve byte-for-byte stdin, stdout, and stderr behavior expected by `cliRunner`.
5. Preserve hidden normal runs and the existing explicitly visible setup/login path.
6. Fail closed if the Job Object, launch handshake, executable assignment, or cleanup of the
   assigned job cannot be proven.
7. Avoid runtime PowerShell, `Add-Type`, downloaded dependencies, and broad handle inheritance.
8. State unprovable limits in code, tests, documentation, and user-facing failure behavior instead
   of turning them into absolute claims.

## Non-goals

- This task does not make native providers trustworthy or turn Full Computer into a sandbox.
- It does not prevent provider code from accessing resources already permitted by its Windows user
  and permission profile.
- It does not discover or kill arbitrary same-user processes that may have been launched outside
  the job.
- It does not promise to reverse side effects after provider termination.
- It does not redesign the window, pet, composer, Settings, sessions, or provider UX.
- It does not enable real-provider Workspace mode, WSL, parallel agents, schedules, or direct APIs.
- It does not change provider model registries, login ownership, goal limits, or activity schemas.
- It does not modify `.workbuddy-ai/`, `LOCAL_PR.html`, or the hypothetical review worktree.

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

### 3. Runtime PowerShell plus `Add-Type`

Rejected after compatibility review. Enterprise App Control or AppLocker can force PowerShell
Constrained Language Mode, which blocks arbitrary C# and Win32 interop through `Add-Type`. Group
Policy can also override process-scope execution-policy choices. `-ExecutionPolicy Bypass` is
therefore neither a reliable compatibility mechanism nor a security design.

### 4. Precompiled native helper plus a Windows Job Object

Selected. Windows Job Objects are designed to manage associated processes as a unit. A provider
assigned before resume brings ordinary descendants into the same job unless a supported escape
path is used. Claude Pet will set no breakaway permission and will terminate the assigned job on
every terminal path.

The helper will be compiled at development/package time and included in the packaged application.
End users will not need PowerShell, a compiler, or a new runtime.

## Guarantee boundary

The phrase **provider stopped** means:

- the provider root was assigned before resume;
- the app requested termination of the private Job Object;
- Windows reported no processes remaining in that assigned job; and
- the app closed its retained native handles.

It does **not** mean:

- no provider-created work exists outside the job;
- network requests or remote operations were rolled back;
- files, registry values, services, tasks, browser state, or credentials were restored;
- an already-running browser or broker was terminated; or
- malicious code was contained.

The Full Computer warning remains required. If future product requirements demand containment of
filesystem, registry, network, services, or brokered processes, that is a separate sandbox design,
not an extension of this Stop implementation.

## Known Windows escape and compatibility limits

Windows normally associates child processes with their parent's job, but documented exceptions
matter:

- a child created through `Win32_Process.Create` is not automatically associated with the job;
- breakaway can occur when a containing job allows it, so this helper enables neither breakaway
  flag;
- some third-party software expects to place its own child in a job and may fail when Claude Pet's
  non-breakaway job prevents that arrangement;
- nested-job behavior depends on supported Windows versions and any job already containing the
  Electron app; and
- shell, browser, service, WMI, scheduled-task, and application brokers can create or reuse a
  process outside the provider job.

Claude Pet currently uses Electron 43, which requires Windows 10 or later. This implementation
targets supported Windows 10 and Windows 11 systems. Unsupported Windows versions are outside the
compatibility claim.

An expected-escape fixture will document at least one out-of-job creation path. The test succeeds
when the assigned job is cleaned and the external fixture is detected and safely cleaned by its
own test harness. Production code must not imitate that cleanup by scanning or killing arbitrary
processes.

## Architecture

### `resources/windows/provider-job-host.cs`

A source-controlled C# helper will be compiled into `provider-job-host.exe` before development
launches, tests that exercise it, and Windows packaging. The build script will use an explicitly
resolved local compiler, fixed options, warnings-as-errors, and no downloaded packages. A missing or
unsupported compiler fails the developer build with a bounded diagnostic. The packaged app
contains the resulting executable, so the end-user machine does not compile source.

The helper will:

1. Read one bounded, versioned launch envelope from stdin before accepting any provider stdin.
   The envelope contains only the already-validated provider executable path, arguments, working
   directory, visibility flag, Electron owner PID, and expected Electron executable path. Goals,
   credentials, and environment values are forbidden.
2. Open and bind a synchronization handle to the still-running expected Electron owner before the
   provider resumes. The PID is used once to bind a live kernel handle and matching executable
   identity; it is never used later as a kill target.
3. Create a private, unnamed Job Object with
   `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` and neither breakaway flag.
4. Create the exact provider executable suspended using an explicit `lpApplicationName`.
5. Use `STARTUPINFOEX` with `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` so the provider inherits only its
   stdin, stdout, and stderr handles. Job, owner, helper, event, thread, and process handles remain
   non-inheritable.
6. Assign the suspended provider to the job. Any assignment failure terminates the suspended
   provider and returns a fixed failure without running provider code.
7. Emit one bounded ASCII readiness record on stderr only after successful assignment, then resume
   the provider and forward all subsequent stdin bytes exactly.
8. Wait on retained owner and provider handles. Owner exit terminates the job. Provider-root exit
   also terminates the job so ordinary surviving descendants cannot outlive a completed root.
9. Wait for the assigned job to report empty, obtain the root exit code when available, and close
   every native handle deterministically.

The helper will use safe-handle ownership and exact Win32 error checks. It will not enumerate the
system process table, terminate arbitrary PIDs, enable breakaway, invoke a shell, or accept a
provider command line as one reparsed string.

### `scripts/build-provider-job-host.js`

The build script will:

- run only on Windows and resolve a supported local .NET Framework C# compiler from an allowlisted
  absolute system location;
- compile the fixed source file to a fixed generated path without network access;
- emit a hash and compiler-version record used by package verification;
- fail if warnings, unexpected output paths, or source drift are detected; and
- be wired into `prestart`, the relevant test setup, and the Windows packaging command so a stale
  helper cannot be silently reused.

The generated executable is a build artifact, not handwritten source. Tests may compile to an
isolated temporary output. Packaging must prove that the included helper was generated from the
current source.

### `src/agent/windowsJobProcess.js`

This main-process-only adapter will:

- validate and bound the launch envelope;
- launch the absolute packaged helper with a minimal environment and `shell: false`;
- write the envelope as the first framed stdin message, then wait for readiness before allowing
  `cliRunner` to send provider input;
- consume and remove exactly one readiness record without exposing it as provider stderr;
- preserve output emitted immediately after readiness;
- return the helper `ChildProcess` plus its retained identity for later verification; and
- abort and reap the helper on malformed output, premature exit, timeout, or stream-bound failure.

The launch envelope is not placed in arguments or environment variables. The readiness parser
pauses stderr and restores bytes received after the record before returning the child, so a fast
provider cannot lose or reorder output. The framing implementation must prove it does not pre-read
or consume the first bytes of the provider goal.

### Existing lifecycle integration

`cliRunner` and `localProviderProbe` will use the Job Object adapter for real provider processes.
The existing native executable lease remains held until the helper reports that the exact provider
process was created and assigned. The lease can then release because Windows has already opened the
provider image for that process.

`windowsProcessTree` becomes a narrow last-resort helper terminator: it validates the retained
helper identity and terminates only its retained process handle. Helper death closes the Job Object
handle, which terminates processes assigned to that job. Production code will no longer accept
caller-supplied descendant PIDs.

Short-lived app-owned system tools that do not execute provider or user work, such as the bounded
absolute `where.exe` resolver, remain outside this provider Job Object path.

## Data flow

1. Electron main validates the provider connection, permission, model, workspace, and exact
   executable lease.
2. `cliRunner` asks `windowsJobProcess` to launch the already-validated provider specification.
3. The helper binds the live Electron owner, creates the Job Object and suspended provider,
   assigns it, reports ready, and resumes it.
4. `cliRunner` attaches its existing bounded stream handlers and sends the goal only through stdin.
5. Normal completion returns the provider root exit code only after the assigned job reports empty
   and its handles have been closed.
6. Stop, timeout, malformed output, probe abort, or app cleanup terminates the retained helper.
   Closing the helper-owned Job Object terminates processes assigned to it.

No renderer receives launch envelopes, PIDs, native handles, raw provider streams, or helper
diagnostics.

## Failure behavior

- Owner binding, Job Object creation, limit configuration, provider creation, handle-list setup,
  assignment, or resume failure:
  `COMMAND_FAILED`; the provider never runs unassigned.
- Invalid or oversized helper readiness output: `COMMAND_FAILED`; terminate and reap the
  helper/job.
- Provider timeout or user Stop: preserve the existing public `REQUEST_TIMEOUT` or `RUN_STOPPED`
  result only after the assigned job is empty.
- Assigned-job cleanup cannot be proven: return fixed `COMMAND_FAILED`; never report successful
  Stop.
- Helper exits before readiness: fixed `COMMAND_FAILED`, with no raw Win32 error crossing the
  public error boundary.
- Enterprise policy or a containing job prevents assignment: fail closed and show the existing
  stable public failure; do not fall back to direct spawn or PID enumeration.
- A documented out-of-job action is observed: do not scan for or kill it. Record a bounded
  diagnostic for development tests and preserve the product's existing untrusted-provider warning.

## Test design

Implementation must use witnessed red-green tests.

### Focused unit and integration coverage

- A real non-Node parent that starts `ping.exe`, with no descendant PIDs supplied: abort must
  terminate both assigned processes.
- A provider that launches two generations of ordinary descendants: Stop, timeout, malformed
  output, helper termination, app-owner exit, and natural root exit must leave the assigned job
  empty.
- Provider creation is suspended until successful job assignment.
- Assignment failure proves the provider fixture never executes.
- No implementation path invokes `taskkill`, accepts descendant PIDs, or enumerates the system
  process table.
- The provider inherits exactly three standard handles; a canary inheritable handle is not leaked.
- Explicit executable paths containing spaces and adversarial quoting reach the intended fixture
  without command-line reparsing.
- Fast provider stdout/stderr immediately after readiness is neither lost nor polluted by the
  helper record.
- Split, duplicated, and oversized readiness records fail closed within bounds.
- Stdin goals remain byte-exact and absent from arguments, environment, and public activity.
- Hidden and explicitly visible launches retain their current behavior in fixtures.
- Lease release occurs only after exact provider creation and assignment.
- Helper PID replacement cannot redirect retained-handle termination.
- A containing-job/nested-job fixture either succeeds safely or fails closed without running the
  provider.
- A WMI/brokered escape fixture remains outside the job and is identified as outside the Stop
  guarantee; only the isolated test harness cleans it up.

### Full automated verification

- Focused lifecycle tests.
- Full serialized Node suite.
- Python tests when the configured Python runtime is available.
- C# compile with warnings-as-errors, source syntax, and `git diff --check`.
- Fresh Windows package build, not reuse of a package built from an earlier commit.
- Package verifier confirms the current helper source/hash/build record are present and forbidden
  development/review artifacts are absent.
- Fresh-profile packaged Offline Demo smoke test to prove the non-provider path is unchanged.
- Packaged fake-provider Stop/timeout test proving cleanup of every process assigned to the job.
- Windows 10 and Windows 11 coverage when release infrastructure can provide both; otherwise the
  untested system remains an explicit release limitation.

Automated tests may prove the assigned-job contract. They cannot prove that every provider version,
enterprise policy, antivirus product, login broker, or human workflow behaves acceptably.

## Human-only compatibility and release gates

These gates require opt-in human action on sacrificial or clean test profiles. Automation must not
sign into a real account, mutate a real workspace, weaken security policy, or dismiss a security
warning on the user's behalf.

1. **Real Codex and Claude login:** verify each supported CLI's visible login flow, browser handoff,
   cancellation, app exit, and successful return. Confirm Claude Pet does not close or corrupt an
   already-running user browser. A browser may be created inside the job, reused outside it, or
   launched through a broker; record the observed behavior rather than assuming it.
2. **Provider-version compatibility:** repeat the login and Stop matrix when the supported
   Codex/Claude CLI versions or their launch behavior changes. Fake fixtures do not certify a new
   provider release.
3. **Hardened Windows:** test the signed packaged build under standard-user Windows and, when that
   is part of the distribution target, at least one representative AppLocker/App Control/Defender
   or enterprise-managed environment. Policy diversity prevents a universal compatibility claim.
4. **Reputation and malware screening:** scan the exact packaged artifact, review detections, and
   code-sign every distributed release. No unit test or model review can promise zero antivirus or
   EDR false positives.
5. **Crash and power-loss drills:** on sacrificial fixtures only, test Electron crash, helper
   crash, forced logoff, and reboot/power interruption. Job cleanup can be tested for process
   death; rollback of already-written state is out of scope.
6. **Usability and accessibility:** have a person verify that Stop, cleanup failure, visible login,
   and the Full Computer warning are keyboard-accessible and understandable. In particular, users
   must not read “provider stopped” as “all side effects were undone.”
7. **Unusual provider behavior:** manually observe a provider using shells, WMI, browser brokers,
   updaters, or helpers that create their own jobs. Decide whether incompatibility is acceptable;
   do not silently loosen the non-breakaway policy.

These checks are release evidence, not permission to sign in, change enterprise policy, upload a
package, or purchase a signing certificate automatically.

## Distribution and reputation

The current local package is an unsigned private test build. Windows SmartScreen gives unsigned
downloads no established reputation, a new unsigned version starts over, and enterprise policy may
remove the user's ability to bypass the warning. Smart App Control can also block unknown unsigned
code.

The helper's recorded hash detects stale or corrupted build output; it is not an anti-tamper
boundary when an attacker can modify both the helper and verifier. Public distribution requires a
code-signing plan that signs the application, helper, installer/package, and every release artifact
that Windows evaluates. Self-signed certificates are acceptable only for isolated development.

## Acceptance criteria

The implementation is acceptable only when:

1. The reproduced parent-orphan case is red before the change and green afterward for processes
   assigned to the job.
2. Every real native provider/probe root is assigned to a non-breakaway Job Object before resume.
3. Every terminal path proves the assigned job is empty or reports a fixed cleanup failure.
4. No production termination depends on a previously observed bare PID or system-wide process
   enumeration.
5. Provider handle inheritance is restricted to the three redirected standard handles.
6. The exact executable lease, stdin-only goal contract, minimal environment, public error
   boundary, and renderer isolation remain intact.
7. A freshly rebuilt package contains and successfully exercises the helper generated from current
   source.
8. The documented escape fixture demonstrates that the UI and docs do not overstate Stop as a
   sandbox or rollback mechanism.
9. The applicable human-only gates are recorded before claiming real Codex/Claude login
   compatibility or public-distribution readiness.
10. Canonical architecture documentation and `PROJECT_CHECKLIST.html` are refreshed only after the
    implementation, package evidence, and required human gates pass.

## Sources informing the revision

- Microsoft: Job Objects and documented child-association/breakaway behavior:
  <https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects>
- Microsoft: nested Job Object behavior:
  <https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs>
- Microsoft: `CreateProcessW`, explicit application names, and inherited-handle behavior:
  <https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw>
- Microsoft: restricted handle inheritance with `STARTUPINFOEX`:
  <https://learn.microsoft.com/en-us/windows/win32/procthread/creating-processes>
- Microsoft: Constrained Language Mode and App Control:
  <https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules/useconstrainedlanguagemode?view=ps-modules>
  <https://learn.microsoft.com/en-us/powershell/scripting/security/app-control/how-app-control-works?view=powershell-7.6>
- Microsoft: execution-policy precedence and Group Policy:
  <https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/set-executionpolicy?view=powershell-7.5>
  <https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_group_policy_settings?view=powershell-7.5>
- Microsoft: SmartScreen reputation, signing, and Smart App Control:
  <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation>
  <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options>
  <https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview>
- Electron: Windows 10 or later is required from Electron 23 onward:
  <https://www.electronjs.org/docs/latest/breaking-changes>

## Implementation boundary

This document authorizes planning, not code changes. The next step after user review is a detailed
implementation plan with explicit red-green checkpoints. Implementation begins only after that plan
is reviewed through the normal project gate.
