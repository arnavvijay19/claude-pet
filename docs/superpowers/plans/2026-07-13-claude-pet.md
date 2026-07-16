# Claude Pet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small always-on-top Electron desktop pet ("Post-Hoc Banana Baron") for the Claude Code Desktop app, running on the user's real Claude account (isolated from his freemodel.dev-routed CLI), that plays an idle animation, accepts prompts from a local terminal or by dragging it into apps / files and prompting it there, and shows the Companion's replies in a speech bubble or enlargable UI.  

**Architecture:** Electron shell (main process owns a frameless transparent always-on-top `BrowserWindow` + system tray + a loopback-only HTTP prompt server); the renderer is a vanilla-JS canvas sprite player reading a small `pet.json` manifest. Prompts (from drag-drop or the local HTTP endpoint) are forwarded to a `claudeClient` module that spawns the `claude` CLI as a child process with an **isolated config directory** (`CLAUDE_CONFIG_DIR`) so it authenticates as the user's own Claude account instead of inheriting his freemodel.dev environment.

**Tech Stack:** Electron (Node 24, already installed — confirmed via `node --version` → v24.18.0), vanilla JS + `<canvas>` (no frontend framework — matches the zero-dependency philosophy documented in the `arnav-vijay-project` memory), Node built-in `http`/`child_process` (no Express — same stdlib-first preference), Python 3 + Pillow for the one sprite-extraction step (reuses the existing hatch-pet skill's Pillow dependency, already proven working in `.hatch-pet-runs`).

## Research integration (added 2026-07-15)

`docs/RESEARCH.md` is the evidence base; `docs/project-context.md` is the per-session one-pager. Per-task read-first pointers: Task 1 → none new; Tasks 2/4 → RESEARCH §B1 (Clawd, read-only per the spec's IP rule) + §B2 (transparency gotchas); Task 3 → §B3; Tasks 5/7 → §B2 drag-region/drop conflict + §B4 `webUtils`; Task 6 → §B4 stdin/`shell:true` + "Open questions" (`CLAUDE_CONFIG_DIR` **verified working 2026-07-15** on CLI v2.1.201 — Task 6 Step 1's acceptance check is done; only the one-time manual `/login` remains, blocked on the appeal). **Visual verification is mandatory for Tasks 4 and 7** (Electron fails silently — §B4): after `npm start`, verify via screenshot, or attach chrome-devtools-mcp using the §Open-questions recipe (`PET_DEBUG=1` gates `remote-debugging-port` 9222 + `remote-allow-origins`; project `.mcp.json` runs `npx chrome-devtools-mcp@latest --browserUrl=http://127.0.0.1:9222`). Do **not** add `setIgnoreMouseEvents` in the MVP (breaks drop events; decided in RESEARCH §Open-questions). Work method: one session = one task, evidence before "done", two failed fixes → rewind (§A). Session contract, model policy, and field-note discipline: `docs/project-context.md` §AI deployment strategy + `docs/BUILD_LOG.md`.

## Global Constraints

- **Usage discipline (user's explicit instruction — "push Fable 5 to the best of its ability but not waste my usage"):** ship the MVP using only the two sprite rows that already exist (`base`, `idle`); do not call any image-generation tool as part of this plan. Generating the remaining 7 animation rows (`running-right`, `waving`, `jumping`, `failed`, `waiting`, `running`, `review`) is Task 8, explicitly marked deferred/optional — only execute it if the user asks, and even then follow the guardrails already written into `HANDOFF_FOR_CLAUDE.md` (small 255KB reference image, one row at a time, mirror `running-left` from `running-right` instead of generating it).
- **No new dependencies beyond Electron itself and Pillow** (both already needed/available) — no state-management libraries, no UI frameworks, no HTTP frameworks.
- **Must not touch or import the freemodel.dev-routed CLI's credentials.** This pet authenticates independently — verified explicitly in Task 6 rather than assumed.
- **ToS / account-safety compliance (spec: "Compliance & account safety"):** the real Claude account is used only via the official CLI, one prompt at a time, always user-initiated — no concurrent sessions, no automated prompt loops, no scheduled/autonomous prompting, no automated OAuth. The real-account path must never route through freemodel.dev or any similar proxy; `CLAUDE_CONFIG_DIR` isolation is for credential *separation* only, never for multiplying usage or dodging limits. No OpenAI/Codex code, assets, or branding may be copied — only the folder-layout convention is mirrored, and the only art is the user's own hatch-pet sprite. If any task would require breaking one of these, stop and ask the user instead.
- **Windows-only.** Machine is Ryzen 5 2600 / GTX 1660 Ti / 16GB (`machine-specs` memory); no cross-platform code paths needed.
- **Visual identity to preserve in any future-generated frames (Task 8):** pixel-art mischievous monkey, black sunglasses, banana, money bundle/bills, magenta `#FF00FF` background, no text/logos/shadows/speed-lines — see `Arnav Vijay/.hatch-pet-runs/post-hoc-banana-baron/prompts/rows/*.md` for the exact per-row prompts already written.

---

### Task 1: MVP sprite extraction (idle-only, no image-gen calls)

The full hatch-pet atlas pipeline (`compose_atlas.py`) hard-requires all 9 animation rows to be present — it raises `SystemExit` on any missing row (confirmed by reading `C:\Users\eklip\.codex\skills\hatch-pet\scripts\compose_atlas.py`, `compose_from_frames()`). Since only `idle` (6 frames) is done and `base` is an identity reference, not a row, we cannot use that script yet. This task writes a small standalone extractor that produces just an MVP spritesheet from what already exists — zero image-gen usage.

> **Correction (2026-07-16, executed):** the Step 3 implementation snippet below is superseded — it was wrong for the actual source image, in three ways discovered while executing:
> 1. **Source is not evenly sliceable.** `idle.png` is `2172x724` RGB, not clean 6×`362`-wide slots. The six monkeys drift off-grid and their bodies cross the slot boundaries by up to ~35px, so `crop((index*frame_width, ...))` would clip limbs and splice a neighbor's tail into the next frame. Fix: key out the background, find the six sprites as connected alpha components, group and center each (mirrors the hatch-pet skill's own `extract_strip_frames.py`).
> 2. **Background is magenta `#FF00FF`, not transparent.** The window is transparent (RESEARCH §B2), so a plain `convert("RGBA")` leaves an opaque magenta box. Fix: distance-based chroma key (threshold 96, matching the skill), plus a magenta-*spill* removal on edge pixels and a post-LANCZOS cleanup for sub-alpha ringing specks.
> 3. **Aspect ratio.** Source sprites are ~`360x455` (~0.79); resizing straight to `192x208` (~0.92) squashes them. Fix: scale-to-fit preserving aspect, centered in the cell.
>
> The shipped `scripts/extract_mvp_sprite.py` reflects all three. The manifest/CLI shape (args, `pet.json` fields, `1152x208` atlas, `32x32` tray icon) is unchanged, so Tasks 3/4/7 consume it exactly as planned. The test below was also extended with transparency/no-magenta/aspect assertions that catch these bugs.


**Files:**
- Create: `Z:\Downloads\Code\Claude Pet\scripts\extract_mvp_sprite.py`
- Create: `Z:\Downloads\Code\Claude Pet\assets\pet.json`
- Test: `Z:\Downloads\Code\Claude Pet\tests\test_extract_mvp_sprite.py`

**Interfaces:**
- Produces: `Z:\Downloads\Code\Claude Pet\assets\spritesheet-mvp.png` — a `1152x208` RGBA image, 6 columns x 1 row, each cell `192x208`, containing the 6 `idle` frames extracted from `Arnav Vijay/.hatch-pet-runs/post-hoc-banana-baron/decoded/idle.png`.
- Produces: `assets/pet.json` with shape `{ id, displayName, description, spritesheetPath, frameWidth, frameHeight, states: { idle: { row: 0, frameCount: 6 } }, frameDurationMs }` — later tasks (renderer) consume this exact shape.

- [x] **Step 1: Write the failing test**

```python
# tests/test_extract_mvp_sprite.py
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "extract_mvp_sprite.py"
SOURCE_IDLE = (
    ROOT.parent / "Arnav Vijay" / ".hatch-pet-runs" / "post-hoc-banana-baron"
    / "decoded" / "idle.png"
)


def test_extract_mvp_sprite_produces_expected_atlas(tmp_path):
    out_png = tmp_path / "spritesheet-mvp.png"
    out_json = tmp_path / "pet.json"
    out_icon = tmp_path / "tray-icon.png"

    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--idle-source",
            str(SOURCE_IDLE),
            "--output-png",
            str(out_png),
            "--output-json",
            str(out_json),
            "--output-tray-icon",
            str(out_icon),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr

    with Image.open(out_png) as atlas:
        assert atlas.size == (192 * 6, 208)

    with Image.open(out_icon) as icon:
        assert icon.size == (32, 32)

    manifest = json.loads(out_json.read_text(encoding="utf-8"))
    assert manifest["states"]["idle"] == {"row": 0, "frameCount": 6}
    assert manifest["frameWidth"] == 192
    assert manifest["frameHeight"] == 208
    assert manifest["id"] == "post-hoc-banana-baron"
```

- [x] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_extract_mvp_sprite.py -v`
Expected: FAIL — `scripts/extract_mvp_sprite.py` does not exist yet (`FileNotFoundError` / non-zero exit from `subprocess.run`).

- [x] **Step 3: Write minimal implementation**

```python
# scripts/extract_mvp_sprite.py
"""Build a 1-row MVP spritesheet (idle only) without the full hatch-pet atlas pipeline."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image

CELL_WIDTH = 192
CELL_HEIGHT = 208
IDLE_FRAME_COUNT = 6


def extract_idle_frames(idle_source: Path) -> list[Image.Image]:
    with Image.open(idle_source) as strip:
        strip = strip.convert("RGBA")
        frame_width = strip.width // IDLE_FRAME_COUNT
        frames = []
        for index in range(IDLE_FRAME_COUNT):
            left = index * frame_width
            frame = strip.crop((left, 0, left + frame_width, strip.height))
            frame = frame.resize((CELL_WIDTH, CELL_HEIGHT), Image.Resampling.LANCZOS)
            frames.append(frame)
        return frames


def build_atlas(frames: list[Image.Image]) -> Image.Image:
    atlas = Image.new("RGBA", (CELL_WIDTH * len(frames), CELL_HEIGHT), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        atlas.paste(frame, (index * CELL_WIDTH, 0), frame)
    return atlas


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--idle-source", required=True, type=Path)
    parser.add_argument("--output-png", required=True, type=Path)
    parser.add_argument("--output-json", required=True, type=Path)
    parser.add_argument("--output-tray-icon", required=True, type=Path)
    args = parser.parse_args()

    args.output_png.parent.mkdir(parents=True, exist_ok=True)
    frames = extract_idle_frames(args.idle_source)
    atlas = build_atlas(frames)
    atlas.save(args.output_png)

    # Tray icon: first idle frame downscaled; NEAREST keeps the pixel-art look.
    icon = frames[0].resize((32, 32), Image.Resampling.NEAREST)
    icon.save(args.output_tray_icon)

    manifest = {
        "id": "post-hoc-banana-baron",
        "displayName": "Post-Hoc Banana Baron",
        "description": "A mischievous pixel-art monkey with sunglasses, a banana, and a money bundle.",
        "spritesheetPath": args.output_png.name,
        "frameWidth": CELL_WIDTH,
        "frameHeight": CELL_HEIGHT,
        "frameDurationMs": 180,
        "states": {
            "idle": {"row": 0, "frameCount": IDLE_FRAME_COUNT},
        },
    }
    args.output_json.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
```

- [x] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_extract_mvp_sprite.py -v`
Expected: PASS

- [x] **Step 5: Generate the real assets (not just the test fixture)**

```bash
python scripts/extract_mvp_sprite.py \
  --idle-source "../Arnav Vijay/.hatch-pet-runs/post-hoc-banana-baron/decoded/idle.png" \
  --output-png assets/spritesheet-mvp.png \
  --output-json assets/pet.json \
  --output-tray-icon assets/tray-icon.png
```

Expected: `assets/spritesheet-mvp.png` (1152x208), `assets/pet.json`, and `assets/tray-icon.png` (32x32) created. Do not open the PNGs visually — trust the test's size assertions.

- [x] **Step 6: Commit**

```bash
git add scripts/extract_mvp_sprite.py assets/spritesheet-mvp.png assets/pet.json assets/tray-icon.png tests/test_extract_mvp_sprite.py
git commit -m "feat: extract MVP idle-only spritesheet and tray icon from existing hatch-pet frames"
```

---

### Task 2: Electron project scaffold

**Files:**
- Create: `Z:\Downloads\Code\Claude Pet\package.json`
- Create: `Z:\Downloads\Code\Claude Pet\.gitignore`
- Test: none (config-only task; verified by `npm install` + `npm start` launching an empty window in Task 4)

**Interfaces:**
- Produces: an `npm start` script later tasks assume exists.

- [x] **Step 1: Write package.json**

```json
{
  "name": "claude-pet",
  "version": "0.1.0",
  "private": true,
  "description": "Desktop pet companion for the Claude Code Desktop app.",
  "main": "src/main.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test"
  },
  "devDependencies": {
    "electron": "^33.0.0"
  }
}
```

- [x] **Step 2: Write .gitignore** *(expanded 2026-07-16 after executing Task 1: pytest/Pillow tooling and the worktree flow now exist in the repo, so their artifacts must be ignored too)*

```
node_modules/
*.log
__pycache__/
.pytest_cache/
.claude/worktrees/
```

- [x] **Step 3: Install**

Run: `npm install`
Expected: `node_modules/` created, `electron` present under `node_modules/.bin/electron`.

- [x] **Step 4: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: scaffold Electron project"
```

(~~`package-lock.json` and `node_modules/` are not committed — lockfile intentionally excluded per `.gitignore`'s `node_modules/`; add `package-lock.json` to the commit if reproducible installs matter later.~~ **Superseded 2026-07-16 post-Task-2:** that reasoning was wrong — `.gitignore`'s `node_modules/` never ignored the lockfile, it just sat untracked and dirtied `git status`. `package-lock.json` is now committed (`92d5738`), pinning electron 33.4.11 for reproducible installs. Only `node_modules/` stays ignored.)

---

### Task 3: Sprite renderer (canvas state machine)

**Files:**
- Create: `Z:\Downloads\Code\Claude Pet\src\renderer\pet.js`
- Create: `Z:\Downloads\Code\Claude Pet\src\renderer\index.html`
- Test: `Z:\Downloads\Code\Claude Pet\tests\petStateMachine.test.js`

**Interfaces:**
- Consumes: `assets/pet.json` shape from Task 1 (`{ states: { [name]: { row, frameCount } }, frameWidth, frameHeight, frameDurationMs }`).
- Produces: `createPetStateMachine(manifest)` returning `{ setState(name), getFrame(elapsedMs) }` — `getFrame` returns `{ row, column }`, consumed by the canvas draw loop and by Task 7's drag-drop handler (which calls `setState('idle')` after showing a response).

- [x] **Step 1: Write the failing test**

```js
// tests/petStateMachine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetStateMachine } = require('../src/renderer/pet.js');

const manifest = {
  frameWidth: 192,
  frameHeight: 208,
  frameDurationMs: 180,
  states: { idle: { row: 0, frameCount: 6 } },
};

test('starts on frame 0 of the idle state', () => {
  const machine = createPetStateMachine(manifest);
  assert.deepEqual(machine.getFrame(0), { row: 0, column: 0 });
});

test('advances frames based on elapsed time', () => {
  const machine = createPetStateMachine(manifest);
  assert.deepEqual(machine.getFrame(180), { row: 0, column: 1 });
  assert.deepEqual(machine.getFrame(360), { row: 0, column: 2 });
});

test('wraps around after the last frame', () => {
  const machine = createPetStateMachine(manifest);
  assert.deepEqual(machine.getFrame(180 * 6), { row: 0, column: 0 });
});

test('setState switches row and resets frame timing', () => {
  const bigManifest = {
    ...manifest,
    states: { idle: { row: 0, frameCount: 6 }, waving: { row: 1, frameCount: 4 } },
  };
  const machine = createPetStateMachine(bigManifest);
  machine.setState('waving');
  assert.deepEqual(machine.getFrame(0), { row: 1, column: 0 });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/petStateMachine.test.js`
Expected: FAIL — `src/renderer/pet.js` does not export `createPetStateMachine`.

- [x] **Step 3: Write minimal implementation**

```js
// src/renderer/pet.js
function createPetStateMachine(manifest) {
  let currentState = Object.keys(manifest.states)[0];
  let stateStartedAtMs = 0;

  return {
    setState(name, atMs = 0) {
      if (!manifest.states[name]) {
        throw new Error(`Unknown pet state: ${name}`);
      }
      currentState = name;
      stateStartedAtMs = atMs;
    },
    getFrame(elapsedMs) {
      const { row, frameCount } = manifest.states[currentState];
      const sinceStateStart = Math.max(0, elapsedMs - stateStartedAtMs);
      const column = Math.floor(sinceStateStart / manifest.frameDurationMs) % frameCount;
      return { row, column };
    },
  };
}

if (typeof module !== 'undefined') {
  module.exports = { createPetStateMachine };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/petStateMachine.test.js`
Expected: PASS (4 tests)

- [x] **Step 5: Write the HTML shell that uses it**

```html
<!-- src/renderer/index.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body { margin: 0; background: transparent; overflow: hidden; }
    /* No -webkit-app-region here: OS-level drag regions swallow HTML5 drop
       events, so window-move is done manually in renderer-main.js instead. */
    canvas { image-rendering: pixelated; }
    #bubble {
      position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
      max-width: 220px; background: #fff; border-radius: 8px; padding: 8px 10px;
      font: 12px system-ui; display: none;
    }
  </style>
</head>
<body>
  <div id="bubble"></div>
  <canvas id="pet" width="192" height="208"></canvas>
  <script src="pet.js"></script>
  <script src="renderer-main.js"></script>
</body>
</html>
```

- [x] **Step 6: Commit**

```bash
git add src/renderer/pet.js src/renderer/index.html tests/petStateMachine.test.js
git commit -m "feat: add pet sprite state machine and renderer shell"
```

---

### Task 4: Main process — overlay window + tray

**Files:**
- Create: `Z:\Downloads\Code\Claude Pet\src\main.js`
- Create: `Z:\Downloads\Code\Claude Pet\src\preload.js`
- Test: manual (Electron main-process windowing is not unit-testable without a full browser harness; verified per Step 3 below instead of an automated test — consistent with "Task Right-Sizing": the deliverable here is a runnable window, not a pure function)

**Interfaces:**
- Consumes: `src/renderer/index.html` from Task 3.
- Produces: an `app` singleton other tasks attach IPC handlers to (Task 5, Task 6 hook into `ipcMain` from this file).

- [ ] **Step 1: Write main.js**

```js
// src/main.js
const { app, BrowserWindow, Tray, Menu, screen, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

let petWindow = null;
let tray = null;

function createPetWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = 192;
  const windowHeight = 208;

  petWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: screenWidth - windowWidth - 24,
    y: screenHeight - windowHeight - 24,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,   // required for transparent windows (RESEARCH §B2)
    hasShadow: false,   // OS shadow renders as a gray box around transparent windows (RESEARCH §B2)
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  petWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  return petWindow;
}

function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'assets', 'tray-icon.png'));
  tray.setToolTip('Claude Pet — Post-Hoc Banana Baron');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => petWindow?.show() },
    { label: 'Hide', click: () => petWindow?.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

// Renderer can't fetch() file:// URLs, so the manifest is read here and
// handed over IPC. spritesheetDataUrl inlines the PNG for the same reason.
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

ipcMain.handle('pet:get-manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'pet.json'), 'utf-8'));
  const png = fs.readFileSync(path.join(ASSETS_DIR, manifest.spritesheetPath));
  manifest.spritesheetDataUrl = `data:image/png;base64,${png.toString('base64')}`;
  return manifest;
});

ipcMain.on('pet:move-window', (_event, { dx, dy }) => {
  if (!petWindow) return;
  const [x, y] = petWindow.getPosition();
  petWindow.setPosition(x + dx, y + dy);
});

app.whenReady().then(() => {
  createPetWindow();
  createTray();
  // promptServer wiring is added in Task 7 (the module doesn't exist yet).
});

app.on('window-all-closed', (event) => {
  // Tray-resident app: do not quit when the window closes.
  event.preventDefault();
});

module.exports = { getPetWindow: () => petWindow };
```

- [ ] **Step 2: Write preload.js**

```js
// src/preload.js
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('claudePet', {
  // fetch() can't load file:// resources, so the manifest comes over IPC instead.
  getManifest: () => ipcRenderer.invoke('pet:get-manifest'),
  onPrompt: (callback) => ipcRenderer.on('pet:prompt', (_event, payload) => callback(payload)),
  onResponse: (callback) => ipcRenderer.on('pet:response', (_event, payload) => callback(payload)),
  // Electron 32+ removed File.prototype.path; webUtils.getPathForFile is the
  // supported way to resolve a dropped File to a filesystem path.
  sendDroppedFile: (file, promptText) =>
    ipcRenderer.send('pet:file-dropped', { filePath: webUtils.getPathForFile(file), promptText }),
  // Manual window-move (no -webkit-app-region — see index.html).
  moveWindowBy: (dx, dy) => ipcRenderer.send('pet:move-window', { dx, dy }),
});
```

- [ ] **Step 3: Verify it runs**

Run: `npm start`
Expected: a small frameless window appears in the bottom-right corner of the screen (transparent background, no titlebar), and a tray icon (the 32x32 `assets/tray-icon.png` from Task 1) appears. No sprite is drawn yet — `renderer-main.js` (Task 3's canvas wiring) is written in the next task's follow-up, see Task 7 Step 1 which finalizes it.

- [ ] **Step 4: Commit**

```bash
git add src/main.js src/preload.js
git commit -m "feat: add Electron main process with tray-resident overlay window"
```

---

### Task 5: Local prompt bridge (terminal → pet)

**Files:**
- Create: `Z:\Downloads\Code\Claude Pet\src\bridge\promptServer.js`
- Test: `Z:\Downloads\Code\Claude Pet\tests\promptServer.test.js`

**Interfaces:**
- Consumes: nothing external (pure Node `http`).
- Produces: `start(petWindow, onPrompt)` — starts an HTTP server bound to `127.0.0.1:47611` (loopback-only, not exposed on the network) accepting `POST /prompt` with JSON body `{ "text": string }`; on receipt, sends `pet:prompt` over `petWindow.webContents.send` (so the renderer shows "thinking…"), calls `onPrompt(text)` (Task 7 passes the handler that invokes Task 6's `claudeClient`), and returns `202 { accepted: true }`. Both prompt paths (HTTP and drag-drop) funnel through the same `handlePrompt` in `main.js`.

- [x] **Step 1: Write the failing test**

```js
// tests/promptServer.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { start, PORT } = require('../src/bridge/promptServer.js');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: '127.0.0.1', port: PORT, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(chunks || '{}') }));
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

test('accepts a prompt, notifies the window, and calls onPrompt', async () => {
  const sent = [];
  const prompts = [];
  const fakeWindow = { webContents: { send: (channel, payload) => sent.push({ channel, payload }) } };
  const server = start(fakeWindow, (text) => prompts.push(text));
  try {
    const { status, body } = await post('/prompt', { text: 'hello pet' });
    assert.equal(status, 202);
    assert.deepEqual(body, { accepted: true });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].channel, 'pet:prompt');
    assert.equal(sent[0].payload.text, 'hello pet');
    assert.deepEqual(prompts, ['hello pet']);
  } finally {
    server.close();
  }
});

test('rejects a request missing text', async () => {
  const fakeWindow = { webContents: { send: () => {} } };
  const server = start(fakeWindow, () => {});
  try {
    const { status } = await post('/prompt', {});
    assert.equal(status, 400);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/promptServer.test.js`
Expected: FAIL — `src/bridge/promptServer.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// src/bridge/promptServer.js
const http = require('node:http');

const PORT = 47611;

function start(petWindow, onPrompt) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/prompt') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'invalid JSON' }));
        return;
      }
      if (typeof parsed.text !== 'string' || parsed.text.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'text is required' }));
        return;
      }
      petWindow.webContents.send('pet:prompt', { text: parsed.text });
      onPrompt(parsed.text);
      res.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify({ accepted: true }));
    });
  });
  server.listen(PORT, '127.0.0.1');
  return server;
}

module.exports = { start, PORT };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/promptServer.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/bridge/promptServer.js tests/promptServer.test.js
git commit -m "feat: add loopback-only HTTP prompt bridge for terminal input"
```

**Usage from a terminal once running:**

```bash
curl -s -X POST http://127.0.0.1:47611/prompt -H "Content-Type: application/json" -d "{\"text\":\"summarize this file\"}"
```

---

### Task 6: Isolated Claude client (real account, not freemodel.dev)

**Files:**
- Create: `Z:\Downloads\Code\Claude Pet\src\bridge\claudeClient.js`
- Test: `Z:\Downloads\Code\Claude Pet\tests\claudeClient.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks directly (invoked by `main.js`'s `pet:prompt`-triggered handler, wired in Task 7 Step 1).
- Produces: `runPrompt(text) -> Promise<string>` — spawns `claude -p --output-format text` (prompt piped via stdin, not argv — see the escaping note in Step 4) with an env that strips any freemodel.dev override and sets an isolated `CLAUDE_CONFIG_DIR`.

- [ ] **Step 1: Verify config isolation actually works before writing the real client**

The Claude Code CLI supports `CLAUDE_CONFIG_DIR` to point at an alternate config/credentials directory. Confirm this on the target machine before relying on it:

Run: `CLAUDE_CONFIG_DIR="$HOME/.claude-pet" claude --help | head -5` (Git Bash)
Expected: the CLI runs normally (proves the env var is at least accepted, not rejected as unknown). Then run `CLAUDE_CONFIG_DIR="$HOME/.claude-pet" claude /login` once, interactively, and complete OAuth with the real Claude account (the Desktop app's free-trial account) — this populates `~/.claude-pet/` with credentials separate from the default `~/.claude/` that the freemodel-routed CLI uses. This is a one-time manual step, not something the code below automates (it must not silently trigger an OAuth flow on the user's behalf).

If `CLAUDE_CONFIG_DIR` is not supported on the installed CLI version: fall back to running `claude` with `HOME` (or `USERPROFILE`) temporarily overridden to `$HOME/.claude-pet-home` in the spawned child's env only — same isolation effect, since the CLI resolves `~/.claude` from `HOME`/`USERPROFILE`. Whichever mechanism works, use it consistently in `buildIsolatedEnv()` below.

- [ ] **Step 2: Write the failing test**

```js
// tests/claudeClient.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildIsolatedEnv } = require('../src/bridge/claudeClient.js');

test('isolated env strips freemodel.dev overrides', () => {
  const baseEnv = {
    PATH: 'C:\\Windows;C:\\Windows\\System32',
    ANTHROPIC_BASE_URL: 'https://freemodel.dev/v1',
    ANTHROPIC_API_KEY: 'freemodel-key-should-not-leak',
    USERPROFILE: 'C:\\Users\\eklip',
  };
  const isolated = buildIsolatedEnv(baseEnv);
  assert.equal(isolated.ANTHROPIC_BASE_URL, undefined);
  assert.equal(isolated.ANTHROPIC_API_KEY, undefined);
  assert.equal(isolated.CLAUDE_CONFIG_DIR, 'C:\\Users\\eklip\\.claude-pet');
  assert.equal(isolated.PATH, baseEnv.PATH);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/claudeClient.test.js`
Expected: FAIL — `src/bridge/claudeClient.js` does not exist.

- [ ] **Step 4: Write minimal implementation**

```js
// src/bridge/claudeClient.js
const { spawn } = require('node:child_process');
const path = require('node:path');

const FREEMODEL_ENV_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

function buildIsolatedEnv(baseEnv) {
  const isolated = { ...baseEnv };
  for (const key of FREEMODEL_ENV_KEYS) {
    delete isolated[key];
  }
  const homeDir = baseEnv.USERPROFILE || baseEnv.HOME;
  isolated.CLAUDE_CONFIG_DIR = path.join(homeDir, '.claude-pet');
  return isolated;
}

function runPrompt(text) {
  return new Promise((resolve, reject) => {
    const env = buildIsolatedEnv(process.env);
    // shell: true is required on Windows (claude is a .cmd shim; Node ≥20.12
    // throws EINVAL spawning .cmd files without a shell — CVE-2024-27980).
    // But argv passed through a shell gets cmd.exe parsing, so the prompt
    // text must NOT go in argv: quotes/&/|/% would break or be interpreted.
    // Instead argv stays fixed and the prompt is piped via stdin, which
    // `claude -p` reads when no positional prompt is given.
    const child = spawn('claude', ['-p', '--output-format', 'text'], { env, shell: true });
    child.stdin.end(text);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`claude CLI exited ${code}: ${stderr.trim()}`));
      }
    });
  });
}

module.exports = { buildIsolatedEnv, runPrompt };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/claudeClient.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/bridge/claudeClient.js tests/claudeClient.test.js
git commit -m "feat: add isolated Claude CLI client separate from freemodel.dev routing"
```

---

### Task 7: Wire it together — renderer main script, prompt handling, drag-and-drop

**Files:**
- Create: `Z:\Downloads\Code\Claude Pet\src\renderer\renderer-main.js`
- Modify: `Z:\Downloads\Code\Claude Pet\src\main.js` (add the `handlePrompt` → `claudeClient.runPrompt` → `pet:response` wiring, the `ipcMain.on('pet:file-dropped', ...)` handler, and the `promptServer.start(petWindow, handlePrompt)` call)
- Test: none new (this task is integration wiring over already-tested units from Tasks 3/5/6; verified manually per Step 3)

**Interfaces:**
- Consumes: `createPetStateMachine` (Task 3), `claudePet.getManifest`/`onPrompt`/`onResponse`/`sendDroppedFile`/`moveWindowBy` (Task 4's preload), `runPrompt` (Task 6), `start(petWindow, onPrompt)` (Task 5).

- [ ] **Step 1: Write renderer-main.js**

```js
// src/renderer/renderer-main.js
const canvas = document.getElementById('pet');
const ctx = canvas.getContext('2d');
const bubble = document.getElementById('bubble');
const sprite = new Image();
let manifest = null;
let machine = null;

async function init() {
  // Manifest + spritesheet arrive over IPC (fetch() can't load file:// URLs).
  manifest = await window.claudePet.getManifest();
  sprite.src = manifest.spritesheetDataUrl;
  machine = createPetStateMachine(manifest);
  requestAnimationFrame(draw);
}

function draw(nowMs) {
  const { row, column } = machine.getFrame(nowMs);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    sprite,
    column * manifest.frameWidth, row * manifest.frameHeight, manifest.frameWidth, manifest.frameHeight,
    0, 0, canvas.width, canvas.height,
  );
  requestAnimationFrame(draw);
}

window.claudePet.onPrompt(() => {
  bubble.textContent = 'thinking…';
  bubble.style.display = 'block';
});

window.claudePet.onResponse(({ text }) => {
  bubble.textContent = text;
  setTimeout(() => { bubble.style.display = 'none'; }, 8000);
});

// Manual window-move: mousedown + move deltas → IPC. A drop without any
// movement is still a click, so a small threshold keeps taps from jittering.
let dragging = false;
let lastX = 0;
let lastY = 0;

canvas.addEventListener('mousedown', (event) => {
  dragging = true;
  lastX = event.screenX;
  lastY = event.screenY;
});

window.addEventListener('mousemove', (event) => {
  if (!dragging) return;
  window.claudePet.moveWindowBy(event.screenX - lastX, event.screenY - lastY);
  lastX = event.screenX;
  lastY = event.screenY;
});

window.addEventListener('mouseup', () => { dragging = false; });

document.body.addEventListener('dragover', (event) => event.preventDefault());
document.body.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (file) {
    // Pass the File object itself; the preload resolves it to a path via
    // webUtils.getPathForFile (file.path was removed in Electron 32).
    window.claudePet.sendDroppedFile(file, 'Take a look at this file.');
    bubble.textContent = 'thinking…';
    bubble.style.display = 'block';
  }
});

init();
```

- [ ] **Step 2: Wire main.js to actually call claudeClient**

Add to `src/main.js`:

```js
const { runPrompt } = require('./bridge/claudeClient.js');

async function handlePrompt(text) {
  try {
    const responseText = await runPrompt(text);
    petWindow.webContents.send('pet:response', { text: responseText });
  } catch (error) {
    petWindow.webContents.send('pet:response', { text: `Error: ${error.message}` });
  }
}

// Drag-drop path: preload resolved the real path via webUtils; build the
// full prompt here so both paths funnel through the same handlePrompt.
ipcMain.on('pet:file-dropped', (_event, { filePath, promptText }) =>
  handlePrompt(`${promptText} ${filePath}`));
```

And inside `app.whenReady()` (after `createTray()`), start the prompt server with `handlePrompt` as its callback — HTTP prompts and drag-drops now take the identical route into Claude, and the server itself sends the `pet:prompt` "thinking…" notification:

```js
require('./bridge/promptServer.js').start(petWindow, handlePrompt);
```

- [ ] **Step 3: Verify end-to-end manually**

Run: `npm start`, then in another terminal:
```bash
curl -s -X POST http://127.0.0.1:47611/prompt -H "Content-Type: application/json" -d "{\"text\":\"say hi in five words\"}"
```
Expected: the pet's speech bubble shows "thinking…" then Claude's reply within a few seconds, authenticated via the isolated `~/.claude-pet` config (confirm by checking that it still works after temporarily unsetting/renaming the freemodel env override in the parent shell — the isolated child process should be unaffected).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/renderer-main.js src/main.js
git commit -m "feat: wire prompt bridge and drag-and-drop to isolated Claude client"
```

---

### Task 8 (deferred, optional — do not run unless the user asks): Finish the remaining 7 animation rows

> **Update 2026-07-16:** before generating ANYTHING, check `Arnav Vijay/.hatch-pet-runs/post-hoc-banana-baron/references/I just noticed these at 0130 on 07-16-26 from my codex image generation folder*/` — the user recovered 5 Codex imagegen outputs there. Two are byte-identical dupes of `decoded/idle.png` and `decoded/base.png` (md5-verified; safe to delete). **Three are row strips that were generated on 2026-07-12 but never decoded into the run:** one visually confirmed as an 8-frame `running-right` on magenta (2172x724), two more unidentified strips (2172x724 and 2142x734). Identify and reuse them before generating any new rows — that could cut the remaining generation from 7 rows to as few as 3.

Only execute this task on explicit request, since it spends image-generation usage. When requested, follow `Arnav Vijay/.hatch-pet-runs/post-hoc-banana-baron/HANDOFF_FOR_CLAUDE.md` verbatim — it already encodes every guardrail the user asked for:

- [ ] Generate `running-right` using `references/canonical-base-small.png` (255KB, not the 1.4MB `canonical-base.png`) as identity reference and `references/layout-guides/running-right.png` as layout guide, one worker only.
- [ ] Mirror `running-left` from `running-right` via `derive_running_left_from_running_right.py` instead of generating it (script already exists in the hatch-pet skill).
- [ ] Generate `waving`, `jumping`, `failed`, `waiting`, `running`, `review` one or two at a time (never more, per the handoff's explicit payload-size warning).
- [ ] Run the full pipeline (`extract_strip_frames.py` → `inspect_frames.py` → `compose_atlas.py` → `validate_atlas.py`) to produce the *official* 9-row `spritesheet.webp`.
- [ ] Swap `assets/pet.json`'s `spritesheetPath`/`states` to point at the full atlas instead of the Task 1 MVP file, and add the new states (`waving`, `jumping`, etc.) to the renderer's state machine — no code change needed in `pet.js` itself, since `createPetStateMachine` already reads states generically from the manifest.
- [ ] Copy the finished `spritesheet.webp` + a `pet.json` (matching the Codex schema: `id`, `displayName`, `description`, `spritesheetPath`) into `~/.claude/pets/<id>/`, mirroring how Codex stores its own pets at `~/.codex/pets/<id>/` — creates a consistent convention across both tools' pet folders.

---

## Self-Review

**Spec coverage:** Desktop-app-specific pet (Task 4, tray-resident window) ✓. Distinct from freemodel-routed CLI (Task 6, explicit env stripping + verification step) ✓. Reuses existing sprite art without new generation (Task 1) ✓. Draggable-onto-files (Task 7 drop handler) ✓. Takes prompts from a terminal (Task 5 HTTP bridge) ✓. Usage-conscious guardrails from the user's explicit instruction (Global Constraints + Task 8 deferral) ✓. ToS/account-safety compliance (Global Constraints; Task 5 loopback-only user-initiated prompts; Task 6 manual-only OAuth + proxy-env stripping; no autonomous prompting anywhere in the plan) ✓.

**Placeholder scan:** No TBD/TODO markers; Task 8 is explicitly deferred by design (user's own usage-conservation instruction), not a placeholder — its steps are fully concrete for whenever it does run.

**Type/interface consistency:** `pet.json` shape defined once in Task 1, consumed identically in Task 3 (`createPetStateMachine`) and Task 7 (`renderer-main.js` via the `pet:get-manifest` IPC handler — `fetch()` can't load `file://` resources, so Task 4's main process reads the manifest/spritesheet and hands them over IPC); `runPrompt(text) -> Promise<string>` defined in Task 6, consumed with matching signature in Task 7 Step 2; `promptServer.start(petWindow, onPrompt)` defined in Task 5, called with that exact signature in Task 7 Step 2 (deliberately not started in Task 4 — the module doesn't exist until Task 5 and its callback until Task 7).

**Known Electron-version pitfalls addressed:** `File.prototype.path` was removed in Electron 32, so dropped files resolve to paths via `webUtils.getPathForFile()` in the preload (Task 4/7); OS-level `-webkit-app-region: drag` regions swallow HTML5 drop events, so window-move is manual mousedown/mousemove → IPC instead (Task 3/7); prompt text is piped to `claude -p` over stdin rather than argv because `shell: true` (required for `.cmd` shims on Windows since Node's CVE-2024-27980 fix) would subject argv to cmd.exe parsing (Task 6).
