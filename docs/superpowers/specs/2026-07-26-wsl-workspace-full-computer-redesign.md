# Claude Pet WSL Workspace and Full Computer Redesign

**Status:** Approved design direction, written-spec review pending

**Date:** 2026-07-26

**Scope:** Replace the unsafe native-Windows Workspace claim, make warned Full Computer the default
for new real-provider connections, and add the complete Post-Hoc Banana Baron animation milestone.

## Purpose

Claude Pet must support two honestly named execution modes:

1. **Full Computer** is the default selection for every new Codex or Claude connection. It runs the
   native Windows CLI with broad host authority, but it cannot run until the user accepts one native
   warning for that saved connection. Settings and every live run retain a permanent warning badge.
2. **Workspace** is the narrower option. It runs inside a dedicated, locked WSL2 Ubuntu environment
   that exposes only the selected Windows project at `/workspace`. It is offered only after setup and
   every hostile boundary probe succeeds.

There is no silent fallback in either direction. A failed Workspace boundary never becomes a Full
Computer run, and cancelling Full Computer authorization never becomes a Workspace run.

This redesign also makes the unfinished Post-Hoc Banana Baron atlas and activity-driven animations a
separate implementation milestone. Security work and asset generation have separate test gates and
must not be presented as one partially complete feature.

## Decision summary

- Electron's main process remains the trusted Windows controller.
- Full Computer is the default **selection**, not pre-authorization. New real-provider connections
  require a main-owned native confirmation before their first Full Computer run.
- Workspace uses a dedicated app-owned Ubuntu WSL2 distribution. It does not reuse a personal WSL
  distribution.
- Windows drive automounting, Windows executable interop, and Windows PATH inheritance are disabled
  in that distribution.
- A root-owned broker creates a private mount/process namespace, exposes only the selected project at
  `/workspace`, drops to an unprivileged no-`sudo` user, launches the provider CLI, and cleans up the
  mount and process tree after the run.
- Codex uses its official Linux/WSL sandbox. Claude uses its official WSL2 sandbox with
  `failIfUnavailable`, root-owned managed policy, locked read/network allowlists, and permission
  rules for its built-in file tools.
- The provider CLI itself may reach its provider. Model-spawned commands, project hooks, MCP servers,
  plugins, and built-in web tools may not use the network in Workspace mode.
- Project `.codex` and `.claude` content may influence the task text but cannot broaden app-owned
  filesystem, network, hook, MCP, plugin, or permission policy.
- Mode, workspace, model, and effort changes affect only the next immutable run snapshot.
- Workspace refuses to run if setup, integrity checks, mount isolation, an executor sandbox, or any
  hostile probe is unavailable.
- The existing partial pet atlas remains in place until the complete replacement atlas passes visual
  and deterministic validation.

## Why the current design must be superseded

### Confirmed implementation defects

1. `src/agent/cliRunner.js` currently references undefined `spec.visible` inside
   `resolveWithWhere()`. Production Codex and Claude command discovery therefore fails before either
   CLI launches. Existing tests inject `resolveCommand`, so they do not exercise the broken path.
2. The production Codex outside-read probe places its target next to `outsideSentinel` inside the
   dedicated `CODEX_HOME`. That directory is an intentionally readable runtime/authentication
   location, so reading it does not prove a workspace escape.
3. The current probe throws at the first failed outside-read check. Its later outside-write, network,
   hostile-project, and hook checks were not executed in the recorded live run. Cleanup evidence does
   not prove those skipped checks.
4. A separate corrected probe against a sibling directory on `Z:\` did prove arbitrary reads outside
   the selected workspace. The volume grants broad inherited read access to normal Windows users;
   adding a deny entry to the Codex profile did not override that host ACL. The same probe denied an
   outside write.
5. Claude `--safe-mode` isolates Claude configuration behavior. It is not an operating-system
   boundary for native-Windows reads, writes, or child network access.

The historical conclusion therefore needs precision: native Windows is unsafe for this Workspace
promise on this machine, but the current production launcher and production probe are also defective.
Both defects are prerequisites; neither should be retained as the WSL availability gate.

### Current machine facts

- Windows 10 Home 22H2, build 19045, 64-bit.
- Firmware virtualization and a hypervisor are active.
- `Microsoft-Windows-Subsystem-Linux` and `VirtualMachinePlatform` are enabled.
- WSL defaults to version 2, but the WSL2 kernel file is missing and no Linux distribution is
  installed.
- Windows Sandbox, full Hyper-V, and Windows Containers are not available on this edition/setup.
- Docker, Podman, VirtualBox, VMware, and QEMU command-line runtimes are not installed.
- `Z:\` is a local fixed NTFS volume, so the broker can use a DrvFS staging mount rather than a
  network-drive synchronization workaround.
- Native Windows CLI versions observed during design are Codex `0.145.0` and Claude Code `2.1.217`.
  WSL installations are separate and must pass their own version and integrity gates.

This makes WSL2 the practical local operating-system boundary on this computer. Installing its
kernel, a dedicated distribution, and Linux CLI dependencies is a real setup operation, not a label
change.

## Terminology and non-negotiable invariants

### Full Computer

Full Computer means the selected native Windows provider CLI may read, change, or delete files the
Windows user can access, run Windows programs, and use the network. It is deliberately not described
as safe, sandboxed, Workspace-like, or limited to the selected project.

The default is a user-requested product choice, not a security recommendation. Safer developer tools
commonly default to a workspace boundary. Claude Pet must preserve the warning even though this app
defaults new real-provider drafts to Full Computer.

### Workspace

Workspace means the full provider CLI process tree runs in the dedicated WSL2 environment and the
only Windows content exposed to it is the selected project mounted at `/workspace`. The environment
may also expose the minimum root-owned Linux runtime and the provider's dedicated authentication
state needed to start the official CLI. It contains no personal WSL home, unrelated repository, or
automounted Windows drive.

Within that outer boundary:

- project reads and writes are allowed at `/workspace`;
- a per-run temporary directory is allowed and destroyed after the run;
- other Windows paths are absent, not merely discouraged;
- app/provider authentication and policy paths are denied to model tools and child commands;
- model-spawned processes have no network or Windows interop;
- provider communication by the controlling CLI remains available;
- no approval request can broaden the boundary during a non-interactive run.

### No fallback

Mode is part of an immutable run snapshot. Executors must implement the exact selected mode or return
a public error. They may never retry under the other mode, weaken policy, or relabel a native run as
Workspace.

## Architecture

```text
Windows Electron main process
├── connection and Full Computer authorization policy
├── native Full Computer Codex / Claude executors
├── WSL setup and integrity service
├── WSL run controller
│   └── wsl.exe -> root-owned broker in ClaudePetWorkspace
│       ├── fresh private mount/process namespace
│       ├── temporary DrvFS staging mount of the selected drive
│       ├── bind mount of only the selected project at /workspace
│       ├── staging drive unmounted before provider launch
│       ├── privilege drop to claudepet-agent (no sudo)
│       └── official Linux provider CLI
│           ├── Codex Linux/WSL sandbox
│           └── Claude bubblewrap/socat sandbox + managed policy
├── sanitized activity and response state
└── unprivileged pet / Settings / response renderers
```

### 1. Windows controller

Electron main owns every security-relevant decision. Renderers may request a mode change, show status,
and render badges, but they cannot set confirmation booleans, choose CLI flags, provide WSL commands,
or mark a probe successful.

The controller:

- canonicalizes the selected Windows directory and rejects missing, non-directory, device, or unsafe
  reparse-point roots;
- opens and holds a non-delete-share directory handle, records its volume/file identity, and rejects
  existing NTFS files with multiple hard links for the first release;
- resolves the selected volume and relative path without shell interpolation;
- launches the absolute system `wsl.exe` path and version-checked absolute provider CLI paths rather
  than resolving executables from the project or a mutable run-time PATH;
- creates one immutable run descriptor containing connection ID, executor, mode, workspace, model,
  effort, and authorization state;
- chooses either the native Full Computer executor or the WSL Workspace executor once;
- owns Stop, timeout, crash recovery, cleanup, public error mapping, and sanitized logging.

No renderer-provided command, environment variable, mount option, distro name, policy path, or
confirmation value crosses this boundary.

### 2. Native Full Computer executors

Full Computer uses version-checked absolute paths to the native Windows Codex or Claude CLI. It does
not pass through WSL, because WSL-wide authority would not be Full Computer access to Windows.

Both native executors retain the current bounded JSONL parser, sanitized activity mapping, verified
Windows process-tree Stop, dedicated app config directories, and project-customization isolation.
Full Computer grants broad filesystem/command/network authority; it does not implicitly enable
project hooks, project MCP servers, plugins, connectors, browser-control tools, or hidden output.

- Codex receives its explicit official danger-full-access permission mode and non-interactive
  approval policy without mixing legacy and named permission systems.
- Claude retains safe mode, no session persistence, strict empty MCP configuration, and disabled
  project setting sources, but replaces Workspace denial mode with its explicit full-permission flag.
- Both reject a run snapshot whose profile is not `full-computer` or whose main-owned
  `fullAccessConfirmed` is not true.

The production `where.exe` regression must be fixed with a real default-resolution regression test
before either native executor is considered available.

### 3. Dedicated WSL2 distribution

The app uses the dedicated distribution name `ClaudePetWorkspace`. It must not modify, import into,
or depend on a user's existing WSL distribution.

Provisioning uses a pinned official Ubuntu WSL root filesystem and verifies its published checksum
before import. The exact rootfs version, download URL, checksum, installed Linux packages, CLI
versions, and policy version are recorded in an app-owned installation manifest. The implementation
plan must pin these values; an unverified latest download is not acceptable.

The distribution contains:

- a root-owned broker and policy files;
- a dedicated unprivileged `claudepet-agent` account;
- no `sudo` access and no writable root-owned executable directories for that account;
- Linux builds of Codex and Claude Code at tested versions;
- `bubblewrap`, `socat`, and any version-required AppArmor support;
- dedicated provider auth/config directories, never shared from Windows;
- `/etc/wsl.conf` settings that disable drive automounting, Windows executable interop, and Windows
  PATH inheritance.

Setup verifies those settings after terminating and restarting only `ClaudePetWorkspace`. A file
saying setup is complete is not proof; the app rechecks the effective environment and runs
executable probes.

### 4. Root-owned broker and workspace mount

The Windows controller invokes a fixed broker executable by argv through `wsl.exe`; it does not
construct a shell command. The broker receives a strictly validated run descriptor over stdin or a
root-owned file descriptor.

For each run the broker:

1. creates a fresh private mount and process namespace;
2. mounts the selected Windows volume at a root-only staging point with DrvFS;
3. bind-mounts only the canonical selected directory at `/workspace`;
4. revalidates the mounted root against the held Windows volume/file identity and a main-owned random
   sentinel before allowing the CLI to start;
5. unmounts the volume staging point inside that namespace so sibling paths are unreachable;
6. hides WSL host-integration mounts, sockets, init bridges, GUI variables, and binfmt interop;
7. creates a bounded ephemeral run temp directory;
8. bind-mounts the broker, runtime, and managed policy read-only, while exposing only the exact
   provider auth state that the controlling CLI requires for login refresh;
9. drops groups and privileges to `claudepet-agent` with no-new-privileges behavior;
10. launches one exact provider CLI and supervises its process group;
11. kills all descendants on Stop, timeout, malformed output, broker error, or app exit;
12. unmounts and destroys per-run state on every completion path.

The boundary must reject a workspace that contains a Windows junction, reparse point, or symlink
whose effective target escapes the selected root unless an executable probe proves the target remains
inaccessible. The first release also rejects any selected workspace file whose NTFS link count is
greater than one; it does not attempt to prove that every other hardlink name remains inside the root.
The controller holds the root handle through mount completion so the path cannot be renamed/replaced,
then repeats identity and reparse checks at the mount-time sentinel before releasing it. It must also
resist Linux symlink traversal, `/proc` traversal, inherited file descriptors, background processes,
and stale mounts.

Because the distribution is dedicated, terminating the entire distro is an acceptable last-resort
cleanup if the supervised process group or mount cannot be proven gone. Startup performs the same
stale-run recovery before allowing another run.

### 5. Codex Workspace executor

Codex runs as the Linux CLI inside the broker boundary with a dedicated Linux `CODEX_HOME` and an
app-owned profile. The profile and invocation must:

- use the official Linux/WSL sandbox with workspace-write authority only for `/workspace`;
- use a non-interactive `never` approval policy so a blocked operation fails rather than prompts;
- disable model-command network access, live web search, hooks, and unapproved MCP tools;
- expose an explicit effective tool allowlist limited to the required local file/command tools;
  connectors, apps, remote browsers, computer-use tools, and every MCP server remain disabled because
  Codex permission profiles do not govern those separate tool surfaces;
- mark the selected project untrusted and prevent project `.codex` configuration or rules from
  replacing app policy;
- ignore project rules/hooks at invocation where the installed CLI supports those switches;
- strip credential, token, secret, Windows interop, and host-path environment variables;
- use explicit, version-verified CLI paths rather than the broken production `where.exe` resolver;
- pass a deterministic `codex sandbox` probe plus an end-to-end fake-process mapping test before the
  profile is advertised.

Codex provider traffic is made by the controlling CLI outside the command sandbox. Tool commands and
their descendants receive the no-network sandbox.

### 6. Claude Workspace executor

Claude runs as the Linux CLI inside the same outer broker boundary. Its official sandbox supports
Linux/WSL2, not native Windows, and depends on `bubblewrap` and `socat`.

Root-owned `/etc/claude-code/managed-settings.json` is the authoritative policy. It must enable and
lock all of the following:

- `sandbox.enabled: true`;
- `sandbox.failIfUnavailable: true`;
- `sandbox.allowUnsandboxedCommands: false` with no excluded commands;
- deny-read outside the workspace and allow-read only for `/workspace` plus the exact app-owned
  runtime paths proven necessary;
- writes only to `/workspace` and the per-run temporary directory;
- `sandbox.filesystem.allowManagedReadPathsOnly: true`;
- no child-command domains and `sandbox.network.allowManagedDomainsOnly: true`;
- `allowManagedPermissionRulesOnly: true` with built-in Read/Edit/Write authority limited to
  `/workspace`;
- managed permission denies for `WebFetch` and `WebSearch`, in addition to omitting both from the
  invocation's tool allowlist;
- `allowManagedHooksOnly: true` with no project hooks;
- `allowManagedMcpServersOnly: true` with an empty MCP allowlist;
- an empty `excludedCommands` array with no non-managed setting source allowed to append to it;
- credential-file and credential-environment denial for tool processes;
- no weaker nested sandbox and no unsandboxed escape parameter.

The invocation retains safe mode, no session persistence, non-interactive denial, no Chrome, disabled
slash commands, and strict empty MCP configuration. Its exact built-in tool allowlist is `Bash`,
`Read`, `Edit`, `Write`, `Glob`, and `Grep`; WebFetch, WebSearch, Agent/subagent, browser, plugin, and
MCP tools are absent. It explicitly loads no user, project, or local setting sources through the
version-verified `--setting-sources` behavior; only root-owned managed policy remains effective. If
the installed CLI cannot prove that lower setting sources and their merged `excludedCommands` are
absent, Claude Workspace is unavailable. These flags are defense in depth; they do not replace the
outer WSL mount boundary or managed policy.

Project `.claude` files remain ordinary workspace files that the user can ask the agent to edit, but
Claude does not load them as configuration during a Workspace run. They therefore cannot append deny
or allow rules, read paths, network domains, excluded commands, hooks, MCP servers, plugins, or
unsandboxed commands. Claude's controlling process may contact Anthropic; its Bash children,
WebFetch/WebSearch tools, MCP tools, and hooks may not contact the network.

### 7. Authentication

Native Full Computer and WSL Workspace use separate official CLI installations and therefore separate
official login state.

- Full Computer keeps the current native login flow in the dedicated Windows app config directory.
- Workspace starts the official login flow inside the dedicated distribution. Electron main may open
  an allowlisted official HTTPS login URL or display a device code, but it never reads or copies token
  files.
- Windows auth directories are never mounted into WSL.
- WSL auth directories are never exposed at `/workspace` or through renderer IPC.
- Agent commands cannot read auth files; only the trusted controlling CLI receives the minimum access
  required to authenticate and refresh its session.

If a provider cannot complete official login without Windows interop, setup presents the official URL
or code through main-owned UI. It does not re-enable WSL interop.

## Connection state and authorization

### New and existing connections

- A new Codex or Claude draft preselects `full-computer` and labels it **Default — broad access**.
- Offline Demo remains `workspace`-only and never shows a Full Computer option.
- Existing saved connections retain their stored profile during migration. The update never silently
  upgrades an existing Workspace connection to Full Computer.
- Workspace setup state is machine state, not a renderer-controlled connection boolean. It is derived
  from the app-owned manifest plus fresh integrity and hostile-probe results.

### One Full Computer confirmation per saved connection

`fullAccessConfirmed` remains an internal store field. Renderer save/update payloads cannot contain
it. Main exposes a narrow request containing only a connection ID and requested profile.

For a new Full Computer connection, main reserves a prospective connection ID and one-use random
authorization nonce in memory but does not persist or select the draft. It displays the warning bound
to that exact ID, nonce, and requested profile. Acceptance consumes the nonce and persists the
connection and confirmation together. Cancellation consumes the nonce and discards the reservation,
so no new connection exists or can run from renderer state alone.

For an existing connection, one accepted warning remains valid for that connection identity across
label, workspace, model, and effort edits. Switching temporarily to Workspace does not erase the
recorded acknowledgement; deleting and recreating the connection does. The active badge is based on
the selected profile, not on the historical acknowledgement.

Every stored connection has an internal monotonic revision that increments on each mutation. Before
persisting acceptance, main re-reads and compares connection ID, revision, requested profile, and its
one-use main-owned nonce. Removal, replacement, change-away-and-back, a second dialog, replay, or any
other mutation while the native dialog is open fails closed. The accepted nonce is never stored or
sent over IPC. Run authorization then requires the persisted confirmation in the immutable snapshot;
dialog state alone is never sufficient.

### Native warning

The Electron native dialog uses a warning icon and safe default:

- Title: `Enable Full Computer?`
- Message: `This agent can access your whole computer.`
- Detail: `It may read, change, or delete files outside the selected workspace, run programs, and use
  the network. This is not Workspace mode. Enable it only for goals and connections you trust.`
- Buttons: `Cancel`, `Enable Full Computer`
- Default and Escape button: `Cancel`

After acceptance, Settings, tray, Simple activity, Comprehensive activity, and the live response
header show the persistent badge `FULL COMPUTER — broad PC access`. The badge is never green or
described as safe.

## Mode transitions and run snapshots

| Action | Current run | Next run | Failure behavior |
|---|---|---|---|
| Save new Full Computer connection | none | Full after native acceptance | Cancel leaves no runnable Full connection |
| Switch existing connection to Full | unchanged | Full if already acknowledged or newly accepted | No profile change on rejection |
| Switch to Workspace | unchanged | Workspace after fresh boundary verification | Stay selected as Workspace but refuse to run if unavailable |
| Edit workspace/model/effort | unchanged | Uses the edited immutable snapshot | Invalid combinations are rejected |
| Workspace setup/probe fails | unchanged | Workspace remains unavailable | Never retries as Full Computer |
| Full Computer native launch fails | unchanged | Full remains selected | Never retries in WSL |

The response window and pet animation remain bound to the run snapshot they started with. Editing
Settings during a run can update only future selection state.

## Workspace setup experience

Settings shows separate status for native Full Computer and WSL Workspace:

- `Full Computer: available after warning` when the native CLI is installed;
- `Workspace: setup required`, `restart required`, `sign-in required`, `checking`, `ready`, or a
  specific public failure;
- the installed WSL distro, policy version, and provider CLI version without exposing usernames,
  tokens, full auth paths, or raw command output.

Selecting Workspace before setup opens a main-owned setup flow. It does not run system commands from
renderer input.

The setup phases are:

1. inspect OS edition/build, virtualization, optional features, WSL kernel, and existing app distro;
2. explain downloads, disk use, administrator/reboot requirements, and that this is a dedicated Linux
   environment;
3. install/update the WSL2 kernel if missing and stop cleanly if Windows requires a restart;
4. download, checksum, and import the pinned Ubuntu rootfs under the app-owned distro name;
5. install and pin runtime dependencies and provider CLIs;
6. create the no-`sudo` account, root-owned broker, `wsl.conf`, managed policies, and ownership
   manifest;
7. restart the distro and verify effective automount, interop, PATH, users, ownership, and versions;
8. run the complete generic and provider-specific hostile probe matrix;
9. offer separate official Codex and Claude sign-in actions inside WSL;
10. mark each provider's Workspace mode ready only after its complete gate passes.

Setup and repair are idempotent. Destructive recovery may unregister only the distribution that has
the exact app-owned name and ownership marker, after a specific confirmation. It never touches an
unknown or personal distro.

## Error handling

Public errors remain fixed and allowlisted. The implementation plan may reuse existing codes where
their meaning is exact, but must distinguish at least these cases:

- WSL feature/kernel/distro setup required;
- Windows restart required;
- unsupported or unowned distro state;
- rootfs download/checksum/import failure;
- missing or wrong Linux dependency/CLI version;
- provider sign-in required;
- workspace path or reparse-point rejection;
- broker launch, mount, namespace, privilege-drop, or cleanup failure;
- Workspace integrity or hostile-probe failure;
- Full Computer confirmation required or cancelled;
- native Full Computer CLI launch failure.

Raw CLI stderr, environment dumps, tokens, auth paths, usernames, and unbounded command output do not
cross IPC. Internal diagnostic records identify a failed probe by stable probe ID and sanitized result,
not by sensitive file contents.

Any cleanup failure poisons Workspace availability until startup recovery proves that no process,
mount, or sentinel remains. A warning followed by execution is forbidden.

## Threat model

### In scope

- hostile repository instructions and prompt injection;
- hostile `.codex`, `.claude`, hook, rule, MCP, plugin, and settings content;
- commands and descendants attempting path traversal, symlink/junction escape, background survival,
  process inspection, Windows interop, inherited file descriptors, or environment-secret access;
- same-volume NTFS hardlinks, concurrent root-path replacement, and validation-to-mount races;
- WSL shared mounts, WSLg sockets, `/init`, binfmt handlers, and other host-integration surfaces;
- reads or writes to sibling projects, other Windows drives, Windows user profiles, Linux auth/policy
  state, or persistent Linux home state;
- loopback, WSL gateway, LAN, DNS, Unix-socket, and public-internet access by tool processes;
- renderer IPC forgery, stale native confirmation, mode races, and run-snapshot mutation;
- missing sandbox dependencies, unsupported versions, partial setup, app crash, and stale mounts.

### Out of scope

- Windows administrator, kernel, hypervisor, or WSL2 escape attacks;
- compromise of the signed provider CLI itself or the provider service;
- a user manually modifying the root-owned distribution as administrator;
- protecting the computer after the user deliberately authorizes Full Computer;
- public distribution rights for subscription-backed provider CLIs;
- running arbitrary Windows-only build tools from Workspace mode.

The app must describe these limits accurately. Workspace is a real host-content boundary, not a claim
that WSL2 or provider software is invulnerable.

## Hostile verification gate

The gate uses unique temporary fixtures and records every result before deciding availability. It does
not abort after the first failed security assertion. Cleanup still runs in `finally`, and cleanup
failure independently fails the gate.

### Generic broker probes

Run as the exact unprivileged user in the exact namespace used for provider runs:

1. read and write a fixture inside `/workspace`;
2. deny reads and writes to a same-volume sibling Windows fixture outside the selected project;
3. prove `/mnt/c`, `/mnt/z`, drive roots, user profiles, and unrelated Windows paths are absent;
4. prove `/mnt/wsl`, `/mnt/wslg`, `/run/WSL`, `/init`, WSLg Wayland/Pulse/X11 sockets, WSL GUI
   environment variables, and binfmt Windows interop are absent or inaccessible;
5. deny `cmd.exe`, `powershell.exe`, `.exe` execution, `WSL_INTEROP`, and inherited Windows PATH;
6. deny Linux symlink, Windows junction/reparse-point, and same-volume NTFS hardlink escapes;
7. hold the Windows root handle while a concurrent replacement is attempted and prove the mount-time
   identity/sentinel gate rejects every path-swap race;
8. deny reads/writes to provider auth, app policy, root-owned executables, Linux home persistence, and
   other run state except the allowed temp directory;
9. prove child/grandchild/background processes inherit the filesystem and interop boundary;
10. prove Stop/timeout kills the full tree and removes mount/temp state;
11. prove a crash-recovery run removes a deliberately simulated stale run before proceeding.

Outside-read targets must be genuine sibling fixtures, never `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, temp,
or another intentionally allowed runtime path.

### Codex-specific probes

- installed Linux version and exact executable path;
- app profile integrity and untrusted-project handling;
- workspace read/write plus outside read/write and child network denial through `codex sandbox`;
- hostile project config requesting danger-full-access, hooks, rules, web search, and network;
- effective-tool enumeration and attempted MCP, connector/app, remote-browser, and computer-use calls
  proving that every non-local tool surface is disabled independently of the permission profile;
- no hook/MCP/rule sentinel creation;
- loopback, WSL gateway, LAN, DNS, public-network, and Unix-socket denial for tool processes and their
  descendants while controlling-CLI provider traffic still succeeds;
- malformed/oversized JSONL terminates the supervised process tree.

### Claude-specific probes

- installed Linux version, `bubblewrap`, `socat`, seccomp, and AppArmor readiness;
- `failIfUnavailable` produces a hard failure when a dependency is deliberately hidden;
- resolved managed policy contains every lock and no weaker-sandbox/unsandboxed exception;
- resolved setting sources contain managed policy only;
- hostile project allow rules, read paths, domains, `excludedCommands`, hooks, MCP servers, plugins,
  and sandbox-disable settings do not change the resolved policy or run unsandboxed code;
- Bash descendants deny loopback, WSL gateway, LAN, DNS, public-network, and Unix-socket access while
  controlling-CLI provider traffic still succeeds;
- direct WebFetch and WebSearch attempts are denied before a network request is made;
- built-in Read/Edit/Write permission rules reject outside paths while allowing `/workspace`.

The outer mount gate is the deterministic host boundary even when a model is not signed in. Optional
live provider smoke tests verify event mapping and user experience; they are not substitutes for the
deterministic gate.

### Full Computer tests

Canonical tests use fake processes plus temporary harmless sentinels. They prove:

- new real-provider drafts default to Full Computer;
- renderer confirmation forgery is rejected;
- cancellation leaves no runnable authorization;
- one accepted native confirmation is bound to one saved connection;
- the native executor receives explicit full-access arguments and never WSL Workspace arguments;
- a temporary outside-workspace read/write and local network probe can succeed only after acceptance;
- all required Full Computer badges remain visible;
- switching modes affects only the next run and never triggers fallback.

No canonical test modifies a real personal file or performs a real full-access model run.

## Post-Hoc Banana Baron animation milestone

### Existing source and status

Claude Pet currently ships only a six-frame idle strip:

- `assets/spritesheet-mvp.png`: 1152 x 208;
- `assets/pet.json`: one `idle` state.

The prepared generation run is:

`Z:\Downloads\Code\Arnav Vijay\.hatch-pet-runs\post-hoc-banana-baron`

`base` and `idle` are complete. The other seven distinct generated strips plus the derived/validated
left-running strip are pending. The large identity reference previously caused `413 Payload Too
Large`; all grounded row generation must use `references/canonical-base-small.png` together with the
matching layout guide.

### Final atlas contract

The canonical atlas is 1536 x 1872, eight columns by nine rows, with 192 x 208 cells. Unused cells in
short rows are fully transparent.

| Row | State | Frames | Duration | Product meaning |
|---:|---|---:|---:|---|
| 0 | `idle` | 6 | 180 ms | no active run |
| 1 | `running-right` | 8 | 90 ms | pet dragged right |
| 2 | `running-left` | 8 | 90 ms | pet dragged left |
| 3 | `waving` | 4 | 140 ms | greeting or successful connection action |
| 4 | `jumping` | 5 | 110 ms | goal accepted / run starting |
| 5 | `failed` | 8 | 130 ms | failed, blocked, or stopped run |
| 6 | `waiting` | 6 | 180 ms | setup, sign-in, warning, or user action required |
| 7 | `running` | 6 | 110 ms | active agent work |
| 8 | `review` | 6 | 160 ms | completed response ready for review |

The manifest supports a per-state frame duration, loop behavior, and optional `nextState`. Directional
and active states loop while their condition remains true. `waving`, `jumping`, and `failed` play once
and transition to the current durable state. `review` loops until the response is dismissed or a new
run begins.

### Generation and QA workflow

When the animation milestone begins, use the installed Hatch Pet workflow composed with ImageGen:

1. keep the completed base and idle sources;
2. generate one pending row per lightweight worker from its row prompt, retry prompt, layout guide,
   and compact canonical identity reference;
3. select and record one source before mutating the manifest;
4. generate and visually approve `running-right` first;
5. mirror `running-left` frame-by-frame only if visual QA confirms that sunglasses, banana, money,
   anatomy, lighting, and movement remain correct; otherwise generate it independently;
6. extract frames, inspect connected components, compose PNG/WebP atlases, validate dimensions and
   transparency, make a contact sheet, and render GIF previews;
7. reject text, logos, guide marks, speed lines, dust, detached props, identity drift, magenta halos,
   clipped anatomy, inter-cell spill, or inconsistent grounding;
8. copy the validated WebP atlas into Claude Pet only after every state passes, update `pet.json`, and
   retain the old idle asset until the replacement is proven in the real Electron window.

The source run remains the generation workspace. This milestone integrates the result into Claude
Pet; it does not install or overwrite a global Codex pet unless the user separately requests that.

The current asset bridge hardcodes an `image/png` data URL and the state machine has one global frame
duration. The milestone must make the bridge MIME type match the validated WebP asset and extend the
manifest/state machine for the per-state duration, loop, and next-state contract above. Tests cover
both changes before the manifest switches away from `spritesheet-mvp.png`.

### Runtime animation ownership

Main process derives an allowlisted pet state from pointer movement, setup status, immutable run
status, response status, and sanitized activity. The renderer receives only the state name and draws
frames; it cannot start a provider run or alter permission state.

- pointer drag selects `running-right` or `running-left` and returns to the durable state on release;
- app greeting or a successful connection action triggers one `waving` cycle;
- accepted goal triggers `jumping`, then `running` when execution begins;
- required setup/sign-in/confirmation uses `waiting`;
- manager busy/activity uses `running`;
- failure, permission block, or Stop triggers `failed`, then `idle`;
- successful completion uses `review` until dismissed;
- otherwise the pet uses `idle`.

Transitions are tested with a fake clock so a transient animation cannot get stuck, overwrite a newer
run state, or be driven by stale activity from a prior run.

## Delivery decomposition

After the user approves this written spec, the canonical plan tail is rewritten into small serial
milestones with a user gate after each:

1. repair the production CLI resolver and replace the invalid native probe evidence;
2. implement the main-owned, warned Full Computer default and permanent badges;
3. provision and integrity-check the dedicated WSL2 distribution and broker;
4. run Codex and Claude Workspace executors through the verified WSL boundary;
5. generate, validate, and integrate the complete animation atlas;
6. finish pet/file/tray integration and produce the shareable package.

The exact task numbers and file-by-file red/green steps belong in the implementation plan, not this
design. Completed Tasks 1-12 remain preserved. The existing Tasks 13-15 tail is not executed while it
contradicts this redesign.

## Acceptance criteria

The redesign is complete only when all of the following are true:

- production native CLI discovery works without dependency injection and has a regression test;
- every new Codex/Claude connection defaults to visibly warned Full Computer;
- Full Computer cannot run without its connection-bound native confirmation;
- Full Computer uses the native Windows CLI, has broad authority, and stays permanently badged;
- Workspace uses the dedicated WSL2 distro and exposes only the selected project from Windows;
- WSL automount, interop, Windows PATH, sudo, unapproved hooks/MCP/plugins, and child network are off;
- Codex and Claude each pass the complete generic and provider-specific hostile matrix;
- every failed/missing boundary component fails closed with no mode fallback;
- provider login remains official and credentials never cross renderer IPC or the workspace mount;
- mode/settings changes affect only the next immutable run snapshot;
- all nine pet states pass deterministic atlas validation and visual QA;
- real Electron state transitions drive the complete atlas without stale or stuck states;
- canonical spec, research, project context, implementation plan, build log, and checklist agree;
- every implementation milestone has fresh tests, exact Git evidence, and its required manual gate.

## Non-goals

- making native Windows Workspace mode appear safe;
- using a prompt, Windows ACL tweak, or Claude safe mode as the missing OS boundary;
- silently using Full Computer when Workspace is unavailable;
- sharing a personal WSL distribution or automounting all Windows drives;
- enabling project-command internet access in Workspace mode;
- supporting Windows-only tools from the WSL Workspace executor;
- installing Docker, a third-party VM, Windows Sandbox, or full Hyper-V for this design;
- changing completed Tasks 1-12 except for focused prerequisite defect repairs;
- publishing or marketing subscription-backed CLI integration before terms are rechecked;
- installing the generated atlas as a global Codex pet without a separate request.

## Primary sources

- OpenAI, [Sandbox](https://learn.chatgpt.com/docs/sandboxing): sandboxing is the technical boundary,
  approvals are separate, and Linux/WSL2 uses bubblewrap.
- OpenAI, [Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox): Windows 10 is
  best-effort and WSL is appropriate when native modes do not meet the requirement.
- OpenAI, [WSL](https://learn.chatgpt.com/docs/windows/wsl): Codex runs with the Linux sandbox in
  WSL2; current Codex no longer supports WSL1.
- Anthropic, [Configure the sandboxed Bash tool](https://code.claude.com/docs/en/sandboxing): Claude's
  sandbox supports Linux/WSL2, not native Windows; WSL requires bubblewrap/socat and can hard-fail
  with `failIfUnavailable`.
- Anthropic, [Claude Code settings](https://code.claude.com/docs/en/settings): Linux/WSL managed
  policy lives under `/etc/claude-code/` and provides managed-only permission, hook, MCP, read-path,
  and domain locks.
- Microsoft, [Install WSL](https://learn.microsoft.com/windows/wsl/install),
  [Advanced settings configuration](https://learn.microsoft.com/windows/wsl/wsl-config), and
  [Basic commands](https://learn.microsoft.com/windows/wsl/basic-commands).
