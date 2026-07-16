# Research Integration Plan (2026-07-15) — executed same session

Integrate `docs/RESEARCH.md` into the spec + implementation plan so findings live where the work happens. Constraints: no architecture/task-order changes; spec compliance rules preserved verbatim.

**Tasks (all executed 2026-07-15):**
1. Spec: append "References & verification" section (research-KB pointer, prior-art read-only rule, verified isolation, env-bypass caveat).
2. Plan Global Constraints: research-KB pointer line.
3. Plan Tasks 3–7: per-task "Read first" pointers; Task 4 `hasShadow: false` + mandatory visual-verification recipe; Task 6 isolation marked VERIFIED + `ANTHROPIC_API_KEY`-bypass warning; Task 7 drag/drop-vs-ignore-mouse warning.
4. RESEARCH.md: resolve open questions (isolation verified; interactivity model decided; devtools-mcp attach recipe; stealth-browser not applicable).
5. project-context.md: phase-5 pointer updated.

**New findings from this session's gap research:**
- `CLAUDE_CONFIG_DIR` **verified working** on installed CLI 2.1.201: `claude config list` with the var set created a separate config dir containing its own `.claude.json` — the shared-`~/.claude.json` Windows caveat ([Josh Grossman](https://joshcgrossman.com/2026/02/04/claude-two-accounts-windows/)) doesn't apply on this version. Multi-account via config dirs is a widely documented pattern ([dev.to](https://dev.to/ashishxcode/claude-code-multi-account-setup-without-losing-context-49nf), [gist](https://gist.github.com/KMJ-007/0979814968722051620461ab2aa01bf2), [wmedia.es](https://wmedia.es/en/tips/claude-code-multiple-profiles-config-dir)).
- `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` env vars **bypass config-dir isolation entirely** — Task 6's env-stripping is load-bearing for compliance.
- Click-through vs drag-drop resolved: `forward: true` forwards **mousemove only**, never clicks/drops ([Electron docs](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions), [electron#38396](https://github.com/electron/electron/issues/38396)) → MVP uses no `setIgnoreMouseEvents`. Windows bugs if revisited: [#15376](https://github.com/electron/electron/issues/15376) (dies after reload), [#33281](https://github.com/electron/electron/issues/33281) (dies with certain apps focused), [#35030](https://github.com/electron/electron/issues/35030) (drag flicker).
- Electron visual verification: installed chrome-devtools-mcp plugin launches its own Chrome — attach to the pet needs a dev-gated `remote-debugging-port` + `remote-allow-origins` switch and a separate MCP entry with `--browserUrl=http://127.0.0.1:9222` (fallback `--wsEndpoint`) ([carljin.com](https://carljin.com/%E4%BD%BF%E7%94%A8-chrome-devtools-mcp-%E8%B0%83%E8%AF%95-electron-%E5%BA%94%E7%94%A8/), [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)). Zero-config fallback: dev-only `webContents.capturePage()`. The `stealth-browser` skill is **not applicable** — it drives its own browser, can't attach to Electron, and carries exactly the risk posture this spec avoids.
