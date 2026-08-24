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
- The hero card's five files (`hero_action_frame.png`, `hero_action_ribbon.png`,
  `hero_combat_banner.png`, `hero_action_ribbon_edge.png`, and the character-card
  border/ink split) — produced by `tools/hero-card-assets.py` from the supplied
  `hero_action_card_border.png` and `Hero_Character_Card_Template_*_frame.png`. Its
  output also prints the measurements `geometry.ts`'s `HERO_RIBBON` constants are
  checked against — run it after touching a source template and compare.

They were produced with Python/PIL from files still in the repo. **If a source
template changes, regenerate rather than hand-editing.**

## Export surfaces, and what is deliberately not an `Exporter`

`src/lib/export/registry.ts` lists `Exporter`s that hand back one blob for the
browser to save — currently just the `.json` set file. Two things that leave the
app are deliberately **not** in that registry, for the same underlying reason: an
`Exporter`'s one-blob shape does not fit what they actually produce.

- **The Tabletop Simulator bundle** (`tts-bundle.ts`) writes a *folder* of images
  plus a save file that names them by path — it needs `exports/` (see
  `schema-and-persistence.md`) or falls back to a ZIP with URLs blanked. Squeezing
  it into `Exporter` would mean it could only ever produce that fallback.
- **Print sheets** (`src/lib/print/`) are a **screen**, not a file exporter. There
  was a `print-pdf` slot in the registry for a long time; building it revealed that
  a PDF would have had to rasterise every card as a JPEG (the app has no
  compression beyond a stored ZIP entry), which is the worst possible treatment of
  black line on white. Printed from the DOM the type stays vector, and the
  browser's own print dialogue writes a better PDF than this app could. See
  `PrintScreen.svelte`, rendered outside `AppShell` on purpose — a print view
  nested in the title bar and nav has chrome to hide and a chance to shift the
  sheet by a millimetre.
- **Per-card PNGs** (`card-pngs.ts`) *do* go through the same rasterisation path as
  everything else (`card-stage.ts`, shared with the TTS export) but are offered
  from `ExportPanel` directly rather than through the `Exporter` registry, because
  the result is a folder-per-category ZIP rather than one file.

`ExportPanel.svelte` and the exporters it calls all take an `AdventureSet` as a
prop and read nothing from the `workshop` store — this is what lets the same panel
work against a published set someone else made, which is never the one open in
the workshop.
