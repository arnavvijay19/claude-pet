# tests/test_extract_mvp_sprite.py
"""Integration test for the MVP idle-only sprite extraction.

Runs the extractor against the real hatch-pet idle strip and asserts the
properties the renderer (plan Tasks 3/4/7) depends on. Beyond the plan's
original size/manifest checks, it also asserts what the source image made
necessary: the magenta #FF00FF chroma background must be keyed out (the pet
window is transparent — leftover magenta renders as an opaque box) and the
sprite aspect ratio must be preserved (the 362x724 source slots must not be
squashed into 192x208 cells).
"""
import json
import math
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "extract_mvp_sprite.py"

CELL_W, CELL_H = 192, 208
FRAME_COUNT = 6
CHROMA_KEY = (255, 0, 255)
KEY_THRESHOLD = 96.0


def find_idle_source() -> Path:
    # The repo may run from Z:\Downloads\Code\Claude Pet or from a git
    # worktree nested under .claude/worktrees/, so walk ancestors instead of
    # hardcoding ROOT.parent.
    relative = Path("Arnav Vijay") / ".hatch-pet-runs" / "post-hoc-banana-baron" / "decoded" / "idle.png"
    for ancestor in [ROOT, *ROOT.parents]:
        candidate = ancestor / relative
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"idle strip not found under any ancestor of {ROOT}: {relative}")


SOURCE_IDLE = find_idle_source()


def run_extractor(tmp_path):
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
    return out_png, out_json, out_icon


def test_extract_mvp_sprite_produces_expected_atlas(tmp_path):
    out_png, out_json, out_icon = run_extractor(tmp_path)

    with Image.open(out_png) as atlas:
        assert atlas.size == (CELL_W * FRAME_COUNT, CELL_H)
        assert atlas.mode == "RGBA"
        atlas_rgba = atlas.copy()

    with Image.open(out_icon) as icon:
        assert icon.size == (32, 32)
        icon_rgba = icon.convert("RGBA")

    manifest = json.loads(out_json.read_text(encoding="utf-8"))
    assert manifest["states"]["idle"] == {"row": 0, "frameCount": FRAME_COUNT}
    assert manifest["frameWidth"] == CELL_W
    assert manifest["frameHeight"] == CELL_H
    assert manifest["frameDurationMs"] == 180
    assert manifest["id"] == "post-hoc-banana-baron"
    # The renderer resolves the spritesheet relative to pet.json's directory.
    assert manifest["spritesheetPath"] == out_png.name

    # --- chroma key actually removed (would render as a magenta box otherwise)
    raw = atlas_rgba.tobytes()
    opaque = [
        (raw[i], raw[i + 1], raw[i + 2])
        for i in range(0, len(raw), 4)
        if raw[i + 3] > 0
    ]
    assert opaque, "atlas is fully transparent - no sprite content"
    for r, g, b in opaque:
        distance = math.sqrt(
            (r - CHROMA_KEY[0]) ** 2 + (g - CHROMA_KEY[1]) ** 2 + (b - CHROMA_KEY[2]) ** 2
        )
        assert distance > KEY_THRESHOLD, f"opaque near-magenta pixel survived: {(r, g, b)}"

    # --- per-frame content: present, aspect-preserved, inside its own cell
    frames = []
    for index in range(FRAME_COUNT):
        cell = atlas_rgba.crop((index * CELL_W, 0, (index + 1) * CELL_W, CELL_H))
        bbox = cell.getbbox()
        assert bbox is not None, f"frame {index} is empty"
        width = bbox[2] - bbox[0]
        height = bbox[3] - bbox[1]
        # Source sprites are ~353-369 x ~452-456 (aspect ~0.78). A squashed
        # 362x724->192x208 resize would fill the cell wall-to-wall instead.
        assert height >= 180, f"frame {index} does not fill cell height: {height}"
        assert width <= 180, f"frame {index} stretched to cell width: {width}"
        assert 0.6 <= width / height <= 0.95, f"frame {index} aspect off: {width}x{height}"
        frames.append(cell.tobytes())

    # Idle frames animate; identical bytes across all 6 means extraction
    # grabbed the same region six times.
    assert len(set(frames)) > 1, "all 6 frames are byte-identical"

    # --- tray icon: transparent background, opaque sprite content
    icon_raw = icon_rgba.tobytes()
    icon_alphas = icon_raw[3::4]
    assert any(a == 0 for a in icon_alphas), "tray icon has no transparency"
    assert any(a > 0 for a in icon_alphas), "tray icon is empty"
