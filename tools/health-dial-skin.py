"""Build the health dial's skin template.

The dial is a generated disc (`src/lib/figures/health-dial.ts`) and its texture
goes through the token texture builder, which lays a *square* of artwork over a
band of rim colour and hands the square to the disc's face. So the thing an
author actually paints is that square, and this writes the template for it:
a layered PSD to work in, and a flattened PNG to look at.

Everything drawn here is derived from two numbers that live in the code, so the
guides cannot drift away from what the dial does:

  * the disc is inscribed in the square, so its edge is a circle of radius W/2;
  * the Lua puts its triggers at 0.6 of the disc's radius, so they sit at
    0.3 W either side of the middle. See `health dial.json`.

    python tools/health-dial-skin.py

Regenerate rather than hand-editing — and if the dial's diameter or its trigger
positions change in the code, change them here too.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image, ImageDraw

from skins import GUIDE, blank, centred, font, plate, publish, ring

SIZE = 1024

# Read off the code: `HEALTH_DIAL_SPEC.diameterMm`, and `TRIGGER_X` in the Lua.
DIAMETER_MM = 50.8
TRIGGER_X = 0.6

RIM = (26, 26, 26)  # HEALTH_DIAL_RIM

MIDDLE = (SIZE / 2, SIZE / 2)
RADIUS = SIZE / 2


def rim_layer() -> Image.Image:
    return Image.new("RGBA", (SIZE, SIZE), (*RIM, 255))


def plate_layer() -> Image.Image:
    image = blank((SIZE, SIZE))
    plate(ImageDraw.Draw(image), MIDDLE, RADIUS, "YOUR ART HERE")
    return image


def guide_layer() -> Image.Image:
    image = blank((SIZE, SIZE))
    draw = ImageDraw.Draw(image)
    ink = (*GUIDE, 235)
    faint = (*GUIDE, 110)

    # The disc's own edge, and a margin inside it for the moulded bevel.
    ring(draw, MIDDLE, RADIUS - 2, ink, 3, dash=72)
    ring(draw, MIDDLE, RADIUS * 0.94, faint, 2)

    # Crosshairs, to line art up against.
    draw.line((SIZE / 2, 0, SIZE / 2, SIZE), fill=faint, width=1)
    draw.line((0, SIZE / 2, SIZE, SIZE / 2), fill=faint, width=1)

    # The health number, which Tabletop Simulator draws over the middle.
    number = RADIUS * 0.40
    ring(draw, MIDDLE, number, ink, 2, dash=48)
    centred(draw, (SIZE / 2, SIZE / 2 - number - 26), "HEALTH NUMBER", 26, ink)

    # The triggers: 0.6 of the disc's radius out, which is 0.3 of the square.
    for direction, glyph, verb in ((-1, "<", "LOWER"), (1, ">", "RAISE")):
        x = SIZE / 2 + direction * TRIGGER_X * RADIUS
        spot = RADIUS * 0.15
        draw.ellipse((x - spot, SIZE / 2 - spot, x + spot, SIZE / 2 + spot), outline=ink, width=2)
        centred(draw, (x, SIZE / 2), glyph, 90, faint)
        centred(draw, (x, SIZE / 2 + spot + 24), verb, 22, ink)

    draw.text((22, 18), "Health dial skin — %.1fmm disc" % DIAMETER_MM, font=font(22), fill=ink)
    draw.multiline_text(
        (22, SIZE - 118),
        "The circle is the whole of the dial: the corners are never seen.\n"
        "Keep the middle and the two triggers clear — the number and the\n"
        "arrows are drawn by the game, not painted here.",
        font=font(20),
        fill=ink,
        spacing=6,
    )
    return image


def main() -> None:
    publish(
        "health_dial_skin",
        [
            (rim_layer(), "Rim colour", True),
            (plate_layer(), "Dial face — replace this", True),
            (guide_layer(), "Guides — hide before saving", True),
        ],
        (SIZE, SIZE),
    )


if __name__ == "__main__":
    main()
