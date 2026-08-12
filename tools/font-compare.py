"""
Print the numbers behind a stand-in card face.

    python tools/font-compare.py \
        public/assets/fonts/BebasNeue-Custom.ttf \
        "assets/fonts/Knockout-HTF48-Featherweight-CUSTOM.ttf"

The visual counterpart is `font-atlas.py`, which draws the same comparison as a
sheet; the measuring itself lives in `fonts.py`, including the note on which
Knockout file to use and why the two overlap figures disagree.

What each block is for:

  vertical metrics   `capTopToBoxTop()` positions type by cap height inside a
                     line box, so cap *and* ascent/descent both matter. A face
                     whose ascent is out by a fifth puts the title tens of
                     pixels off however right its caps are.
  stem width         The one property that cannot be fixed by scaling.
  glyph overlap      Reported both ways. `shape` asks whether it is the same
                     letter; `typeset` asks whether it lands in the same place.
  set width          What `condense` has to undo. Per string, because one
                     constant has to serve whatever copy a card carries — and
                     the spread across these strings is what says whether it
                     can.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import fonts as F  # noqa: E402


def report(standin: Path, original: Path) -> None:
    print(f"stand-in : {standin.name}")
    print(f"original : {original.name}\n")

    a, b = F.vertical_metrics(standin), F.vertical_metrics(original)
    print("VERTICAL METRICS (fractions of the em)")
    print(f"{'':10} {'stand-in':>10} {'Knockout':>10} {'ratio':>9}")
    for key in ("cap", "digit", "ascent", "descent"):
        ratio = f"{a[key] / b[key]:.4f}" if b[key] else "—"
        print(f"{key:10} {a[key]:10.4f} {b[key]:10.4f} {ratio:>9}")
    print()

    stem_a, stem_b = F.stem_width(standin), F.stem_width(original)
    print("CAP STEM (fraction of cap height)")
    print(f"  stand-in {stem_a:.4f}   Knockout {stem_b:.4f}   ratio {stem_a / stem_b:.4f}\n")

    for align in ("shape", "typeset"):
        scores = F.overlaps(standin, original, align=align)
        values = np.array(list(scores.values()))
        worst = sorted(scores.items(), key=lambda item: item[1])[:8]
        print(f"GLYPH OVERLAP — {align}, {len(scores)} glyphs")
        print(
            f"  median {np.median(values):.4f}   mean {values.mean():.4f}"
            f"   min {values.min():.4f}"
        )
        print("  worst  " + "  ".join(f"{c} {v:.2f}" for c, v in worst) + "\n")

    print("SET WIDTH at matched cap height — condense = Knockout / stand-in")
    print(f"{'string':36} {'stand-in':>10} {'Knockout':>10} {'condense':>9}")
    factors = []
    for text in F.strings_for(standin, original):
        wa, wb = F.set_width(standin, text), F.set_width(original, text)
        factors.append(wb / wa)
        print(f"{text:36} {wa:10.1f} {wb:10.1f} {wb / wa:9.4f}")
    # One `condense` per role has to serve every string, so the spread is the
    # number that says whether a single constant can be honest.
    print(f"{'spread':36} {'':10} {'':10} {max(factors) - min(factors):9.4f}")


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    standin, original = Path(sys.argv[1]), Path(sys.argv[2])
    for path in (standin, original):
        if not path.exists():
            print(f"missing: {path}")
            return 1
    report(standin, original)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
