# Mobile UI Phase 9 — cross-device hardening

**Status:** Chromium browser hardening complete; physical-device, multi-browser,
authenticated, keyboard, and offline release sign-off remains open.

**Completed:** 27 September 2026

**Applies to:** Cross-route responsive hardening, delayed file operations,
dialog and pointer safety, build output, and export regression evidence

## What changed, in plain language

This phase was the whole-product inspection after the individual mobile pieces
were built. Every local authoring page was exercised at 320×568, with
representative phone, landscape, tablet, breakpoint-edge, and desktop checks.
Public browsing, dialogs, account menus, print settings, full-screen views,
both themes, and the three-pane Cards workspace were included as well.

The pass found and fixed a few problems that only become obvious when the app is
used as a complete product:

- The Overview page could become trapped below the browser chrome on a short
  landscape phone. It now gives the useful content the available height.
- Dialogs and full-screen viewers now respect phone safe areas and keep their
  own content scrollable instead of freezing the page.
- Drag controls now stop cleanly if the browser cancels a gesture, capture is
  lost, or another pointer appears.
- A slow image or model upload can no longer finish later and overwrite a newer
  choice, a removal, a visibility change, another set, or another account.
- The card-move selector now stays at 16px on phones so iOS does not zoom the
  whole page when it receives focus.
- The export rehearsal now uses the same global styles and fonts as the real
  application and can be repeated at another viewport without reloading the
  document.

One genuine output bug was found during that rehearsal. Two spacing values in
the threat board were accidentally based on the browser width rather than the
print board width. The exported strip could therefore shift between a phone and
a desktop. The board is now its own sizing container, so those measurements are
anchored to the printable component.

## Technical log

### Responsive and interaction hardening

- Checked the local authoring routes — Edit, Cards, Threat, Map, Components,
  Symbols, Overview, Analysis, and Settings — at 320×568 without document-width
  overflow or clipped primary controls.
- Checked representative layouts at 360×800, 390×844, 430×932, 844×390,
  768×1024, 1440×900, and on both sides of the 760/761 and 1180/1181
  breakpoints.
- Checked Home, Gallery, a public shared set, shared-set actions, card and
  component viewers, New Set, the account menu, full-screen viewing, and print
  settings at their narrow relevant sizes.
- Preserved the selected Cards entity and useful scroll owner through viewport
  changes; the desktop preview divider still supports pointer and keyboard
  resizing.
- Applied safe-area-aware sizing to shared dialogs and sheet-style overlays.
- Hardened the remaining manual drag and swipe lifecycles so they stay bound to
  their initiating pointer and clean up after pointer cancellation, lost
  capture, or component teardown.
- Kept coarse-pointer sizing based on `any-pointer: coarse`, so a touch-capable
  laptop remains touchable even when its primary pointer is a mouse.

### Asynchronous state integrity

`src/lib/interaction/operation-guard.ts` now provides a small, dependency-free
generation guard for asynchronous work. Artwork, card backs, initiative bands,
style assets, replacement assets, card and character images, threat assets,
symbols, figures, settings imports, and collection banners use it to confirm
that the destination still represents the operation the author started.

The guards include the relevant set/document identity, entity or asset key, and
operation generation. A later upload to the same slot, a removal or visibility
change, set replacement, and account changes supersede stale work. Work for a
still-existing, explicitly addressed entity may safely finish after the author
opens another editor; it lands on its original target rather than the newly
visible one. Multi-file rulebook imports validate and decode the complete
selection before committing it, preventing a half-applied document when a later
file fails.

### Export invariance and evidence

The Phase 0 fixture was exported in the same mounted browser document at phone
and desktop viewport sizes. The run covers trim and bleed card archives, the
map, threat board, fixture JSON, and the local Tabletop Simulator bundle.

- Card, map, threat, archive-entry, and TTS image dimensions were unchanged.
- Document and TTS structure were unchanged after timestamp, local-path, and
  generated content-hash references were normalized.
- In the retained final pair, three card PNGs differed in 2, 4, and 71 pixels
  out of 3.05–3.63 million. Every changed channel differed by one level;
  visual inspection found no content or geometry change. Repeated strict runs
  varied in which few raster edges rounded differently, so strict pixel
  verification remains intentionally capable of reporting the noise while the
  cross-viewport geometry gate accepts it.
- The threat-board container fix removed the earlier viewport-dependent
  geometry difference rather than teaching the verifier to ignore it.

Print is a browser-print screen rather than a file exporter, so it has no PDF
artefact to hash. Its existing sheet planner, millimetre geometry, scale, and
selection semantics remained unchanged; its preview and settings were checked
separately in phone landscape and desktop layouts.

The evidence runner accepts an isolated `profile` query, imports the real global
stylesheet, and exposes **Run again** so a phone and desktop pass can share the
same loaded fonts and renderer state. Local TTS evidence may use a dedicated
bundle folder without changing the ordinary product export name.

### Build hygiene

Vite's deprecated Rollup option was moved to the current Rolldown option, and a
480 kB entry-aware split target keeps growth from silently recreating the large
entry-chunk warning. This changes delivery chunks only, not application or
export behaviour.

## Evidence collected in Chromium

| Surface | Sizes exercised | Result |
|---|---|---|
| All local authoring routes | 320×568 | No document-width overflow or clipped primary controls |
| Threat editor | 360×800 | Board pan viewport and inspector remain usable |
| Cards and Map | 390×844 | Useful single-pane workspace and stable selection |
| Account and Gallery | 430×932 | Menus and page content fit |
| Overview, print, dialogs | 844×390 | Short-landscape scrolling and completion controls remain reachable |
| Cards tablet | 768×1024 | Tablet layout remains usable |
| Responsive seams | 760/761 and 1180/1181 | Expected pane modes without clipping |
| Cards desktop | 1440×900 | Three-pane layout and preview resizing remain intact |
| Public viewers | 320×568 | Card/component dialogs, Escape, arrows, and full-screen exit work |
| Themes | 390×844 | Light and dark layouts checked |

These are controlled browser checks, not claims about physical touch hardware.

## Release evidence still required

Phase 9 does not declare the mobile project fully released yet. The following
checks require environments that were not available in this pass:

- current iOS Safari, Android Chrome, iPad Safari, Firefox, and Safari;
- real safe areas, software-keyboard opening/dismissal, focus zoom, and 200%
  browser zoom or larger operating-system text;
- genuine touch, pinch, pointer interruption, rotation, and
  background/foreground cancellation;
- physical rich-text selection and formatting;
- signed-in account, contribution, collection-organizer, publishing, and
  one-time-code journeys;
- offline/cache, permission-denied, and realistic failure recovery;
- phone file picking and image/model decoding.

Those items remain unchecked in `MOBILE_UI_PROJECT.md`. Browser emulation is
valuable evidence for responsive layout, but it is not substituted for device
evidence where the operating system owns the interaction.

## Verification

- `npm run check` — 0 errors and 0 warnings;
- `npm run build` — production build completed with no errors or warnings;
- Phase 0 geometry verification — all 53 baseline files passed;
- Phase 9 phone-to-desktop geometry verification — all 26 files passed;
- `git diff --check` — clean apart from working-copy line-ending notices.

The exact Phase 9 capture and comparison procedure is recorded in
`tools/baselines/mobile-ui-phase9/README.md`.
