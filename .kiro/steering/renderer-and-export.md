---
inclusion: auto
description: Invariants of the render-is-export pipeline. Apply when touching src/lib/renderer/, src/lib/export/, card faces, ThreatBoard, or anything that gets rasterised to PNG.
---

# The renderer is the export

`src/lib/renderer/` draws cards as DOM, and `src/lib/export/card-image.ts`
photographs that same DOM. **There is no second drawing path** — an export that
redrew cards its own way would drift from what the author approved. Preserve that.

## The rasterisation pipeline

Clone the live node → lay the clone out **at print size** → freeze every computed
style inline → rewrite asset URLs to data URIs → wrap in an SVG `foreignObject` →
draw to a canvas.

Each step exists because of a specific failure, documented in the file. The ones
that bite:

- The clone **must** be sized before styles are read. Computed values are *used*
  values, so freezing a 411px preview's numbers renders the card at quarter scale in
  a corner.
- Computed `mask-image` URLs come back absolute, and serialisation escapes quotes —
  so URL rewriting happens **on the DOM, before serialising**.
- **A form control's text is a property, not an attribute, and does not survive
  `cloneNode`.** Anything rasterised must render its values as text.
  `ThreatBoard.svelte` takes an `editable` prop for exactly this: on for the editor,
  off for the exporter. Any new rasterised component with inputs needs the same
  split.

## Masking, not redrawing

The general trick throughout: template art is used as a **CSS alpha mask over a
fill**, so shapes keep their drawn form while taking any colour or gradient. That is
what makes the border customisable without redrawing it.

Chrome that must sample a gradient across the whole card is painted as a full-card
layer and cut to shape with `clip-path` (see `clipRect` / `seamBed`).

Art that has shape where it stretches — the pennant point, the split separator — is
sliced out of its file at natural size and **placed, never scaled**.

## Derived assets

Some files in `public/assets/templates/` are **generated from the supplied
templates**, not authored:

- `initiative_frame.png` — `Initiative Card_border.png` with the band bars and label
  separators erased, so the renderer can draw those at whichever band positions a
  card actually has.
- `event_logo.png` / `event_logo_ink.png` — the Unmatched Adventures lockup lifted
  out of `event_back_template_blank.png` as two alpha layers (box, and the lettering
  knocked out of it).

They were produced with Python/PIL from files still in the repo. **If a source
template changes, regenerate rather than hand-editing.**
