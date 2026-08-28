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
  hero_character_badge*.png      …the hero's own health badge, as a mask
  hero_character_badge_accent*.png …the small triangle notched into it, as a
                                  separate mask
  hero_character_label_ink_*.png  …each band's tab label and START HEALTH
                                  caption, as one mask per band
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
from scipy import ndimage

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

# The health badge's fill, in its own supplied art — the same blue the
# sidekick-badge removal below already matches, read off the hero's own
# (upper) badge instead of the sidekick's (lower) one.
BADGE_BLUE = (41, 57, 146)

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

# Alpha at which the stroke counts as opaque enough to hide the fill behind it.
# Capped per row by that row's own peak, since the last rows of the taper are a
# few pixels wide and never reach it.
OPAQUE = 250


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


# Suffixes for every character-card ink file — the three this script's own
# loop writes, plus `_multihealth`, whose ink is generated by a separate,
# untracked one-off script (see `TEMPLATE_ASSETS.heroCharacterInk`'s own note
# in `renderer/assets.ts`) but shares this exact row with the other three,
# confirmed pixel-for-pixel below rather than assumed.
CHARACTER_INK_SUFFIXES = ["", "_sidekick", "_multi", "_multihealth"]

# Where the move arrow and the word MOVE both live, in every ink file —
# tight enough on the left to exclude the "Special ability" heading's own
# ink (which reaches as far right as column 1178 in every file, confirmed
# below rather than assumed) while leaving room on every other side. Nothing
# but the arrow and the four letters fall inside it, so `split_move_ink`
# takes the whole region rather than picking shapes apart within it.
MOVE_ROI = (1200, 550, 1550, 1700)  # x0, y0, x1, y1


def split_move_ink() -> None:
    """Pull the move arrow and the word MOVE out of `hero_character_ink*.png`.

    Both used to be fixed ink; both come out now, into one mask, because an
    author who recolours the move *value* means the whole of it — the digit,
    the arrow that points at it, and the word naming it — not just the digit
    on its own. One extraction, one written mask, since `MOVE_ROI` contains
    nothing else: no per-shape filtering needed the way the arrow alone once
    needed to be told apart from the word.

    All four ink files carry the identical shape at the identical position —
    this row does not vary by layout — so one written mask covers every
    layout; `TEMPLATE_ASSETS.heroCharacterMoveInk` points every key at the
    same file for that reason.

    **This stage erases from the files it reads**, so it cannot run twice: the
    second pass finds an empty `MOVE_ROI` because the first pass emptied it.
    That is the same "reads its own output" fault `tools/card-masks.py` was
    rebuilt to avoid, and fixing it properly here means a supplied `_raw` copy
    of all four ink files, which does not exist. Until it does, an already-run
    region is *skipped* rather than raised on — the extraction has happened,
    the mask beside it is already written, and blocking every later stage over
    work that is finished helps nobody. Genuinely missing ink still raises: the
    ROI is empty in every file *and* no mask was ever written.
    """
    x0, y0, x1, y1 = MOVE_ROI
    shared_alpha: np.ndarray | None = None
    written = TEMPLATES / "hero_character_move_ink.png"

    for suffix in CHARACTER_INK_SUFFIXES:
        path = TEMPLATES / f"hero_character_ink{suffix}.png"
        ink = np.array(Image.open(path).convert("RGBA")).astype(int)
        region = np.zeros(ink.shape[:2], dtype=bool)
        region[y0:y1, x0:x1] = ink[y0:y1, x0:x1, 3] > 128
        if not region.any():
            if written.exists():
                print(f"move ink already out of {path.name}; skipping")
                continue
            raise RuntimeError(f"no move ink found in {path.name}")

        # The >128 threshold leaves an antialiased fringe behind — a ring of
        # sub-128 alpha `region` never claimed. Dilating a few pixels and
        # re-intersecting with any nonzero alpha picks that fringe back up;
        # without it, erasing only the hard core left a faint ghost outline
        # in `ink`, and the saved mask's own edge came out a shade smaller
        # than the shape it was cut from.
        claimed = ndimage.binary_dilation(region, iterations=3) & (ink[:, :, 3] > 0)
        alpha = np.where(claimed, ink[:, :, 3], 0)
        if suffix == "":
            shared_alpha = alpha

        ink[claimed, 3] = 0
        Image.fromarray(ink.astype(np.uint8)).save(path)

    if shared_alpha is not None:
        mask_png(shared_alpha).save(written)


# Each band's own run down the card, matching `CHARACTER_BAND_RUNS` in
# `geometry.ts` — the same three-way split the design object already makes,
# so a band's labels and a band's fill are cut on one boundary rather than
# two that could drift apart.
CHARACTER_LABEL_BANDS = {
    "hero": (140, 606),
    "ability": (630, 1588),
    "sidekick": (1612, 2078),
}

# The two columns a band's labels stand in: the rotated tab down the left
# edge, and the "START HEALTH" caption beside the badge. Both are deliberately
# narrower than the band itself, because the band's rows also carry things
# that are *not* words — the decorative arcs at x1280..1403, and (on the
# sidekick layouts) the sidekick's own health badge, which is fixed ink at
# x1280..1404 rather than a mask like the hero's. Taking whole rows would
# sweep both into a mask labelled "the words in this band".
#
# `CAP_COLUMN` spans both the ordinary caption (x1086..1179) and the shifted
# one a 3+ health swarm prints (x1004..1097), and stops short of
# `CHARACTER_ATTACK_ROW.badgeX` at 1209 so no badge art can reach it.
LABEL_TAB_COLUMN = (150, 220)
LABEL_CAP_COLUMN = (995, 1205)

# Which mask each layout's sidekick band reads. The hero and ability bands are
# pixel-identical in all four ink files (asserted below, not assumed), so each
# writes one file; the sidekick band is not — a 3+ health swarm shifts its
# caption left — and the quote layout has no sidekick labels at all.
SIDEKICK_LABEL_FILES = {
    "": None,
    "_sidekick": "hero_character_label_ink_sidekick.png",
    "_multi": "hero_character_label_ink_sidekick.png",
    "_multihealth": "hero_character_label_ink_sidekick_multihealth.png",
}


def label_roi(band: str, shape: tuple[int, int]) -> np.ndarray:
    """The region one band's own labels stand in, as a boolean mask."""
    y0, y1 = CHARACTER_LABEL_BANDS[band]
    roi = np.zeros(shape, dtype=bool)
    roi[y0 : y1 + 1, LABEL_TAB_COLUMN[0] : LABEL_TAB_COLUMN[1] + 1] = True
    # The ability band is one tall panel with no attack row, so no caption.
    if band != "ability":
        roi[y0 : y1 + 1, LABEL_CAP_COLUMN[0] : LABEL_CAP_COLUMN[1] + 1] = True
    return roi


def split_label_ink() -> None:
    """Pull each band's tab label and START HEALTH caption into its own mask.

    "HERO", "ATTACK" and "START HEALTH" in the name band; "SPECIAL ABILITY" in
    the ability band; "SIDEKICK", "ATTACK" and "START HEALTH" in the
    sidekick's. All of it used to be fixed ink on the reasoning that a label
    is nobody's choice — which held right up until an author wanted the words
    to sit on a band they had recoloured. A white tab on a navy band is the
    template's own pairing, not a rule; recolour the band and the pairing is
    the author's to make again.

    One mask per *band*, not per word, because a band is what the picker sits
    beside — `CharacterBandStyle.labelInk`, next to the fill it has to read
    against. The three are cut on `CHARACTER_BAND_RUNS`' own boundaries, so a
    label can only ever belong to the band whose colour it is judged against.

    What is deliberately left in the picture: the decorative arcs that frame a
    badge, and the sidekick's own health badge on the sidekick layouts. Neither
    is a word, and the badge in particular is a whole shape drawn as fixed ink
    (see `HeroCharacterCardFace`'s note on why the sidekick's was never a
    mask) — inking it with the labels would hand one picker two unrelated jobs.

    **This stage erases from the files it reads**, exactly as `split_move_ink`
    does and for the same unfixable reason: there is no supplied `_raw` copy of
    the four ink files to read instead. So an already-run band is *skipped*
    rather than raised on, keyed on the mask beside it already existing.
    """
    written: dict[str, np.ndarray] = {}
    skipped = 0

    for suffix in CHARACTER_INK_SUFFIXES:
        path = TEMPLATES / f"hero_character_ink{suffix}.png"
        ink = np.array(Image.open(path).convert("RGBA")).astype(int)
        touched = False

        for band in CHARACTER_LABEL_BANDS:
            if band == "sidekick":
                name = SIDEKICK_LABEL_FILES[suffix]
                if name is None:
                    continue  # the quote layout prints no sidekick band
            else:
                name = f"hero_character_label_ink_{band}.png"

            roi = label_roi(band, ink.shape[:2])
            region = roi & (ink[:, :, 3] > 128)
            if not region.any():
                if (TEMPLATES / name).exists():
                    skipped += 1
                    continue
                raise RuntimeError(f"no {band} label ink found in {path.name}")

            # The same antialiased-fringe recovery `split_move_ink` documents:
            # >128 leaves a ring of sub-threshold alpha behind, which shows as
            # a ghost outline in the picture and a mask a shade small. Clipped
            # back to the ROI so a dilation cannot reach into a neighbouring
            # band or out towards the badge.
            claimed = ndimage.binary_dilation(region, iterations=3) & (ink[:, :, 3] > 0) & roi
            alpha = np.where(claimed, ink[:, :, 3], 0)

            # Every layout that shares a mask must agree pixel-for-pixel, or
            # one of them is being drawn somebody else's labels. Checked here
            # rather than trusted: the hero and ability bands are identical in
            # all four files, and `_sidekick`/`_multi` in the two that share.
            if name in written:
                if not np.array_equal(alpha, written[name]):
                    raise RuntimeError(f"{path.name}: {band} labels differ from {name}")
            else:
                written[name] = alpha

            ink[claimed, 3] = 0
            touched = True

        if touched:
            Image.fromarray(ink.astype(np.uint8)).save(path)

    for name, alpha in written.items():
        mask_png(alpha).save(TEMPLATES / name)
        print(f"wrote {name}  ({int((alpha > 128).sum())} px)")
    if skipped:
        print(f"label ink already out of {skipped} band(s); skipped")


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

    # The window's own first column keeps a trace of the frame's *left* edge
    # through the same resample — about 120 alpha on 1233 rows, the whole
    # height of the card. `lit`'s 128 threshold dropped it for free; the ∨
    # keeps the stroke's real alpha now (see `foot_edge` below), so it has to
    # go explicitly or it prints as a faint hairline down the interior.
    # Only the part below `lit`: the ∨'s left arm genuinely starts in this
    # column, and where it does it is fully opaque.
    stroke[stroke[:, WINDOW.x0] < 128, WINDOW.x0] = 0

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
    #
    # Carved at the stroke's opaque *ridge* rather than at `lit`'s halfway
    # point, so the fill runs on under the stroke until the stroke can hide
    # it. `lit` was right while the ∨ was drawn 0/255 — the fill met an
    # opaque edge and the two composited solid — but the moment the edge
    # keeps its own ramp (below), stopping the fill at 50% leaves the pixels
    # between there and the stroke's core carrying only the stroke's partial
    # alpha: measured, 89 rows of the taper with a fully transparent pixel
    # inside the ribbon. Capped by each row's own peak because the last two
    # rows of the point are a few pixels wide and never reach `OPAQUE`.
    ridge = stroke >= np.minimum(OPAQUE, stroke.max(axis=1, keepdims=True))
    foot = np.zeros_like(stroke)
    keep = np.zeros(BLEED[0], dtype=bool)
    keep[WINDOW.x0 : body_x1 + 1] = True
    for y in range(foot_top - POINT_OVERLAP, foot_bottom + 1):
        keep &= ~ridge[y]
        foot[y][keep] = 255

    # The ∨ keeps the stroke's *own* alpha rather than being re-thresholded to
    # 0/255. `stroke` is a LANCZOS resample onto the bleed canvas, so it
    # already carries a ramp that tracks the taper's sub-pixel position row by
    # row; `np.where(lit, 255, 0)` threw that away and printed the point as a
    # staircase. Nothing here can put it back — measured on the villain's
    # ribbon, a thresholded taper crosses at a pixel centre on every row and
    # steps 5, 6, 5, 5, 6 px, where the same taper with its ramp intact steps
    # a constant 5.23. Antialiasing already in the art can only be preserved.
    foot_edge = stroke.copy()
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

    # -- the character card, split into a border, two health-badge masks, and
    #    ink -------------------------------------------------------------
    #
    # The frame is one flat picture, and everything in it is either the card's
    # *border* — the pink outline and the bars between the bands — the health
    # badge behind the START HEALTH number, a small triangular accent notched
    # low into that badge, or something else printed inside a band: a tab
    # label, the START HEALTH caption itself, the move arrow, the word MOVE.
    # The first three are colours an author would want to choose
    # independently, so they come out as masks and the rest stays a picture.
    # Nothing overlaps, so all four can be laid down in any order.
    #
    # Also resampled onto the full bleed canvas here (`to_bleed`), the same as
    # `hero_action_frame.png` already is above — this split used to save at the
    # source template's own native resolution and leave the scale-up to the
    # browser's `mask-size: 100% 100%` at render time, which is exactly the
    # class of bug the ribbon-head notes above warn about: a non-integer
    # runtime upscale of a hard alpha edge can lose enough coverage at the
    # boundary to show whatever is behind it. Pre-resampling once here removes
    # the runtime scale rather than patching around it.
    #
    # The resample itself softens what was a hard-edged mask into a few rows
    # of partial alpha at every transition — harmless for `ink`, which is
    # full-colour art that wants antialiasing anyway, but for a mask laid
    # *over* a band fill, a partially-opaque edge blends the mask's own
    # colour with the fill's rather than reading as a crisp line, which
    # showed as a thin stray band between a band and the frame around it.
    # `harden` restores the hard edge the source always had, the mask-only
    # equivalent of `square_edges` above.
    def harden(image: Image.Image) -> Image.Image:
        alpha = np.array(image)[:, :, 3]
        return mask_png(np.where(alpha >= 128, 255, 0))

    for name, source in CHARACTER_FRAMES.items():
        frame_art = load(source)
        opaque = frame_art[:, :, 3] > 128
        pink = (np.abs(frame_art[:, :, :3] - np.array(BORDER_PINK)).sum(2) < 90) & opaque
        border = np.where(pink, frame_art[:, :, 3], 0)

        # The badge is a shield, whole — its own natural taper at the foot
        # included, not split from the body above it. Matched by colour and
        # kept to the *upper* half — the hero's own badge — and never left of
        # column 1200, which is the START HEALTH caption's own column and
        # must stay part of `ink`. Restricted to opaque source pixels, since
        # an unrestricted match also catches the template's own transparent
        # padding, which happens to read as the same blue once premultiplied.
        badge = (np.abs(frame_art[:, :, :3] - np.array(BADGE_BLUE)).sum(2) < 60) & opaque
        badge[frame_art.shape[0] // 2 :] = False
        badge[:, :1200] = False
        badge_rows = np.flatnonzero(badge.any(1))
        badge_top, badge_bottom = int(badge_rows[0]), int(badge_rows[-1])

        # A small near-white triangle is notched into the shield low in its
        # body — its own printed decoration, not the shield's fill colour, so
        # it comes out as a mask of its own rather than taking whatever the
        # badge is coloured. Scoped to the shield's own row span (measured
        # above, not guessed) so this cannot catch unrelated near-white ink
        # elsewhere on the card.
        accent = (frame_art[:, :, :3].min(2) > 235) & opaque
        accent[:badge_top] = False
        accent[badge_bottom + 1 :] = False
        accent[:, :1200] = False

        ink = frame_art.copy()
        ink[pink, 3] = 0
        ink[badge, 3] = 0
        ink[accent, 3] = 0

        harden(to_bleed(mask_png(border))).save(TEMPLATES / f"hero_character_border{name}.png")
        harden(to_bleed(mask_png(np.where(badge, frame_art[:, :, 3], 0)))).save(
            TEMPLATES / f"hero_character_badge{name}.png"
        )
        harden(to_bleed(mask_png(np.where(accent, frame_art[:, :, 3], 0)))).save(
            TEMPLATES / f"hero_character_badge_accent{name}.png"
        )
        to_bleed(Image.fromarray(ink.astype(np.uint8))).save(
            TEMPLATES / f"hero_character_ink{name}.png"
        )

    split_move_ink()
    split_label_ink()

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
