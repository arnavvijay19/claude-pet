# Claude Pet — Deep Research Knowledge Base

Compiled 2026-07-15 from web research + the existing spec (`docs/superpowers/specs/claude-pet-spec.md`) and plan (`docs/superpowers/plans/2026-07-13-claude-pet.md`). This is the durable "everything a session needs to know" doc. The tiny framework distilled from it lives in `docs/project-context.md` territory / the plan itself.

---

## Part A — How to run a long project with AI (methodology)

Sources: [official Claude Code best practices](https://code.claude.com/docs/en/best-practices), [chudi.dev 2026 field guide](https://chudi.dev/blog/claude-code-complete-guide), [SDD in action (alexop.dev)](https://alexop.dev/posts/spec-driven-development-claude-code-in-action/), [DataCamp SDD tutorial](https://www.datacamp.com/tutorial/spec-driven-development-with-claude-code), [managing multiple sessions](https://aiskill.market/blog/managing-multiple-claude-code-sessions), [shanraisshan/claude-code-best-practice](https://github.com/shanraisshan/claude-code-best-practice).

### The document hierarchy (spec → plan → code)
- **Spec** = what to build (exists: `claude-pet-spec.md`). **Plan** = numbered tasks with file paths (exists: `2026-07-13-claude-pet.md`). **Code** follows the plan, one task at a time, human review between tasks.
- Specs are **recovery points**: when a session rots or dies, the next session reloads spec + plan, not chat history. Commit them.
- For months-long projects add a **project-context.md**: architecture decisions, constraints, vocabulary — things that never change session-to-session. ~30 min to write, saves re-derivation every session.

### Session hygiene
- Sessions degrade: context rot starts around **30–40% context usage**; failed attempts and tangents poison later output.
- **One session = one goal, one verification path, one final diff.** `/clear` between goals.
- If Claude goes wrong twice on the same thing: **rewind/restart with a sharper prompt** instead of correcting in place — fresh session + better prompt beats long session + accumulated failure.
- Checkpoint (commit) every 45–60 minutes on long tasks.

### Guardrails
- Plan mode / staged execution: "do step one, then stop and show me" — catch wrong turns at step 1, not step 6.
- **Demand evidence**: the most-cited failure mode is the model claiming "tests pass" without running them. Superpowers `verification-before-completion` enforces this — invoke it.
- **Red-team pass**: before executing a plan, have a fresh subagent read the spec cold looking for holes.
- Subagents keep the main session lean: orchestrate in main, execute in fresh-context workers (superpowers `subagent-driven-development` — already the plan's required sub-skill).
- Review at **phase gates**, not mid-implementation.

### Applied to this user's setup
- Superpowers loop (brainstorm → spec → plan → execute → verify → finish) is already the top-recommended solo-dev SDD framework; the existing plan already mandates it.
- Usage discipline doubles here: freemodel free-tier for the *build*, and the real account (suspended until appeal ~2026-07-23, trial ends 2026-07-17) is only needed for the Phase-5 end-to-end test. Phases 1–4 need zero real-account usage.

---

## Part B — How to build THIS project (Electron desktop pet specifics)

### B1. Prior art — read these repos before writing window/animation code
- **[Clawd](https://github.com/KebeliSamet0/clawd)** — pixel-art Claude mascot pet, Windows, Electron + vanilla JS, transparent/frameless/always-on-top, tray-resident, idle/typing/thinking/sleeping/error animations. Closest existing thing to this project.
- **[clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk)** — pet that *watches* Claude Code/Codex: hook auto-sync, cursor eye-tracking, floating permission-bubble cards. Reference for the deferred hook-reactions phase.
- **[xtrimsystems/claude-pet](https://github.com/xtrimsystems/claude-pet)** — Shimeji-style Claude Code pet; hooks write state changes to a file, pet process polls it — simplest external-event IPC pattern.
- **[OpenPets](https://github.com/alvinunreal/openpets)** — platform version; its MCP server + `~/.claude/settings.json` hook install is a working reference for agent-driven pets.
- IP rule from the spec still applies: read for architecture, copy nothing (code, assets, branding).

### B2. Electron transparent-overlay gotchas (Windows 10)
Sources: [electron#1335](https://github.com/electron/electron/issues/1335), [electron#23042](https://github.com/electron/electron/issues/23042), [transparency demo](https://github.com/toonvanvr/electron-transparency-demo), [electron-transparency-mouse-fix](https://www.npmjs.com/package/electron-transparency-mouse-fix), [frameless window docs](https://zeke.github.io/electron.atom.io/docs/api/frameless-window/).

- **Transparent areas are NOT click-through by default** (native per-pixel click-through was removed after Electron 6.1.9). The whole window eats clicks.
- The fix is `setIgnoreMouseEvents(true, { forward: true })` — the `forward` option is **Windows-only** (lucky us): mousemove still reaches the page while clicks pass through. Standard pattern: ignore-mouse globally, flip to `false` when the forwarded mousemove is over the sprite, back to `true` on leave. (MVP can skip this — a window sized exactly to the sprite barely overlaps anything — but it's the known fix if the pet blocks clicks.)
- **Drag & drop breaks under ignore-mouse** — drop events get eaten. So: either don't enable ignore-mouse (MVP), or disable it while a drag is in progress.
- `-webkit-app-region: drag` swallows HTML5 drop events and misbehaves with devtools open → **manual window-move** (mousedown deltas → IPC → `win.setPosition`) is correct; the existing plan already does this.
- Transparent windows must be `resizable: false`; add `hasShadow: false`.
- Plain `alwaysOnTop: true` loses to other topmost windows: use `setAlwaysOnTop(true, 'screen-saver')` (plan already does) and consider `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`. For focus-stealing problems: `focusable: false`, `showInactive()`.
- **Never trust devtools-open behavior** for drag/transparency testing.

### B3. Desktop-pet architecture patterns (Shimeji lineage)
Source: [Shimeji-ee](https://kilkakon.com/shimeji/), [shimeji topic](https://github.com/topics/shimeji?o=asc&s=stars), DPET guide.

- Canonical design = **three separated layers**: sprite frames (art) / actions (animation sequences + movement deltas) / behaviors (when + why transitions fire, frequency-weighted random selection). Shimeji's actions.xml / behaviors.xml split.
- Our `pet.json` manifest = the actions layer (data-driven, renderer reads states generically). A behaviors layer (weighted idle variety, wander) is a later add that touches only the manifest + a small brain module — the state machine API (`setState`/`getFrame`) doesn't change.
- Full Shimeji state set (walk/climb/fall/grab, window edges as platforms) is explicitly out of scope; noted so nobody "helpfully" adds it.

### B4. Electron + AI-assisted build workflow
Sources: [Stephan Miller's Electron-from-scratch log](https://www.stephanmiller.com/electron-project-from-scratch-with-claude-code/), [visual feedback loop (juri.dev)](https://juri.dev/articles/visual-feedback-loop-electron-apps-claude-code/), [Electron agent skills overview](https://nothans.com/claude-code-and-agent-skills-for-electron-app-development-your-desktop-app-just-got-a-cheat-code), [electron-pro subagent](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/01-core-development/electron-pro.md).

- Miller's hard lesson: **plan the architecture, not just features** (he retrofitted a plugin architecture painfully). Here: the pet.json contract + IPC boundary are that architecture — settle them first (they are settled; don't churn them).
- **Electron fails silently**: builds and unit tests pass while the window renders blank or the IPC bridge is dead. An AI agent without visual verification is coding blind. Fix: screenshot/CDP verification each visual phase — `npx skills add vercel-labs/agent-browser --skill electron`, or the already-installed chrome-devtools-mcp plugin against the Electron renderer.
- Electron skills exist that pre-load correct main/renderer/IPC/context-isolation patterns; the existing plan already encodes the big version-specific traps:
  - `File.prototype.path` removed in Electron 32 → `webUtils.getPathForFile()` in preload.
  - Windows `.cmd` shims need `shell: true` (Node ≥20.12 EINVAL, CVE-2024-27980) → prompt text must be piped via **stdin**, never argv.
  - `contextIsolation: true`, `nodeIntegration: false`, everything through preload's `contextBridge`.

### B5. Claude Code hooks (for the deferred reactions phase)
Sources: [official hooks guide](https://code.claude.com/docs/en/hooks-guide), [21-event lifecycle breakdown](https://claudefa.st/blog/tools/hooks/hooks-guide), [statusline fields](https://gist.github.com/AKCodez/ffb420ba6a7662b5c3dda2edce7783de), [Coding Agent Explorer bridge pattern](https://nestenius.se/net/exploring-claude-code-hooks-with-the-coding-agent-explorer-net/).

- Hooks = shell commands on lifecycle events, JSON on stdin. Pet-relevant: `Notification` (needs input/permission), `Stop` (finished), `SubagentStop`, `PostToolUse`.
- Companion-app pattern: hook script does **one HTTP POST to a local port** → app reacts. Our promptServer already listens on 127.0.0.1:47611; a future `/event` route is the natural extension. File-write + poll (xtrimsystems) is the even simpler fallback.
- Statusline is the only source of *live* context-percentage metrics if the pet should ever react to context filling.
- **Compliance note**: hooks firing pet *animations* is free and safe (no API calls, no prompts). Hooks must never *send prompts* — that would be autonomous prompting, banned by the spec.

---

## Part C — Architectural layouts (reference)

### C1. This project (from the plan — settled, don't churn)
```
Electron main process
├─ main.js            window (frameless/transparent/alwaysOnTop/tray) + IPC handlers
├─ preload.js         contextBridge: getManifest / onPrompt / onResponse /
│                     sendDroppedFile (webUtils) / moveWindowBy
├─ bridge/promptServer.js   loopback HTTP 127.0.0.1:47611, POST /prompt
└─ bridge/claudeClient.js   spawn `claude -p` via stdin; CLAUDE_CONFIG_DIR=~/.claude-pet;
                            strips ANTHROPIC_BASE_URL/API_KEY/AUTH_TOKEN
Renderer (vanilla JS, no framework)
├─ pet.js             pure state machine: createPetStateMachine(manifest) →
│                     { setState(name), getFrame(elapsedMs) → {row, column} }
└─ renderer-main.js   canvas draw loop, manual drag, drop handler, speech bubble
Assets
├─ pet.json           THE contract: { id, states: {name: {row, frameCount}},
│                     frameWidth/Height, frameDurationMs, spritesheetPath }
└─ spritesheet-mvp.png  idle-only, from existing hatch-pet frames, zero image-gen
```
Invariants (mirror the Arnav Vijay console's discipline):
1. Renderer never touches Claude, filesystem, or network — IPC only.
2. claudeClient is the only credential-aware module; one prompt in, one string out; no queue, no retry loop, no concurrency (compliance is architectural).
3. pet.json is the single shared shape — new animations are manifest edits, not code.
4. Real-account path never sees freemodel env; freemodel CLI never sees `~/.claude-pet`.

### C2. Reference layouts from prior art (for comparison, not adoption)
- **Clawd**: single Electron window, vanilla JS, tray menu, animation states as sprite rows — validates our exact shape.
- **Shimeji-ee**: art / actions / behaviors triple split — our manifest covers art+actions; behaviors = future optional module.
- **clawd-on-desk / OpenPets**: hook-or-MCP event ingestion → pet state changes — future phase, plugs into promptServer as a new route without touching the renderer contract.

---

## Open questions / watch items — resolved 2026-07-15 (except the appeal)

- **`CLAUDE_CONFIG_DIR` — VERIFIED WORKING** on the installed CLI (v2.1.201, Windows/Git Bash): with the var set, a harmless `claude config list` created the directory fresh containing its own `.claude.json`, `projects/`, `sessions/`, etc. The Windows caveat from multi-account writeups (global state in `~\.claude.json` shared across profiles) does **not** apply on this version — `.claude.json` lives *inside* the config dir. The HOME-override fallback in plan Task 6 Step 1 is unnecessary; keep it only as documentation. Critical corollary: env vars `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_BASE_URL` **bypass config-dir isolation entirely** ([confirmed by multi-account guides](https://joshcgrossman.com/2026/02/04/claude-two-accounts-windows/)) — claudeClient's env-stripping is load-bearing for compliance, not belt-and-braces.
- **Click-through vs drag-drop — DECIDED: MVP ships with no `setIgnoreMouseEvents` at all.** The conflict is fundamental, not a bug to work around: `forward: true` delivers only mouse-*move* events; clicks and drops always pass through ([Electron docs](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions), [electron#38396](https://github.com/electron/electron/issues/38396)), and forwarding silently breaks after a page reload on Windows ([electron#15376](https://github.com/electron/electron/issues/15376)). The sprite-sized window barely overlaps anything, so click-through buys nothing. If ever added: toggle ignore **off** whenever the cursor is over the sprite and never during a drag.
- **Electron visual verification — recipe confirmed.** The installed chrome-devtools-mcp plugin's config has fixed args (launches its own Chrome; no `--browserUrl`), so to inspect the pet renderer: (1) main.js gates `app.commandLine.appendSwitch('remote-debugging-port', '9222')` + `appendSwitch('remote-allow-origins', '*')` behind `PET_DEBUG=1`; (2) a project-local `.mcp.json` registers `npx chrome-devtools-mcp@latest --browserUrl=http://127.0.0.1:9222`; (3) the agent uses `take_screenshot`/`take_snapshot` against the running window ([Electron+CDP-MCP recipe](https://carljin.com/%E4%BD%BF%E7%94%A8-chrome-devtools-mcp-%E8%B0%83%E8%AF%95-electron-%E5%BA%94%E7%94%A8/)). `--ws-endpoint` is the fallback if browserUrl misbehaves. The `stealth-browser` skill is **not applicable** here: it drives its own Chromium and cannot attach to an Electron window — it solves bot-detection on third-party sites, which this project never touches; given the account's compliance posture, don't reach for it in this repo.
- Real account suspended until appeal decision (~2026-07-23); trial ends 2026-07-17 — Phase 5's live test may need to wait or the account situation may change entirely. Phases 1–4 are unblocked.
