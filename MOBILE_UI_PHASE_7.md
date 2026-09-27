# Mobile UI Phase 7 — Threat-track Mobile Inspector

**Status:** Browser implementation and fresh cross-viewport raster comparison
complete; physical touch evidence remains

**Completed:** 27 September 2026

**Applies to:** Threat-board viewport, space/slot/note selection, full-size
inspectors, placed-note movement, touch hit regions, and export isolation

This document records the implemented Phase 7 contract from
`MOBILE_UI_PROJECT.md`. It changes responsive editing and gesture ownership
only. It does not change the set schema, storage, threat geometry, printable
content, or export dimensions.

## Plain-language summary

The threat track no longer shrinks into a tiny, almost uneditable strip on a
phone. It stays large enough to read and slides sideways inside its own window,
while the rest of the page continues to move up and down normally.

Tap a threat space, tile slot, or piece of placed text, and its controls appear
in a full-size editor below the board. A Board item picker provides another
reliable way to reach anything hidden at the far end or beneath overlapping
text. Delete is now a visible, confirmed action rather than something hidden
behind mouse hover.

Placed text cannot accidentally move during an ordinary swipe. Choose
**Move** first; the board then scrolls that note into view and gives it keyboard
focus. Only that note owns the drag until **Done moving** is chosen. If the
gesture is interrupted, its starting position is restored.

The generous selection areas are screen-only. The exported threat track still
contains the same printed shapes and text, with none of the inspector, buttons,
selection outlines, or touch targets.

## Technical log

### Board viewport and selection

- `ThreatTracker` now owns a horizontally scrolling editor viewport. At narrow
  widths or with a coarse pointer, the board stage has a 72rem (1152px in the
  measured browser) minimum width instead of shrinking to the phone column.
- The scroll wrapper contains that width with `overflow-x: auto` and
  `overscroll-behavior-x: contain`; it does not widen the document or take over
  the page's vertical scroll root.
- `ThreatBoard` renders printed values as text and adds editor-only selection
  buttons for spaces, slots, and notes. The targets have descriptive names,
  `aria-pressed` state, visible focus treatment, and at least the shared 44px
  touch dimension.
- A pointer-only overlay covers the visible note footprint, while an independent
  accessible target is clamped inside the strip. A note anchored at 0% or 100%
  therefore keeps an on-screen 44px recovery target even though printable
  overflow remains clipped.
- A transient union identifies the selected space, slot, or note. The Board
  item picker lists every entity as an alternate route when the visual items
  overlap. New items select themselves, deletion selects a sensible neighbour,
  and selection clears when its entity disappears or a finished replacement
  board hides the composition.

### Full-size inspectors

- The selected-space inspector owns threat value, effect text, space fill,
  stroke fill, number-banner fill, number colour, and confirmed deletion.
- The selected-slot inspector owns its label, instruction, and confirmed
  deletion. Slots continue to inherit the board's existing styling because
  `ThreatSlot` has no persisted per-slot style fields; no schema field was
  invented for this responsive phase.
- The selected-note inspector owns text, colour, size, rotation, horizontal and
  vertical position, Move/Done, and confirmed deletion.
- Every destructive action uses the shared two-step `ConfirmAction`; the board
  no longer carries hover-only minus buttons.
- `NumberInput` accepts an optional accessible label so the threat-value field
  and its stepper group have a meaningful name without relying on an invalid
  implicit label around buttons.

### Deliberate note movement

- Move is an explicit inspector mode. Ordinary selection targets and the board
  viewport retain native touch behaviour; only the armed note target receives
  `touch-action: none`.
- Entering Move scrolls the note target into view and focuses it, so arrow-key
  nudging works immediately as well as pointer dragging.
- Movement uses the shared `startPointerSession` lifecycle, including mouse and
  touch thresholds, one captured primary pointer, and one terminal callback.
- The immutable snapshot contains the note ID, original x/y position, and grab
  offset. Pointer movement uses transient store updates; a successful drag
  touches the document once, while cancellation restores the original position
  without saving a partial move.
- Pointer cancellation, lost capture, Escape, page hiding, blur, resize,
  orientation change, a second pointer, selection or mode change, supersession,
  and unmount all take the cancellation path.

### Renderer and export boundary

- The scroll viewport and inspectors remain outside `ThreatBoard`, so they can
  never enter the element photographed by the exporter.
- Selection targets and states are conditional on `editable`; both threat
  export paths continue to mount `ThreatBoard` with `editable: false`.
- Read-only space values, final label, slot copy, and placed-note copy retain
  the renderer's text path. No threat geometry constant or export module was
  changed.

## Browser evidence

The deterministic Phase 0 fixture was exercised in the in-app Chromium browser
at browser zoom 100% and a fine pointer.

At 360×800:

- the document remained exactly 360px wide with no horizontal page overflow;
- the board viewport measured 318px wide, its board stage and board measured
  1152px wide, and the rendered 7:1 board remained about 163px tall;
- the viewport owned 834px of horizontal overflow while the surrounding page
  retained its independent 3,448px vertical content scroller;
- a measured space target was 44.5×51.4px, and the independent note target was
  44×44px and wholly inside the clipped strip;
- spaces, slots, and placed text all opened their corresponding inspector, and
  the Board item picker tracked the same selection;
- the space inspector exposed a named threat-value spinbutton plus effect,
  colour, and visible confirmed-delete controls;
- the slot inspector exposed label, instruction, and visible confirmed delete;
- the note inspector exposed text, colour, size, rotation, both position axes,
  Move, and visible confirmed delete;
- before Move, the board and note target both used native touch behaviour;
  after Move, only the note target changed to `touch-action: none`, its label
  announced drag and arrow-key behaviour, and focus moved to that target;
- choosing Done returned the note to ordinary selection without changing its
  content or position.

At 1280×800, the board and viewport both measured 1190px wide, so the desktop
layout did not gain an unnecessary horizontal scrollbar or document overflow.

The live Export PNG action completed without an in-app error. The repository's
53 stored Phase 0 export geometries also verify, including the 1637×232 threat
PNG. Phase 9 later added an isolated evidence profile and rendered the fixed
fixture at 390×844 and 1440×900 in the same browser document. The direct threat
PNG retained both its dimensions and decoded pixels, closing the raster gap
without replacing the Phase 0 evidence.

Validation completed:

- `npm run check` — 0 errors and 0 warnings;
- `npm run build` — completed successfully, with only the existing ineffective
  dynamic-import and large-chunk warnings;
- `node tools/mobile-baseline/evidence.mjs verify --geometry-only` — all 53
  stored baseline files verified;
- `git diff --check` — clean apart from working-copy line-ending notices;
- 360×800 and 1280×800 responsive checks — passed.

## Remaining physical evidence

The in-app browser exposes a fine pointer, so physical iOS Safari and Android
Chrome evidence remains open for:

- selecting, editing, moving where applicable, and confirmed removal of every
  entity using touch only;
- one-finger horizontal board panning versus vertical page scrolling;
- software-keyboard reachability for each inspector;
- rollback during rotation, backgrounding, lost capture, and a second touch.
