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
staircase at any size. That is the jaggedness on the point; the boost ring
next to it looks smoother because `inner_border.png` kept its soft edge.

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

`inner_border.png` gets the same softening, for the same reason and nothing
else: it is the boost ring's mask and only the boost ring's — nothing else in
`src/` reads it. Its circumference is antialiased in places and hard in
others, so the ring printed with a stepped edge on part of its arc. Softening
is stable rather than merely idempotent — it re-derives the edge from the
>=128 silhouette every time, so running it twice gives a byte-identical file
and cannot compound into a blur. That is also what keeps `BOOST`'s radii,
measured off this same alpha channel, still true.

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


def alpha_of(name: str) -> np.ndarray:
    return np.array(Image.open(TEMPLATES / name).convert("RGBA"))[:, :, 3]


def soften(a: np.ndarray) -> np.ndarray:
    """Antialias a hard-edged mask without moving its boundary.

    Supersampled: the >=128 silhouette is re-rasterised at `SS` and averaged
    back down, so the edge lands where it already was and only gains a ramp.

    Pixels that *already* carry intermediate alpha are kept as they are, and
    that is what makes this stable rather than merely repeatable. Re-deriving
    an edge that some other tool had already antialiased re-thresholds its
    ramp, which moves the boundary a fraction and gives a different answer
    every run — `inner_border.png`, antialiased along part of its ring and
    hard along the rest, did exactly that. Keeping existing soft pixels means
    a second run finds every edge soft, changes nothing, and writes a
    byte-identical file.
    """
    h, w = a.shape
    big = Image.fromarray(a).resize((w * SS, h * SS), Image.BILINEAR)
    big = Image.fromarray((np.array(big) >= 128).astype(np.uint8) * 255)
    softened = np.array(big.resize((w, h), Image.BOX))
    already = (a > 8) & (a < 247)
    return np.where(already, a, softened).astype(np.uint8)


def write(name: str, a: np.ndarray) -> None:
    """A mask is read for alpha alone, so the colour channels carry nothing."""
    rgba = np.zeros((*a.shape, 4), dtype=np.uint8)
    rgba[:, :, 3] = a
    Image.fromarray(rgba).save(TEMPLATES / name)


def main() -> None:
    fill = soften(alpha_of("banner_fill.png"))
    write("banner_fill.png", fill)
    print("banner_fill.png     softened")

    border = soften(alpha_of("banner_border.png"))
    print("banner_border.png   softened")

    # The strip of fill the outline fails to cover, head rows only.
    shifted = np.zeros_like(fill)
    shifted[:, GAP:] = fill[:, :-GAP]
    strip = np.clip(fill.astype(np.int16) - shifted.astype(np.int16), 0, 255).astype(np.uint8)
    mask = np.zeros_like(strip)
    mask[HEAD_TOP : HEAD_BOTTOM + 1] = strip[HEAD_TOP : HEAD_BOTTOM + 1]

    merged = np.maximum(border, mask)
    write("banner_border.png", merged)

    # Report the registration the way it was measured, so a regression is loud.
    worst = 0
    for y in range(HEAD_TOP, HEAD_BOTTOM + 1):
        f = np.where(fill[y] > 8)[0]
        b = np.where(merged[y] > 8)[0]
        if len(f) and len(b):
            worst = max(worst, int(b.min() - f.min()), int(f.max() - b.max()))
    print(f"banner_border.png   outline now covers the fill; worst overhang {worst}px")

    write("inner_border.png", soften(alpha_of("inner_border.png")))
    print("inner_border.png    softened (boost ring)")


if __name__ == "__main__":
    main()
