# Mobile UI Phase 5 — Preview and Artwork Adjustment

**Status:** Browser implementation complete; physical iOS and Android gesture evidence remains

**Completed:** 26 September 2026

**Applies to:** Live-card fitting and zoom, inline artwork placement, border-break transform handles, layer ordering, and mobile pane transitions

This document records the implemented Phase 5 contract from
`MOBILE_UI_PROJECT.md`. It changes editor interaction and responsive preview
chrome only. It does not change the set schema, persisted artwork shape,
renderer `.plate`, export path, storage authority, or publication model.

## Plain-language summary

Artwork no longer steals an ordinary phone swipe. The image behaves like the
rest of the editor until the author deliberately chooses **Adjust artwork**.
That action changes to a visible **Done** control and gives one finger to the
artwork; Done, changing panes, changing subjects, or removing the image gives
the gesture back immediately.

The card preview now starts fitted to the phone, still zooms from 50% through
200%, and becomes its own two-direction scroll area when enlarged. Tapping the
percentage fits the card again and returns the preview to its starting edge.
Bleed, cut-line, zoom, export, and pane controls remain available around that
scroll area.

Resize and rotation marks stay visually small, but their touch regions grow to
44px on a coarse pointer. Authors who prefer exact values still have every
slider, typed number, nudge, and Reset control. Fixed card elements and custom
artwork can still be moved through visible Up and Down buttons without
drag-and-drop.

## Gesture ownership and cancellation

The inline artwork panel and right-preview overlay now use the Phase 0
`pointer-session` lifecycle. It waits for a deliberate movement threshold,
accepts only the primary pointer, and has one terminal commit or cancellation.
Escape, a second pointer, lost capture, page hiding, blur, resize, orientation
change, mode change, and unmount all cancel through the same route.

Each session snapshots the complete starting transform. A cancellation after
movement restores that snapshot, while a tap below the threshold causes no
document write. This means an interrupted rotation or resize cannot leave half
of one gesture mixed with the start of another.

Adjust mode is shared editor-only state keyed to the artwork target. It is not
saved in the set. The inline panel and live preview therefore agree about who
owns gestures, while exports never know that an author happened to be
adjusting an image.

## Transform contract

One shared helper supplies the constraints used by direct manipulation and
the precision controls:

- offsets: −100% through +100%;
- uniform scale: 20% through 400%;
- independent width and height: 10% through 400%;
- rotation: normalized around −180° through 180°.

Corner handles scale uniformly. Edge handles preserve the opposite edge by
moving the image centre by half the size change, projected through the
artwork's current rotation. Arrow-key nudging remains available on the preview
selection box.

Pinch-to-scale remains a follow-up. A second pointer cancels the current
session instead of silently turning a two-finger browser gesture into a saved
document mutation.

## Preview and renderer isolation

At phone width the stage uses phone-safe inline padding and the selected card
fills the remaining width at 100%. Zoom multiplies that fitted width rather
than introducing document-level overflow. The stage owns horizontal and
vertical overflow at larger sizes, and the percentage readout is also an
explicit Fit action.

The transform overlay remains a sibling of the renderer's `.plate`. It is
only mounted during Adjust mode and cannot be cloned into the PNG export.
Phase 5 did not modify `CardRenderer`, `CardArt`, or the export modules.

## Browser evidence

The clean Phase 0 fixture was exercised in the in-app Chromium browser at
browser zoom 100% and a fine pointer. A temporary deterministic border-break
layer was used for transform checks, then removed; the fixture and its
IndexedDB copy were restored afterward.

At 390×844:

- document width stayed 390px;
- the 100% action card measured 332px inside a 380px preview stage, leaving
  24px on each side for the complete coarse-pointer handle regions;
- at 200%, the card measured 664px and the stage exposed both horizontal and
  vertical overflow without widening the document;
- Fit returned zoom, horizontal pan, and vertical pan to their starting state;
- outside Adjust, the inline preview reported native `touch-action: auto`, no
  application role, and unchanged transform values;
- Adjust changed the surface to `touch-action: none`, exposed Done, and a
  pointer drag updated the exact horizontal and vertical values;
- Done restored native behaviour while retaining the committed transform;
- switching between Edit and Preview also ended Adjust mode.

The preview overlay exercised movement, uniform corner scaling, all-axis
stretch infrastructure, rotation, and keyboard-compatible selection. Dragging
the east edge 30px moved the right edge by 30px while the left edge moved by
0px. Typed rotation, a horizontal nudge, and section Reset all updated the
same selected layer. Up and Down moved the custom layer through the fixed
stack and returned it to its original order.

The `.plate` outer-HTML signature was identical before and during Adjust mode,
and the overlay reported that it was outside `.plate`.

At 1440×900, the desktop layout remained 272px Contents, 840px Editor, and
320px Preview. The preview tools did not overflow, and mouse activation of
Adjust and Done mounted and removed the overlay normally.

Validation completed so far:

- `npm run check` — 0 errors and 0 warnings;
- `npm run build` — completed successfully, with only the existing dynamic
  import and large-chunk warnings;
- Phase 0 rendered baseline geometry — all 53 files verified unchanged;
- 390×844 fitted width, 200% two-axis overflow, Fit reset, and document width
  — passed;
- Adjust/Done ownership in both the inline panel and preview — passed;
- move, uniform scale, edge stretch, rotation, opposite-edge anchoring,
  typed values, nudges, sliders, and Reset — passed;
- fixed/custom layer selection and Up/Down ordering — passed;
- `.plate` isolation and desktop three-pane regression — passed.

## Remaining device evidence

The in-app browser exposes a fine pointer. Physical iOS Safari and Android
Chrome testing therefore remains open for:

- starting a normal page swipe directly over artwork outside Adjust mode;
- confirming that every invisible handle hit region is comfortable with a
  thumb while its visual mark remains small;
- cancelling an active gesture with rotation, app backgrounding, or a second
  finger and confirming the starting transform is restored;
- moving and ordering both fixed and custom layers with touch;
- completing the full mobile-authoring smoke path through save, reload, and a
  PNG comparison with desktop.
