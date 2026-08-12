"""
Draw a glyph-by-glyph comparison sheet for a stand-in against its Knockout cut.

    python tools/font-atlas.py \
        public/assets/fonts/BebasNeue-Custom.ttf \
        "assets/fonts/Knockout-HTF48-Featherweight.otf" \
        assets/bebas_featherweight_comparison.png

Every glyph is drawn twice on the same cell, at a matched cap height:

    green    Knockout only — ink the stand-in is missing
    magenta  stand-in only — ink Knockout does not have
    white    both agree

Green and magenta sum to white, so agreement is literally the two channels
landing on the same pixel. Nothing is judged by eye: the number under each cell
is the measured overlap, and the sheet is sorted worst first so the glyphs worth
redrawing are the ones you read before you get bored.

Alignment is by each outline's **top-left ink corner**, which compares the
drawings rather than the spacing — see `fonts.py` for why that is a different
question from where the two would fall in a line of type, and for the figure
that proves it.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
import fonts as F  # noqa: E402

# The sheet is set in one of the project's own condensed faces, because a sheet
# about type that is set in the system UI font reads as a spreadsheet.
CHROME_FONT = Path("public/assets/fonts/Oswald-custom-condensed.ttf")

COLUMNS = 8
CELL_PAD = 6
MARGIN = 8
GLYPH_BOX = 200
LABEL_STRIP = 48

# Human names for the files, so the sheet's heading reads as a sentence about
# type rather than as two paths. Anything not listed falls back to its stem.
PRETTY = {
    "BebasNeue-Custom": "Bebas Neue Custom",
    "BebasNeue-Regular": "Bebas Neue",
    "Oswald-custom-condensed": "Oswald Custom Condensed",
    "Os-Custom-Junior": "Oswald Custom Junior",
    "Knockout-HTF48-Featherweight-CUSTOM": "Knockout HTF48 Featherweight",
    "Knockout-HTF48-Featherweight": "Knockout HTF48 Featherweight (original .otf)",
    "Knockout-HTF29-JuniorLiteweight-CUSTOM": "Knockout HTF29 JuniorLiteweight",
    "Knockout-HTF49-Liteweight-Custom": "Knockout HTF49 Liteweight",
}

# Which card roles a given Knockout cut is the face for — the reason anyone is
# looking at this sheet at all.
ROLES = {
    "Knockout-HTF48-Featherweight-CUSTOM": "the title cut",
    "Knockout-HTF48-Featherweight": "the title cut",
    "Knockout-HTF29-JuniorLiteweight-CUSTOM": "the ability-text cut",
    "Knockout-HTF49-Liteweight-Custom": "the numeral cut",
}

PAGE_BG = (18, 19, 23)
CELL_BG = (0, 0, 0)
STRIP_BG = (30, 31, 36)
TITLE_INK = (245, 245, 245)
SUB_INK = (200, 200, 200)
NOTE_INK = (224, 168, 96)
DIM_INK = (122, 122, 122)
CHAR_INK = (232, 232, 232)

KNOCKOUT_RGB = np.array([0, 255, 0], dtype=np.uint8)
STANDIN_RGB = np.array([255, 0, 255], dtype=np.uint8)


def overlap_ink(score: float) -> tuple[int, int, int]:
    """
    Worst-first is the sort; colour is the second reading of the same fact.

    Banded rather than a smooth ramp, because the eye reads three categories
    off a page far faster than it reads a gradient — and the bands are where
    the decisions actually are: below 0.6 is a different letter, 0.6–0.8 is
    visibly off, above 0.8 is a drawing difference a reader would not name.
    """
    if score < 0.60:
        return (255, 77, 77)
    if score < 0.75:
        return (255, 153, 51)
    if score < 0.85:
        return (255, 221, 68)
    return (150, 150, 150)


def cell_image(
    standin: Path, original: Path, char: str, cap_px: int
) -> tuple[Image.Image, float, tuple[int, int], tuple[int, int]] | None:
    """One cell's glyph composite, plus the numbers printed under it."""
    result = F.compose(standin, original, char, cap_px=cap_px, align="shape")
    if result is None:
        return None
    ink_standin, ink_knockout, score = result

    height, width = ink_standin.shape
    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    # Additive: where both land, the channels sum to white on their own.
    rgb[ink_knockout] += KNOCKOUT_RGB
    rgb[ink_standin] += STANDIN_RGB

    return (
        Image.fromarray(rgb),
        score,
        F.ink_size(original, char, cap_px),
        F.ink_size(standin, char, cap_px),
    )


def build(standin: Path, original: Path, out: Path, cap_px: int = F.CAP_PX) -> None:
    cells = []
    # Lower case joins the sheet only when both faces draw it — see
    # `fonts.sample_for`. A caps-only stand-in would otherwise fill twenty-six
    # cells with its capitals scored against the other face's real lower case,
    # and the sort puts the worst first, so the noise would land at the top.
    for char in F.sample_for(standin, original):
        made = cell_image(standin, original, char, cap_px)
        if made is not None:
            cells.append((char, *made))

    # Worst first: the sheet exists to find what to redraw next.
    cells.sort(key=lambda item: item[2])

    rows = (len(cells) + COLUMNS - 1) // COLUMNS
    cell_w = (2400 - 2 * MARGIN - (COLUMNS - 1) * CELL_PAD) // COLUMNS
    cell_h = GLYPH_BOX + LABEL_STRIP + 24
    head_h = 122
    foot_h = 40
    width = 2 * MARGIN + COLUMNS * cell_w + (COLUMNS - 1) * CELL_PAD
    height = head_h + rows * (cell_h + CELL_PAD) + foot_h

    page = Image.new("RGB", (width, height), PAGE_BG)
    draw = ImageDraw.Draw(page)

    def face(size: int) -> ImageFont.FreeTypeFont:
        return ImageFont.truetype(str(CHROME_FONT), size)

    standin_name = PRETTY.get(standin.stem, standin.stem)
    original_name = PRETTY.get(original.stem, original.stem)
    role = ROLES.get(original.stem)
    heading = f"{standin_name} vs {original_name}" + (f" — {role}" if role else "")

    draw.text((MARGIN, 8), heading, font=face(42), fill=TITLE_INK)
    draw.text(
        (MARGIN, 58),
        "Sorted worst match first. Green = Knockout only, magenta = stand-in only, white = both agree.",
        font=face(25),
        fill=SUB_INK,
    )
    # Which inventory this sheet actually drew, and why. Hardcoded once as
    # "no lower case" — true of Bebas, false the moment a mixed-case stand-in
    # was compared, and a sheet that misdescribes its own contents is worse
    # than one that says nothing.
    caps_only = not (F.draws_lowercase(standin) and F.draws_lowercase(original))
    inventory = (
        f"Capitals, figures and punctuation only: {standin_name} draws every lowercase"
        " codepoint as a capital, so there is nothing to compare below the cap line."
        if caps_only
        else "Capitals, figures, punctuation and lower case — both faces draw a real"
        " lower case, so the x-height is part of the comparison."
    )
    draw.text((MARGIN, 86), inventory, font=face(25), fill=NOTE_INK)

    for index, (char, image, score, knockout_dims, standin_dims) in enumerate(cells):
        col, row = index % COLUMNS, index // COLUMNS
        x = MARGIN + col * (cell_w + CELL_PAD)
        y = head_h + row * (cell_h + CELL_PAD)

        draw.text((x + 3, y - 3), char, font=face(24), fill=CHAR_INK)
        box_top = y + 24
        draw.rectangle([x, box_top, x + cell_w, box_top + GLYPH_BOX], fill=CELL_BG)

        # Centred in the cell rather than pinned: the composite's own size
        # varies with the wider of the two drawings, and a cell that jitters
        # column to column is harder to scan than one that does not.
        scale = min(GLYPH_BOX / image.height, cell_w / image.width, 1.0)
        placed = (
            image.resize((max(1, int(image.width * scale)), max(1, int(image.height * scale))))
            if scale < 1.0
            else image
        )
        page.paste(
            placed,
            (x + (cell_w - placed.width) // 2, box_top + (GLYPH_BOX - placed.height) // 2),
        )

        strip_top = box_top + GLYPH_BOX
        draw.rectangle([x, strip_top, x + cell_w, strip_top + LABEL_STRIP], fill=STRIP_BG)
        draw.text(
            (x + 5, strip_top + 1), f"overlap {score:.2f}", font=face(24), fill=overlap_ink(score)
        )
        draw.text(
            (x + 5, strip_top + 25),
            f"K {knockout_dims[0]}x{knockout_dims[1]}  B {standin_dims[0]}x{standin_dims[1]}",
            font=face(21),
            fill=DIM_INK,
        )

    draw.text(
        (MARGIN, height - foot_h + 6),
        "Aligned by each outline's top-left corner, so a curve or an odd side bearing shifts a cell more than the shape really differs.",
        font=face(23),
        fill=DIM_INK,
    )

    out.parent.mkdir(parents=True, exist_ok=True)
    page.save(out)

    scores = np.array([c[2] for c in cells])
    print(f"wrote {out}  ({width}x{height}, {len(cells)} glyphs)")
    print(f"median {np.median(scores):.4f}  mean {scores.mean():.4f}  min {scores.min():.4f}")
    print("worst: " + "  ".join(f"{c[0]} {c[2]:.2f}" for c in cells[:8]))


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    standin, original, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    for path in (standin, original, CHROME_FONT):
        if not path.exists():
            print(f"missing: {path}")
            return 1
    build(standin, original, out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
