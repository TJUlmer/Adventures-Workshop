# Mobile UI Phase 2 — Responsive Cards Shell and In-Set Chrome

**Status:** Browser implementation and Phase 2 regression checks complete; physical-device safe-area evidence remains for release hardening

**Completed:** 26 September 2026

**Applies to:** Cards workspace panes, in-set navigation, responsive shell chrome, and phone safe areas

This document records the implemented Phase 2 contract from
`MOBILE_UI_PROJECT.md`. It changes responsive presentation and transient pane
state only. It does not change the set schema, persisted document, renderer,
export geometry, storage authority, or publication model.

## Plain-language summary

On a phone, the Cards workspace no longer tries to squeeze the contents list,
editor, and card preview beside one another. Each gets the full useful width,
and a persistent **Contents / Edit / Preview** bar switches between them.
Choosing something in Contents takes the author straight to Edit, while all
three views stay alive behind the scenes so changing views does not rebuild the
editor or preview.

On a tablet, Contents stays visible on the left and the author can switch the
right side between Edit and Preview. A desktop keeps the familiar three-column
workspace and resizable preview. The top bars use less height on small or short
screens, the current set section scrolls into view, and the phone status bar
keeps the important saved, syncing, offline, or conflict message while hiding
the less useful counts. Screen-edge padding also honours notches and home
indicators.

## Responsive pane contract

| Workspace width | Visible panes | Workspace gutter | Pane control |
|---|---|---:|---|
| `<= 760px` | One of Contents, Edit, or Preview | 16px | Contents / Edit / Preview |
| `761–1180px` | Contents plus either Edit or Preview | 20px | Edit / Preview |
| `> 1180px` | Contents, Edit, and resizable Preview | 32px | Existing divider |

Inactive panes remain mounted, `inert`, and hidden from accessibility and
pointer interaction. They use visibility rather than `display: none`, which
also lets the renderer keep a real pane width for synchronous text fitting.
Pane choice remains local to `EditorPanes.svelte`; it is not written into the
set document, storage, URL, or browser history.

Selecting or reselecting a card, character, or set-details subject reveals
Edit. A selection made from Contents also moves focus into the visible editor.
Deck headers are not selectable in the current document model, so Phase 2 does
not invent a new deck selection state.

The desktop preview divider retains its remembered width, pointer and keyboard
adjustment, Home/End bounds, and double-click reset. Its measured maximum is
reactive, and focus is recovered to the selected pane control if a breakpoint
change removes a focused desktop divider.

## Compact shell and safe areas

The Cards status bar now lives inside the pane grid, immediately above the
phone/tablet switcher. This keeps the switcher at the safe bottom edge without
duplicating status output. `viewport-fit=cover` is enabled, and the outer shell
consumes all four `safe-area-inset-*` values; print explicitly removes that
screen-only padding.

At phone widths the global banner is 56px high, and short viewports reduce it
to 48px. The title, set-navigation, status, editor headers, tabs, and workspace
spacing also become denser in short landscape layouts. Coarse-pointer header
and navigation controls retain the shared 44px touch target.

The set-navigation strip owns its horizontal overflow. Navigation and resize
changes reveal the active item by changing only that strip's `scrollLeft`, so
the surrounding page is not moved. Long status text is ellipsized; character,
card, and print counts are hidden on phones while the save/cloud state remains
visible and announced.

## Browser evidence

The fixed Phase 0 fixture was exercised in the in-app Chromium browser at
browser zoom 100%, light theme, and a fine pointer.

| Viewport width | Mode | Visible panes | Mounted panes | Document width |
|---:|---|---|---:|---:|
| 320px | Phone | One full-width pane | 3 | 320 / 320px |
| 360px | Phone | One full-width pane | 3 | 360 / 360px |
| 390px | Phone | One full-width pane | 3 | 390 / 390px |
| 412px | Phone | One full-width pane | 3 | 412 / 412px |
| 760px | Phone | One full-width pane | 3 | 760 / 760px |
| 761px | Tablet | Contents + Edit | 3 | 761 / 761px |
| 1180px | Tablet | Contents + Edit | 3 | 1180 / 1180px |
| 1181px | Desktop | Contents + Edit + Preview | 3 | 1181 / 1181px |
| 1440px | Desktop | Contents + Edit + Preview | 3 | 1440 / 1440px |

At every measured width, `documentElement.scrollWidth === clientWidth`. The
active set-navigation item remained fully visible, including Settings at
390px. Selecting Breakwater from phone Contents opened Edit and focused the
workspace. Preview received the full 390px phone workspace and rendered at its
correct fitted size on first reveal.

At 844×390, the tablet layout retained Contents beside a scrolling editor.
Compact banner, title, navigation, status, editor header, and tab rows left a
74px visible editor body. It scrolled rather than clipping, but physical review
during Phase 3 correctly rejected that swipe window as too cramped. The Phase
3 follow-up makes the complete 183px Edit pane the scroll owner instead.

Phone pane switching preserved the editor subject and selection, its 2749px
scroll position, Preview zoom at 200% with a 515px stage scroll position, and a
308px Contents scroll position. Selecting a different card, reselecting the
current card, and selecting a character each opened and focused Edit.

At 1440×900, the desktop divider reported a 424px initial width with 320px and
801px bounds. ArrowLeft changed it to 440px, Shift+ArrowLeft to 488px,
ArrowRight to 472px, Home to 320px, End to 801px, and double-click reset it to
424px. After setting 440px, resizing to tablet hid the divider and recovered
focus to the pressed Edit switcher; returning to desktop restored 440px.

At 320×844, the 76-character set name “The Impossible Voyage of the Mariner
Beyond the Glass Regent's Shattered Horizon” occupied a 105px title region
against 456px of content and ellipsized there. An 8px gap remained before Save,
Export ended at 308px, and the document stayed 320px wide. The fixed fixture
name was restored after the check.

Validation completed so far:

- `npm run check` — 0 errors and 0 warnings;
- `npm run build` — production build completed;
- `git diff --check` — passed for the Phase 2 files;
- Phase 0 rendered baseline geometry — all 53 files verified unchanged;
- phone/tablet/desktop breakpoint matrix — no shell-level horizontal overflow;
- phone Contents → Edit selection and full-width Preview — passed;
- pane values, subject selection, preview zoom, and pane scroll retention — passed;
- desktop divider keyboard, reset, stored-width, and breakpoint focus recovery — passed;
- long set-name ellipsis with Save and Export retained — passed;
- active set-navigation reveal — passed;
- short-landscape workspace — passed.

## Remaining device evidence

Physical iOS and Android testing remains part of the later device-hardening
gate for real notch/home-indicator insets, browser chrome, virtual keyboards,
and rotation. Browser emulation confirms the CSS contract but is not presented
as physical safe-area proof.
