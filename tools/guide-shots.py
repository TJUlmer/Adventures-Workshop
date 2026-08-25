"""Turn captured guide screenshots into the files the app serves.

Screenshots for `src/lib/guides/content.ts` are captured from the *running
app* rather than drawn — see `capture-guide-shot.js` for the half that runs in
the browser. It writes raw PNGs into `exports/guides-raw/`, which the dev
server's own export endpoint can reach and nothing ships from. This is the
other half: trim, convert, and put them where the app looks.

  trim     eat uniform rows and columns inward from each edge. A capture is
           taken at whatever size the element happened to be, so a sidebar
           600px tall holding 370px of content arrives with a third of it
           empty.

           Per edge, and against that edge's own colour — not against the
           corner pixel, and not against a fixed background. Both of those
           were tried and both are wrong for the shots this actually takes: a
           panel's header is a different colour from its body, so a corner
           pixel matched nothing below it and the whole tail survived, while
           a "is this pixel background?" test over the whole image found the
           empty tail *and* the gaps between rows and cropped a section's
           heading off the top.

  pad      then put `MARGIN` back on every side. Trimming alone leaves content
           flush against the frame wherever it already reached the edge, which
           is most captures — the element was measured to its own bounds.

           Because both of those move the picture, each shot reports the
           `offset` a capture coordinate shifts by to land in the written
           file. A step's `hotspots` are fractions of the **written file**, so
           a rect measured in the browser converts as
           `(rect * scale + offset) / written size`.

  webp     these are pictures of a UI, looked at and never sampled, and they
           ship inside `dist/` in an app that is meant to work offline. A
           dozen full-window PNGs is several megabytes of download; the same
           dozen in WebP is a fraction of it.

Idempotent, and reads and writes different folders so it stays that way — the
lesson `tools/card-masks.py` records at length.

`exports/` is gitignored, so the raw captures are working files: only the WebP
under `public/` is committed. Changing `MARGIN` or `WEBP_QUALITY` after the
fact therefore means re-capturing, which is the intended cost — a guide's
shots have to be re-taken whenever the UI moves anyway.

    python tools/guide-shots.py

Everything in `exports/guides-raw/<guide-id>/<name>.png` becomes
`public/assets/guides/<guide-id>/<name>.webp`.
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "exports" / "guides-raw"
OUT = ROOT / "public" / "assets" / "guides"

# Background put back around the trimmed content, each side.
MARGIN = 12

# How far two pixels may differ and still count as the same colour. Generous
# enough for a gradient or a subtle border, tight enough that real content
# never reads as empty.
TOLERANCE = 10

WEBP_QUALITY = 88

# How many times to go round the edges. Two is enough for everything captured
# so far; the loop stops as soon as a pass takes nothing.
MAX_PASSES = 4


def _eat(rgb: np.ndarray) -> int:
    """How many leading rows of `rgb` are uniform and all the same colour.

    Stops at the first row that either varies within itself or differs from
    the run so far, so a panel's empty tail is eaten and its content is not.
    Rotating and flipping the array is what makes one function serve all four
    edges.
    """
    if len(rgb) == 0:
        return 0
    colour = rgb[0, 0]
    eaten = 0
    for row in rgb:
        if np.abs(row - colour).max() > TOLERANCE:
            break
        eaten += 1
    # Never eat everything: a genuinely blank capture should survive as one,
    # visibly wrong, rather than as a zero-sized file.
    return min(eaten, len(rgb) - 1)


def trim(image: Image.Image) -> tuple[Image.Image, tuple[int, int]]:
    """Eat uniform edges, then pad `MARGIN` of each edge's colour back on.

    Repeated until nothing more comes off, rather than measured once per side
    against the original. A panel with a 1px border down one edge defeats the
    single-pass version completely: every row of its empty tail then contains
    that one differing pixel, so no row is uniform and the whole tail
    survives. Eating the border column first makes those rows uniform, which
    is only visible on a second pass.
    """
    full = np.array(image.convert("RGB")).astype(int)
    top, left = 0, 0
    bottom, right = full.shape[0], full.shape[1]

    for _ in range(MAX_PASSES):
        before = (top, left, bottom, right)
        rgb = full[top:bottom, left:right]
        if rgb.shape[0] < 2 or rgb.shape[1] < 2:
            break
        top += _eat(rgb)
        rgb = full[top:bottom, left:right]
        bottom -= _eat(rgb[::-1])
        rgb = full[top:bottom, left:right]
        left += _eat(rgb.transpose(1, 0, 2))
        rgb = full[top:bottom, left:right]
        right -= _eat(rgb.transpose(1, 0, 2)[::-1])
        if (top, left, bottom, right) == before:
            break

    if bottom - top < 2 or right - left < 2:
        return image, (0, 0)

    height, width = full.shape[:2]
    cropped = image.crop((left, top, right, bottom))

    # Padded with the *original* edge colours, so the margin reads as more of
    # the panel rather than as a frame drawn round it.
    padded = Image.new(
        "RGB",
        (cropped.width + MARGIN * 2, cropped.height + MARGIN * 2),
        tuple(int(v) for v in rgb[min(top, height - 1), min(left, width - 1)])
    )
    padded.paste(cropped, (MARGIN, MARGIN))
    # The offset a coordinate in the *capture* moves by to land in the file.
    return padded, (MARGIN - left, MARGIN - top)


def main() -> None:
    if not RAW.is_dir():
        print(f"nothing to do: {RAW.relative_to(ROOT)} does not exist")
        return

    count = 0
    for source in sorted(RAW.rglob("*.png")):
        target = OUT / source.relative_to(RAW).with_suffix(".webp")
        target.parent.mkdir(parents=True, exist_ok=True)

        image = Image.open(source).convert("RGB")
        cropped, (dx, dy) = trim(image)
        cropped.save(target, "WEBP", quality=WEBP_QUALITY, method=6)

        kb = target.stat().st_size / 1024
        print(
            f"{source.relative_to(RAW)}  {image.width}x{image.height}"
            f"  ->  {cropped.width}x{cropped.height}  {kb:.0f}KB"
            f"   offset {dx:+d},{dy:+d}"
        )
        count += 1

    print(f"\n{count} shot(s) written to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
