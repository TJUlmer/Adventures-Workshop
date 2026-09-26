# Mobile UI Phase 1 — Shared Touch and Control Foundation

**Status:** Browser implementation complete; physical iOS and hybrid-pointer evidence remains

**Completed:** 26 September 2026

**Applies to:** Shared controls, standard authoring fields, dynamic tabs, native dialogs, and destructive actions

This document records the implemented Phase 1 contract from
`MOBILE_UI_PROJECT.md`. It does not change the set schema, persisted document,
renderer, export geometry, storage authority, or navigation model.

## Interaction sizing

`--touch-target` is 44px. Shared controls apply it with
`@media (any-pointer: coarse)`, so a touch-capable laptop keeps touch targets
when a mouse is also present. Fine-pointer controls retain their established
24px and 30px desktop heights.

Compact controls separate their interactive box from their visual face:

- switches retain a 32×18px track;
- colour inputs retain their 16–20px swatches;
- the angle control retains its 26px dial;
- sliders retain compact tracks and thumbs inside a 44px range input;
- buttons, icon buttons, steppers, reset actions, segmented controls, tabs,
  slider nudges, and precision entries receive the full coarse-pointer target.

Pressed feedback no longer depends on hover. Hidden native colour inputs now
project focus onto their visible swatch, while hexadecimal and angle readouts
have explicit focus rings.

## Phone text and overflow

At widths up to 760px, tappable text-like controls compute to at least 16px.
The rule covers the shared inputs, textareas, selects, number and precision
entries, hexadecimal fields, rich-text contenteditable surface, workspace
formatted fields, library/gallery search, sidebar ownership selectors, and
the cloud collection/profile contribution fields.

Dynamic tabs are horizontal-only scroll containers. Changes to the selected
value, tab list, labels, badges, fonts, or container size reveal the selected
tab by adjusting only the strip's `scrollLeft`; vertical ancestors never move.
Segmented controls and fill/picker rows contain, wrap, or scroll their own
content instead of widening the page.

Adjacent destructive and non-destructive actions use at least 8px separation
in the audited action rows.

## Dialog contract

`src/lib/ui/dialog.css` provides the shared native-dialog geometry:

- `100dvh` is the block-size authority;
- conservative safe-area terms protect every edge;
- the frame has exactly one scrolling body;
- headers and action footers remain outside that scroll owner;
- phone gutters and action wrapping remain component-specific.

New Set, New Collection, both export selectors, Draft Conflict, Fork Update,
and Guide now use this structure. Card Lightbox and Component Modal retain
their existing specialised, already dynamic-viewport-safe layouts.

`viewport-fit=cover` remains deferred until Phase 2 protects the entire outer
shell. Dialogs already consume safe-area insets when that shell-wide switch is
made.

## Destructive actions

`ConfirmAction.svelte` owns the common two-activation lifecycle for operations
without undo. The first activation arms the same control; the second performs
the operation. Blur, Escape, disablement, timeout, and component teardown all
cancel the armed state, and the accessible label announces what another
activation will do.

The shared action now protects destructive card and character editor actions,
artwork layers, figures and their attachments, custom symbols, and the
existing timed sidebar/threat operations. Reversible presentation toggles and
flows with their own explicit confirmation remain outside it.

## Browser evidence

The deterministic Phase 0 fixture was exercised in the in-app Chromium
browser against the Phase 1 source.

| Viewport | Document width | Minimum visible text-control size |
|---|---:|---:|
| 320×568 | 320 / 320px | 16px |
| 360×800 | 360 / 360px | 16px |
| 390×844 | 390 / 390px | 16px |
| 412×915 | 412 / 412px | 16px |
| 430×932 | 430 / 430px | 16px |

At 360px, the four-tab character strip measured 276px visible against 323px
of content. Selecting the final tab moved only the strip to `scrollLeft = 47`
and left the selected tab fully within the strip. The document remained
360px wide.

At 320×568, New Set's action footer remained visible while its single body
scroller measured 473px visible against 575px of content. The document stayed
320px wide. The same shared structure is used by the other migrated dialogs.

At 720px with a fine pointer, shared small and medium buttons remained 24px
and 30px high, and the theme control remained 30px. At 1440px, switches kept
their 32×18px visual face. Pointer activation, keyboard tab activation, and
Escape cancellation of an armed destructive action were exercised.

Validation completed:

- `npm run check` — 0 errors and 0 warnings;
- `npm run build` — production build completed, with only the existing chunk
  and mixed dynamic/static import warnings;
- `git diff --check` — clean apart from line-ending notices;
- Phase 0 evidence verifier — 53 baseline files passed geometry-only
  comparison.

## Remaining device evidence

The following Phase 1 exit checks require hardware and remain open in
`MOBILE_UI_PROJECT.md`:

- use the shared controls with a thumb at 360px on physical iOS and Android;
- focus every standard text-like control in iOS Safari and confirm that the
  viewport does not zoom or strand the focused field behind the keyboard;
- verify `any-pointer: coarse` sizing on a touch-capable laptop while a mouse
  is also connected.
