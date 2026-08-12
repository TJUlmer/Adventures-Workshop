"""
Measuring a stand-in card face against the Knockout cut it stands in for.

The printed cards are set in Knockout HTF, which cannot be redistributed, so
every face in `public/assets/fonts` is a substitute. `renderer/geometry.ts`
carries three numbers per role that depend on which substitute is loaded — the
size, the tracking and the `condense` factor — and its own comment says to
re-measure all three whenever the face changes. This module does the measuring;
`font-compare.py` prints it and `font-atlas.py` draws it.

Measure against the *font files*, never against a print template. The
template's ink already carries the artwork's tracking, so measuring a face
through it folds that tracking into the face's width and it is then applied
twice.

## Which Knockout file

`assets/fonts` holds two Featherweights and they are not interchangeable:

    Knockout-HTF48-Featherweight.otf          the original
    Knockout-HTF48-Featherweight-CUSTOM.ttf   the project's own cut

They disagree most on the figure 1 — 21px of ink against 35px at a 133px cap —
which is enough to move that glyph's score from 0.04 to 0.57 and to change the
answer to "what should be redrawn next". `-CUSTOM` is the reference the
project's comparison sheets are built against, because it is the cut the rest
of the family was matched to. Pass the other one deliberately, or not at all.

## Two overlaps, and the difference matters

There are two honest ways to lay one glyph over another, and they disagree
loudly on exactly the glyphs worth knowing about:

  shape      Aligned by the top-left of each glyph's ink. Answers "is this the
             same letter?" — independent of how the face spaces it.
  typeset    Aligned by the pen origin and the baseline, which is where the two
             would actually fall in a line of text. Answers "will it sit in the
             same place?"

The figure 1 is the case that makes the point. Bebas draws it in a *tabular*
advance with the ink pushed right; Knockout's is proportional and narrow. Laid
out as they would be typeset the two barely touch — 0.04 — while the drawings
themselves overlap at 0.43. Reporting either one alone would be a half-truth.
"""

from __future__ import annotations

from pathlib import Path

import freetype
import numpy as np
from fontTools.ttLib import TTFont

# Rendered cap height for shape comparison. High enough that a one-pixel
# rasterising difference is noise rather than signal.
CAP_PX = 133

# Capitals, figures and the punctuation a card title or a name might carry.
SAMPLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!\"'(),-.:;?&"

# Added only when *both* faces genuinely draw lower case — see `sample_for`.
LOWER_SAMPLE = "abcdefghijklmnopqrstuvwxyz"

# Strings the card actually sets in these faces. `condense` is fitted to them.
STRINGS = ["CARD TITLE", "VILLAIN", "DEATH FROM ABOVE", "THE HOLLOW KING"]

# The mixed-case counterpart, for the roles that carry copy rather than a name:
# ability text, initiative labels, the rules heading. Used alongside the caps
# strings whenever lower case is in play, and reported per string — if a face
# needs a different `condense` for copy than for titles, the spread says so.
MIXED_STRINGS = [
    "During combat, spend a boost",
    "After this card resolves",
    "Immediately after an opponent's scheme",
]


def draws_lowercase(path: Path) -> bool:
    """
    Does this face draw real lower case, or capitals wearing lowercase names?

    The question cannot be answered from the cmap. Bebas Neue is a caps-only
    face, and its 'a' is neither missing nor an alias of 'A' — it is a separate
    glyph id whose *outline* happens to be the capital, so every lookup says the
    lower case is there. So the drawings are compared instead.

    The separation is not marginal and does not need a careful threshold:
    measured across the project's faces, Bebas scores 1.0000 — every lowercase
    pixel-identical to its capital — while every mixed-case face here lands
    between 0.35 and 0.46. Anything above 0.9 is a caps-only face.
    """
    scores = []
    for char in LOWER_SAMPLE:
        lower, _, _ = render(path, char)
        upper, _, _ = render(path, char.upper())
        if lower.size == 0 or upper.size == 0:
            continue
        height = max(lower.shape[0], upper.shape[0])
        width = max(lower.shape[1], upper.shape[1])
        a = np.zeros((height, width), dtype=bool)
        b = np.zeros((height, width), dtype=bool)
        a[: lower.shape[0], : lower.shape[1]] = lower
        b[: upper.shape[0], : upper.shape[1]] = upper
        scores.append(_iou(a, b))
    return bool(scores) and float(np.mean(scores)) < 0.9


def sample_for(standin: Path, original: Path) -> str:
    """
    The glyphs worth comparing for *this* pair.

    Lower case is included only when both faces draw it. Against a caps-only
    stand-in every lowercase cell would score its capital against the other
    face's real 'a' — a mismatch that says nothing about the substitution, and
    twenty-six of them would swamp the sheet's sort order with noise. Against
    two mixed-case faces the opposite was true: leaving them out hid half of
    what the face is for.
    """
    if draws_lowercase(standin) and draws_lowercase(original):
        return SAMPLE + LOWER_SAMPLE
    return SAMPLE


def strings_for(standin: Path, original: Path) -> list[str]:
    """Set-width strings to fit `condense` to, matched to the same pair."""
    if draws_lowercase(standin) and draws_lowercase(original):
        return STRINGS + MIXED_STRINGS
    return STRINGS


def upm(font: TTFont) -> int:
    return font["head"].unitsPerEm


def cap_units(face: freetype.Face) -> float:
    """Cap height in font units, from the outline of 'H' rather than OS/2."""
    face.load_char("H", freetype.FT_LOAD_NO_SCALE | freetype.FT_LOAD_NO_BITMAP)
    return face.glyph.outline.get_bbox().yMax


def vertical_metrics(path: Path) -> dict[str, float]:
    """
    Everything as a fraction of the em.

    Cap and digit heights come from the *outlines* rather than from OS/2, which
    is a declaration a font is free to get wrong — and several do. Ascent and
    descent come from `hhea`, because that is what a browser builds its line box
    from, and the line box is what the geometry positions against.
    """
    font = TTFont(path)
    units = upm(font)
    face = freetype.Face(str(path))

    def ink_top(char: str) -> float:
        if ord(char) not in font.getBestCmap():
            return 0.0
        face.load_char(char, freetype.FT_LOAD_NO_SCALE | freetype.FT_LOAD_NO_BITMAP)
        return face.glyph.outline.get_bbox().yMax

    hhea = font["hhea"]
    return {
        "upm": units,
        "cap": ink_top("H") / units,
        "digit": ink_top("0") / units,
        "x": ink_top("x") / units,
        "ascent": hhea.ascent / units,
        "descent": abs(hhea.descent) / units,
    }


def render(path: Path, char: str, cap_px: int = CAP_PX) -> tuple[np.ndarray, int, int]:
    """
    One glyph, rasterised so its cap height is `cap_px` tall.

    Returns the ink plus its origin offsets — `bitmap_left` from the pen
    position and `bitmap_top` above the baseline — so a caller can align either
    by the origin or by the ink, and the two are not the same thing.
    """
    font = TTFont(path)
    if ord(char) not in font.getBestCmap():
        return np.zeros((0, 0), dtype=bool), 0, 0

    units = upm(font)
    face = freetype.Face(str(path))
    size = cap_px * units / cap_units(face)
    face.set_char_size(int(size * 64))
    face.load_char(char, freetype.FT_LOAD_RENDER)

    bitmap = face.glyph.bitmap
    rows, width = bitmap.rows, bitmap.width
    if rows == 0 or width == 0:
        return np.zeros((0, 0), dtype=bool), 0, 0

    data = np.array(bitmap.buffer, dtype=np.uint8).reshape(rows, bitmap.pitch)[:, :width]
    return data > 127, face.glyph.bitmap_left, face.glyph.bitmap_top


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    union = np.logical_or(a, b).sum()
    return float(np.logical_and(a, b).sum()) / float(union) if union else 0.0


def compose(
    standin: Path, original: Path, char: str, cap_px: int = CAP_PX, align: str = "shape"
) -> tuple[np.ndarray, np.ndarray, float] | None:
    """
    Both faces' ink for one character, on a shared canvas, plus their overlap.

    `align="shape"` puts each glyph's ink corner at the same point — the
    comparison of the drawings. `align="typeset"` puts each glyph's *origin* at
    the same point, which is where a line of text would put them.

    The canvas is sized from the glyphs rather than from a guess. A fixed pad
    silently drops every figure, because figures here stand taller than the caps
    the scale is matched on: one face lands on the canvas and the other does
    not, which scores as a shape mismatch when it is nothing of the kind.
    """
    ink_a, left_a, top_a = render(standin, char, cap_px)
    ink_b, left_b, top_b = render(original, char, cap_px)
    if ink_a.size == 0 or ink_b.size == 0:
        return None

    if align == "shape":
        # Ink corner to ink corner: sidebearings and advances drop out.
        off_a = off_b = (0, 0)
    else:
        pad_top = max(top_a, top_b)
        pad_left = max(0, -min(left_a, left_b))
        off_a = (pad_top - top_a, pad_left + left_a)
        off_b = (pad_top - top_b, pad_left + left_b)

    height = max(off_a[0] + ink_a.shape[0], off_b[0] + ink_b.shape[0])
    width = max(off_a[1] + ink_a.shape[1], off_b[1] + ink_b.shape[1])

    canvas_a = np.zeros((height, width), dtype=bool)
    canvas_b = np.zeros((height, width), dtype=bool)
    canvas_a[off_a[0] : off_a[0] + ink_a.shape[0], off_a[1] : off_a[1] + ink_a.shape[1]] = ink_a
    canvas_b[off_b[0] : off_b[0] + ink_b.shape[0], off_b[1] : off_b[1] + ink_b.shape[1]] = ink_b

    return canvas_a, canvas_b, _iou(canvas_a, canvas_b)


def overlaps(
    standin: Path, original: Path, chars: str | None = None, align: str = "shape"
) -> dict[str, float]:
    """
    Overlap per glyph. 1.0 is the same drawing in the same place.

    The glyphs default to whatever suits the pair — `sample_for` adds lower case
    when both faces draw it — rather than to a fixed inventory.
    """
    scores: dict[str, float] = {}
    for char in chars if chars is not None else sample_for(standin, original):
        result = compose(standin, original, char, align=align)
        if result is not None:
            scores[char] = result[2]
    return scores


def stem_width(path: Path) -> float:
    """
    Cap stem, as a fraction of cap height.

    The one property that cannot be fixed by scaling: squeeze a face to match a
    width and its stems thin with it, so this has to be right before anything
    else is worth measuring. Taken off 'I' where the face has one — a single
    unambiguous stem — and off 'H' below its crossbar otherwise.
    """
    for char in ("I", "H"):
        ink, _, _ = render(path, char, CAP_PX)
        if ink.size == 0:
            continue
        # A row a fifth up from the baseline: below any crossbar, above any foot.
        row = ink[int(ink.shape[0] * 0.8)]
        runs: list[int] = []
        run = 0
        for on in row:
            if on:
                run += 1
            elif run:
                runs.append(run)
                run = 0
        if run:
            runs.append(run)
        if runs:
            return float(np.median(runs)) / CAP_PX
    return float("nan")


def set_width(path: Path, text: str, cap_px: int = CAP_PX) -> float:
    """
    Advance width of a string at a matched cap height, in pixels.

    Kerning is deliberately not applied: the renderer sets these strings as
    plain CSS text with `letter-spacing`, and CSS does not kern across a
    letter-spacing value the way a typesetter would. Measuring with kerning
    would flatter the face by a width the browser will never produce.
    """
    font = TTFont(path)
    units = upm(font)
    face = freetype.Face(str(path))
    size = cap_px * units / cap_units(face)
    face.set_char_size(int(size * 64))

    total = 0.0
    for char in text:
        face.load_char(char, freetype.FT_LOAD_DEFAULT)
        total += face.glyph.advance.x / 64.0
    return total


def ink_size(path: Path, char: str, cap_px: int = CAP_PX) -> tuple[int, int]:
    """Ink width and height in pixels, for the per-cell readout."""
    ink, _, _ = render(path, char, cap_px)
    return (ink.shape[1], ink.shape[0]) if ink.size else (0, 0)
