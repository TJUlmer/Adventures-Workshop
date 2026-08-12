"""Drawing shared by the skin templates: guides, rings, labels, output.

Kept apart from `psdwrite` so that one stays a file format and this stays the
house style — the two templates should look like each other.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import psdwrite

ROOT = Path(__file__).resolve().parent.parent
RESOURCES = ROOT / "assets" / "resources"

# Open Font Licence, and the face the app's own chrome is nearest to. Not one of
# the Knockout files: these are pixels that get handed to whoever opens the
# template, and the Knockout licence is the reason half of this project exists.
FONT = ROOT / "public" / "assets" / "fonts" / "Oswald-VariableFont_wght.ttf"

GUIDE = (120, 226, 255)
PLATE = (57, 64, 77)
PLATE_RING = (86, 96, 112)


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT), size)


def blank(size: tuple[int, int]) -> Image.Image:
    return Image.new("RGBA", size, (0, 0, 0, 0))


def ring(
    draw: ImageDraw.ImageDraw,
    centre: tuple[float, float],
    radius: float,
    colour,
    width: int,
    dash: int = 0,
) -> None:
    """A circle, whole or dashed. `dash` is the number of arcs it is cut into."""
    cx, cy = centre
    box = (cx - radius, cy - radius, cx + radius, cy + radius)
    if dash == 0:
        draw.ellipse(box, outline=colour, width=width)
        return
    step = 360 / dash
    for index in range(dash):
        if index % 2 == 0:
            draw.arc(box, index * step, (index + 1) * step, fill=colour, width=width)


def centred(draw: ImageDraw.ImageDraw, xy, text: str, size: int, colour) -> None:
    face = font(size)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=face)
    draw.text(
        (xy[0] - (right - left) / 2 - left, xy[1] - (bottom - top) / 2 - top),
        text,
        font=face,
        fill=colour,
    )


def plate(draw: ImageDraw.ImageDraw, centre: tuple[float, float], radius: float, label: str) -> None:
    """Something token-shaped to replace, so a template is not an empty box."""
    cx, cy = centre
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=(*PLATE, 255))
    ring(draw, centre, radius * 0.9, (*PLATE_RING, 255), 4)
    centred(draw, (cx, cy + radius * 0.6), label, 40, (*PLATE_RING, 255))


def publish(stem: str, layers: list[psdwrite.Layer], size: tuple[int, int]) -> None:
    """The pair: the layered file to work in, and a flat one to look at."""
    RESOURCES.mkdir(parents=True, exist_ok=True)
    composite = psdwrite.flatten(layers, size)
    psdwrite.write_psd(RESOURCES / f"{stem}.psd", layers, composite)
    composite.convert("RGB").save(RESOURCES / f"{stem}.png")
    print(f"wrote {stem}.psd and {stem}.png to {RESOURCES}")
