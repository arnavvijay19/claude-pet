# Claude Pet — Project Context (the really small framework)

Read this first, every session. It's the whole project in one page.
Details live in [`superpowers/specs/claude-pet-spec.md`](superpowers/specs/claude-pet-spec.md) (what & why),
[`superpowers/plans/2026-07-13-claude-pet.md`](superpowers/plans/2026-07-13-claude-pet.md) (exact tasks),
and [`RESEARCH.md`](RESEARCH.md) (evidence & prior art behind every decision below).

## One sentence

A transparent always-on-top Electron window draws the existing Banana Baron sprite from a
`pet.json` manifest; prompts arrive by drag-drop or a localhost POST; one isolated module pipes
them to the real-account `claude` CLI one at a time, and the reply shows in a speech bubble.

## Architecture — 5 modules around 1 contract

```
            ┌────────────────────────── Electron main process ─────────────────────────┐
            │  main.js ── window (frameless, transparent, always-on-top) + tray        │
            │     │                                                                     │
            │  promptServer.js ── POST /prompt on 127.0.0.1:47611  ──┐                  │
            │                                                        ▼                  │
            │  claudeClient.js ── ONLY module that touches the real account:            │
            │     spawn `claude -p` · prompt via stdin · CLAUDE_CONFIG_DIR=~/.claude-pet│
            └───────────────▲───────────────────────────────────────────────────────────┘
                            │ IPC only (preload.js contextBridge)
            ┌───────────────┴──────────── renderer ────────────────┐
            │  pet.js ── state machine reading pet.json            │
            │  renderer-main.js ── canvas draw loop, drag, bubble  │
            └──────────────────────────────────────────────────────┘

            pet.json = the single shared contract (sprite grid + states).
            New behavior = manifest edits, not code.
```

## Rules (each is architectural, not stylistic — rationale in RESEARCH.md §C1)

1. **Renderer never touches Claude, files, or network.** IPC through preload only.
   (`contextIsolation: true`, `nodeIntegration: false` — see RESEARCH.md §B2/§B4 version traps.)
2. **claudeClient is the only credential-aware module.** One prompt in, one string out.
   No queue, no retry, no concurrency — the spec's compliance rules are enforced by shape.
3. **Real account and freemodel never mix.** claudeClient deletes `ANTHROPIC_BASE_URL`/`_API_KEY`/
   `_AUTH_TOKEN` and sets `CLAUDE_CONFIG_DIR`; the freemodel CLI never sees `~/.claude-pet`.
4. **No autonomous prompting, ever.** Hooks (future phase) may fire animations, never prompts.

## Build phases — all detail is in the plan; research pointers are the "read this first" per phase

| # | Phase | Proof it's done | Read first |
|---|-------|-----------------|------------|
| 1 | **Assets** — extract idle row → spritesheet + pet.json (plan Task 1) | Pillow script output matches 192×208×6 grid; unit test green | plan Task 1 |
| 2 | **Shell** — Electron scaffold + window + tray (plan Tasks 2, 4) | Window appears transparent, on top, draggable; **screenshot it** | RESEARCH.md §B2 (transparency/click-through gotchas), §B1 Clawd repo |
| 3 | **Alive** — pet.js state machine + canvas loop (plan Task 3) | Idle animation cycles at 180 ms/frame; state-machine tests green | RESEARCH.md §B3 (Shimeji art/actions/behaviors split) |
| 4 | **Ears** — promptServer + drag-drop (plan Tasks 5, 7-partial) | `curl POST /prompt` → 202 and pet reacts; file drop yields a path | RESEARCH.md §B2 (drag-region vs drop conflict), §B4 (`webUtils.getPathForFile`) |
| 5 | **Brain** — claudeClient + end-to-end (plan Tasks 6, 7) | Prompt → real reply in bubble. **Blocked until account appeal (~2026-07-23)** | RESEARCH.md §B4 (stdin/`shell:true` traps); `CLAUDE_CONFIG_DIR` verified 2026-07-15 — only manual `/login` remains |
| — | **Deferred** — remaining 7 animation rows; hook-driven reactions (plan Task 8) | Only on explicit request | RESEARCH.md §B5 (hooks patterns, xtrimsystems file-poll) |

Phases 1–4 need **zero** real-account usage. Build them now; only phase 5 waits on the appeal.

## Working method (from RESEARCH.md §A — the short version)

- One session = one phase-step, one verification, one commit. `/clear` between goals.
- Evidence before "done": run the test / take the screenshot — Electron fails silently
  (blank window, dead IPC, tests still green), so **visual verification is mandatory** for
  anything window-related (RESEARCH.md §B4; chrome-devtools-mcp plugin is installed for this).
- Two failed fix attempts → rewind to last commit, don't stack corrections.
- Prior-art repos (Clawd et al., RESEARCH.md §B1): read for architecture, copy nothing (spec's IP rule).

## AI deployment strategy (meta — how sessions of *any* model build this)

This project is built by AI sessions, not by one assistant. Sessions die, context compacts,
models vary (Claude via freemodel, GPT via Codex CLI, whatever else). The docs are the only
memory that survives. Therefore:

**Session contract — every session, any model, must:**
1. **Start** by reading this file, then [`BUILD_LOG.md`](BUILD_LOG.md) (what happened + field
   notes), then the plan section for its one task. Nothing else is assumed known.
2. **During work, take field notes in `BUILD_LOG.md` the moment things come up** — a fix for a
   surprise problem, a gotcha, an idea, a superseded decision. Don't batch them for session
   end; a compaction or crash loses unbatched notes. Format is defined at the top of that file.
3. **End** by (a) committing or explicitly reporting `git status`, (b) appending a session-log
   entry to `BUILD_LOG.md`, (c) never claiming "done" without pasted command output or a
   screenshot. A session that skips (b) has failed even if its code works.

**Model/effort policy** (a guide, not a gate — any capable model may do any task):
- **Hard tasks** — plan Tasks 2, 4, 6, 7 (Electron scaffold, transparent window, claudeClient
  spawn quirks, end-to-end integration): strongest available model, highest effort. These are
  where Windows/Electron silent failures live.
- **Mechanical tasks** — Tasks 1, 3, 5 (Pillow extraction, canvas loop, tray/server): any
  competent model, default effort.
- Model choice never changes the compliance rules — those bind every session equally.

**Order & parallelism:** Tasks 1→2→3→4 strictly serial (each builds on the last). After 4,
Tasks 5 and 6 are independent and *may* run as two parallel sessions (different files; if both
run, each stays inside its own module and the later one rebases). Task 7 last, single session.

**Standard entry prompt** (paste verbatim to start any build session, any model):

> Read `Claude Pet/docs/project-context.md` and `Claude Pet/docs/BUILD_LOG.md`, then execute
> the next incomplete task in `Claude Pet/docs/superpowers/plans/2026-07-13-claude-pet.md`.
> One task only. Follow the session contract and working method in project-context.md.

**Doc-routing rule:** field notes and session history → `BUILD_LOG.md`; changed decisions →
edit RESEARCH.md/plan in place; this file only changes when the architecture or strategy
itself changes.
