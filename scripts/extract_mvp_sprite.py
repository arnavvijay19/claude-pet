#!/usr/bin/env python3
"""Build a 1-row MVP spritesheet (idle only) without the full hatch-pet atlas pipeline.

The generated idle strip is RGB on a magenta #FF00FF chroma-key background, and
the six monkeys drift off the even 6-slot grid (measured: sprite content crosses
slot boundaries by dozens of pixels). So this extractor mirrors the hatch-pet
skill's approach instead of naive slot cropping: key out the background, find
the six sprites as connected alpha components, and fit each one into a 192x208
cell with its aspect ratio preserved.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path

from PIL import Image

CELL_WIDTH = 192
CELL_HEIGHT = 208
CELL_MARGIN = 5  # per side; sprites are fitted into (CELL-2*margin)
IDLE_FRAME_COUNT = 6
DEFAULT_CHROMA_KEY = "#FF00FF"  # confirmed in the run's pet_request.json
DEFAULT_KEY_THRESHOLD = 96.0  # matches hatch-pet extract_strip_frames.py
ALPHA_FLOOR = 16  # alpha <= this counts as background when finding components
CLEAN_ALPHA_FLOOR = 8  # post-resize: drop near-invisible LANCZOS ringing pixels


def parse_hex_color(value: str) -> tuple[int, int, int]:
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise SystemExit(f"invalid chroma key color: {value}; expected #RRGGBB")
    return tuple(int(value[index : index + 2], 16) for index in (1, 3, 5))


def remove_chroma_background(
    image: Image.Image,
    chroma_key: tuple[int, int, int],
    threshold: float,
) -> Image.Image:
    """Return an RGBA copy with pixels near the chroma key made transparent.

    The generation process leaves the background noisy (sampled corners range
    #E413E3-#EF0DEF), so keying is by Euclidean distance, not equality.

    Surviving pixels are despilled: sprite/background blend pixels just past
    the threshold otherwise stay fully opaque *pink* and smear into a magenta
    halo when LANCZOS-downscaled. Removing the magenta excess (min(r,b) - g)
    turns them neutral-dark like the sprite's own outline. The sprite palette
    (browns, tans, yellow, black, white, money-green) has no color with
    min(r,b) > g, so legitimate pixels pass through unchanged.
    """
    rgba = image.convert("RGBA")
    data = bytearray(rgba.tobytes())
    key_r, key_g, key_b = chroma_key
    threshold_sq = threshold * threshold
    for index in range(0, len(data), 4):
        red = data[index]
        green = data[index + 1]
        blue = data[index + 2]
        dr = red - key_r
        dg = green - key_g
        db = blue - key_b
        if dr * dr + dg * dg + db * db <= threshold_sq:
            data[index] = data[index + 1] = data[index + 2] = 0
            data[index + 3] = 0
        else:
            excess = min(red, blue) - green
            if excess > 0:
                data[index] = red - excess
                data[index + 2] = blue - excess
    return Image.frombytes("RGBA", rgba.size, bytes(data))


def connected_components(image: Image.Image) -> list[dict]:
    """Label 4-connected regions of alpha > ALPHA_FLOOR."""
    width, height = image.size
    alpha = image.getchannel("A").tobytes()
    visited = bytearray(width * height)
    components: list[dict] = []

    for start, alpha_value in enumerate(alpha):
        if alpha_value <= ALPHA_FLOOR or visited[start]:
            continue
        stack = [start]
        visited[start] = 1
        pixels: list[int] = []
        min_x, min_y, max_x, max_y = width, height, 0, 0
        while stack:
            current = stack.pop()
            pixels.append(current)
            x = current % width
            y = current // width
            if x < min_x:
                min_x = x
            if x > max_x:
                max_x = x
            if y < min_y:
                min_y = y
            if y > max_y:
                max_y = y
            if x > 0 and not visited[current - 1] and alpha[current - 1] > ALPHA_FLOOR:
                visited[current - 1] = 1
                stack.append(current - 1)
            if x + 1 < width and not visited[current + 1] and alpha[current + 1] > ALPHA_FLOOR:
                visited[current + 1] = 1
                stack.append(current + 1)
            if y > 0 and not visited[current - width] and alpha[current - width] > ALPHA_FLOOR:
                visited[current - width] = 1
                stack.append(current - width)
            if y + 1 < height and not visited[current + width] and alpha[current + width] > ALPHA_FLOOR:
                visited[current + width] = 1
                stack.append(current + width)
        components.append(
            {
                "pixels": pixels,
                "area": len(pixels),
                "bbox": (min_x, min_y, max_x + 1, max_y + 1),
                "center_x": (min_x + max_x + 1) / 2,
            }
        )
    return components


def group_into_frames(components: list[dict], frame_count: int) -> list[list[dict]]:
    """Pick the frame_count largest components as sprite seeds (left to right)
    and attach every remaining non-noise component to the nearest seed."""
    if not components:
        raise SystemExit("no sprite content found after chroma keying")
    largest = max(component["area"] for component in components)
    seeds = [c for c in components if c["area"] >= max(120, largest * 0.20)]
    if len(seeds) != frame_count:
        raise SystemExit(
            f"expected {frame_count} sprite components, found {len(seeds)} "
            f"(areas: {sorted((c['area'] for c in components), reverse=True)[:10]})"
        )
    seeds.sort(key=lambda component: component["center_x"])
    seed_ids = {id(seed) for seed in seeds}
    groups: list[list[dict]] = [[seed] for seed in seeds]
    noise_floor = max(12, largest * 0.002)
    for component in components:
        if id(component) in seed_ids or component["area"] < noise_floor:
            continue
        nearest = min(
            range(frame_count),
            key=lambda index: abs(seeds[index]["center_x"] - component["center_x"]),
        )
        groups[nearest].append(component)
    return groups


def group_image(source: Image.Image, group: list[dict]) -> Image.Image:
    """Copy exactly the group's pixels onto a transparent canvas cropped to
    the group's bounds — neighbors bleeding into the same region are excluded."""
    width, _height = source.size
    min_x = min(component["bbox"][0] for component in group)
    min_y = min(component["bbox"][1] for component in group)
    max_x = max(component["bbox"][2] for component in group)
    max_y = max(component["bbox"][3] for component in group)
    output = Image.new("RGBA", (max_x - min_x, max_y - min_y), (0, 0, 0, 0))
    source_pixels = source.load()
    output_pixels = output.load()
    for component in group:
        for pixel_index in component["pixels"]:
            x = pixel_index % width
            y = pixel_index // width
            output_pixels[x - min_x, y - min_y] = source_pixels[x, y]
    return output


def clean_resized(image: Image.Image) -> Image.Image:
    """Scrub LANCZOS resampling artifacts from a resized RGBA sprite.

    Downscaling has negative side-lobes that ring the alpha edge back up to
    tiny values (alpha 1-8) while pulling RGB toward the pre-despill magenta,
    producing single opaque #FF00FF specks. Drop those near-invisible pixels
    and re-despill the survivors (same rule as remove_chroma_background)."""
    data = bytearray(image.tobytes())
    for index in range(0, len(data), 4):
        if data[index + 3] <= CLEAN_ALPHA_FLOOR:
            data[index] = data[index + 1] = data[index + 2] = 0
            data[index + 3] = 0
            continue
        red = data[index]
        green = data[index + 1]
        blue = data[index + 2]
        excess = min(red, blue) - green
        if excess > 0:
            data[index] = red - excess
            data[index + 2] = blue - excess
    return Image.frombytes("RGBA", image.size, bytes(data))


def fit_to_cell(sprite: Image.Image) -> Image.Image:
    """Scale the sprite to fit the cell (aspect preserved) and center it."""
    cell = Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), (0, 0, 0, 0))
    max_width = CELL_WIDTH - 2 * CELL_MARGIN
    max_height = CELL_HEIGHT - 2 * CELL_MARGIN
    scale = min(max_width / sprite.width, max_height / sprite.height, 1.0)
    if scale != 1.0:
        sprite = clean_resized(
            sprite.resize(
                (max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale))),
                Image.Resampling.LANCZOS,
            )
        )
    left = (CELL_WIDTH - sprite.width) // 2
    top = (CELL_HEIGHT - sprite.height) // 2
    cell.alpha_composite(sprite, (left, top))
    return cell


def extract_idle_frames(
    idle_source: Path,
    chroma_key: tuple[int, int, int],
    threshold: float,
) -> list[Image.Image]:
    with Image.open(idle_source) as opened:
        strip = remove_chroma_background(opened, chroma_key, threshold)
    groups = group_into_frames(connected_components(strip), IDLE_FRAME_COUNT)
    return [fit_to_cell(group_image(strip, group)) for group in groups]


def build_atlas(frames: list[Image.Image]) -> Image.Image:
    atlas = Image.new("RGBA", (CELL_WIDTH * len(frames), CELL_HEIGHT), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        atlas.alpha_composite(frame, (index * CELL_WIDTH, 0))
    return atlas


def build_tray_icon(frame: Image.Image, size: int = 32) -> Image.Image:
    """First idle frame, content-cropped and aspect-fitted into a square icon."""
    bbox = frame.getbbox()
    sprite = frame.crop(bbox) if bbox else frame
    sprite.thumbnail((size, size), Image.Resampling.LANCZOS)
    sprite = clean_resized(sprite)
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    icon.alpha_composite(sprite, ((size - sprite.width) // 2, (size - sprite.height) // 2))
    return icon


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--idle-source", required=True, type=Path)
    parser.add_argument("--output-png", required=True, type=Path)
    parser.add_argument("--output-json", required=True, type=Path)
    parser.add_argument("--output-tray-icon", required=True, type=Path)
    parser.add_argument("--chroma-key", default=DEFAULT_CHROMA_KEY)
    parser.add_argument("--key-threshold", type=float, default=DEFAULT_KEY_THRESHOLD)
    args = parser.parse_args()

    chroma_key = parse_hex_color(args.chroma_key)
    frames = extract_idle_frames(args.idle_source, chroma_key, args.key_threshold)
    atlas = build_atlas(frames)

    args.output_png.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(args.output_png)

    args.output_tray_icon.parent.mkdir(parents=True, exist_ok=True)
    build_tray_icon(frames[0]).save(args.output_tray_icon)

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
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(
        f"wrote {args.output_png} ({atlas.width}x{atlas.height}), "
        f"{args.output_json}, {args.output_tray_icon}"
    )


if __name__ == "__main__":
    main()
