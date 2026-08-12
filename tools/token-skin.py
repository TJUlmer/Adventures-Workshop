"""Build the two-sided token skin template.

A token with "two-sided art" turned on takes one image laid out as two faces
side by side and wraps a half onto each side of the piece — see `twoSided` in
`src/lib/models/token.ts`. This writes the template for that image: a layered
PSD to work in, and a flattened PNG to look at.

Everything about it follows from what the mesh does with the picture, which is
what makes it worth generating rather than drawing:

  * 2:1, and each half a square. The token's face samples a *square* patch, so
    a half that is not square gets the token's own circle stretched into it.
  * The left half is the top face and the right half is the underside. That is
    the `artUv` split, not a convention — swap them and the piece reads back to
    front on the table.
  * The pixel at the dead centre of the image is what the *rim* is painted with.
    A two-sided image has no band of rim colour to spare, so the edge samples
    the seam, which on a framed piece is its background. Leave something there
    you would be happy to see around the edge.
  * A polygon token crops this same square to its own outline, so art that
    reaches the circle will lose its corners on anything with fewer sides.

    python tools/token-skin.py

Regenerate rather than hand-editing.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image, ImageDraw

from skins import GUIDE, blank, centred, font, plate, publish, ring

HALF = 1024
WIDTH, HEIGHT = HALF * 2, HALF

# What the rim ends up being, so the flattened preview shows an honest edge.
SEAM = (26, 26, 26)

FACES = (
    (0, "FRONT", "the top face"),
    (HALF, "BACK", "the underside"),
)


def ground_layer() -> Image.Image:
    return Image.new("RGBA", (WIDTH, HEIGHT), (*SEAM, 255))


def plate_layer() -> Image.Image:
    image = blank((WIDTH, HEIGHT))
    draw = ImageDraw.Draw(image)
    for x0, label, _ in FACES:
        plate(draw, (x0 + HALF / 2, HALF / 2), HALF / 2, label)
    return image


def guide_layer() -> Image.Image:
    image = blank((WIDTH, HEIGHT))
    draw = ImageDraw.Draw(image)
    ink = (*GUIDE, 235)
    faint = (*GUIDE, 110)

    for x0, label, what in FACES:
        middle = (x0 + HALF / 2, HALF / 2)
        radius = HALF / 2

        # The token's edge, and a margin inside it for the moulded bevel.
        ring(draw, middle, radius - 2, ink, 3, dash=72)
        ring(draw, middle, radius * 0.94, faint, 2)

        # The square the face samples, which is also a polygon's outer reach.
        draw.rectangle((x0 + 1, 1, x0 + HALF - 2, HALF - 2), outline=faint, width=1)

        draw.line((middle[0], 0, middle[0], HEIGHT), fill=faint, width=1)
        draw.line((x0, HALF / 2, x0 + HALF, HALF / 2), fill=faint, width=1)

        draw.text((x0 + 22, 18), f"{label} — {what}", font=font(26), fill=ink)

    # The seam, and the one pixel of it that becomes the edge of the piece.
    draw.line((HALF, 0, HALF, HEIGHT), fill=ink, width=3)
    spot = 46
    ring(draw, (HALF, HALF / 2), spot, ink, 3)
    draw.line((HALF - spot - 34, HALF / 2, HALF - spot - 6, HALF / 2), fill=ink, width=2)
    draw.line((HALF + spot + 6, HALF / 2, HALF + spot + 34, HALF / 2), fill=ink, width=2)
    centred(draw, (HALF, HALF / 2 - spot - 52), "THE RIM IS PAINTED", 24, ink)
    centred(draw, (HALF, HALF / 2 - spot - 24), "WITH THIS PIXEL", 24, ink)

    draw.multiline_text(
        (22, HEIGHT - 122),
        "Two faces of one token, left then right, each a square the piece's\n"
        "circle is inscribed in. Paint both the right way up: the underside is\n"
        "turned over by the model, not by you. The corners are never seen on a\n"
        "circle, and a polygon loses more of them the fewer sides it has.",
        font=font(20),
        fill=ink,
        spacing=6,
    )
    return image


def main() -> None:
    publish(
        "token_skin_two_sided",
        [
            (ground_layer(), "Seam and rim colour", True),
            (plate_layer(), "Token faces — replace these", True),
            (guide_layer(), "Guides — hide before saving", True),
        ],
        (WIDTH, HEIGHT),
    )


if __name__ == "__main__":
    main()
