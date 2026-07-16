# Build log & field notes

Two sections. Every session appends; no session rewrites history (fix mistakes by adding a
correcting line, or — for field notes — editing the stale note in place and noting the edit).

## Session log

One entry per session, appended at the **bottom**, written **before the session ends** (not
optional — an unlogged session is a failed session even if its code worked). Format:

```
- **YYYY-MM-DD · <model> · <task/phase>** — what got done (with commit hash), what's verified
  (name the evidence: test output, screenshot), what's blocked/next. One to three lines.
```

<!-- entries below -->

- **2026-07-15 · claude (freemodel) · docs** — Research integration finished (`866abff`), AI
  deployment strategy + this log added. No code yet; next unstarted work is plan Task 1.

- **2026-07-16 · Fable 5 (freemodel) · Task 1 (MVP sprite extraction)** — Done, on worktree
  branch `worktree-task-1-mvp-sprite-extraction` (no remote exists; user merges to master).
  Delivered `scripts/extract_mvp_sprite.py`, `tests/test_extract_mvp_sprite.py` (pytest,
  1 passed ~2.4s), and generated `assets/spritesheet-mvp.png` (1152x208), `assets/pet.json`,
  `assets/tray-icon.png` (32x32). Verified: green test + visual inspection of atlas over a
  checkerboard (6 clean transparent frames, no magenta halo, aspect preserved). The plan's
  original Step 3 snippet was wrong 3 ways (magenta bg kept, aspect squashed, off-grid frames
  sliced) — superseded in place; see the Task 1 correction block in the plan. Next: Task 2.

- **2026-07-16 · Fable 5 (freemodel) · post-Task-1 docs** — Follow-up on the Task 1 branch
  before handing off to Task 2: re-ran the suite (1 passed), moved the Task 1 entry above out
  of Field notes into this section (placement fix, content verbatim), and expanded plan Task
  2's `.gitignore` snippet to cover the Python/worktree artifacts Task 1 introduced
  (`__pycache__/`, `.pytest_cache/`, `.claude/worktrees/`). The `pet.json` contract is
  untouched — Tasks 3/4/7 consume it exactly as planned. NEXT (user, before the Task 2
  session): commit the uncommitted `project-context.md` edit in the main checkout, then from
  `Z:\Downloads\Code\Claude Pet` on `master` run
  `git merge worktree-task-1-mvp-sprite-extraction` — an unmerged Task 1 would make the next
  session redo it. Then Task 2 via the standard entry prompt (hard task — Fable high/xhigh
  per the model policy; xhigh is better saved for Tasks 4/6/7 where the silent failures live).

- **2026-07-16 · Fable 5 (freemodel) · integration** — The NEXT items above are done (user
  delegated them): `master` fast-forwarded to `9b160dc`, his `project-context.md` tweak
  committed as `87ff927`, suite green on merged `master` (1 passed, 2.30s). Nothing pending —
  the next session starts plan Task 2 directly via the standard entry prompt.

- **2026-07-16 · Fable 5 (freemodel) · Task 2 (Electron scaffold)** — Done, on worktree branch
  `worktree-task-2-electron-scaffold` (`17f4e57` = package.json + .gitignore exactly per plan;
  docs commit follows). Verified: `npm install` completed, `node_modules/.bin/electron` exists,
  and `./node_modules/.bin/electron --version` → `v33.4.11` (pasted output, not assumed —
  needed because of the allowScripts warning, see field note). `package-lock.json` left
  untracked per the plan's Step 4 note. No `npm start` smoke test — `src/main.js` doesn't exist
  until Task 4, exactly as the plan expects. NEXT (user): from `Z:\Downloads\Code\Claude Pet`
  on `master` run `git merge worktree-task-2-electron-scaffold`, then re-run `npm install` in
  the main checkout (node_modules lives only in the worktree and is git-ignored). Then Task 3.

- **2026-07-16 · Fable 5 (freemodel) · integration** — The NEXT items above are done (user
  delegated them, same session): `master` fast-forwarded to `e8bb227`, `npm install` re-run in
  the main checkout, `./node_modules/.bin/electron --version` → `v33.4.11` there too (pasted).
  Nothing pending — the next session starts plan Task 3 directly via the standard entry prompt
  (mechanical task per the model policy; worktree recommended, branch off `master`).

## Field notes

Things discovered mid-work that the plan/research didn't predict: a solution to a surprise
problem, a gotcha, an idea worth doing later, a better approach than the planned one. **Write
these the moment they come up, not at session end** — a note not written down is lost to the
next session. Keep each note 1–3 lines, dated. Prefix with one of:

- `FIX:` — a problem hit and how it was actually solved
- `GOTCHA:` — something that looks broken/fine but isn't (save the next session the hunt)
- `IDEA:` — new feature/improvement thought of on the fly (do NOT act on it mid-task; log it here)
- `SUPERSEDE:` — a planned approach that turned out wrong, and what replaced it (also update the plan)

If a note changes a decision recorded in RESEARCH.md or the plan, update **that** doc too and
link the note to it — this file is the inbox, not the archive.

<!-- notes below -->

- 2026-07-15 `GOTCHA:` This machine's session env header may claim macOS/darwin with a fake
  `/Users/dev/...` cwd — it's Windows 10 via Git Bash. Use `Z:\...` / `/z/...` paths. Backslash
  paths break in double-quoted Bash strings; use forward slashes.
- 2026-07-15 `GOTCHA:` Python stdout here defaults to cp1252 — Unicode output needs
  `python -X utf8`.
- 2026-07-16 `SUPERSEDE:` Plan Task 1's naive slot-crop extractor replaced with chroma-key +
  connected-components + aspect-fit (details in the plan's Task 1 correction block). Root
  facts: idle.png is RGB on noisy #FF00FF, sprites drift off the 362px grid and cross slot
  boundaries.
- 2026-07-16 `GOTCHA:` LANCZOS downscale of keyed sprites rings alpha back up to 1-8 and
  recreates #FF00FF specks from despilled edges — scrub resized output (alpha<=8 -> drop,
  re-despill min(r,b)-g) or magenta survives. Implemented as clean_resized() in the extractor.
- 2026-07-16 `GOTCHA:` The Read/Bash tools can't stat files inside the references folder the
  user added at 01:30 ("I just noticed these...") — path >260 chars (Windows MAX_PATH) once
  the ig_*.png names are included. Directory listing works; per-file access fails. Copy/rename
  with short names via Explorer, or use \?\ paths.
- 2026-07-16 `IDEA:` (logged, not acted on) That folder holds 3 never-decoded row strips from
  the 2026-07-12 Codex run — one confirmed 8-frame running-right + 2 unidentified. Task 8 can
  skip generating those rows; note added to Task 8 in the plan. The other 2 files are
  md5-identical dupes of decoded/idle.png and decoded/base.png — safe to delete.
- 2026-07-16 `GOTCHA:` `npm install` here warns `electron@33.4.11 (postinstall: node install.js)`
  is "not yet covered by allowScripts" — looks like the Electron binary download was blocked,
  but it wasn't: `node_modules/electron/dist/electron.exe` exists and `--version` runs fine.
  Don't chase `npm approve-scripts` unless the dist/ folder is actually missing.
- 2026-07-16 `GOTCHA:` A session whose cwd starts inside an old task worktree is write-locked to
  it — Write to the shared checkout is refused ("session is now isolated"). Fix: `git worktree
  add` a new task worktree from `master` and switch into it; don't work on the stale branch.
- 2026-07-16 `SUPERSEDE:` Plan Task 2 Step 4's "don't commit package-lock.json" note was wrong
  (it claimed `.gitignore`'s `node_modules/` excluded it — it doesn't; the file just sat
  untracked, permanently dirtying `git status`). Lockfile committed in `92d5738` (pins electron
  33.4.11); plan note struck through in place.
- 2026-07-16 `GOTCHA:` `npm start` between Task 2 and Task 4 fails with "Unable to find
  Electron app" — **expected, not a regression or a faked Task 2**. `package.json` declares
  `"main": "src/main.js"` up front (per plan Task 2 Step 1) but that file is a *Task 4*
  deliverable (plan line 393: "Create: src\main.js, src\preload.js"); Task 2's own test line
  says "none (config-only task; verified by npm install + npm start ... in Task 4)". A review
  session on 2026-07-16 misread Task 4's file list (plan lines ~396+) as Task 2's spec and
  called Task 2 a fake completion — verified wrong: `17f4e57` contains exactly what Task 2
  promised, and the Task 2 log entry explicitly stated main.js doesn't exist until Task 4.
  Also: the empty `src/bridge/` + `src/renderer/` dirs in the main checkout are dated Jul 13
  (planning day), untracked-by-git leftovers — not evidence any session created-then-abandoned
  code. Don't "fix" the npm start error; it disappears when Task 4 lands.
