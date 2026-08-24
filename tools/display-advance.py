"""
Mean capital advance, in ems, for every display face in `public/assets/fonts`.

This is the one number `DISPLAY_FONTS[key].advance` in
`src/lib/renderer/fonts.ts` carries, and `fitDisplaySize` sizes an event card's
heading from it — so it is measured here rather than estimated. A stale value
does not fail loudly: it sizes the heading a few per cent wrong, which reads as
a design choice rather than a bug. Its own comment in `fonts.ts` says to
re-measure whenever a file is replaced; this is what does it.

Definition, chosen to reproduce the three values that were already in the file:
the unweighted mean advance of `A`-`Z` divided by the head's units-per-em. Caps
only, because `fitDisplaySize` counts characters of a heading and headings on
this card are set in capitals.

Run:  python tools/display-advance.py
      python tools/display-advance.py --check      (verify the known three)

`--check` is the reason to trust the rest of the output: `edo`, `oswaldCustom`
and `oswaldJunior` were measured by other means when they were first written
down, so reproducing them here is what establishes that this script means the
same thing by "advance" as the renderer does.
"""

from __future__ import annotations

import sys
from pathlib import Path

from fontTools.ttLib import TTFont

FONT_DIR = Path(__file__).resolve().parent.parent / "public" / "assets" / "fonts"

CAPS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

# What `fonts.ts` already claims, so the method can be checked rather than
# trusted. File -> (key, recorded advance).
KNOWN = {
    "edosz.ttf": ("edo", 0.525),
    "Oswald-custom-condensed.ttf": ("oswaldCustom", 0.3295),
    "Os-Custom-Junior.ttf": ("oswaldJunior", 0.4322),
}


def mean_cap_advance(path: Path) -> float:
    """Unweighted mean advance of A-Z, as a fraction of the em."""
    font = TTFont(path, fontNumber=0, lazy=True)
    upm = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]

    widths = []
    for char in CAPS:
        name = cmap.get(ord(char))
        if name is None:
            continue
        widths.append(hmtx[name][0])

    if not widths:
        return float("nan")
    return sum(widths) / len(widths) / upm


def main() -> int:
    check = "--check" in sys.argv
    files = sorted(FONT_DIR.glob("*.ttf")) + sorted(FONT_DIR.glob("*.otf"))
    if not files:
        print(f"No fonts found in {FONT_DIR}")
        return 1

    worst = 0.0
    for path in files:
        try:
            advance = mean_cap_advance(path)
        except Exception as error:  # a file that is not a font, or is broken
            print(f"{path.name:52} !! {error}")
            continue

        note = ""
        if path.name in KNOWN:
            key, recorded = KNOWN[path.name]
            drift = abs(advance - recorded) / recorded
            worst = max(worst, drift)
            note = f"  <- {key}, recorded {recorded} ({drift * 100:.2f}% drift)"
        print(f"{path.name:52} {advance:.4f}{note}")

    if check:
        print()
        print(f"worst drift against the recorded three: {worst * 100:.2f}%")
        # A whole per cent would mean this script is measuring something else.
        return 0 if worst < 0.01 else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
