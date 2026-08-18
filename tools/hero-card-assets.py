"""Derive the hero card's mask layers from the supplied templates.

    python tools/hero-card-assets.py

The supplied art is a *picture* of a finished card: the frame, the combat
ribbon's head and a leftover boost numeral all painted into one file, and the
character card's frame drawn with its band fills knocked out. The renderer
needs the pieces apart, because a hero's ribbon head takes the colour of
whichever combat symbol the card carries and the shape underneath it does not
change. Splitting them by hand would be guesswork; every number below was read
off the alpha and the ink of the files in `public/assets/templates`.

Regenerate rather than hand-editing. If a supplied template changes, the
measurements printed at the end are what the constants in
`src/lib/renderer/geometry.ts` are checked against.

Outputs, all alpha masks unless noted:

  hero_action_frame.png          the card frame, boost numeral removed
  hero_combat_banner.png         the ribbon's coloured head, chevron foot and all
  hero_ribbon_point.png          the tail's pennant point, at its natural place
  hero_ribbon_point_edge.png     that point's outline
  hero_character_frame_multi.png the sidekick frame with its health badge gone
  hero_character_border*.png     each character frame's pink, as a mask
  hero_character_ink*.png        …and everything else in it, as a picture

The ribbon's straight run is not written at all: it is a rectangle, and the
renderer draws it as one so that the ribbon can be any length. Only the point
has shape, which is the same split the villain/minion name ribbon already
makes.
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

TEMPLATES = Path(__file__).resolve().parent.parent / "public" / "assets" / "templates"

# The action card's print file. The supplied hero art is four rows short of it,
# so every derived mask is resampled onto this canvas and the numbers below are
# measured back off the result — that way `geometry.ts` has one bleed space and
# nothing has to remember a per-file scale factor.
BLEED = (1632, 2222)

SOURCE = "hero_action_card_border.png"

# The frame's own colour in the supplied file. Everything opaque that is *not*
# this is the ribbon the frame was drawn around.
CREAM = (246, 234, 218)

# The character card's border, in its own supplied art.
BORDER_PINK = (221, 160, 199)

# The three character-card layouts, by the suffix their derived pieces take.
CHARACTER_FRAMES = {
    "": "Hero_Character_Card_Template_frame.png",
    "_sidekick": "Hero_Character_Card_Template_sidekick_frame.png",
    "_multi": "hero_character_frame_multi.png"
}

# The supplied drawing of the ribbon's stroke: the card's frame and the stroke
# together, in one flat colour, at trim size. It is the authority on three
# things the border art cannot say — that the stroke runs down the **right**
# edge and round the **foot** and nowhere else, that it sits *outside* the
# ribbon's coloured body rather than inside it, and what the foot's own ∨ is
# shaped like.
STROKE_REF = "hero_frame_plus_ribbon_stroke.png"

# The stroke the ribbon's outline is drawn at, matching the villain ribbon's
# own right edge (`BANNER.edge.width`).
EDGE_STROKE = 17

# `HERO_RIBBON.x` and `HERO_RIBBON_SYMBOL.top` in geometry.ts — read directly
# rather than re-derived, since telling the frame's own top-left corner apart
# from the ghost of the example card's combat icon (see the frame section
# below) turns on exactly where that icon sits.
HERO_RIBBON_TOP = 147
HERO_RIBBON_SYMBOL_TOP = 187

# The frame window's bounds, in bleed pixels, read off `hero_action_frame.png`.
# The stroke drawing is on the same short canvas as every other piece of hero
# art, so it goes through the same resample and needs no offset of its own.


class WINDOW:
    x0, x1 = 147, 1485
    y0, y1 = 147, 2076


# Rows to ignore at the window's top and bottom, where resampling the drawing
# leaves a trace of the frame it was clipped away from. The sides need none —
# the foot's left arm runs right up to the window's edge and must keep it.
WINDOW_FEATHER = 3


class WINDOW:
    x0, x1 = 147, 1485
    y0, y1 = 147, 2076

# How far above its taper the point's art starts.
#
# The renderer draws the straight run as a rectangle and lays this on the end
# of it, so the two masks meet on one row — and a row where each contributes
# part of its alpha is a row that shows as a pale line across the ribbon.
# Overlapping them cannot produce one.
POINT_OVERLAP = 8


def load(name: str) -> np.ndarray:
    return np.array(Image.open(TEMPLATES / name).convert("RGBA")).astype(int)


def mask_png(alpha: np.ndarray) -> Image.Image:
    """A white image carrying `alpha`. Only the alpha channel is ever read."""
    height, width = alpha.shape
    rgba = np.full((height, width, 4), 255, dtype=np.uint8)
    rgba[:, :, 3] = alpha.astype(np.uint8)
    return Image.fromarray(rgba)


def to_bleed(image: Image.Image) -> Image.Image:
    return image.resize(BLEED, Image.LANCZOS)


def spans(mask: np.ndarray) -> list[tuple[int, int] | None]:
    """First and last set column of every row. The ribbon is convex per row."""
    out: list[tuple[int, int] | None] = []
    for row in mask:
        set_columns = np.flatnonzero(row)
        out.append((int(set_columns[0]), int(set_columns[-1])) if set_columns.size else None)
    return out


def squeeze(layer: np.ndarray, x0: int, x1: int, to_x0: int, to_x1: int) -> np.ndarray:
    """Resample a mask's columns from one span onto another, rows untouched."""
    out = np.zeros_like(layer)
    piece = Image.fromarray(layer[:, x0 : x1 + 1]).resize(
        (to_x1 - to_x0 + 1, layer.shape[0]), Image.LANCZOS
    )
    out[:, to_x0 : to_x1 + 1] = np.array(piece)
    return out


def square_edges(alpha_layer: np.ndarray, x0: int, x1: int) -> None:
    """Restore the ribbon's vertical sides, which the resample softens away.

    Only the taper is a slanted edge; everywhere else the ribbon is a hard
    rectangle, and the filter's ringing costs those rows their last column.
    A row already reaching both sides is filled solid; the taper is left alone.
    """
    span = x1 - x0 + 1
    for row in alpha_layer:
        lit = np.flatnonzero(row[x0 : x1 + 1] > 32)
        if lit.size >= span * 0.95:
            row[x0 : x1 + 1] = 255


def check_geometry(expected: dict[str, int]) -> None:
    """Hold `geometry.ts` to what was just derived.

    The masks and the numbers that place them have drifted apart twice, and
    both times it printed as the ribbon's fill running past its own point —
    which looks like a mask bug and is not one. Cheaper to fail here.
    """
    source = (
        TEMPLATES.parent.parent.parent / "src" / "lib" / "renderer" / "geometry.ts"
    ).read_text(encoding="utf-8")
    # `width` is not unique in the file, so that one is looked for inside the
    # `HERO_RIBBON` block rather than across the whole of it.
    block = source[source.index("export const HERO_RIBBON = {") :]
    block = block[: block.index("} as const;")]
    patterns = {
        "HERO_RIBBON.width": (block, r"width: (\d+)"),
        "HERO_RIBBON.edgeWidth": (block, r"edgeWidth: (\d+)"),
        "HERO_RIBBON.pointHeight": (block, r"pointHeight: (\d+)"),
        "HERO_POINT_BELOW": (source, r"HERO_POINT_BELOW = BLEED\.height - (\d+)")
    }
    print()
    for name, want in expected.items():
        haystack, pattern = patterns[name]
        found = re.search(pattern, haystack)
        got = int(found.group(1)) if found else None
        if name == "HERO_POINT_BELOW" and got is not None:
            got = BLEED[1] - got
        mark = "ok " if got == want else "!! "
        print(f"{mark}{name:24s} wants {want}, geometry.ts has {got}")


def main() -> None:
    art = load(SOURCE)
    rgb, alpha = art[:, :, :3], art[:, :, 3]
    height, width = alpha.shape
    opaque = alpha > 128
    cream = np.abs(rgb - np.array(CREAM)).sum(2) < 45

    # -- the ribbon's head -------------------------------------------------
    #
    # Filled by row span rather than by colour. The head is drawn with a white
    # starburst knocked into it, and the renderer paints its own symbol there —
    # so what is wanted is the silhouette, not the ink.
    ink = opaque & ~cream
    ink[:, 500:] = False  # the boost numeral the source was flattened with
    head = np.zeros_like(ink)
    for y, span in enumerate(spans(ink)):
        if span:
            head[y, span[0] : span[1] + 1] = True

    head_rows = np.flatnonzero(head.any(1))
    head_top, head_bottom = int(head_rows[0]), int(head_rows[-1])
    head_spans = spans(head)
    # The taper is the first row narrower than the run above it.
    run_width = max(span[1] - span[0] for span in head_spans if span)
    # Searched from the foot, not the head: the ribbon's top-left corner is
    # rounded to the frame's own radius, so its first rows are narrow too.
    taper_top = (
        next(
            y
            for y in range(head_bottom, head_top - 1, -1)
            if head_spans[y] and head_spans[y][1] - head_spans[y][0] == run_width
        )
        + 1
    )

    run_span = head_spans[taper_top - 1]
    assert run_span is not None

    # -- the frame ---------------------------------------------------------
    #
    # The cream only. The ribbon is drawn *under* this, exactly as the
    # villain/minion one is under `outer_border.png`, so the frame carries a
    # hole where the ribbon crosses it and the window's own rounded corner is
    # what shapes the ribbon's top. Nothing can show through the join, because
    # the ribbon is wider than the hole on every side that matters.
    frame = np.where(cream, alpha, 0)

    # The example card the source file shows carries a combat icon
    # (versatile's burst-and-shield — see `CARD_SYMBOL_COLORS`'s own note on
    # this file), and that icon's rays antialias down toward near-white at
    # their edges — close enough to `CREAM` for the threshold above to count
    # them as the frame's own ink. Left alone, that baked a faint ghost of
    # the burst into every hero's ribbon corner, showing through behind
    # whichever symbol a card actually carries.
    #
    # Two rounds of trying to zero it out cut into real ink instead, both
    # measured after the fact rather than guessed:
    #
    #   - Left of `run_span[0]` (147, the same 147 `HERO_RIBBON.x` places
    #     the ribbon at) is the frame's own left border stroke — solid at
    #     every row from the corner down to the foot, at *every* row this
    #     region spans, not only near the top. Zeroing from column 0 deleted
    #     it, which is the black gap this was caught from.
    #   - Above the icon, `head_top` through about 176, is the top border's
    #     rounded corner tapering into that same left stroke — solid ink
    #     (>94% of pixels lit across the full measured span, against under
    #     6% once the ghost actually starts), reaching as far right as
    #     column 199 at the very top row. Zeroing from `head_top` caught the
    #     tail of this taper too.
    #
    # The ghost itself only starts where `HERO_RIBBON_SYMBOL.top` (187 in
    # `geometry.ts`) puts the icon — unsurprising, since it is a trace of
    # that exact icon — which is comfortably clear of both: the taper has
    # narrowed back to the bare 127..147 stroke by row 176, and the ghost
    # never reaches left of 147 at any row. So the region zeroed is bounded
    # by the icon's own top and the ribbon's own left edge, not by the
    # ribbon head's full silhouette.
    icon_top = head_top + (HERO_RIBBON_SYMBOL_TOP - HERO_RIBBON_TOP)
    margin = 20
    frame[icon_top : head_bottom + margin, run_span[0] : run_span[1] + margin] = 0

    # -- the stroke, read off the supplied drawing -------------------------
    #
    # `hero_frame_plus_ribbon_stroke.png` is the frame and the stroke together,
    # at trim size, in one colour. Everything inside the frame's window is the
    # stroke: a bar down the right of the ribbon, and a ∨ round its foot.
    stroke = np.array(to_bleed(Image.open(TEMPLATES / STROKE_REF).convert("RGBA")))[:, :, 3]
    # Clipped to the frame's window: what is left of the drawing is the stroke
    # and nothing else, the border on all four sides having gone with it.
    stroke[:, : WINDOW.x0] = 0
    stroke[:, WINDOW.x1 + 1 :] = 0
    stroke[: WINDOW.y0 + WINDOW_FEATHER] = 0
    stroke[WINDOW.y1 - WINDOW_FEATHER :] = 0

    lit = stroke > 128
    bar_rows = [(int(np.flatnonzero(r)[0]), int(np.flatnonzero(r)[-1])) for r in lit if r.any()]
    bar_x0, bar_x1 = Counter(bar_rows).most_common(1)[0][0]

    # The stroke never runs right of its bar, so anything that does is the
    # frame's own edge caught by the resample.
    stroke[:, bar_x1 + 1 :] = 0
    lit = stroke > 128

    # The foot is one unbroken run of rows below the bar; anything past a gap
    # is the frame's own edge, caught by the resample.
    rows = np.flatnonzero(lit.any(1))
    foot_bottom = int(rows[0])
    for y in rows[1:]:
        if y > foot_bottom + 1:
            break
        foot_bottom = int(y)
    # The foot is where the stroke stops being that bar and turns inward.
    foot_top = (
        max(
            y
            for y in rows
            if (int(np.flatnonzero(lit[y])[0]), int(np.flatnonzero(lit[y])[-1]))
            == (bar_x0, bar_x1)
        )
        + 1
    )

    # -- the ribbon's own body ---------------------------------------------
    #
    # It ends where the stroke begins, so the head is squeezed from the border
    # art's own 147..389 into 147..(bar_x0 - 1). Ten pixels on a 1632px card,
    # and it is what puts the stroke *outside* the colour rather than eaten out
    # of it.
    body_x1 = bar_x0 - 1
    head_scaled = np.array(to_bleed(mask_png(np.where(head, 255, 0))))[:, :, 3]
    widest = max(
        (np.flatnonzero(row) for row in head_scaled > 128 if row.any()), key=len
    )
    head_x0, head_x1 = int(widest[0]), int(widest[-1])
    head_scaled[:, :head_x0] = 0
    head_scaled[:, head_x1 + 1 :] = 0
    square_edges(head_scaled, head_x0, head_x1)
    head_scaled = squeeze(head_scaled, head_x0, head_x1, WINDOW.x0, body_x1)

    # -- the foot's fill ----------------------------------------------------
    #
    # Whatever the stroke's ∨ encloses, row by row: the fill starts as the full
    # body and each row keeps only what the row above kept and the stroke has
    # not taken. `POINT_OVERLAP` rows of straight body above it, so the mask
    # and the rectangle the renderer draws overlap instead of meeting on one
    # row — a row where each contributes part of its alpha prints as a pale
    # line across the ribbon.
    foot = np.zeros_like(stroke)
    keep = np.zeros(BLEED[0], dtype=bool)
    keep[WINDOW.x0 : body_x1 + 1] = True
    for y in range(foot_top - POINT_OVERLAP, foot_bottom + 1):
        keep &= ~lit[y]
        foot[y][keep] = 255

    foot_edge = np.where(lit, 255, 0)
    foot_edge[: foot_top - POINT_OVERLAP] = 0

    mask_png(head_scaled).save(TEMPLATES / "hero_combat_banner.png")
    mask_png(foot).save(TEMPLATES / "hero_ribbon_point.png")
    mask_png(foot_edge).save(TEMPLATES / "hero_ribbon_point_edge.png")
    to_bleed(mask_png(frame)).save(TEMPLATES / "hero_action_frame.png")

    # -- the character card's third frame ----------------------------------
    #
    # A sidekick that is several identical figures shows a stack of tokens
    # where a single one shows a health badge, so the badge comes out of the
    # frame and the renderer draws the stack. Only the lower badge goes: the
    # hero's own is always a number.
    sidekick = load("Hero_Character_Card_Template_sidekick_frame.png")
    badge = np.abs(sidekick[:, :, :3] - np.array([41, 57, 146])).sum(2) < 60
    badge |= sidekick[:, :, :3].min(2) > 235  # the white flash inside it
    badge[: sidekick.shape[0] // 2] = False  # the hero's row keeps its badge
    badge[:, :1200] = False  # …and the row's own "START HEALTH" label stays
    multi = sidekick.copy()
    multi[badge, 3] = 0
    Image.fromarray(multi.astype(np.uint8)).save(
        TEMPLATES / "hero_character_frame_multi.png"
    )

    # -- the character card, split into a border and its ink ---------------
    #
    # The frame is one flat picture, and everything in it is either the card's
    # *border* — the pink outline and the bars between the bands — or something
    # printed inside a band: a tab label, a START HEALTH caption, the health
    # badge, the move arrow, the word MOVE. Only the first is a colour an
    # author would want to choose, so it comes out as a mask and the rest stays
    # a picture. Nothing overlaps, so the two can be laid down in either order.
    for name, source in CHARACTER_FRAMES.items():
        frame_art = load(source)
        pink = np.abs(frame_art[:, :, :3] - np.array(BORDER_PINK)).sum(2) < 90
        border = np.where(pink, frame_art[:, :, 3], 0)
        ink = frame_art.copy()
        ink[pink, 3] = 0
        mask_png(border).save(TEMPLATES / f"hero_character_border{name}.png")
        Image.fromarray(ink.astype(np.uint8)).save(TEMPLATES / f"hero_character_ink{name}.png")

    # -- what geometry.ts is checked against -------------------------------
    scale = BLEED[1] / height
    print(f"source            {width} x {height}  ->  {BLEED[0]} x {BLEED[1]}")
    print(f"body x            {WINDOW.x0}..{body_x1}  (width {body_x1 - WINDOW.x0 + 1})")
    print(f"stroke x          {bar_x0}..{bar_x1}  (width {bar_x1 - bar_x0 + 1})")
    print(f"ribbon width      {bar_x1 - WINDOW.x0 + 1}")
    print(f"ribbon top        {head_top * scale:.1f}")
    print(f"head taper top    {taper_top * scale:.1f}")
    print(f"head point        {head_bottom * scale:.1f}")
    print(f"foot top          {foot_top}")
    print(f"foot bottom       {foot_bottom}")
    print(f"foot height       {foot_bottom - foot_top + 1}")
    print(f"below the foot    {BLEED[1] - foot_bottom - 1}")
    tip = np.flatnonzero(lit[foot_bottom])
    print(f"point centre x    {(tip[0] + tip[-1]) / 2:.1f}")

    check_geometry(
        {
            "HERO_RIBBON.width": bar_x1 - WINDOW.x0 + 1,
            "HERO_RIBBON.edgeWidth": bar_x1 - bar_x0 + 1,
            "HERO_RIBBON.pointHeight": foot_bottom - foot_top + 1,
            "HERO_POINT_BELOW": BLEED[1] - foot_bottom - 1
        }
    )

if __name__ == "__main__":
    main()
