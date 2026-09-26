# Mobile UI Phase 3 — Touch-complete Hierarchy and Core Forms

**Status:** Browser implementation complete; physical iOS and Android keyboard and native-picker evidence remains

**Completed:** 26 September 2026

**Applies to:** Cards hierarchy actions, card movement, editor scroll ownership, editor headers, character/card tabs, and ordinary Content and Design controls

This document records the implemented Phase 3 contract from
`MOBILE_UI_PROJECT.md`. It changes interaction and responsive presentation
only. It does not change the set schema, persisted document shape, renderer,
export geometry, storage authority, or publication model.

## Plain-language summary

The Cards contents list no longer assumes that an author can hover or drag.
On a touch device, the add, expand, move, and delete controls stay visible and
grow to comfortable tap targets. Every card now has a small move panel: the
author can send it earlier or later in its deck, or choose another compatible
deck, without trying to drag a narrow row with a finger. Mouse users still
keep the existing drag-and-drop shortcut.

The editors also make better use of a narrow phone. Long headings and their
actions stack instead of colliding, overflowing tab rows scroll sideways and
reveal the chosen tab, and the dense artwork and ability controls reflow before
they can hide a button. Delete still takes two deliberate activations whether
it is started from the contents list or an editor. Android browsers are also
asked to resize the app for the software keyboard.

The Edit tab now uses its whole visible pane as the swipe area on a phone or a
short screen. The large identity header can scroll out of the way, while the
Content/Design or character tabs stay pinned at the top. This replaces the old
layout where the header and tabs permanently consumed most of a short phone's
height and left only a small window over the actual form.

## Hierarchy interaction contract

Touch sizing and discoverability are capability-driven. The new hierarchy
rules use `(hover: none)` and `(any-pointer: coarse)`; a narrow mouse-only
desktop window therefore keeps its compact controls, while a touchscreen
laptop remains touchable even when it is wide.

Card rows retain their HTML drag events and add an in-flow action panel with:

- **Earlier** and **Later** controls, disabled at the corresponding boundary;
- a **Move to deck** selector containing only compatible existing decks;
- the same card and deck labels used by the editors, including character
  ownership where names alone would be ambiguous.

Initiative reordering is scoped to the visible Character or Effect subgroup,
so a move never appears to jump against a hidden sibling from the other
variant. Moving into another deck appends to that deck, matching the existing
desktop drop-on-header behaviour.

The panel closes on an outside pointer action or Escape. Escape, reordering,
and cross-deck transfer return focus to the card's persistent move trigger.
Cross-deck focus uses the card id because moving the card remounts its row
under another hierarchy branch.

All irreversible hierarchy deletes use `ConfirmAction`. This includes empty
decks: an empty deck can still contain a name, owner, and notes, so the first
activation arms a visibly dangerous state and the second performs deletion.

## Core form contract

Workspace and section headers wrap their actions at a 430px workspace
container rather than depending on the browser viewport. Existing 560px,
520px, 480px, and 620px card-panel collapse rules remain in place.

Measured repairs were limited to the controls that could actually run out of
room:

- editable artwork controls become one full-width column below 480px;
- slider labels and precision controls wrap within a 430px workspace;
- artwork masks, texture choices, ability icons, bonus controls, formatted
  field removal controls, and card value controls receive capability-driven
  touch targets;
- shared character/card tabs keep their native horizontal scrolling and
  automatically reveal the selected item.

`interactive-widget=resizes-content` was added to the viewport declaration.
Supporting mobile browsers therefore resize the layout viewport and its
dynamic viewport units when the keyboard opens; the full-pane editor scroller
receives the reduced space instead of sitting underneath the keyboard.

### Vertical scroll ownership

Normal-height tablet and desktop layouts retain the existing editor-body
scroller, so their fixed identity header and tabs behave unchanged. At phone
widths and at viewport heights of 500px or less, `EditorPanes` becomes the one
vertical scroll owner for Edit. The editor body expands naturally inside it,
the identity header can leave the viewport, and the direct tab strip is sticky.

This applies equally to card, character, and set editors through their shared
`Workspace` wrapper. Inactive panes remain mounted, so switching to Preview
and back keeps the Edit pane's scroll position.

## Browser evidence

The fixed Phase 0 fixture was exercised in the in-app Chromium browser at
browser zoom 100%, light theme, and a fine pointer.

| Viewport | Action Content | Action Design | Document width |
|---|---:|---:|---:|
| 320×568 | 320px | 320px | 320 / 320px |
| 360×800 | 360px | 360px | 360 / 360px |
| 390×844 | 390px | 390px | 390 / 390px |
| 430×932 | 430px | 430px | 430 / 430px |
| 844×390 | 572px editor | 572px editor | 844 / 844px |

At 320px, every editable artwork precision row reported equal `scrollWidth`
and `clientWidth` (124–129px depending on its unit and value). No Content or
Design control widened the document. The only elements whose internal text
metrics exceeded their small visual face were intentionally clipped colour
swatches and chips.

The 320px character tab strip measured 278px visible against 323px of content.
Selecting **Action card defaults** moved only that strip to `scrollLeft = 45`
and left the selected tab fully visible.

Exact-size Chromium checks measured the new Edit scroll viewport at 349px for
320×568, 625px for 390×844, and 183px for 844×390. The short-landscape value
replaces the 74px inner-body window accepted during Phase 2. At all three
sizes, the identity header scrolled away and the 45px tab strip stayed pinned
to the pane's top edge. A touch swipe at 390×844 moved the pane to
`scrollTop = 239`; switching to Preview and back preserved an explicit
`scrollTop = 180`. Document width remained equal to viewport width.

At 1440×900 the ownership did not change: the workspace stayed non-scrolling,
the ordinary editor body retained its 576px scroll viewport, and the tabs
remained static.

The hierarchy checks exercised all of the following and restored the fixture
afterward:

- Breakwater moved later and earlier without drag-and-drop;
- Breakwater transferred from Mariner to the Glass Regent and back;
- incompatible deck kinds were absent from the selector;
- boundary movement was disabled;
- Escape, keyboard reorder, and cross-deck transfer restored focus to the
  corresponding move trigger;
- a destructive editor action armed on its first activation, announced the
  second-activation label, and disarmed on Escape without deleting anything.

At 1440×900, the three panes measured 272px Contents, 840px Editor, and
320px Preview. Nine card rows remained `draggable`, and the document stayed
1440px wide.

Validation completed so far:

- `npm run check` — 0 errors and 0 warnings;
- `npm run build` — production build completed, with only the existing chunk
  size and mixed dynamic/static import warnings;
- `git diff --check` — passed for the Phase 3 files;
- Phase 0 rendered baseline geometry — all 53 files verified unchanged;
- 320, 360, 390, and 430px action-card Content and Design matrix — no page
  overflow;
- 844×390 short-landscape editor — no page overflow;
- full-pane editor scrolling at 320×568, 390×844, and 844×390 — passed;
- sticky editor tabs, touch swipe, and scroll retention across pane switching
  — passed;
- non-drag reorder and cross-deck transfer — passed and fixture restored;
- keyboard focus recovery for Escape, reorder, and transfer — passed;
- dynamic tab overflow and selected-tab reveal — passed;
- desktop three-pane and draggable-row preservation — passed.

## Remaining device evidence

The in-app browser exposes a fine pointer and cannot reproduce a physical
software keyboard or the operating system's file, colour, and select pickers.
It also did not surface its native file chooser through the automation hook,
so no file was selected and no upload was performed during this phase.

Physical iOS Safari and Android Chrome testing therefore remains open for:

- opening and cancelling representative replacement-image, artwork, custom
  pattern, select, colour, and number pickers with the keyboard both dismissed
  and open;
- confirming that a focused lower field and editor actions remain reachable
  above the real keyboard;
- confirming 44px hierarchy and form targets with a thumb on `(hover: none)`;
- exercising a hero with several character-card tabs on the physical tab
  scroller.
