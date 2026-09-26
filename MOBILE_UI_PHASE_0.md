# Mobile UI Phase 0 — Interaction Contract

**Status:** Browser implementation and reproducible baseline complete; physical-device interruption evidence remains
**Locked:** 26 September 2026
**Applies to:** Cards workspace and future direct-manipulation editors

This document turns Phase 0 of `MOBILE_UI_PROJECT.md` into a concrete contract.
It records view state only. Nothing here adds a persisted field or changes the
set document, renderer, export geometry, storage authority, or navigation URL.

## Responsive state table

| Container width | Visible panes | Switcher | Initial right/phone surface |
|---|---|---|---|
| `> 1180px` | Contents + Edit + resizable Preview | None | All panes |
| `761–1180px` | Contents + either Edit or Preview | Edit / Preview, beneath the second column | Edit |
| `<= 760px` | Exactly one of Contents, Edit, or Preview | Contents / Edit / Preview, beneath the active pane | Edit |

The 760px boundary matches the existing compact global chrome. Measurements at
320, 360, 390, 412, and 430px showed that it gives the active pane the full
available width, and 768px retains a useful 272px hierarchy beside the editor.
The boundary is provisional only in the sense that physical-device evidence may
move it; preference alone is not enough to change it.

“One pane” means one **visible** pane. All three snippets remain mounted, so
form values, component-local selection, preview state, and pane scroll positions
survive a switch. An inactive pane is `display: none`, `aria-hidden`, and `inert`.

### Pane state and transitions

- `activePane` belongs locally to `EditorPanes.svelte` and resets when Cards is
  remounted. It is not stored in the set, IndexedDB, `localStorage`, the URL, or
  browser history.
- Entering Cards starts on Edit, preserving the existing set-details entry
  behaviour.
- On a phone, Contents, Edit, and Preview are direct choices. On a tablet,
  Contents remains visible and the switcher chooses the second-column surface.
- Selecting or reselecting a character or card changes the active pane to Edit.
  Decks are not selectable in the current document model, so the contract does
  not invent deck selection.
- An automatic Contents → Edit transition focuses the Edit region after it is
  visible. A manual switch leaves focus on the switcher button.
- Crossing a breakpoint preserves `activePane`. If resize hides the focused
  pane, focus moves to the selected switcher button.
- Preview is reachable in every mode. The desktop preview width, keyboard
  slider behaviour, reset action, and remembered width remain unchanged.

The switcher is a grid row rather than a fixed overlay. Dynamic viewport height
therefore keeps it above the software keyboard, and bottom padding is ready for
`safe-area-inset-bottom`. Enabling `viewport-fit=cover` remains a shell-wide
decision because every outer edge—not only this switcher—must then honour the
safe area.

## Gesture ownership contract

| Surface mode | Gesture owner | Allowed behaviour |
|---|---|---|
| Navigate / Preview | Browser/page | Vertical scroll, native text selection, and browser pinch zoom |
| Explicit edit mode | Named editor surface | One primary-pointer editing session until commit or cancellation |

An editor must not apply `touch-action: none`, call `preventDefault()`, or take
pointer capture merely because it contains something draggable. Those actions
begin only after the author enters a named mode such as Adjust, Move, Spaces,
Link, or Text and starts on an eligible target. Even in an edit mode, blank
canvas remains page-owned.

`src/lib/interaction/pointer-session.ts` is the shared lifecycle prototype. It
deliberately knows nothing about cards, transforms, maps, or threat spaces.

### Session lifecycle

1. Refuse secondary mouse buttons and non-primary contacts.
2. Take an immutable start snapshot and capture one pointer.
3. Treat movement below 6 CSS px for a mouse or 10 CSS px for touch/pen as a
   tap, not a drag. Invalid thresholds fall back to those defaults.
4. Once the threshold is crossed, update transient presentation state. The
   owner may prevent the now-deliberate edit gesture from scrolling.
5. On `pointerup`, apply the final transient position and commit once.
6. On interruption, release capture/listeners and cancel once. Document edits
   restore the start snapshot; a view-only preference may instead retain its
   last coherent value when its owner explicitly chooses that policy.

Cancellation covers `pointercancel`, lost pointer capture, Escape, page
backgrounding or hiding, window blur, viewport/orientation change, a second
pointer, mode change, supersession, callback failure, manual cancellation, and
component teardown. Pointer and key interruption listeners run in the capture
phase, so a nested component cannot hide them by stopping propagation. The
final pointer-up move remains cancellable: synchronous teardown wins over
commit. Callbacks and cleanup are idempotent. Until multi-touch editing is
designed, a second pointer cancels a mutating session; it never silently
becomes pinch.

The non-production prototype is served at
`/tools/mobile-interaction-contract.html`. Its Navigate mode allows a vertical
swipe begun over the artwork to scroll the page. Adjust mode applies gesture
ownership only to the artwork itself, captures and moves it, commits on release,
and restores its snapshot on cancellation. If the viewport changes while a
session is active, the restored snapshot is clamped to the new bounds.

## Measured browser evidence

The prototype was driven in the in-app Chromium browser on Windows at browser
zoom 100%, light theme, and a fine pointer.

| Width | Measured document width | Mode | Visible panes | Switcher target height |
|---:|---:|---|---|---:|
| 320 | 320 | Phone | Edit | 44px |
| 360 | 360 | Phone | Edit | 44px |
| 390 | 390 | Phone | Edit | 44px |
| 412 | 412 | Phone | Edit | 44px |
| 430 | 430 | Phone | Edit | 44px |
| 760 | 760 | Phone | Edit | 44px |
| 768 | 768 | Tablet | Contents + Edit | 44px |
| 1024 | 1024 | Tablet | Contents + Edit | 44px |
| 1180 | 1180 | Tablet | Contents + Edit | 44px |
| 1181 | 1181 | Desktop | Contents + Edit + Preview | — |
| 1440 | 1440 | Desktop | Contents + Edit + Preview | — |

At every measured width `documentElement.scrollWidth === clientWidth`. The 320px
pass exposed two independent min-content leaks in the shell and title bar; the
grid now uses a zero-minimum column and the set-name control is allowed to
shrink. SetNav remains an intentional, independent horizontal scroller.

Verified interactions:

- Tablet Edit → Preview keeps Contents visible.
- Phone Preview receives the full workspace width.
- Adding a hero from phone Contents automatically opens Edit and focuses it.
- Pane changes retain the editor's scroll position and mounted component state.
- A swipe begun over the prototype artwork scrolls in Navigate mode.
- A 113px Adjust drag captured, moved, released, and committed once.
- The deterministic lifecycle verifier passed 16/16 checks: tap, sub-threshold
  touch jitter, invalid-threshold fallback, one-shot drag commit,
  `pointercancel`, lost capture, Escape, viewport change, second pointer,
  stopped pointer/key bubbling, final-move cancellation, page hiding,
  idempotent teardown, a fresh follow-up session, and secondary-button refusal.

Physical iOS/Android testing is still required for browser chrome, safe areas,
virtual keyboards, long-press selection, real `pointercancel`, rotation, and
lost capture.

## Renderer/export baseline contract

Cross-device gates compare dimensions, content, and geometry. Byte hashes are a
fast same-browser/same-OS signal only: font rasterisation and browser encoders
can legitimately change bytes while geometry remains identical.

| Output | Trim px | Bleed px |
|---|---:|---:|
| Action / hero character | 1478 × 2065 | 1632 × 2222 |
| Rules portrait | 1478 × 2065 | 1632 × 2218 |
| Rules landscape | 2064 × 1478 | 2218 × 1632 |
| Initiative | 1326 × 2020 | 1524 × 2232 |
| Event | 2033 × 1335 | 2232 × 1524 |
| Non-hero deck back | 373 × 520 | none |
| Threat track | 1637 × 232 | none |
| Map small / medium / large | 1337 × 742 / 1337 × 866 / 1637 × 1131 | none |

ZIP timestamps, `.awset` `exportedAt`, TTS `Date`, and local absolute URLs must
be normalised before structured comparison. Whole-file hashes of those formats
are not stable evidence.

`tools/mobile-ui-baseline.json` records the fixed fixture, capture matrix,
selection, and decoded-pixel fingerprints; the evidence manifest also
fingerprints the exact Phase 0 source state. Phase 0 includes
four durable Cards Content captures at `320×568`, `390×844`, `1024×768`,
and `1440×900`. The real exporters produced trim and bleed card ZIPs, map and
threat PNGs, and a 20-file Tabletop Simulator bundle with no warnings.

Raw screenshots live under ignored `exports/guides-raw/mobile-ui-phase0/`;
accepted captures live under `tools/baselines/mobile-ui-phase0/screenshots/`.
The evidence verifier decodes supported PNGs and hashes their actual sample
bytes. A repeated complete render changed some encoded PNG containers but
produced identical decoded pixels, and both ordinary and geometry-only
verification passed.

## Remaining Phase 0 evidence

The browser-side contract and reproducible baseline are complete. Before
sign-off, exercise interruption on physical iOS Safari and Android Chrome:
real `pointercancel` and lost capture, rotation, browser chrome and safe areas,
background/foreground transitions, long-press selection, and the software
keyboard. Synthetic browser coverage is deliberately not presented as
physical-device proof.
