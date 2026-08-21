"""Build the health dial's skin templates: one-sided, and two-sided.

The dial is a generated disc (`src/lib/figures/health-dial.ts`) and its texture
goes through the token texture builder, which lays a *square* of artwork over a
band of rim colour and hands the square to the disc's face. So the thing an
author actually paints is that square, and this writes two templates for it —
a layered PSD to work in and a flattened PNG to look at, for each of the two
ways a dial can wear its art:

  * `health_dial_skin` — one square, shown the same on both faces. The common
    case, and the only one that existed before the dial could wrap to the back.
  * `health_dial_skin_two_sided` — two squares side by side, front then back,
    the same front|back layout `token_skin_two_sided.py` already uses for a
    two-sided token. Front is the disc's *top* face — the one Tabletop
    Simulator draws the health number and its two triggers over, since the
    Lua only ever places them clear of the top (`faceY()` in `health
    dial.json`) — so the front half carries that same guide; the back is a
    plain disc with nothing drawn over it, because nothing ever is.

Two files rather than the one restructured into a 2:1 canvas, because a
one-sided author's source image is still a plain square, fit straight into
`buildTokenTexture` — forcing that into a 2:1 canvas and a crop back down
would be a regression for what stays the more common case. `face_guide()` is
what keeps the two templates' numbers from drifting apart from each other: the
front half of the two-sided template and the whole of the one-sided template
call the exact same drawing code, so a correction to one is a correction to
both.

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

# The two-sided canvas: the same square, twice, side by side.
HALF = SIZE
WIDTH, HEIGHT = HALF * 2, HALF
FACES = (
    (0, "FRONT", "shows the health number and triggers", True),
    (HALF, "BACK", "the underside — nothing is drawn over it", False),
)


def rim_layer(size: tuple[int, int]) -> Image.Image:
    return Image.new("RGBA", size, (*RIM, 255))


def plate_layer() -> Image.Image:
    image = blank((SIZE, SIZE))
    plate(ImageDraw.Draw(image), MIDDLE, RADIUS, "YOUR ART HERE")
    return image


def plate_layer_two_sided() -> Image.Image:
    image = blank((WIDTH, HEIGHT))
    draw = ImageDraw.Draw(image)
    for x0, label, _, _ in FACES:
        plate(draw, (x0 + HALF / 2, HALF / 2), HALF / 2, label)
    return image


def face_guide(
    draw: ImageDraw.ImageDraw,
    middle: tuple[float, float],
    radius: float,
    ink,
    faint,
    show_controls: bool,
) -> None:
    """The disc's own guide: its edge, crosshairs, and — on the face Tabletop
    Simulator actually draws over — the health number and its two triggers.

    Shared by the one-sided template and the front half of the two-sided one,
    so the two guides cannot drift apart: a correction to the trigger position
    made here is a correction made in both places at once, which is the whole
    reason this was pulled out rather than copied.
    """
    ring(draw, middle, radius - 2, ink, 3, dash=72)
    ring(draw, middle, radius * 0.94, faint, 2)

    draw.line((middle[0], middle[1] - radius, middle[0], middle[1] + radius), fill=faint, width=1)
    draw.line((middle[0] - radius, middle[1], middle[0] + radius, middle[1]), fill=faint, width=1)

    if not show_controls:
        return

    # The health number, which Tabletop Simulator draws over the middle.
    number = radius * 0.40
    ring(draw, middle, number, ink, 2, dash=48)
    centred(draw, (middle[0], middle[1] - number - 26), "HEALTH NUMBER", 26, ink)

    # The triggers: 0.6 of the disc's radius out, which is 0.3 of the square.
    for direction, glyph, verb in ((-1, "<", "LOWER"), (1, ">", "RAISE")):
        x = middle[0] + direction * TRIGGER_X * radius
        spot = radius * 0.15
        draw.ellipse((x - spot, middle[1] - spot, x + spot, middle[1] + spot), outline=ink, width=2)
        centred(draw, (x, middle[1]), glyph, 90, faint)
        centred(draw, (x, middle[1] + spot + 24), verb, 22, ink)


def guide_layer() -> Image.Image:
    image = blank((SIZE, SIZE))
    draw = ImageDraw.Draw(image)
    ink = (*GUIDE, 235)
    faint = (*GUIDE, 110)

    face_guide(draw, MIDDLE, RADIUS, ink, faint, show_controls=True)

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


def guide_layer_two_sided() -> Image.Image:
    image = blank((WIDTH, HEIGHT))
    draw = ImageDraw.Draw(image)
    ink = (*GUIDE, 235)
    faint = (*GUIDE, 110)

    for x0, label, what, controls in FACES:
        middle = (x0 + HALF / 2, HALF / 2)
        face_guide(draw, middle, HALF / 2, ink, faint, show_controls=controls)
        # The square the face samples, same guide role as the token template's.
        draw.rectangle((x0 + 1, 1, x0 + HALF - 2, HALF - 2), outline=faint, width=1)
        draw.text((x0 + 22, 18), f"{label} — {what}", font=font(24), fill=ink)

    # The seam, and the one pixel of it that becomes the edge of the piece —
    # same convention `token_skin_two_sided.psd` uses, for the same reason: a
    # two-sided image has no separate rim strip to spare.
    draw.line((HALF, 0, HALF, HEIGHT), fill=ink, width=3)
    spot = 46
    ring(draw, (HALF, HALF / 2), spot, ink, 3)
    draw.line((HALF - spot - 34, HALF / 2, HALF - spot - 6, HALF / 2), fill=ink, width=2)
    draw.line((HALF + spot + 6, HALF / 2, HALF + spot + 34, HALF / 2), fill=ink, width=2)
    centred(draw, (HALF, HALF / 2 - spot - 52), "THE RIM IS PAINTED", 24, ink)
    centred(draw, (HALF, HALF / 2 - spot - 24), "WITH THIS PIXEL", 24, ink)

    # Fewer, longer lines than the one-sided template's own note — this canvas
    # is twice as wide, and wrapping to the same narrow measure would run the
    # paragraph off the bottom of the square.
    draw.multiline_text(
        (22, HEIGHT - 100),
        "Two faces of one dial, left then right, each the one-sided template's own square. The health number and its\n"
        "triggers are only ever drawn on the FRONT by the game, whichever picture is showing there — paint the back\n"
        "freely. The underside is turned over by the model, not by you.",
        font=font(20),
        fill=ink,
        spacing=6,
    )
    return image


def main() -> None:
    publish(
        "health_dial_skin",
        [
            (rim_layer((SIZE, SIZE)), "Rim colour", True),
            (plate_layer(), "Dial face — replace this", True),
            (guide_layer(), "Guides — hide before saving", True),
        ],
        (SIZE, SIZE),
    )
    publish(
        "health_dial_skin_two_sided",
        [
            (rim_layer((WIDTH, HEIGHT)), "Seam and rim colour", True),
            (plate_layer_two_sided(), "Dial faces — replace these", True),
            (guide_layer_two_sided(), "Guides — hide before saving", True),
        ],
        (WIDTH, HEIGHT),
    )


if __name__ == "__main__":
    main()
