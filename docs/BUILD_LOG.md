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
- **2026-07-16 · Fable 5 (freemodel) · Task 1 (MVP sprite extraction)** — Done, on worktree
  branch `worktree-task-1-mvp-sprite-extraction` (no remote exists; user merges to master).
  Delivered `scripts/extract_mvp_sprite.py`, `tests/test_extract_mvp_sprite.py` (pytest,
  1 passed ~2.4s), and generated `assets/spritesheet-mvp.png` (1152x208), `assets/pet.json`,
  `assets/tray-icon.png` (32x32). Verified: green test + visual inspection of atlas over a
  checkerboard (6 clean transparent frames, no magenta halo, aspect preserved). The plan's
  original Step 3 snippet was wrong 3 ways (magenta bg kept, aspect squashed, off-grid frames
  sliced) — superseded in place; see the Task 1 correction block in the plan. Next: Task 2.

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
