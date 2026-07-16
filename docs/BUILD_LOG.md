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
