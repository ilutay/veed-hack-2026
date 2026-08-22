#!/usr/bin/env python3
"""Overlay crisp slide text onto generated slide art.

`fal_media_agent.py` asks the image model to "leave open space for webpage title
and caption overlays", but it also puts `Slide title:` and `Key points:` into the
image prompt. Diffusion models render lettering unreliably, so that text arrives
misspelled ("niarrow", "Iterrate on winners"). This tool restores the intent:
generate art with no lettering, then draw the real text here, where it is exact.

Typical use, after generating art from a text-free variant of the script:

    python3 codex/tools/compose_slide_text.py \
        --script lesson-script.json \
        --art-dir  <run>/02-content-generation/slide-images \
        --output-dir <run>/02-content-generation/slide-images-composed \
        --resolution 1080x1920
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
BOLD = FONT_DIR / "DejaVuSans-Bold.ttf"
REGULAR = FONT_DIR / "DejaVuSans.ttf"


def load_font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    if not path.exists():
        raise SystemExit(f"missing font: {path} (apt install fonts-dejavu-core)")
    return ImageFont.truetype(str(path), size)


def wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    """Greedy word wrap against real measured widths."""
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if draw.textlength(trial, font=font) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def fit_block(
    draw: ImageDraw.ImageDraw, text: str, font_path: Path, start: int, min_size: int,
    max_w: int, max_h: int,
) -> tuple[ImageFont.FreeTypeFont, list[str], int]:
    """Shrink until the wrapped block fits both width and height. Never overflow."""
    size = start
    while size >= min_size:
        font = load_font(font_path, size)
        lines = wrap(draw, text, font, max_w)
        line_h = int(size * 1.25)
        if len(lines) * line_h <= max_h:
            return font, lines, line_h
        size -= 2
    font = load_font(font_path, min_size)
    lines = wrap(draw, text, font, max_w)[: max(1, max_h // int(min_size * 1.25))]
    return font, lines, int(min_size * 1.25)


def cover(img: Image.Image, w: int, h: int) -> Image.Image:
    """Scale to fill and centre-crop, so the art never letterboxes."""
    src_r, dst_r = img.width / img.height, w / h
    if src_r > dst_r:
        new_w = int(img.height * dst_r)
        img = img.crop(((img.width - new_w) // 2, 0, (img.width + new_w) // 2, img.height))
    else:
        new_h = int(img.width / dst_r)
        img = img.crop((0, (img.height - new_h) // 2, img.width, (img.height + new_h) // 2))
    return img.resize((w, h), Image.LANCZOS)


def compose(art: Path, out: Path, title: str, points: list[str], w: int, h: int) -> None:
    img = cover(Image.open(art).convert("RGB"), w, h)
    draw = ImageDraw.Draw(img, "RGBA")

    margin = int(w * 0.07)
    max_w = w - 2 * margin
    band_h = int(h * 0.30)

    # The band is opaque, not a soft scrim. The image model sometimes renders
    # its own (misspelled) lettering into the art despite being told not to; a
    # translucent scrim lets that garbage show through behind the real title.
    # Only the bottom edge feathers, so the panel still blends into the art.
    solid_h = int(band_h * 0.80)
    draw.rectangle([(0, 0), (w, solid_h)], fill=(255, 255, 255, 255))
    for i in range(solid_h, band_h):
        alpha = int(255 * (1 - (i - solid_h) / max(1, band_h - solid_h)) ** 1.4)
        draw.line([(0, i), (w, i)], fill=(255, 255, 255, alpha))

    title_font, title_lines, title_lh = fit_block(
        draw, title, BOLD, int(h * 0.052), int(h * 0.026), max_w, int(band_h * 0.55)
    )
    y = margin
    for line in title_lines:
        draw.text((margin, y), line, font=title_font, fill=(17, 17, 17))
        y += title_lh

    body = " · ".join(p.strip() for p in points if p and p.strip())
    if body:
        y += int(h * 0.012)
        body_font, body_lines, body_lh = fit_block(
            draw, body, REGULAR, int(h * 0.028), int(h * 0.016), max_w,
            max(int(band_h - (y - margin)), int(h * 0.03)),
        )
        for line in body_lines:
            draw.text((margin, y), line, font=body_font, fill=(55, 55, 55))
            y += body_lh

    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--script", required=True, type=Path)
    ap.add_argument("--art-dir", required=True, type=Path)
    ap.add_argument("--output-dir", required=True, type=Path)
    ap.add_argument("--resolution", default="1080x1920")
    args = ap.parse_args()

    try:
        w, h = (int(x) for x in args.resolution.lower().split("x"))
    except ValueError:
        raise SystemExit(f"bad --resolution: {args.resolution!r} (expected WIDTHxHEIGHT)")

    lesson = json.loads(args.script.read_text())
    slides = lesson.get("slides") or []
    if not slides:
        raise SystemExit("script has no slides")

    written = 0
    for slide in slides:
        art = args.art_dir / f"{slide['id']}.png"
        if not art.exists():
            raise SystemExit(f"missing art for {slide['id']}: {art}")
        compose(
            art, args.output_dir / f"{slide['id']}.png",
            slide.get("title", ""), slide.get("key_points") or [], w, h,
        )
        written += 1

    print(f"composed {written} slides into {args.output_dir} at {w}x{h}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
