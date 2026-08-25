"""Regenerate the villain ribbon's two mask layers from the supplied art.

`ActionCardFace` cuts the name ribbon from two masks anchored identically:
`banner_fill.png` paints the run and pennant in the banner colour, and
`banner_border.png` paints its outline over the top in `theme.divider`.

**The supplied outline does not cover the supplied fill's left edge.** Measured
across all 86 rows of the pennant head (y 863..948), `banner_border_raw.png`'s
left edge sits 1-3px *inside* `banner_fill_raw.png`'s, while the right edges
agree exactly. The outline is drawn over the fill, so those pixels stay
banner-coloured: a sliver of red running down the left side of the point and
past its tip, reported as "the red ribbon is extending below the black ribbon
divider".

The fix is to trust the **outline** and clip the fill to it, rather than the
other way round. An outline is what draws a shape's edge, so a fill that pokes
out past it is the registration error, not a wider ribbon — and clipping means
the ribbon's visible silhouette is the outline's own, which the artist
antialiased. Head rows only: the straight run above deliberately carries an
outline on its right edge alone (`BANNER.edge`), so clipping to it there would
shave 200px off the left of the ribbon.

**The fill is not antialiased and the outline is.** `banner_fill_raw.png` is
pure 0/255; `banner_border_raw.png` carries a real two-pixel ramp that tracks
the taper's sub-pixel position row by row (30/169, 20/149, 12/132 …). Since the
outline is what the eye sees — the fill ends up entirely under it — keeping
that ramp *is* the antialiasing, and the outline is passed through **untouched**.

That is the fix to a fix, and the reason the point was jagged. An earlier pass
softened the outline: supersample x4, re-threshold, box-downscale. Re-thresholding
a ramp throws away exactly the sub-pixel information that made it a ramp, and
what came back was the same quantised `16, 239` step on *every* head row — the
signature of an edge snapped to whole pixels. A staircase, produced by the step
meant to prevent one. **Antialiasing already in the art can only be preserved,
never improved; supersampling is for art that has none.**

Nothing is supersampled here as a result. Softening the fill was tried and does
nothing measurable: its 276 changed pixels are all in the pennant, and the clip
overwrites every one of them.

Reading the supplied `_raw` files and writing the derived ones is the other
half of the same lesson. This tool used to read the files it also wrote, which
made it a one-shot generator with a guard bolted on to stop it compounding its
own output — and running it a second time is what destroyed the outline's
antialiasing in the first place. With separate inputs it is simply idempotent.

The boost ring is deliberately not handled here. It had the same fault — its
inner edge ran 255,255,239,16,0, a whole transition crammed into one pixel —
but no supersampling can recover a curve that thresholding has already
destroyed, and it did not have to: `BOOST_RING` is exactly the annulus's
bounding box, so `ActionCardFace` draws the ring as a `border-radius: 50%`
border rather than masking it out of `inner_border.png`. The browser
antialiases that exactly, at any size. That art is unused as a result.

    python tools/card-masks.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

TEMPLATES = Path(__file__).resolve().parent.parent / "public" / "assets" / "templates"

# The pennant head's own rows, from `BANNER.headTop` to the point. Above these
# the run carries an outline on one side only, so it cannot bound the fill.
HEAD_TOP, HEAD_BOTTOM = 863, 948

# How far the fill retreats inside the outline's outer edge, in bleed pixels.
# Enough to clear the outline's own antialiasing: landing on it exactly still
# let a hair of banner colour through the stroke's ramp at the point.
INSET = 3

# Anything above this counts as ink when locating an edge.
LIT = 8


def alpha_of(name: str) -> np.ndarray:
    return np.array(Image.open(TEMPLATES / name).convert("RGBA"))[:, :, 3]


def write(name: str, a: np.ndarray) -> None:
    """A mask is read for alpha alone, so the colour channels carry nothing."""
    rgba = np.zeros((*a.shape, 4), dtype=np.uint8)
    rgba[:, :, 3] = a
    Image.fromarray(rgba).save(TEMPLATES / name)



def hold_under(fill: np.ndarray, outline: np.ndarray, by: int) -> np.ndarray:
    """Clip the pennant's fill to sit `by` pixels inside the outline's edge.

    Expressed against the outline's outer edge rather than by eroding the fill,
    so the amount taken off is a property of where the stroke is.

    Horizontal only, and deliberately: the head art's top row abuts the plain
    rectangle that masks the straight run above it, so taking anything off the
    top would open a transparent seam across the ribbon exactly where the two
    layers meet. Clipping the sides retracts the point on its own, because the
    taper's last rows are only a few pixels wide to begin with.
    """
    out = fill.copy()
    for y in range(HEAD_TOP, HEAD_BOTTOM + 1):
        ink = np.where(outline[y] > LIT)[0]
        if not len(ink):
            continue
        row = np.zeros_like(fill[y])
        lo, hi = ink.min() + by, ink.max() - by
        if lo <= hi:
            row[lo : hi + 1] = fill[y, lo : hi + 1]
        out[y] = row
    return out


def main() -> None:
    outline = alpha_of("banner_border_raw.png")
    fill = hold_under(alpha_of("banner_fill_raw.png"), outline, INSET)

    write("banner_border.png", outline)
    write("banner_fill.png", fill)

    print("banner_border.png   supplied outline, antialiasing untouched")
    print(f"banner_fill.png     pennant held {INSET}px inside the outline")

    # Report the registration the way it was measured, so a regression is loud.
    exposed = 0
    for y in range(HEAD_TOP, HEAD_BOTTOM + 1):
        f = np.where(fill[y] > LIT)[0]
        o = np.where(outline[y] > LIT)[0]
        if not len(f) or not len(o):
            continue
        if min(int(f.min() - o.min()), int(o.max() - f.max())) < INSET:
            exposed += 1
    print(f"                    {exposed} head rows where the fill is not {INSET}px clear")

    ramp = ((outline[HEAD_TOP : HEAD_BOTTOM + 1] > LIT) & (outline[HEAD_TOP : HEAD_BOTTOM + 1] < 247)).sum()
    print(f"                    {ramp} antialiased pixels across the pennant's outline")


if __name__ == "__main__":
    main()
