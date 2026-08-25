"""Regenerate the villain ribbon's two mask layers.

`ActionCardFace` cuts the name ribbon from two masks anchored identically:
`banner_fill.png` paints the run and pennant in the banner colour, and
`banner_border.png` paints its outline over the top in `theme.divider`. Two
faults in the supplied art show up on every exported card.

**The outline does not cover the fill's left edge.** Measured across all 86
rows of the pennant head (y 863..948), the border's left edge sits 1-3px
*inside* the fill's, while the right edges agree exactly. The outline is drawn
over the fill, so those pixels stay banner-coloured: a sliver of red running
down the left side of the point and past its tip, reported as "the red ribbon
is extending below the black ribbon divider". Present in `banner_border_raw.png`
too, so it is the drawing's own registration rather than anything this
pipeline did to it.

**Neither mask is antialiased.** Both are pure 0/255 — zero intermediate alpha
across the whole head — so the pennant's diagonal taper renders as a hard
staircase at any size. That is the jaggedness on the point.

Both are fixed here rather than by hand, so the numbers stay reproducible:

  align   the outline gains exactly the strip of fill that lies outside it,
          `fill AND NOT shift_right(fill, GAP)`, restricted to the head. That
          makes the outline's outer silhouette the fill's own by construction,
          so it cannot drift again. Confined to the head because the straight
          run deliberately carries an outline on its right edge only (see
          `BANNER.edge`), and widening it there would draw one down the left.

  soften  supersampled: upscale x4, re-threshold, box-downscale. The boundary
          lands where it already was — this adds a soft edge, it does not move
          anything — which is what keeps `BANNER`'s measured numbers valid.

  hold    the fill is then clipped to sit `INSET` inside the outline's outer
          edge, so the stroke covers it with room to spare. Making the two
          coincide exactly was not enough: a hair of banner colour still came
          through the stroke's own antialiasing at the point.

The boost ring is deliberately *not* handled here. It had the same fault — its
inner edge ran 255,255,239,16,0, a whole transition crammed into one pixel —
but supersampling cannot recover a curve that thresholding has already
destroyed, and it did not have to: `BOOST_RING` is exactly the annulus's
bounding box, so `ActionCardFace` now draws the ring as a `border-radius: 50%`
border rather than masking it out of `inner_border.png`. The browser
antialiases that exactly, at any size. That art is unused as a result.

This is a **one-shot generator**, not an idempotent one — it reads the files it
writes, and neither `soften` nor `hold_under` survives being applied to its own
output. `already_generated` detects that and stops, so running it twice is
harmless even though running it twice *properly* is not.

    python tools/card-masks.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

TEMPLATES = Path(__file__).resolve().parent.parent / "public" / "assets" / "templates"

# The pennant head's own rows, from `BANNER.headTop` to the point. Outside
# these the run is masked by its own rectangle and must not be touched.
HEAD_TOP, HEAD_BOTTOM = 863, 948

# Widest measured shortfall of the outline against the fill, in bleed pixels.
GAP = 3

# Supersampling factor for the added soft edge.
SS = 4

# How far the fill retreats under the outline at the pennant, in bleed pixels.
INSET = 3


def alpha_of(name: str) -> np.ndarray:
    return np.array(Image.open(TEMPLATES / name).convert("RGBA"))[:, :, 3]


def soften(a: np.ndarray) -> np.ndarray:
    """Antialias a hard-edged mask without moving its boundary.

    Supersampled: the >=128 silhouette is re-rasterised at `SS` and averaged
    back down, so the edge lands where it already was and only gains a ramp.

    Every edge is re-derived, including one that already carries some
    intermediate alpha. An earlier version kept those pixels, on the grounds
    that re-thresholding a ramp could move the boundary — but the supplied art
    carries *token* antialiasing in places (the boost ring's inner edge ran
    255,255,239,16,0: a transition crammed into a single pixel), and
    preserving that is preserving the jaggedness this exists to remove.

    Only ever run against the supplied art — see `already_generated`.
    """
    h, w = a.shape
    big = Image.fromarray(a).resize((w * SS, h * SS), Image.BILINEAR)
    big = Image.fromarray((np.array(big) >= 128).astype(np.uint8) * 255)
    return np.array(big.resize((w, h), Image.BOX))


def already_generated() -> bool:
    """Has this already run over these files?

    This is a one-shot generator, not an idempotent one, and the honest thing
    is to say so and stop. It reads the two masks it also writes, and two of
    its steps do not survive being applied to their own output: `soften`
    re-thresholds a ramp it wrote (which oscillates once `hold_under` has left
    a hard cut beside it), and `hold_under` would clip an already-clipped fill
    against an outline that no longer bounds it. Both are fine from the
    supplied art and wrong from anything else, so the guard is the fix rather
    than contorting each step into idempotence.

    The test is the tool's own two invariants: the fill carries a soft edge,
    and it sits clear of the outline through the pennant.
    """
    fill = alpha_of("banner_fill.png")
    outline = alpha_of("banner_border.png")
    if not ((fill > 8) & (fill < 247)).any():
        return False
    for y in range(HEAD_TOP, HEAD_BOTTOM + 1):
        f = np.where(fill[y] > 8)[0]
        o = np.where(outline[y] > 8)[0]
        if len(f) and len(o) and (f.min() - o.min() < INSET or o.max() - f.max() < INSET):
            return False
    return True


def write(name: str, a: np.ndarray) -> None:
    """A mask is read for alpha alone, so the colour channels carry nothing."""
    rgba = np.zeros((*a.shape, 4), dtype=np.uint8)
    rgba[:, :, 3] = a
    Image.fromarray(rgba).save(TEMPLATES / name)


def hold_under(fill: np.ndarray, outline: np.ndarray, by: int) -> np.ndarray:
    """Clip the pennant's fill to sit `by` pixels inside the outline's edge.

    Expressed against the *outline's* outer edge rather than by eroding the
    fill, so the amount taken off is a property of where the stroke is rather
    than of how many times this has run.

    Horizontal only, and deliberately: the head art's top row abuts the plain
    rectangle that masks the straight run above it, so taking anything off the
    top would open a transparent seam across the ribbon exactly where the two
    layers meet. Clipping the sides retracts the point on its own, because the
    taper's last rows are only a few pixels wide to begin with.
    """
    out = fill.copy()
    for y in range(HEAD_TOP, HEAD_BOTTOM + 1):
        ink = np.where(outline[y] > 8)[0]
        if not len(ink):
            continue
        row = np.zeros_like(fill[y])
        lo, hi = ink.min() + by, ink.max() - by
        if lo <= hi:
            row[lo : hi + 1] = fill[y, lo : hi + 1]
        out[y] = row
    return out


def main() -> None:
    if already_generated():
        print("already generated from the supplied art; nothing to do")
        return

    # The outline is built against the fill's *full* silhouette, so the ribbon
    # keeps its drawn size — only the colour inside it retreats.
    full_fill = soften(alpha_of("banner_fill.png"))

    border = soften(alpha_of("banner_border.png"))

    # The strip of fill the outline fails to cover, head rows only.
    shifted = np.zeros_like(full_fill)
    shifted[:, GAP:] = full_fill[:, :-GAP]
    strip = np.clip(full_fill.astype(np.int16) - shifted.astype(np.int16), 0, 255).astype(np.uint8)
    mask = np.zeros_like(strip)
    mask[HEAD_TOP : HEAD_BOTTOM + 1] = strip[HEAD_TOP : HEAD_BOTTOM + 1]

    merged = np.maximum(border, mask)
    write("banner_border.png", merged)

    # Now hold the fill clear of the outline's outer edge, so the stroke covers
    # it with room to spare rather than landing on it exactly. Coinciding to
    # the pixel left a hair of banner colour showing through the stroke's own
    # antialiasing at the point.
    fill = hold_under(full_fill, merged, INSET)
    write("banner_fill.png", fill)
    print(f"banner_fill.png     softened, pennant inset {INSET}px under the stroke")
    print("banner_border.png   softened")

    # Report the registration the way it was measured, so a regression is loud.
    worst = 0
    for y in range(HEAD_TOP, HEAD_BOTTOM + 1):
        f = np.where(full_fill[y] > 8)[0]
        b = np.where(merged[y] > 8)[0]
        if len(f) and len(b):
            worst = max(worst, int(b.min() - f.min()), int(f.max() - b.max()))
    print(f"banner_border.png   outline now covers the fill; worst overhang {worst}px")



if __name__ == "__main__":
    main()
