"""Build the six-face PSD and PNG guide for the TTS presentation box.

The rectangles come from the same JSON the OBJ uses. Hide the Guides layer
before exporting a PNG for the app; the Base layer leaves unused corners and
unpainted faces white.

    python tools/box-skin.py
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw

from psdwrite import flatten, write_psd
from skins import GUIDE, blank, centred, font

ROOT = Path(__file__).resolve().parent.parent
LAYOUT = json.loads((ROOT / "src/lib/export/box-skin-layout.json").read_text())
DESTINATION = ROOT / "public/assets/templates"
SIZE = (LAYOUT["width"], LAYOUT["height"])
INK = (*GUIDE, 255)
FAINT = (*GUIDE, 120)


def rect(name: str) -> tuple[int, int, int, int]:
    x, y, width, height = LAYOUT[name]
    return x, y, x + width, y + height


def guides() -> Image.Image:
    image = blank(SIZE)
    draw = ImageDraw.Draw(image)
    panels = (
        ("front", "FRONT", "Visible top face · place cover art here"),
        ("back", "BACK", "Underside of the box"),
        ("sideTop", "SIDE 1 · TOP EDGE", ""),
        ("sideBottom", "SIDE 2 · BOTTOM EDGE", ""),
    )
    for name, title, subtitle in panels:
        x0, y0, x1, y1 = rect(name)
        draw.rectangle((x0 + 2, y0 + 2, x1 - 3, y1 - 3), outline=INK, width=4)
        draw.rectangle((x0 + 22, y0 + 22, x1 - 23, y1 - 23), outline=FAINT, width=2)
        size = 62 if name in ("front", "back") else 36
        centre_y = (y0 + y1) / 2
        centred(draw, ((x0 + x1) / 2, centre_y), title, size, INK)
        if subtitle:
            centred(draw, ((x0 + x1) / 2, centre_y + 76), subtitle, 27, INK)

    for name, title in (("sideLeft", "SIDE 3 · LEFT EDGE"),
                        ("sideRight", "SIDE 4 · RIGHT EDGE")):
        x0, y0, x1, y1 = rect(name)
        draw.rectangle((x0 + 2, y0 + 2, x1 - 3, y1 - 3), outline=INK, width=4)
        draw.rectangle((x0 + 22, y0 + 22, x1 - 23, y1 - 23), outline=FAINT, width=2)
        label = blank((y1 - y0, x1 - x0))
        centred(ImageDraw.Draw(label), ((y1 - y0) / 2, (x1 - x0) / 2), title, 36, INK)
        image.alpha_composite(label.rotate(90, expand=True), (x0, y0))

    return image


def main() -> None:
    DESTINATION.mkdir(parents=True, exist_ok=True)
    layers = [
        (Image.new("RGBA", SIZE, (255, 255, 255, 255)), "Base - paint on new layers", True),
        (guides(), "Guides - hide before exporting PNG", True),
    ]
    composite = flatten(layers, SIZE)
    write_psd(DESTINATION / "box_skin.psd", layers, composite)
    composite.convert("RGB").save(DESTINATION / "box_skin_guide.png")
    print(f"wrote {DESTINATION / 'box_skin.psd'} and guide PNG")


if __name__ == "__main__":
    main()
