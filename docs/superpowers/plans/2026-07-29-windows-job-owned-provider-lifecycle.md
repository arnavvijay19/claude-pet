# Windows Job-Owned Provider Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PID/tree enumeration with an app-owned Windows Job Object that starts each
verified native provider suspended, assigns it before resume, and truthfully proves cleanup only for
processes assigned to that job.

**Architecture:** A source-controlled C# helper is compiled before development launches and Windows
packaging. The verified native-CLI lease launches through a Node adapter that sends one bounded
framed launch envelope to the helper; the helper binds the Electron owner, restricts inherited
handles, creates the provider suspended, assigns it to a private non-breakaway Job Object, reports
readiness, and then proxies raw standard streams. `cliRunner` terminates the retained helper
identity, whose death closes the job; it never accepts descendant PIDs or enumerates the process
table.

**Tech Stack:** Electron 43.1.1, Node.js 24, `node:test`, PowerShell only for test orchestration,
.NET Framework C# compiler at build time, Win32 `CreateProcessW`/Job Object APIs, electron-packager.

## Global Constraints

- Target supported Windows 10 and Windows 11 x64 systems; do not claim support for older Windows.
- Job Objects are lifecycle ownership, not a filesystem, registry, network, service, browser, or
  malicious-code sandbox.
- “Provider stopped” means the assigned job is empty; it never means provider side effects were
  rolled back or that brokered/out-of-job work was removed.
- Do not fall back to direct provider spawn, `taskkill`, descendant PID lists, WMI enumeration, or
  process-table scanning when helper launch or job assignment fails.
- Preserve the signed/hash/file-ID-bound native CLI lease until the helper proves the exact
  provider image was created and assigned.
- Keep goals and credentials out of arguments, launch envelopes, helper diagnostics, and public
  activity. Goals remain stdin-only.
- Provider environment remains the existing bounded minimal environment.
- The provider inherits only its stdin, stdout, and stderr pipe handles.
- Runtime code must not use PowerShell, `Add-Type`, a downloaded package, or a compiler.
- Preserve hidden normal runs and the explicitly visible Codex/Claude setup paths.
- Do not modify or stage `.workbuddy-ai/`, `LOCAL_PR.html`, or `.claude/`.
- Do not sign in, run a real provider goal, alter enterprise policy, upload a package, purchase a
  certificate, or dismiss Windows security warnings without a separate user-authorized human gate.
- Use TDD for every behavior change. At each task gate, run the exact focused command, inspect the
  diff, and commit only that task.

---

## File map

### New production files

- `resources/windows/provider-job-host.cs` — bounded launch-envelope parser, Win32 interop, private
  Job Object ownership, suspended provider creation, restricted handle inheritance, stream pumps,
  owner/provider waits, cleanup proof, and fixed helper exit codes.
- `scripts/build-provider-job-host.js` — offline compiler resolution, fixed C# compiler invocation,
  source/output hashing, and build-record generation.
- `src/agent/windowsJobProcess.js` — Node-side helper path resolution, envelope validation/framing,
  readiness parsing, stream preservation, and `{ child, execFile, providerAssigned }` launch
  result.

### New generated files

- `resources/windows/generated/provider-job-host.exe` — ignored local build artifact included in
  Windows packages.
- `resources/windows/generated/provider-job-host.build.json` — ignored source hash, executable
  hash, compiler path/version, target architecture, and protocol version.

### New test files and fixtures

- `tests/buildProviderJobHost.test.js` — compiler/build-record and stale-output behavior.
- `tests/windowsJobProcess.test.js` — Node adapter validation, readiness, framing, stream, and
  failure behavior.
- `tests/windowsJobHost.test.js` — real Windows Job Object containment and cleanup integration.
- `tests/fixtures/jobProviderFixture.js` — provider-root fixture with controlled stdin/stdout/stderr,
  child creation, inherited-handle canary, and exit modes.
- `tests/fixtures/jobProviderChild.js` — second/third-generation descendant fixture.
- `tests/fixtures/jobBrokerEscape.ps1` — isolated WMI/CIM process-creation fixture used only when the
  required Windows provider is available; the test harness retains and cleans its exact sentinel.

### Existing files changed

- `.gitignore` — ignore only the two generated helper artifacts.
- `package.json` — add helper build scripts and `prestart`/`prepackage:win` gates.
- `src/agent/nativeCliLaunchLease.js` — route lease-controlled creation through the Job launcher and
  preserve `{ child, execFile, providerAssigned }` metadata.
- `src/agent/cliRunner.js` — use the returned helper identity for termination and remove
  descendant-PID support.
- `src/agent/windowsProcessTree.js` — reduce to retained-helper identity validation and one-process
  termination; remove `taskkill` and descendant handling.
- `src/agent/localProviderProbe.js` — make its default spawn use the same Job launcher and helper
  identity contract.
- `tests/nativeCliLaunchLease.test.js`, `tests/cliRunner.test.js`,
  `tests/windowsProcessTree.test.js`, `tests/localProviderProbe.test.js`,
  `tests/codexCli.test.js`, and `tests/claudeCodeCli.test.js` — update the launch contract and prove
  setup/run/probe coverage.
- `tests/nativeFullComputerExecutors.test.js` — prove both native Full Computer executors keep
  their verified leases around job-owned probes and runs.
- `scripts/verify_package.js` and `tests/verifyPackage.test.js` — require the helper/build record and
  validate source/output hashes.
- `docs/project-context.md`, `docs/BUILD_LOG.md`, `docs/RESEARCH.md`, and
  `PROJECT_CHECKLIST.html` — update only after implementation, package, and applicable human gates
  have evidence.

---

### Task 1: Offline helper build pipeline

**Files:**

- Create: `scripts/build-provider-job-host.js`
- Create: `resources/windows/provider-job-host.cs`
- Create: `tests/buildProviderJobHost.test.js`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**

- Produces:
  `buildProviderJobHost({ sourcePath, outputDirectory, compilerCandidates, spawnSync })`
  returning frozen
  `{ sourceSha256, executableSha256, compilerPath, compilerVersion, architecture, protocolVersion }`.
- Produces executable modes:
  `provider-job-host.exe --protocol-version` writes `1\n` and exits `0`;
  any other command-line argument exits with fixed code `64`.
- Generated filenames are exactly `provider-job-host.exe` and
  `provider-job-host.build.json`.

- [ ] **Step 1: Write failing build-pipeline tests**

Add tests that inject a fake compiler for platform-neutral validation and run the real compiler only
on Windows:

```js
test('build record binds protocol, source bytes, compiler, architecture, and exe hash', () => {
  const result = buildProviderJobHost({
    sourcePath,
    outputDirectory,
    compilerCandidates: ['C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe'],
    spawnSync: fakeSuccessfulCompiler,
  });
  assert.deepEqual(Object.keys(result).sort(), [
    'architecture', 'compilerPath', 'compilerVersion',
    'executableSha256', 'protocolVersion', 'sourceSha256',
  ]);
  assert.equal(result.protocolVersion, 1);
  assert.match(result.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(result.executableSha256, /^[a-f0-9]{64}$/);
});

test('missing compiler, warning output, or missing executable fails without stale success', () => {
  assert.throws(() => buildProviderJobHost({ ...base, compilerCandidates: [] }),
    /provider helper compiler unavailable/i);
  assert.throws(() => buildProviderJobHost({ ...base, spawnSync: warningCompiler }),
    /provider helper compilation failed/i);
});
```

The Windows-only test must execute the generated helper with `--protocol-version`, assert exact
stdout `1\r\n` or `1\n`, empty stderr, and exit code `0`.

- [ ] **Step 2: Run the tests to verify RED**

Run:

```powershell
node --test --test-isolation=none tests/buildProviderJobHost.test.js
```

Expected: FAIL because the build module and helper source do not exist.

- [ ] **Step 3: Implement the bounded build script and minimal compilable helper**

Export the function and constants from the build module:

```js
const PROTOCOL_VERSION = 1;
const OUTPUT_NAMES = Object.freeze({
  executable: 'provider-job-host.exe',
  record: 'provider-job-host.build.json',
});

function buildProviderJobHost({
  sourcePath = path.join(ROOT, 'resources', 'windows', 'provider-job-host.cs'),
  outputDirectory = path.join(ROOT, 'resources', 'windows', 'generated'),
  compilerCandidates = defaultCompilerCandidates(process.env.SystemRoot),
  spawnSync = childProcess.spawnSync,
} = {}) {
  // Resolve only an allowlisted absolute candidate; hash source; compile to a fresh temporary
  // output with fixed /nologo /target:exe /platform:anycpu /optimize+ /warnaserror+ options; reject
  // nonzero status, stdout/stderr warnings, or absent output; atomically replace the generated
  // executable and JSON record; then return Object.freeze(record).
}
```

Use `fs.mkdtempSync(path.join(outputDirectory, '.build-'))` for the temporary output. Before moving,
verify the resolved output and destination remain beneath `outputDirectory`. Remove only that
verified temporary directory in `finally`; never recursively remove `resources/windows` or a
computed unverified path.

The initial C# program is intentionally small but complete:

```csharp
internal static class Program
{
    internal const int ProtocolVersion = 1;
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--protocol-version")
        {
            Console.Out.WriteLine(ProtocolVersion);
            return 0;
        }
        return 64;
    }
}
```

**Review-approved architecture correction (2026-07-30):** WorkBuddy reproduced an access
violation on every launch of the PE32+ image emitted by `/platform:x64`, while the compatible
AnyCPU managed image passed 500/500 independent launches. Task 1 therefore uses
`/platform:anycpu` and requires the helper to return `64` before processing commands whenever
`Environment.Is64BitProcess` is false. The build record remains `architecture: "x64"` because
protocol execution is fail-closed in a 32-bit process; a real x86 diagnostic build must verify
that refusal.
Add exact scripts:

```json
"build:job-host": "node scripts/build-provider-job-host.js",
"prestart": "npm run build:job-host",
"start": "electron .",
"prepackage:win": "npm run build:job-host"
```

Ignore only:

```gitignore
resources/windows/generated/provider-job-host.exe
resources/windows/generated/provider-job-host.build.json
resources/windows/generated/.build-*/
```

- [ ] **Step 4: Run focused GREEN and inspect generated metadata**

Run:

```powershell
node --test --test-isolation=none tests/buildProviderJobHost.test.js
npm.cmd run build:job-host
Get-Content -Raw resources/windows/generated/provider-job-host.build.json
git diff --check
```

Expected: tests PASS; the record reports protocol `1`, architecture `x64`, absolute allowlisted
compiler path, and two 64-character hashes; `git status --short` does not list generated artifacts.

- [ ] **Step 5: Commit Task 1**

```powershell
git add .gitignore package.json scripts/build-provider-job-host.js resources/windows/provider-job-host.cs tests/buildProviderJobHost.test.js
git diff --cached --check
git commit -m "build: compile Windows provider job host"
```

---

### Task 2: Native Job Object ownership and restricted provider creation

**Files:**

- Modify: `resources/windows/provider-job-host.cs`
- Modify: `scripts/build-provider-job-host.js`
- Modify: `tests/buildProviderJobHost.test.js`
- Create: `tests/windowsJobHost.test.js`
- Create: `tests/fixtures/jobProviderFixture.js`
- Create: `tests/fixtures/jobProviderChild.js`
- Create: `tests/fixtures/jobBrokerEscape.ps1`

**Interfaces:**

- Consumes one first-line UTF-8 envelope:
  `{ protocolVersion: 1, command, args, cwd, visible, ownerPid, ownerExecutable }`.
- Bounds: envelope `<= 65,536` bytes; `args.length <= 256`; each argument, path, key, or value
  `<= 32,768` UTF-8 bytes; no NULs.
- The helper inherits the already-bounded provider environment supplied by Node and passes that
  same environment to the provider. Environment keys and values never enter the envelope.
- Emits exactly one helper record before provider stderr:
  `CLAUDE_PET_JOB_READY 1\r\n`.
- Fixed helper exit codes:
  `0` provider completed with code zero and assigned job is empty;
  `64` invalid protocol/envelope;
  `65` owner binding failed;
  `66` job setup failed;
  `67` provider creation/assignment/resume failed;
  `68` stream pump failed;
  `69` assigned-job cleanup could not be proven.
- Helper diagnostics contain only the fixed exit code/category, never raw paths, arguments,
  environment, goals, Win32 messages, or provider output.

- [ ] **Step 1: Write real Windows RED tests**

Create a harness that spawns the built helper, writes the envelope, and retains exact provider
sentinel paths/PIDs. Add Windows-only tests for:

```js
test('assigns the suspended provider before any fixture code executes', windowsOnly, async () => {
  const run = launchFixture({ mode: 'prove-assigned-before-start' });
  assert.equal(await run.readiness, 'CLAUDE_PET_JOB_READY 1');
  assert.equal(await run.providerReport, 'assigned-before-user-code');
});

test('helper death removes two generations of ordinary descendants', windowsOnly, async () => {
  const run = launchFixture({ mode: 'two-generations' });
  const identities = await run.waitForExactIdentities(3);
  run.helper.kill();
  await assertEveryExactIdentityExited(identities);
});

test('provider inherits standard pipes but not an unrelated inheritable canary', windowsOnly,
  async () => {
    const run = launchFixture({ mode: 'inspect-handles', inheritableCanary: true });
    assert.deepEqual(await run.jsonReport, {
      stdin: true, stdout: true, stderr: true, canaryInherited: false,
    });
  });
```

Also cover owner exit, natural provider-root exit with a surviving child, assignment failure,
containing/nested job behavior, visible/hidden mode, spaces and adversarial quoting, nonzero root
exit, malformed/oversized envelope, and cleanup timeout.

For the opt-in WMI/CIM test, the test harness creates a unique sentinel and retains the exact
external process identity before invoking the provider fixture. Skip with an explicit reason if the
Windows management provider is unavailable. Assert the external process is outside the assigned
job, terminate only the exact retained fixture identity in test cleanup, and never reuse this logic
in production.

- [ ] **Step 2: Run integration tests to verify RED**

Run:

```powershell
npm.cmd run build:job-host
node --test --test-isolation=none tests/windowsJobHost.test.js
```

Expected: FAIL because the minimal helper accepts no launch envelope and owns no job.

- [ ] **Step 3: Implement exact Win32 interop and safe-handle ownership**

Define the required constants and P/Invoke boundary in one internal `NativeMethods` class:

```csharp
internal const uint CREATE_SUSPENDED = 0x00000004;
internal const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
internal const uint PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;
internal const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
internal static extern bool CreateProcessW(
    string applicationName, StringBuilder commandLine,
    IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles,
    uint creationFlags, IntPtr environment, string currentDirectory,
    ref STARTUPINFOEX startupInfo, out PROCESS_INFORMATION processInformation);

[DllImport("kernel32.dll", SetLastError = true)]
internal static extern bool AssignProcessToJobObject(
    SafeJobHandle job, SafeProcessHandle process);
```

Include the corresponding `CreateJobObjectW`, `SetInformationJobObject`,
`InitializeProcThreadAttributeList`, `UpdateProcThreadAttribute`, `ResumeThread`,
`TerminateJobObject`, `QueryInformationJobObject`, `OpenProcess`,
`QueryFullProcessImageNameW`, `WaitForMultipleObjects`, `GetExitCodeProcess`, and
`CloseHandle` declarations with `SetLastError = true`.

Use private `SafeHandleZeroOrMinusOneIsInvalid` subclasses for job, process, thread, pipe, and
attribute-list ownership. No native handle may be stored in an integer or finalized manually.

- [ ] **Step 4: Implement bounded parsing, explicit command construction, and owner binding**

Read bytes until the first LF without a buffered text reader; reject more than `65,536` bytes and
retain no bytes after the envelope. Deserialize with `JavaScriptSerializer.DeserializeObject` to
`Dictionary<string, object>`, require the exact seven envelope keys, then validate each value's
type and every bound before constructing an internal immutable launch specification.

Construct the mutable provider command line with the standard Windows quoting algorithm:

```csharp
private static string QuoteArgument(string value)
{
    if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return value;
    var result = new StringBuilder("\"");
    var slashes = 0;
    foreach (char ch in value)
    {
        if (ch == '\\') { slashes++; continue; }
        if (ch == '"') result.Append('\\', slashes * 2 + 1).Append('"');
        else { result.Append('\\', slashes).Append(ch); }
        slashes = 0;
    }
    return result.Append('\\', slashes * 2).Append('"').ToString();
}
```

Pass `command` separately as `lpApplicationName`; the command-line buffer begins with its quoted
path followed by individually quoted arguments.

Open `ownerPid` for synchronization/query rights, immediately compare
`QueryFullProcessImageNameW` with the normalized `ownerExecutable`, retain that handle, and reject
before provider creation on any mismatch or owner exit.

- [ ] **Step 5: Implement the private job, allowlisted inheritance, and stream pumps**

Create an unnamed job and set only `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Create three private
anonymous pipes, make only the provider ends inheritable, and include exactly those three handles
in `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`. Pass `inheritHandles: true` only with that attribute list.

Call `CreateProcessW` with:

```csharp
uint flags = CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT;
```

Then:

1. assign the suspended root to the job;
2. write and flush `CLAUDE_PET_JOB_READY 1\r\n` to helper stderr;
3. resume the primary thread;
4. pump helper stdin to provider stdin and provider stdout/stderr to helper stdout/stderr using
   bounded fixed buffers without text decoding;
5. wait for owner or provider root;
6. call `TerminateJobObject(job, 1)` on owner/root exit or helper failure;
7. poll `JOBOBJECT_BASIC_ACCOUNTING_INFORMATION.ActiveProcesses` to zero within the fixed cleanup
   deadline;
8. return the provider root exit code only when it is in `0..63`; map other provider codes to `67`;
9. close pipe, thread, process, owner, job, and attribute-list ownership in reverse order.

Pass `IntPtr.Zero` for `lpEnvironment` so the provider inherits the helper's already-bounded
environment exactly. Set `STARTF_USESHOWWINDOW` plus `SW_HIDE` only when `visible` is false; when
`visible` is true, do not force a hidden provider window. Update the build script's fixed compiler
arguments to reference `System.Web.Extensions.dll`, which provides `JavaScriptSerializer`. Set its
`MaxJsonLength` to `65,536` and `RecursionLimit` to `8` before deserialization.

If assignment fails, terminate the still-suspended root before disposing the job. No failure path
may call `ResumeThread`.

- [ ] **Step 6: Run real helper GREEN and leak checks**

Run:

```powershell
npm.cmd run build:job-host
node --test --test-isolation=none tests/windowsJobHost.test.js
Get-Process provider-job-host -ErrorAction SilentlyContinue
git diff --check
```

Expected: all helper tests PASS; the final process query returns no helper; every exact fixture
identity has exited. A skipped WMI/CIM test must print its explicit environmental reason and remains
a documented release limitation.

- [ ] **Step 7: Commit Task 2**

```powershell
git add resources/windows/provider-job-host.cs scripts/build-provider-job-host.js tests/buildProviderJobHost.test.js tests/windowsJobHost.test.js tests/fixtures/jobProviderFixture.js tests/fixtures/jobProviderChild.js tests/fixtures/jobBrokerEscape.ps1
git diff --cached --check
git commit -m "feat: own provider processes with a Windows job"
```

---

### Task 3: Node helper adapter and exact stream protocol

**Files:**

- Create: `src/agent/windowsJobProcess.js`
- Create: `tests/windowsJobProcess.test.js`

**Interfaces:**

- Produces:
  `createWindowsJobProcessLauncher({ spawn, helperPath, ownerPid, ownerExecutable, readyTimeoutMs })`.
- `launcher.launch({ command, args, options })` resolves to frozen
  `{ child, execFile, providerAssigned: true }`, where `child` is the helper `ChildProcess`,
  `execFile` is the absolute helper executable path, and `providerAssigned` is set only after the
  exact readiness record.
- `options` exact keys remain `cwd`, `env`, `shell`, `windowsHide`, and `stdio`; `shell` must be
  `false`; `stdio` must be `['pipe','pipe','pipe']`.
- Readiness maximum is `128` bytes and timeout maximum is `30,000` ms.

- [ ] **Step 1: Write adapter RED tests**

Use fake `ChildProcess` streams to prove:

```js
test('writes one bounded envelope before exposing stdin and keeps provider bytes raw', async () => {
  const pending = launcher.launch(validSpec);
  assert.equal(parseEnvelope(helper.stdin.firstWrite).protocolVersion, 1);
  helper.stderr.write('CLAUDE_PET_JOB_READY 1\r\nprovider-stderr');
  const { child, execFile, providerAssigned } = await pending;
  assert.equal(execFile, helperPath);
  assert.equal(providerAssigned, true);
  assert.equal(await read(child.stderr), 'provider-stderr');
});

test('rejects split, duplicate, oversized, malformed, premature, and timed-out readiness', async () => {
  await assert.rejects(launchWith('CLAUDE_PET_JOB_WRONG 1\r\n'),
    (error) => error.code === 'COMMAND_FAILED');
});
```

Also assert goals are absent from the envelope, helper arguments, and environment; immediate
stdout/stderr after readiness is not lost; `visible: true` maps only to `visible: true`; NUL,
relative paths, extra keys, excess args/environment, or non-pipe stdio fail before spawn. Assert
that the helper inherits `options.env` unchanged while the serialized envelope has no `env` key.

- [ ] **Step 2: Run adapter tests to verify RED**

Run:

```powershell
node --test --test-isolation=none tests/windowsJobProcess.test.js
```

Expected: FAIL because `windowsJobProcess.js` does not exist.

- [ ] **Step 3: Implement envelope validation and readiness consumption**

Use exact exported bounds:

```js
const JOB_PROTOCOL_VERSION = 1;
const MAX_ENVELOPE_BYTES = 65_536;
const MAX_READY_BYTES = 128;
const MAX_READY_TIMEOUT_MS = 30_000;
const READY_LINE = Buffer.from('CLAUDE_PET_JOB_READY 1\r\n', 'ascii');
```

Launch the absolute helper with no arguments:

```js
const child = spawn(helperPath, [], {
  cwd: path.win32.dirname(helperPath),
  env: options.env,
  shell: false,
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});
```

Write `Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8')` before returning any provider-facing
stdin access. Start readiness collection before the write. Consume exactly the first stderr line;
call `child.stderr.pause()`, restore bytes after the marker with `child.stderr.unshift(leftover)`,
then resume on successful return. On any failure, destroy stdin, kill only the retained helper
child, wait for close, and throw fixed `AgentError('COMMAND_FAILED')`.

Resolve with:

```js
return Object.freeze({ child, execFile: helperPath, providerAssigned: true });
```

only after exact readiness. The adapter must never set `providerAssigned` based only on the
helper's Node `spawn` event.

- [ ] **Step 4: Run adapter GREEN and real-helper smoke**

Run:

```powershell
node --test --test-isolation=none tests/windowsJobProcess.test.js
npm.cmd run build:job-host
node --test --test-isolation=none tests/windowsJobHost.test.js tests/windowsJobProcess.test.js
git diff --check
```

Expected: both suites PASS; no helper readiness bytes appear in provider stderr.

- [ ] **Step 5: Commit Task 3**

```powershell
git add src/agent/windowsJobProcess.js tests/windowsJobProcess.test.js
git diff --cached --check
git commit -m "feat: add Windows job process launcher"
```

---

### Task 4: Verified lease and cliRunner lifecycle integration

**Files:**

- Modify: `src/agent/nativeCliLaunchLease.js`
- Modify: `src/agent/cliRunner.js`
- Modify: `src/agent/windowsProcessTree.js`
- Modify: `tests/nativeCliLaunchLease.test.js`
- Modify: `tests/cliRunner.test.js`
- Replace coverage in: `tests/windowsProcessTree.test.js`

**Interfaces:**

- `createNativeCliLeaseRunner({ launchProcess })` uses the injected Job launcher for both version
  capture and provider launch.
- `lease.launch(spec)` returns frozen `{ child, execFile, providerAssigned: true }`; `execFile`
  identifies the helper to terminate, while the lease continues to bind `spec.command` to the
  verified provider path.
- `terminateWindowsProcessTree({ child, execFile })` accepts only the retained helper child and
  absolute expected helper path; it no longer accepts `pid`, `grandchildPids`, `waitForExit`, or
  `inspectProcess`.

- [ ] **Step 1: Write lease/runner RED tests for the new contract**

Add assertions that the verified lease gives the sanitized exact provider specification only to
the injected Job launcher:

```js
test('lease holds provider identity until job launcher reports assignment', async () => {
  const launchGate = Promise.withResolvers();
  const lease = await openLeaseWithRunner({
    launch: async (spec) => {
      observed = spec;
      await launchGate.promise;
      return {
        child: helperChild,
        execFile: 'C:\\app\\provider-job-host.exe',
        providerAssigned: true,
      };
    },
  });
  const pending = lease.launch(requestedSpec);
  assert.equal(releaseCalls, 0);
  launchGate.resolve();
  assert.deepEqual(await pending, {
    child: helperChild,
    execFile: 'C:\\app\\provider-job-host.exe',
    providerAssigned: true,
  });
  assert.equal(observed.command, verifiedBinding.path);
});
```

Update `cliRunner` tests so timeout, abort, invalid JSONL, and stdin failure terminate
`{ child: helperChild, execFile: helperPath }`, never the provider PID/path. Delete every
`grandchildPids` test input.

Replace `windowsProcessTree` tests with retained-object checks: already-exited helper returns true;
path mismatch fails closed; running exact helper calls `child.kill()` once and waits for its
`close`; timeout or `kill() === false` produces `COMMAND_FAILED`.

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```powershell
node --test --test-isolation=none tests/nativeCliLaunchLease.test.js tests/cliRunner.test.js tests/windowsProcessTree.test.js
```

Expected: FAIL on the old bare-child return shape and PID/tree terminator contract.

- [ ] **Step 3: Route the lease runner through `windowsJobProcess`**

Change the default construction:

```js
function createNativeCliLeaseRunner({
  launchProcess = createWindowsJobProcessLauncher().launch,
} = {}) {
  return Object.freeze({
    async capture({ command, args, options, timeoutMs = DEFAULT_LAUNCH_TIMEOUT_MS }) {
      const launched = await launchProcess({ command, args, options });
      return captureBounded(launched.child, timeoutMs);
    },
    launch(spec) {
      return launchProcess(spec);
    },
  });
}
```

Extract the existing bounded capture listeners into
`captureBounded(child, timeoutMs): Promise<{ exitCode, signal, stdout, stderr }>` without changing
the current `MAX_VERSION_OUTPUT_BYTES` or timeout behavior.

Preserve launch metadata through the lease:

```js
const launched = await runner.launch(safeSpec);
const child = launched?.child;
if (!child || typeof launched.execFile !== 'string' || launched.providerAssigned !== true) {
  throw new AgentError('COMMAND_FAILED');
}
return Object.freeze({
  child,
  execFile: launched.execFile,
  providerAssigned: true,
});
```

The inspection session releases only after the helper has emitted readiness and the lease launch
promise resolves. Remove `waitForChildCreated` from this leased Job path: an asynchronous helper
launch has already emitted its Node `spawn` event before readiness, so listening for that event
afterward would deadlock. Keep an exact regression proving the lease resolves from
`providerAssigned: true`, not from a late `spawn` listener.

- [ ] **Step 4: Make `cliRunner` terminate the retained helper**

Change `start(spec)` to normalize both leased and test/direct launch results:

```js
const launched = spec.launchLease
  ? await spec.launchLease.launch({ command, args, options })
  : { child: spawn(command, args, options), execFile: command, providerAssigned: false };
return { child: launched.child, command, terminationExecFile: launched.execFile };
```

For Windows production provider paths, require a launch lease. Keep direct launch only for the
existing allowlisted system-tool/tests boundary. In `stop` call:

```js
await terminateWindowsProcessTree({
  child,
  execFile: terminationExecFile,
});
```

Remove `grandchildPids`, `waitForExit`, and bare provider PID construction entirely. Do not resolve
`RUN_STOPPED` or `REQUEST_TIMEOUT` until helper close/job cleanup succeeds.

- [ ] **Step 5: Reduce `windowsProcessTree` to retained-helper termination**

Implement:

```js
async function terminateWindowsProcessTree({ child, execFile, timeoutMs = 5000 } = {}) {
  if (!validRetainedHelper(child, execFile)) throw new AgentError('COMMAND_FAILED');
  if (child.exitCode !== null || child.signalCode !== null) return true;
  const closed = waitForClose(child, Math.min(timeoutMs, 30_000));
  if (child.kill() !== true) throw new AgentError('COMMAND_FAILED');
  if (!await closed) throw new AgentError('COMMAND_FAILED');
  return true;
}
```

`validRetainedHelper` requires `child.spawnfile` to equal the normalized absolute `execFile` and a
real retained `ChildProcess` interface (`once`, `removeListener`, `kill`, and integer `pid`); do not
re-open or inspect a PID. Tests use faithful fake objects with the same immutable `spawnfile`.
Delete `defaultInspectProcess`, `taskkill.exe`, and `grandchildPids`.

- [ ] **Step 6: Run focused GREEN plus the original orphan regression**

Run:

```powershell
node --test --test-isolation=none tests/nativeCliLaunchLease.test.js tests/cliRunner.test.js tests/windowsProcessTree.test.js tests/windowsJobProcess.test.js tests/windowsJobHost.test.js
git diff --check
```

Expected: all focused tests PASS. The former PowerShell/non-Node parent case passes without
supplying any descendant PID, and no test or production file invokes `taskkill`.

Confirm:

```powershell
rg -n "taskkill|grandchildPids|Win32_Process|Get-Process|process table" src
```

Expected: no production lifecycle hit; any `Win32_Process` text exists only in design/test evidence.

- [ ] **Step 7: Commit Task 4**

```powershell
git add src/agent/nativeCliLaunchLease.js src/agent/cliRunner.js src/agent/windowsProcessTree.js tests/nativeCliLaunchLease.test.js tests/cliRunner.test.js tests/windowsProcessTree.test.js
git diff --cached --check
git commit -m "fix: terminate verified provider jobs"
```

---

### Task 5: Probe, provider, setup, and app-owner coverage

**Files:**

- Modify: `src/agent/localProviderProbe.js`
- Modify: `tests/localProviderProbe.test.js`
- Modify: `tests/codexCli.test.js`
- Modify: `tests/claudeCodeCli.test.js`
- Modify: `tests/nativeFullComputerExecutors.test.js`
- Modify if required by owner cleanup: `src/main.js`
- Modify if required by owner cleanup: `tests/appLifecycle.test.js`

**Interfaces:**

- `localProviderProbe.defaultSpawn(spec, { launchProcess, terminate })` receives the same
  `{ child, execFile, providerAssigned: true }` Job-launch result and terminates only that helper
  identity.
- Every production Codex/Claude version check, status check, Full Computer probe, real run, and
  visible setup launch passes through a fresh verified lease whose default runner is Job-owned.
- Electron owner is `process.pid` plus normalized `process.execPath`; the helper retains that owner
  handle before resuming the provider.

- [ ] **Step 1: Write RED coverage for every production launch category**

In provider executor tests, inject an `openLease` whose `launch` records:
`version`, `status`, `probe`, `run`, and `visible setup`. Assert each path reaches `runner` with a
lease and that visible setup alone has `visible: true`.

Update probe abort test:

```js
test('default probe spawn aborts its retained job helper and waits for assigned-job cleanup',
  async () => {
    const pending = defaultSpawn(spec, {
      launchProcess: async () => ({
        child: helper, execFile: helperPath, providerAssigned: true,
      }),
      terminate: async (identity) => events.push(['terminate', identity]),
    });
    controller.abort(new Error('caller stopped probe'));
    await assert.rejects(pending, /caller stopped probe/);
    assert.deepEqual(events[0], ['terminate', { child: helper, execFile: helperPath }]);
  });
```

Add an app-lifecycle test that simulates Electron owner exit and proves the fake helper is not
detached or adopted by renderer/tray code.

- [ ] **Step 2: Run provider/probe tests to verify RED**

Run:

```powershell
node --test --test-isolation=none tests/localProviderProbe.test.js tests/codexCli.test.js tests/claudeCodeCli.test.js tests/nativeFullComputerExecutors.test.js tests/appLifecycle.test.js
```

Expected: FAIL where `localProviderProbe.defaultSpawn` still directly spawns and terminates by PID.

- [ ] **Step 3: Integrate the Job launcher without changing provider arguments**

In `localProviderProbe.defaultSpawn`, replace direct `childProcess.spawn` with:

```js
const launched = await launchProcess({
  command: spec.command,
  args: spec.args || [],
  options: {
    cwd: spec.cwd,
    env: spec.env,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  },
});
if (launched.providerAssigned !== true) throw new AgentError('COMMAND_FAILED');
const { child, execFile } = launched;
```

On abort/stdin error/protocol failure call
`terminate({ child, execFile })`, wait for helper close, then reject with the existing public error.
Do not change the pinned Codex/Claude argument arrays, local dummy credentials, loopback protocol,
fixtures, model registry, or public error mappings.

Production Full Computer probes already pass through `cliRunner.capture` with a verified lease;
retain that structure and add regression assertions rather than adding a second helper layer.

- [ ] **Step 4: Run focused GREEN and an account-free packaged-style fake-provider flow**

Run:

```powershell
node --test --test-isolation=none tests/localProviderProbe.test.js tests/codexCli.test.js tests/claudeCodeCli.test.js tests/nativeFullComputerExecutors.test.js tests/appLifecycle.test.js
node --test --test-isolation=none tests/windowsJobHost.test.js tests/windowsJobProcess.test.js
git diff --check
```

Expected: all tests PASS. No real account, provider network request, or user workspace mutation
occurs.

- [ ] **Step 5: Commit Task 5**

```powershell
git add src/agent/localProviderProbe.js src/main.js tests/localProviderProbe.test.js tests/codexCli.test.js tests/claudeCodeCli.test.js tests/nativeFullComputerExecutors.test.js tests/appLifecycle.test.js
git diff --cached --check
git commit -m "test: cover job-owned provider entry points"
```

Stage `src/main.js` and `tests/appLifecycle.test.js` only if the witnessed RED test requires a real
owner-cleanup wiring change; otherwise leave both unstaged.

---

### Task 6: Package integrity and fresh-package lifecycle proof

**Files:**

- Modify: `scripts/verify_package.js`
- Modify: `tests/verifyPackage.test.js`
- Modify: `package.json` only if Task 1's package hook needs correction
- Modify: `scripts/package_windows.ps1` only if it remains an active package entry point

**Interfaces:**

- `verifyPackage(packageRoot)` additionally requires beneath
  `resources/app/resources/windows/`:
  `provider-job-host.cs`,
  `generated/provider-job-host.exe`, and
  `generated/provider-job-host.build.json`.
- The verifier recalculates source/executable SHA-256 and requires exact match with the record.
- The build record must have exact keys and values:
  `protocolVersion: 1`, `architecture: "x64"`, normalized allowlisted compiler identity, and
  lowercase 64-character hashes.

- [ ] **Step 1: Write package RED tests**

Add fixtures proving:

```js
test('requires the current provider job host and matching build record', () => {
  const root = makeMinimalPackageWithJobHost();
  assert.doesNotThrow(() => verifyPackage(root));
  fs.appendFileSync(jobHostExe(root), 'tamper');
  assert.throws(() => verifyPackage(root), /job-host-executable-hash/);
});

test('rejects missing source, executable, record, wrong protocol, and stale source hash', () => {
  for (const mutation of packageMutations) {
    assert.throws(() => verifyPackage(mutation.root), /job-host-/);
  }
});
```

Retain existing secret scanning, no-reparse, no-development-tree, and legacy-renderer coverage.

- [ ] **Step 2: Run package tests to verify RED**

Run:

```powershell
node --test --test-isolation=none tests/verifyPackage.test.js
```

Expected: FAIL because `verifyPackage` does not require or hash the helper.

- [ ] **Step 3: Implement package helper verification**

Add `verifyProviderJobHost(root)` before the recursive scan. Read the record with a maximum of
`16,384` bytes, reject extra keys, calculate both hashes through streaming reads, and reject
reparse objects before opening them. Return the helper verification result only internally; keep
the public `{ files, bytes }` result unchanged.

Ensure `prepackage:win` completes the helper build before electron-packager copies resources.
Do not add the ignored build artifacts to Git.

- [ ] **Step 4: Run package GREEN, full tests, and a fresh package**

Run:

```powershell
node --test --test-isolation=none tests/verifyPackage.test.js
npm.cmd test
py -3.12 -m pytest -q
npm.cmd run package:win
npm.cmd run verify:package
git diff --check
```

Expected: focused and complete Node suites PASS; Python passes when the configured runtime is
available, otherwise record the exact unavailable-runtime error without claiming Python coverage;
the fresh package verifier reports its new exact file/byte totals.

- [ ] **Step 5: Exercise the fresh packaged fake-provider cleanup path**

Using an isolated temporary profile and the packaged executable, run only the deterministic
fake-provider lifecycle harness:

1. launch a two-generation provider fixture;
2. record the exact root/child/grandchild identities;
3. invoke Stop and verify the assigned job is empty;
4. repeat for timeout, malformed output, provider-root natural exit, helper crash, and Electron
   owner exit;
5. prove Offline Demo still completes and zero prompt listeners exist unless the opt-in capability
   launch is used.

Do not sign in or run Codex/Claude. Save bounded logs and exact process-identity evidence under
`docs/evidence/`; do not save environment dumps or credentials.

- [ ] **Step 6: Commit Task 6**

```powershell
git add package.json scripts/package_windows.ps1 scripts/verify_package.js tests/verifyPackage.test.js docs/evidence
git diff --cached --check
git commit -m "build: verify packaged provider job host"
```

Stage only files actually changed and the bounded non-secret evidence created in Step 5.

---

### Task 7: Canonical documentation, checklist, and human release gates

**Files:**

- Modify: `docs/project-context.md`
- Modify: `docs/RESEARCH.md`
- Modify: `docs/BUILD_LOG.md`
- Modify: `PROJECT_CHECKLIST.html`
- Create: `docs/evidence/provider-job-human-gates.md`

**Interfaces:**

- Evidence file records each gate as `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`, plus date, exact
  artifact hash/version, tester, environment class, and bounded observation.
- No checkbox may claim a real provider, Windows version, enterprise policy, signing, antivirus,
  accessibility, crash, or browser-flow result without matching evidence.

- [ ] **Step 1: Write the human-gate evidence template with truthful initial states**

Create this exact table populated with `NOT RUN` unless a human explicitly performed the gate:

```markdown
| Gate | Status | Artifact/version | Environment | Evidence |
|---|---|---|---|---|
| Windows 10 x64 assigned-job lifecycle | NOT RUN | — | — | — |
| Windows 11 x64 assigned-job lifecycle | NOT RUN | — | — | — |
| Codex visible login/browser handoff | NOT RUN | — | clean profile | Requires user opt-in |
| Claude visible login/browser handoff | NOT RUN | — | clean profile | Requires user opt-in |
| Existing browser remains usable | NOT RUN | — | clean profile | Requires user observation |
| AppLocker/App Control/Defender policy | NOT RUN | — | managed test machine | No universal claim |
| SmartScreen/AV/EDR scan | NOT RUN | — | exact signed artifact | Unsigned private build only |
| Keyboard/accessibility comprehension | NOT RUN | — | packaged app | Requires human review |
| Crash/logoff/reboot drill | NOT RUN | — | sacrificial fixture | No rollback claim |
| Provider-version compatibility | NOT RUN | — | pinned/current CLI | Repeat after version changes |
```

- [ ] **Step 2: Update canonical architecture only with verified facts**

Replace the `windowsProcessTree.js` architecture description with the Job helper/adapter boundary.
State:

- assigned-job cleanup is automated and tested;
- out-of-job actions and completed side effects are outside the guarantee;
- the package is an unsigned private test build;
- real login, hardened-policy, signing/reputation, and human accessibility gates retain their
  recorded status.

Refresh `PROJECT_CHECKLIST.html` from verified commits/evidence only. Do not mark public
distribution or unperformed human gates complete.

- [ ] **Step 3: Run final verification-before-completion gate**

Run fresh:

```powershell
npm.cmd test
py -3.12 -m pytest -q
npm.cmd run package:win
npm.cmd run verify:package
git diff --check
git status --short
git log --oneline --decorate -12
```

Also inspect exact provider/helper residue:

```powershell
Get-Process provider-job-host,codex,claude,ping -ErrorAction SilentlyContinue
```

Expected: complete Node suite passes; Python result is recorded exactly; the package is freshly
built and verified; no task-created helper/provider/fixture remains. Existing user-owned processes
must not be terminated merely because their names match—resolve ownership from retained test
records before any cleanup.

- [ ] **Step 4: Commit documentation and checklist**

```powershell
git add docs/project-context.md docs/RESEARCH.md docs/BUILD_LOG.md docs/evidence/provider-job-human-gates.md PROJECT_CHECKLIST.html
git diff --cached --check
git commit -m "docs: record provider job lifecycle evidence"
```

- [ ] **Step 5: Stop at the user acceptance gate**

Report:

- exact implementation commits;
- exact Node/Python/package totals;
- assigned-job lifecycle evidence;
- every human gate still `NOT RUN`, `BLOCKED`, or failed;
- that Job Objects are not a sandbox and Stop does not roll back side effects;
- whether real Codex/Claude login compatibility remains unverified.

Do not merge, push, sign, publish, alter policy, run real providers, or begin unrelated UX repairs
without the user's next explicit instruction.

---

## Plan self-review checklist

- [ ] Every approved guarantee is implemented by Tasks 2–5 and verified in Tasks 6–7.
- [ ] Every documented escape/rollback limitation appears in automated or human-gate evidence.
- [ ] The exact provider lease remains held until helper readiness.
- [ ] No production path accepts descendant PIDs, enumerates processes, or invokes `taskkill`.
- [ ] Helper arguments and environment never contain a goal or credential.
- [ ] Provider handle inheritance contains exactly three standard handles.
- [ ] Normal/timeout/Stop/error/root-exit/helper-exit/owner-exit paths prove the assigned job empty.
- [ ] Visible login behavior remains human-gated and is never automated against a real account.
- [ ] Generated binaries remain ignored and are rebuilt before start/package.
- [ ] Fresh-package verification binds helper source and executable hashes.
- [ ] `.workbuddy-ai/`, `LOCAL_PR.html`, and `.claude/` remain unmodified and unstaged.
- [ ] Canonical docs/checklist describe only witnessed evidence and retain unrun human gates.
