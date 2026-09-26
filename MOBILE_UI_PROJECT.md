# Unmatched Labs Mobile UI Project

**Status:** Implementation in progress — Phase 0 browser work complete; physical-device sign-off pending
**Last updated:** 26 September 2026
**Scope:** Responsive browser UI for phones and touch-capable tablets

## Purpose

Make Unmatched Labs genuinely usable on a phone without weakening the desktop
authoring experience or changing the rendered game components.

This is not primarily a matter of shrinking the existing desktop layout. The
current Cards workspace keeps a 272px hierarchy beside the editor after hiding
the preview at widths below 1180px. That leaves only 118px for the editor on a
390px phone, before the editor's own padding. Mobile authoring therefore needs
a deliberate pane-navigation model, touch-sized controls, and explicit editing
modes for spatial tools.

The work remains a presentation and interaction project. It should not require
changes to the set schema, IndexedDB/cloud authority, publishing semantics, or
the DOM renderer used for export.

---

## Outcomes

When this project is complete:

- A phone user can browse, create, open, edit, preview, save, publish, and
  export a set without requesting the desktop site.
- The Cards workspace presents one useful surface at a time rather than
  squeezing the desktop three-pane layout into a phone.
- Every essential operation has a visible touch route. Nothing critical
  depends on hover, right-click, Shift-click, a mouse wheel, or an accurately
  aimed sub-30px icon.
- Ordinary pages scroll normally. A visual editor captures gestures only
  after the author deliberately enters an editing mode.
- The software keyboard does not hide the active field or the only way to
  finish an action.
- Card, threat-track, map, print, PNG, and Tabletop Simulator output remain
  unchanged for the same document.
- Existing desktop layouts, density, keyboard shortcuts, and preview resizing
  continue to work.

## Non-goals

- A native iOS or Android application.
- App-store packaging.
- A new PWA or offline-installation programme.
- New export formats. PDF export remains out of scope.
- Changes to card, map, threat-track, or print geometry.
- Changes to persistence, authentication, publication, collaboration, or
  collection membership.
- Making hover work on touch. Touch receives an explicit alternative.
- Adding a test framework. The repository's automated gate remains
  `svelte-check`, followed by the existing production build and manual
  rendered-output verification.

---

## Product decisions

These are the recommended working decisions for implementation. They should
only change in response to prototype or device evidence.

### Responsive modes

| Width/capability | Cards workspace |
|---|---|
| Above 1180px | Existing hierarchy + editor + resizable preview |
| Approximately 761–1180px | Hierarchy + editor, with an explicit Preview mode |
| Approximately 760px and below | One visible pane at a time: Contents, Edit, or Preview; all three remain mounted |

The exact phone breakpoint may be tuned during Phase 0. Capability queries
such as `any-pointer: coarse` should control touch-target sizing; viewport or
container queries should control layout. A narrow desktop window should not be
mistaken for a touch device, and a touchscreen laptop should remain touchable.

### Phone navigation

- Use a persistent, safe-area-aware **Contents / Edit / Preview** switcher.
- Prefer a bottom switcher unless the Phase 0 prototype shows that it
  conflicts with browser chrome or the software keyboard.
- Selecting a real entity in Contents automatically opens Edit.
- Keep all three panes mounted so switching does not discard form state,
  editor selection, preview state, or scroll position.
- Preview must remain reachable at every responsive width.

### Gesture ownership

The page scrolls unless the author deliberately enters a mode that needs the
gesture.

- Form pages use ordinary browser scrolling and native text selection.
- A visual surface opens in a non-mutating **Navigate** or **Preview** mode.
- **Adjust**, **Move**, **Spaces**, **Link**, and **Text** modes may capture
  one-finger gestures until the author taps Done or changes modes.
- Browser zoom must not be disabled globally.
- Printed geometry stays unchanged. Larger touch hit areas are editor-only
  and may extend invisibly beyond their visual icon.

### Delivery boundary

The first release milestone is useful everyday mobile authoring: shell
navigation, hierarchy, cards, characters, rich text, preview, standard artwork
adjustment, saving, and export.

Full touch map editing is a later milestone because it is a distinct spatial
editor project. Until that phase ships, the Map page may be viewable on a
phone while clearly recommending a tablet or desktop for construction. The
limitation must be explicit rather than presenting controls that appear usable
but mutate the map accidentally.

---

## Success criteria shared by every phase

- No unintended document-level horizontal scrolling at 320px.
- Intentional horizontal regions—tab strips, creator chips, map viewports,
  threat tracks, and similar controls—scroll independently.
- Core actions have approximately 44 × 44 CSS-pixel touch targets on a coarse
  pointer. A small visual glyph may sit inside a larger invisible target.
- Editable controls use at least 16px text on phones so iOS does not
  automatically zoom on focus.
- Dialogs and sheets use dynamic viewport height, one clear scroll owner,
  safe-area padding, and reachable footer actions.
- Destructive actions without undo use one consistent confirmation pattern.
- No mobile-only control is included in photographed or printed output.
- Desktop behaviour is checked after every phase.
- `npm run check` passes before a phase is considered complete.
- `npm run build` and the full device matrix pass at release milestones.

---

## Roadmap at a glance

| Phase | Deliverable | Size | Milestone |
|---|---|---:|---|
| 0 | Interaction contract and baseline | Small | Preparation |
| 1 | Shared touch/control foundation | Medium | Mobile authoring MVP |
| 2 | Responsive Cards shell and chrome | Medium | Mobile authoring MVP |
| 3 | Touch-complete hierarchy and core forms | Medium–large | Mobile authoring MVP |
| 4 | Mobile-safe rich text | Medium | Mobile authoring MVP |
| 5 | Preview and artwork adjustment | Medium–large | Mobile authoring MVP |
| 6 | Conventional set pages and public flows | Medium | Broad mobile usability |
| 7 | Threat-track mobile inspector | Medium–large | Full authoring parity |
| 8 | Map mobile workspace | Large | Full authoring parity |
| 9 | Cross-device hardening and release | Medium | Release |

The authoring MVP is roughly 1–2 focused engineering weeks. Complete touch
parity, including Maps and Threat, is approximately 3–5 focused weeks if the
phases proceed cleanly; allow a wider 4–6 week planning envelope for one
implementer when real-device fixes and interruptions are included. These are
scope signals, not delivery commitments.

---

## Phase 0 — Lock the interaction contract

**Goal:** Establish one responsive model and a reproducible baseline before
changing shared controls.

### Work

- [x] Confirm the phone breakpoint after measuring 320, 360, 390, 412, and
  430px widths.
- [x] Confirm the tablet behaviour between the phone breakpoint and 1180px.
- [x] Prototype the Contents / Edit / Preview switcher location.
- [x] Define the automatic Contents → Edit transition.
- [x] Decide which transient pane state belongs locally in
  `EditorPanes.svelte`; do not persist it in the set document.
- [x] Capture fixed-fixture Cards workspace baselines at desktop, tablet, and
  phone states.
- [x] Record existing export dimensions/fingerprints or representative PNGs
  for later comparison.
- [x] Establish a common pointer-session pattern covering pointer capture,
  tap-versus-drag threshold, `pointercancel`, and cleanup after rotation or
  lost capture.
- [x] Prototype gesture ownership on a simple editor surface before applying
  it to Maps.

### Likely files

- `src/lib/components/layout/EditorPanes.svelte`
- A possible new `MobilePaneSwitcher.svelte`
- Project documentation only for the initial interaction contract

### Exit criteria

- [x] One state table describes phone, tablet, and desktop behaviour.
- [x] Preview is reachable in every responsive state.
- [x] A vertical swipe scrolls in Preview/Navigate mode.
- [x] The same surface captures a gesture only in an explicit edit mode.
- [ ] Tap, drag, cancellation, rotation, and lost pointer capture leave the
  prototype in a valid state on physical iOS Safari and Android Chrome.
- [x] No schema or stored-document state is proposed.

---

## Phase 1 — Shared touch and control foundation

**Goal:** Make ordinary forms physically operable before adapting bespoke
canvases.

### Work

- [x] Add coarse-pointer sizing for buttons, icon buttons, switches,
  steppers, colour swatches, reset actions, segmented controls, tabs, slider
  nudges, and angle controls.
- [x] Give sliders a touchable track/thumb region while retaining their
  compact visual appearance.
- [x] Use at least 16px text for phone inputs, textareas, selects, numeric
  fields, hexadecimal fields, and contenteditable areas.
- [x] Keep at least 8px separation between adjacent destructive and
  non-destructive actions.
- [x] Preserve visible focus and pressed states in addition to hover.
- [x] Make dynamic tabs horizontally scrollable and keep the selected tab in
  view.
- [x] Let chip/picker rows wrap or scroll without reintroducing tiny targets.
- [x] Standardize dialogs and sheets on `100dvh`, safe-area padding,
  scrollable bodies, and sticky actions.
- [x] Centralize confirmation for destructive operations that have no undo.

### Likely files

- `src/lib/ui/Button.svelte`
- `src/lib/ui/Slider.svelte`
- `src/lib/ui/NumberInput.svelte`
- `src/lib/ui/Switch.svelte`
- `src/lib/ui/Tabs.svelte`
- `src/lib/ui/SegmentedControl.svelte`
- `src/lib/ui/TextInput.svelte`
- `src/lib/ui/TextArea.svelte`
- `src/lib/ui/Select.svelte`
- `src/lib/ui/ColorInput.svelte`
- `src/lib/ui/FillEditor.svelte`
- `src/lib/ui/AngleDial.svelte`
- Shared dialog and destructive-action components

### Exit criteria

- [ ] Shared controls can be used reliably with a thumb at 360px.
- [ ] Focusing every standard text-like control on iOS does not zoom the
  page.
- [ ] Touch sizing activates on a touch-capable laptop even when a mouse is
  also present.
- [x] Narrow mouse-only desktop windows retain appropriate desktop density.
- [x] No control introduces new horizontal page overflow.
- [x] Existing keyboard and mouse behaviour remains intact.

---

## Phase 2 — Responsive Cards shell and in-set chrome

**Goal:** Give each Cards pane the full useful phone width and keep Preview
available.

### Work

- [ ] Refactor `EditorPanes.svelte` into desktop, tablet, and phone modes.
- [ ] Show exactly one full-width pane on a phone.
- [ ] Keep panes mounted while inactive.
- [ ] Auto-open Edit after selecting a card, character, deck, or relevant set
  item from Contents.
- [ ] Add an explicit Preview mode at tablet widths instead of removing the
  preview entirely.
- [ ] Preserve the desktop preview resizer, stored width, keyboard operation,
  and reset behaviour.
- [ ] Reduce mobile workspace inline padding to approximately 12–16px where
  measurement shows it is necessary.
- [ ] Compact the global banner, title row, set navigation, and status bar.
- [ ] Retain a clear save/sync/offline/conflict state while hiding redundant
  phone-only counts.
- [ ] Make the active set-navigation item visible after load or navigation.
- [ ] Apply bottom safe-area padding to the pane switcher.

### Likely files

- `src/App.svelte`
- `src/lib/components/layout/EditorPanes.svelte`
- `src/lib/components/layout/AppShell.svelte`
- `src/lib/components/layout/GlobalHeader.svelte`
- `src/lib/components/layout/TitleBar.svelte`
- `src/lib/components/layout/SetNav.svelte`
- `src/lib/components/layout/StatusBar.svelte`
- A possible new `MobilePaneSwitcher.svelte`

### Exit criteria

- [ ] At 320, 360, 390, and 412px, the active pane receives the useful page
  width with no shell-level horizontal overflow.
- [ ] A user can select a card, edit it, and inspect the preview without
  rotating the phone.
- [ ] Pane switching preserves values, selection, and useful scroll state.
- [ ] Long set names ellipsize without displacing Save or Export.
- [ ] Landscape 844 × 390 retains a usable scrolling workspace.
- [ ] At desktop width, the existing three-pane layout and preview resizer
  behave unchanged.

---

## Phase 3 — Touch-complete hierarchy and core forms

**Goal:** Make every normal card and character authoring action discoverable
and reachable without a mouse.

### Work

- [ ] Replace hover-only row actions with visible coarse-pointer actions or a
  per-row overflow menu.
- [ ] Increase hierarchy row and disclosure hit regions.
- [ ] Add non-drag ways to reorder cards and move them between decks.
- [ ] Preserve desktop drag-and-drop as an efficiency feature.
- [ ] Keep the existing two-step destructive confirmation and apply it to
  editor-header delete actions that currently bypass it.
- [ ] Make editor headers wrap or stack their actions.
- [ ] Make character/card tabs horizontally scroll without widening the page.
- [ ] Retain the existing container-query collapse behaviour in card and
  character panels.
- [ ] Inspect every Content and Design section at 320–430px and repair only
  measured overflow.
- [ ] Check file upload and native picker flows with the software keyboard
  dismissed and open.

### Likely files

- `src/lib/components/sidebar/SetSidebar.svelte`
- `src/lib/components/sidebar/SidebarGroup.svelte`
- `src/lib/components/sidebar/CharacterRow.svelte`
- `src/lib/components/sidebar/DeckRow.svelte`
- `src/lib/components/sidebar/CardRow.svelte`
- `src/lib/components/sidebar/AddMenu.svelte`
- `src/lib/components/workspace/WorkspaceHeader.svelte`
- `src/lib/components/workspace/CardEditor.svelte`
- `src/lib/components/workspace/CharacterEditor.svelte`
- `src/lib/components/workspace/SetEditor.svelte`
- Targeted Content/Design panels only where measured

### Exit criteria

- [ ] Every add, collapse, rename, move, reorder, and delete action is
  discoverable on `(hover: none)`.
- [ ] A card can be reordered and transferred without HTML drag-and-drop.
- [ ] No ordinary action card Content or Design section overflows the page at
  320px.
- [ ] Heroes with several character-card tabs can reach every tab.
- [ ] Editor actions stay reachable while the software keyboard is open.
- [ ] Destructive operations use the same confirmation model from the
  hierarchy and editor.

---

## Phase 4 — Mobile-safe rich text and symbol insertion

**Goal:** Make formatting reliable with native mobile selection and a virtual
keyboard.

### Work

- [ ] Store a cloned selection range whenever `selectionchange` reports a
  range inside the editor.
- [ ] Restore the saved range before applying toolbar formatting if the
  browser cleared it.
- [ ] Move mouse-specific toolbar behaviour to pointer-safe handling.
- [ ] Do not interfere with long-press selection handles or IME composition.
- [ ] Use a horizontally scrolling toolbar or a compact primary row plus a
  More panel.
- [ ] Give formatting and symbol controls coarse-pointer hit areas.
- [ ] Preserve the “Select text to resize” explanation.
- [ ] Insert symbols at the last intended caret even if the keyboard briefly
  closes.

### Likely files

- `src/lib/ui/RichTextEditor.svelte`
- `src/lib/ui/SymbolPalette.svelte`
- Any shared rich-text selection helper introduced by the work

### Exit criteria

On physical iOS Safari and Android Chrome, an author can:

- [ ] Long-press and select a phrase.
- [ ] Apply bold, italic, alignment, block style, size, and colour.
- [ ] Continue changing the same selection without unexpected collapse.
- [ ] Insert built-in and custom symbols at the intended caret.
- [ ] Close and reopen the keyboard without losing text or corrupting markup.
- [ ] Use the same toolbar with keyboard and mouse on desktop.

---

## Phase 5 — Preview and artwork adjustment

**Goal:** Make the rendered card easy to inspect and artwork intuitive to
adjust without turning the page into a scroll trap.

### Work

- [ ] Fit the selected card to phone width by default.
- [ ] Keep zoom, bleed, export, and preview tools reachable.
- [ ] Support the existing zoom range through 200%.
- [ ] Allow panning/scrolling when a zoomed preview exceeds the viewport.
- [ ] Add an explicit **Adjust artwork** mode with a visible Done action.
- [ ] Move artwork with one finger only while Adjust mode is active.
- [ ] Give resize/rotation handles at least 44px hit regions without making
  their visual marks oversized.
- [ ] Preserve opposite-edge anchoring for edge resizing.
- [ ] Keep typed values, nudges, sliders, and Reset as a complete precision
  fallback.
- [ ] Make layer selection and ordering available without drag-and-drop.
- [ ] Use the same pointer lifecycle and transform constraints in the inline
  artwork panel and right-preview overlay.
- [ ] Treat pinch-to-scale as a follow-up unless handles and numeric controls
  prove inadequate.

### Likely files

- `src/lib/components/preview/PreviewPanel.svelte`
- `src/lib/components/preview/ArtworkTransformOverlay.svelte`
- Artwork panels under `src/lib/components/workspace/`
- `src/lib/ui/Slider.svelte`

### Exit criteria

- [ ] Swiping over artwork scrolls normally outside Adjust mode.
- [ ] Entering Adjust makes gesture ownership unambiguous.
- [ ] Leaving Adjust immediately restores normal scrolling.
- [ ] Move, uniform scale, width/height stretch, rotation, Reset, and precise
  entry all work with touch.
- [ ] No transform requires aiming at the current small visual handle.
- [ ] A cancellation or orientation change leaves one coherent transform.
- [ ] Fixed and custom artwork layers can be ordered using touch.
- [ ] The `.plate` DOM and exported PNG remain unchanged.

### Mobile authoring MVP gate

The first mobile authoring milestone is complete when Phases 0–5 pass their
exit criteria and this phone smoke path succeeds:

1. Open or create a set.
2. Navigate to a character and card.
3. Edit the title, rules text, value, quantity, and artwork.
4. Format selected text and insert a symbol.
5. Inspect and zoom the live preview.
6. Save, reload, and confirm the edits persist.
7. Export the card/set and compare the output with desktop.

At this milestone, precision Map and Threat construction may still be marked
tablet/desktop recommended.

---

## Phase 6 — Conventional set pages and public flows

**Goal:** Make the rest of Labs feel intentionally mobile while preserving
the public pages that already respond well.

### Set-level pages

- [ ] Verify Overview, Analysis, Components, Symbols, and other conventional
  set pages at phone and tablet widths.
- [ ] Stack dense metric/control grids without changing derived analysis.
- [ ] Give component/figure actions touch-sized controls.
- [ ] Ensure inspectors and modals have one scroll owner and reachable footer
  actions.
- [ ] Preserve all rendered component dimensions and exports.

### Welcome, Home, Gallery, and profiles

- [ ] Preserve the existing single-column Welcome/Home behaviour.
- [ ] Make New Set and New Collection dialogs safe at short viewport heights
  and with the keyboard open.
- [ ] Give Gallery a full-width search field, tappable content-type switch,
  and deliberate compact Filter/Sort layout.
- [ ] Replace hover-only deck-back/character-card preview with an explicit
  touch behaviour.
- [ ] Make favourite, creator, and parent-set actions comfortable targets.
- [ ] Add a narrow creator-profile layout, including invitations.

### Shared sets and collections

- [ ] Retain the existing shared-set 700px compact layout and action sheet.
- [ ] Verify masthead, Explore toolbar, scope, zoom, jump links, comments,
  full screen, fork, and export in portrait and landscape.
- [ ] Preserve lazy loading of published preview artwork.
- [ ] Retain the collection showcase's existing 920, 700, and 430px layouts.
- [ ] Verify roster, difficulty, creator credits, member explorer, components,
  and Play or print on touch.
- [ ] Repair remaining collection workspace rows that assume desktop width.
- [ ] Keep project tabs independently scrollable with an obvious active tab.
- [ ] Verify contribution descriptions, timelines, discussions, ratings,
  Ready state, and publishing with the keyboard open.

### Account, export, and print

- [ ] Keep the account menu within the dynamic viewport and scroll its
  contents.
- [ ] Standardize export selectors on the shared mobile dialog pattern.
- [ ] Replace the phone Print control band with a compact toolbar and settings
  sheet/accordion so a useful preview remains visible.
- [ ] Verify Print in phone landscape.
- [ ] Preserve print geometry, scale, selection semantics, and output.

### Likely files

- Set-level tools under `src/lib/components/tools/`
- `src/lib/components/library/HomeScreen.svelte`
- New Set and New Collection dialogs
- `src/lib/components/cloud/GalleryScreen.svelte`
- `src/lib/components/cloud/SharedSetScreen.svelte`
- Collection showcase/workspace/member components
- Author profile and account components
- `src/lib/print/PrintScreen.svelte`
- Export selector components

### Exit criteria

- [ ] A signed-out visitor can browse Gallery, open a shared set, inspect a
  collection, and reach print/export actions at 320px.
- [ ] Gallery and collection previews have a discoverable touch equivalent
  to desktop hover.
- [ ] A signed-in collaborator can use contributions, timeline, discussions,
  difficulty, and publishing without clipping.
- [ ] Print settings never reduce the preview to zero or an unusable height.
- [ ] Public routes retain their current deep-link and lazy-loading behaviour.
- [ ] Existing responsive public-page identity is refined, not redesigned.

---

## Phase 7 — Threat-track mobile inspector

**Goal:** Stop requiring authors to edit print-scale controls inside the wide
7:1 threat strip.

### Work

- [ ] Display the board at a usable minimum width inside a horizontally
  scrollable viewport instead of shrinking its controls to phone width.
- [ ] Make the board selection-first on coarse/narrow layouts.
- [ ] Move threat value, text, styling, and confirmed deletion into the
  selected-space inspector.
- [ ] Keep slot text, note, styling, and confirmed deletion in the slot
  editor.
- [ ] Put placed-note text, styling, position, Move, and confirmed deletion in
  the note editor.
- [ ] Require an explicit Move action before a note captures dragging.
- [ ] Give small printed entities minimum screen-space hit regions.
- [ ] Allow horizontal board panning while the surrounding page continues to
  scroll vertically.
- [ ] Keep mobile editing controls outside the photographed result or scope
  them strictly to editable screen UI.

### Likely files

- `src/lib/components/tools/ThreatTracker.svelte`
- `src/lib/renderer/ThreatBoard.svelte`
- Shared inspectors and pointer-session helper

### Exit criteria

- [ ] Every threat space, slot, and note can be selected, edited, moved where
  applicable, and removed at 360px using touch only.
- [ ] No delete control is hidden behind hover.
- [ ] Horizontal strip navigation and vertical page scrolling do not fight.
- [ ] Interruption during a move does not lose or duplicate an object.
- [ ] Mobile hit areas and inspectors never appear in export.
- [ ] A representative threat export matches desktop in content and geometry.

---

## Phase 8 — Map mobile workspace

**Goal:** Provide a deliberate touch map-authoring tool rather than a desktop
canvas squeezed onto a phone.

This is the largest and highest-risk phase. It should reuse the pointer
lifecycle, control sizing, confirmation, and inspector conventions already
proved by earlier phases.

### Modes

- **Navigate** — default; pan and pinch without mutating the document.
- **Spaces** — select spaces; Add Space arms one placement; moving a space
  requires an explicit action.
- **Link** — choose the first and second endpoints with persistent guidance
  and an obvious Cancel action.
- **Text** — select or place text; movement is deliberate.
- **Environment** — select and adjust environment art; ordering also has
  buttons rather than relying on drag alone.

### Work

- [ ] Commit placement on pointer-up only when movement remained below the tap
  threshold. Never create a space on pointer-down.
- [ ] Use a minimum screen-space hit radius independent of printed diameter.
- [ ] Replace Shift-click-only colour selection with a visible Select
  Multiple mode, selection count, and Clear action.
- [ ] Preserve harmless pan/zoom while cancelling incomplete work cleanly
  when the mode or map changes.
- [ ] Add a visible touch Undo action.
- [ ] Move selected space/path/zone/environment properties into a full-width
  inspector or bottom sheet.
- [ ] Enlarge corner, unlink, palette, swatch, and ordering hit regions.
- [ ] Maintain one viewport transform and inverse-transform pointer
  coordinates at every zoom.
- [ ] Retain the unobstructed artwork visibility mode as a true non-editing
  view.
- [ ] Verify multiple-map switching cannot retain stale selection or a
  half-finished link.

### Likely files

- `src/lib/components/tools/MapEditor.svelte`
- Map model/query helpers only where gesture-safe selection requires them
- Shared inspector and pointer-session components

### Exit criteria

At phone portrait and tablet portrait sizes, a touch-only author can:

- [ ] Pan and pinch around a populated map without changing it.
- [ ] Add, select, move, multi-select, recolour, split, rotate, and delete
  spaces.
- [ ] Create, edit, and unlink paths, including their special options.
- [ ] Create and edit secret passages.
- [ ] Place, edit, move, reorder, and remove environment pieces.
- [ ] Place, edit, move, and remove text.
- [ ] Configure zones and patterns.
- [ ] Undo map mutations.
- [ ] Switch maps without stale selection or pending gestures.

Additionally:

- [ ] A scroll gesture never creates a space.
- [ ] A pan never moves a selected object.
- [ ] A tap never inherits a stale Link endpoint.
- [ ] Map appearance and exported coordinates remain unchanged.

---

## Phase 9 — Cross-device hardening and release

**Goal:** Verify mobile Labs as one continuous product rather than a
collection of individually responsive components.

### Required viewport matrix

| Class | Minimum target |
|---|---|
| Small phone | 320 × 568 |
| Common Android | 360 × 800 |
| Modern iPhone | 390 × 844 |
| Large phone | 430 × 932 |
| Phone landscape | Representative 740–930 × 320–430 |
| Tablet portrait | 768 × 1024 |
| Desktop regression | Existing desktop targets, including above 1180px |

### Browser/device coverage

- [ ] Current iOS Safari on a physical iPhone where available.
- [ ] Current Android Chrome with its software keyboard.
- [ ] iPad Safari in portrait and landscape.
- [ ] Android tablet or Chromebook touch with a hardware keyboard where
  available.
- [ ] Windows touch laptop with touch and mouse.
- [ ] Desktop Chrome, Firefox, and Safari where available.

Responsive desktop emulation is useful for iteration, but it is not sufficient
evidence for rich-text selection, virtual-keyboard behaviour, safe areas, or
gesture arbitration.

### End-to-end journeys

- [ ] First visit → Welcome → create/import/open a set.
- [ ] Home → continue/delete/restore set and open collection entry points.
- [ ] Cards → select → edit content/design → format text → adjust artwork →
  preview → save/export.
- [ ] Overview/Analysis/Components/Symbols workflows.
- [ ] Threat-track authoring.
- [ ] Map navigation and authoring.
- [ ] Gallery search/filter → creator → shared set.
- [ ] Shared set scope, comments, favourites, full screen, customize, fork,
  export, and print.
- [ ] Collection showcase → roster/set/components → Play or print.
- [ ] Collection member and organizer workflows.
- [ ] Sign in, one-time-code entry, account menu, and sign out.
- [ ] Loading, empty, offline/cache, permission-denied, and error states.
- [ ] Browser Back/Forward and direct shared/collection links.

### Hardening checks

- [ ] Focused fields stay visible above the keyboard.
- [ ] Dismissing the keyboard restores a stable layout.
- [ ] Orientation changes retain the selected entity and valid pane state.
- [ ] Drawers and dialogs do not strand the page in a non-scrollable state.
- [ ] No critical action depends on hover or precision pointing.
- [ ] Test 200% browser zoom, larger OS text, reduced motion, focus order,
  visible focus, dialog focus trapping, accessible names, and selected/pressed
  state.
- [ ] Test dark and light themes.
- [ ] Test file upload and artwork decode on phone browsers.
- [ ] Test offline editing and background/foreground transitions.
- [ ] Compare representative card, threat, map, print, and TTS outputs with
  their pre-mobile desktop output.
- [ ] Run `npm run check`.
- [ ] Run `npm run build`.
- [ ] Record any intentional remaining limitation in user-facing copy and
  this plan.

### Release gate

- [ ] Every primary route and MVP task works at 320px without desktop mode.
- [ ] No blocker-level clipping, trapped scrolling, or keyboard-obscured
  completion action remains.
- [ ] Maps and threat tracks can be navigated without accidental mutation.
- [ ] Rich-text editing passes on physical iOS Safari and Android Chrome.
- [ ] Touch interruption cannot duplicate, lose, or partially corrupt an
  edited object.
- [ ] Desktop layouts and shortcuts remain intact.
- [ ] Representative exports match desktop output in dimensions, content,
  and geometry.
- [ ] Check and production build finish without errors or warnings.

---

## Principal risks

| Risk | Impact | Mitigation |
|---|---|---|
| Pointer capture or `touch-action` traps navigation | The author cannot scroll past a canvas | Default Navigate/Preview mode; capture only during explicit edits; always handle cancellation |
| Pan is interpreted as placement | Silent document mutation | Movement threshold; commit on pointer-up, never pointer-down |
| iOS clears rich-text selection | Formatting appears broken or applies elsewhere | Persist and restore a cloned Range; verify on physical Safari |
| Sub-16px fields trigger iOS focus zoom | Layout shifts and remains magnified | Phone-specific 16px minimum for every editable field |
| Touch CSS leaks into renderer/export | Approved output changes | Editor-only wrappers and screen/capability rules; compare exports |
| Drag writes continuously to state/storage | Jank and excessive saves | Update transient preview during gesture; commit once at completion |
| Map transforms drift at zoom | Objects land away from the finger | One viewport transform source and inverse pointer coordinates |
| Printed elements produce tiny hit regions | Existing maps/threat tracks are uneditable | Minimum CSS-pixel hit radius independent of printed geometry |
| Orientation or keyboard resize interrupts a gesture | Stuck mode or partial mutation | One cleanup path for resize, cancellation, lost capture, and backgrounding |
| Touch laptop reports a fine primary pointer | Targets stay too small | Use `any-pointer: coarse` for hit sizing and viewport/container queries for layout |
| Mobile changes reduce desktop efficiency | Existing users regress | Additive responsive rules and desktop regression checks every phase |

---

## Implementation discipline

- Keep the renderer as the export. Do not create a mobile rendering path.
- Keep mobile controls outside `.plate` and other photographed roots.
- Prefer shared primitives and capability rules over page-by-page target-size
  patches.
- Keep pane/mode state ephemeral unless there is a demonstrated reason to
  persist it outside the document.
- Do not add a runtime dependency for gestures, breakpoints, or drawers.
- Treat every direct-manipulation change as a state-integrity change, not only
  a visual change.
- Land the work in logically separated commits by phase.
- Update this document as decisions are proven, replacing stale assumptions
  instead of appending contradictory notes.

## Recommended delivery order

1. Phase 0 interaction contract and gesture prototype.
2. Phase 1 shared control foundation and Phase 2 shell work.
3. Phase 3 hierarchy/forms.
4. Phase 4 rich text.
5. Phase 5 preview/artwork and the mobile authoring MVP gate.
6. Phase 6 conventional/public pages.
7. Phase 7 Threat, proving the inspector model on the simpler spatial tool.
8. Phase 8 Maps, reusing the proven gesture and inspector patterns.
9. Phase 9 final device hardening.

Do not begin with Maps. A map-first implementation would independently solve
target sizing, gesture cancellation, inspector layout, keyboard behaviour,
and state commits that the shared controls and smaller spatial editors can
establish more safely.
