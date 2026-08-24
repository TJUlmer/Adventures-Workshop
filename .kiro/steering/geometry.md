---
inclusion: auto
description: How print geometry is measured and expressed. Apply when adding or correcting numbers in src/lib/renderer/geometry.ts, positioning card chrome or text, or working with anything in public/assets/templates/.
---

# Geometry is measured, not estimated

`src/lib/renderer/geometry.ts` is the source of truth. Every number was read off a
print template's alpha channel or ink, in **bleed pixels** (1632 × 2222 for action
cards; the initiative and rules templates carry their own sizes), then converted to:

- percentages — `px` / `py`
- `cqw` — `pu`

so one markup is correct at a 120px thumbnail and at 300 DPI.

Text is positioned **by cap height** via `capTopToBoxTop()`, not by CSS box, using
the Knockout faces' real metrics (cap 0.67em, ascent 0.84em). That is why the title,
values, ability copy and quantity land on the template's positions to the pixel.

## Measure, do not eyeball

To add or correct geometry, read the template with Python/PIL:

```bash
python -c "
from PIL import Image; import numpy as np
a = np.array(Image.open('public/assets/templates/outer_border.png').convert('RGBA'))[:,:,3]
print([(y, round((a[y]>128).mean(),3)) for y in range(0, a.shape[0], 100)])
"
```

## Nothing measures text at runtime

Dynamic sizes fall out of flex layout instead:

- The **name ribbon** is as long as the name.
- The **body panel** is as tall as its copy, rising *over* the art window but never
  past `ART_WINDOW.minHeight`. The panel covers the artwork rather than resizing it,
  so an image is never rescaled by something the author did not touch.
- The **vertical rule** between values and copy runs as long as the taller of the two.

This works because type is set in a **vertical writing mode** — so its length *is*
its box's height — and the panel is **bottom-anchored**, so growing it moves the
divider.

Where a size genuinely cannot be laid out (the event heading), it is derived from the
face's mean advance in `renderer/fonts.ts` — still without measuring.

Keep it that way. Introducing a runtime text measurement re-opens the font-loading
and canvas-metrics problems catalogued in `verifying-changes.md`.

## Newer templates follow the same rule

The hero action card and hero character card (`HeroActionCardFace`,
`HeroCharacterCardFace`) are measured exactly the same way, off their own supplied
templates (`Hero_Action_Card_Template.png`, `Hero_Character_Card_Template_*.png`,
plus the Photoshop guide files that shipped alongside them). `tools/hero-card-assets.py`
both derives the hero's chrome assets *and* checks `geometry.ts`'s `HERO_RIBBON`
constants against what it measures — run it after touching a hero source template,
since the masks and the numbers that place them have drifted apart before, and each
time it printed as a chrome bug rather than a stale-measurement one.
