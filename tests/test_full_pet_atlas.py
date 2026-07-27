import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]

EXPECTED_STATES = {
    "idle": {"row": 0, "frameCount": 6, "frameDurationMs": 180, "loop": True},
    "running-right": {"row": 1, "frameCount": 8, "frameDurationMs": 90, "loop": True},
    "running-left": {"row": 2, "frameCount": 8, "frameDurationMs": 90, "loop": True},
    "waving": {"row": 3, "frameCount": 4, "frameDurationMs": 140, "loop": False, "nextState": "idle"},
    "jumping": {"row": 4, "frameCount": 5, "frameDurationMs": 110, "loop": False, "nextState": "running"},
    "failed": {"row": 5, "frameCount": 8, "frameDurationMs": 130, "loop": False, "nextState": "idle"},
    "waiting": {"row": 6, "frameCount": 6, "frameDurationMs": 180, "loop": True},
    "running": {"row": 7, "frameCount": 6, "frameDurationMs": 110, "loop": True},
    "review": {"row": 8, "frameCount": 6, "frameDurationMs": 160, "loop": True},
}


def test_full_pet_atlas_matches_manifest_and_cell_alpha_contract():
    manifest = json.loads((ROOT / "assets" / "pet.json").read_text(encoding="utf-8"))
    assert manifest == {
        "id": "post-hoc-banana-baron",
        "displayName": "Post-Hoc Banana Baron",
        "description": "A mischievous pixel-art monkey with sunglasses, a banana, and a money bundle.",
        "spritesheetPath": "spritesheet.webp",
        "frameWidth": 192,
        "frameHeight": 208,
        "states": EXPECTED_STATES,
    }

    with Image.open(ROOT / "assets" / "spritesheet.webp") as atlas:
        assert atlas.mode == "RGBA"
        assert atlas.size == (1536, 1872)
        for name, state in manifest["states"].items():
            row = state["row"]
            for column in range(8):
                cell = atlas.crop((column * 192, row * 208, (column + 1) * 192, (row + 1) * 208))
                alpha_bounds = cell.getchannel("A").getbbox()
                if column < state["frameCount"]:
                    assert alpha_bounds is not None, (name, column, "used cell is empty")
                else:
                    assert alpha_bounds is None, (name, column, "unused cell is not transparent")


def test_full_pet_atlas_has_no_visible_chroma_key_halo():
    with Image.open(ROOT / "assets" / "spritesheet.webp") as atlas:
        visible_magenta = sum(
            alpha > 0 and red > 200 and blue > 200 and green < 80
            for red, green, blue, alpha in atlas.convert("RGBA").get_flattened_data()
        )

    assert visible_magenta == 0
