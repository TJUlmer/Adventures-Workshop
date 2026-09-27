# Mobile UI Phase 8 — Map Mobile Workspace

**Status:** Browser implementation complete; physical multi-touch/cancellation
and a fresh phone-versus-desktop raster comparison remain

**Completed:** 27 September 2026

**Applies to:** Map viewport and modes, deliberate placement and movement,
selection and inspectors, touch hit regions, multiple-map state, Undo, artwork
view, and export isolation

This document records the implemented Phase 8 contract from
`MOBILE_UI_PROJECT.md`. It changes responsive authoring and gesture ownership
only. It does not change the set schema, persistence authority, map model,
printed geometry, renderer, or export dimensions.

## Plain-language summary

The map editor now opens in a safe **Navigate** mode. A swipe moves the view and
the zoom controls enlarge it without changing the map. Adding or moving
something requires choosing **Add** or **Move** first, so an ordinary scroll or
exploratory drag is not treated as map data.

Spaces have generous tap areas regardless of how small they print. There is a
visible multi-select mode with a count and Clear action, Link explains which
endpoint comes next, and Undo is always in the page header. Text and scenery use
the same deliberate selection-and-Move pattern.

On a phone or tablet, the selected item's full editor sits immediately beneath
the map. Environment/text lists and board-wide settings follow it in the same
visual and keyboard order. The desktop keeps a three-column workspace, with the
selected inspector beside the map.

**Artwork view** is now genuinely non-editing: it hides construction ink,
removes map hit targets, disables the remaining map-changing toolbar actions,
and makes the inspectors and board settings inert. Pan and zoom remain available
for looking closely, and Export remains available.

Changing maps—or even opening a duplicated set whose map IDs were deliberately
preserved—clears unfinished gestures and selections. Slow artwork, pattern, and
environment imports are tied to both the set and map that started them, so they
cannot finish later in a different copy.

## Technical log

### Modes and visible actions

- Five explicit modes replace implicit desktop gestures: Navigate, Spaces,
  Link, Text, and Environment. Navigate is the initial and post-switch mode.
- Space and text placement arm one tap and commit only on pointer-up below the
  shared movement threshold. Dragging keeps the action armed and creates no
  entity.
- Space, text, and environment movement begin only after the inspector's Move
  action. The store opens a history transaction only after pointer capture
  succeeds; commit produces one Undo step, while every cancellation path
  restores the immutable starting snapshot.
- Link keeps its first endpoint visible in a status message, exposes Cancel,
  toggles an existing pair, and clears the endpoint on completion, mode change,
  map change, or disappearance of that space.
- Spaces exposes Select multiple, a live selection count, Clear, a visible
  Undo action, and full space/path/secret-passage controls in the inspector.

### Pointer lifecycle and viewport transform

- The board has one translate/scale transform. Pointer coordinates are derived
  from the transformed board rectangle, including the map convention that both
  model axes are measured in board-width units.
- Entity hit targets are editor-only, inverse-scaled overlays with a 44px
  minimum screen footprint. Printed diameter and export geometry are unchanged.
- `startPointerSession` now lets a surface that owns multi-pointer arbitration
  defer automatic second-pointer cancellation. `MapEditor` records the second
  contact, cancels an authoring session, then promotes both contacts to the one
  pinch gesture without losing the first pointer.
- A second pointer outside the viewport—including the floating zoom controls—
  cancels an active authoring move. Escape, blur, page hiding, visibility loss,
  resize, orientation change, lost capture, mode change, map change, and unmount
  share the same rollback lifecycle.
- Undo also reclamps the view after a restored size/aspect change, so zoomed
  offsets cannot remain outside a resized board.

### Responsive inspectors and ordering

- At 900px and below the DOM and grid order are both map, selected inspector,
  environment/text lists, then Board/Zones. Keyboard focus therefore follows
  the same route the page draws.
- The selected inspector is full column width with no nested mobile scroller.
  Space/path options, text controls, and environment position/size/rotation/
  opacity/order actions remain reachable in normal page scroll.
- At wide desktop sizes the same source order becomes map, selected inspector,
  and visual-layer list across three columns, with Board/Zones beneath the map.
- Mode, placement, unlink, palette, colour, corner, ordering, and zoom controls
  use 44px coarse-pointer hit dimensions without enlarging desktop-only chrome.

### Map identity and asynchronous work

- Transient state resets against the combined set ID and map ID. This matters
  because a fork preserves every entity ID, including map IDs.
- Custom-size measurement, artwork import, zone-pattern import, and environment
  import each have independent operation generations. A newer request cancels
  only older work of the same kind.
- Artwork imports always measure the chosen image, then apply its aspect only if
  the map is still Custom when the read completes. Changing size no longer
  discards the image itself.
- Environment replacement state is operation-scoped, so an older import cannot
  clear a newer Replace request and accidentally turn it into Add.
- A built-in/None pattern choice or later zone recolour invalidates a pending
  custom-pattern read, and completion also verifies that the colour still
  belongs to a space. Environment replacement likewise revalidates that its
  target still exists; deletion cancels it, while a newer manual layer name is
  preserved. The imported asset still lands if the author moves elsewhere,
  but completion only auto-selects it when no newer mode/selection interaction
  has occurred.
- Every async completion checks the originating set and map, and all generations
  are invalidated on Undo, map/set change, artwork view, and component teardown.

### Renderer and export boundary

- `MapBoard` remains the sole printable renderer. The viewport, transform,
  hit targets, selection rings, construction numbers, and inspectors all live
  outside it.
- No file under `src/lib/renderer/` or `src/lib/export/` changed in Phase 8.
- Artwork view is transient editor state. It does not write `showSpacesAndPaths`
  or any other persisted visibility flag.

## Browser evidence

The deterministic Phase 0 fixture was exercised in the in-app Chromium browser
at browser zoom 100% and a fine pointer.

At 390×844:

- the document had 0px horizontal overflow;
- the map viewport measured 322×223.1px and every zoom control measured 44×44px;
- all five measured space targets, the placed-text target, and the environment
  target measured 44×44px;
- map, inspector, visual-layer list, and Board/Zones appeared in the same DOM
  and visual order; the empty inspector measured the full 322px column width;
- Select multiple produced `2 selected`, marked both targets, and enabled Clear;
- with Add space armed, a 60×50px drag created 0 spaces and left Add armed; a
  tap created exactly 1 space and Undo returned the document from 6 spaces to 5;
- dragging selected space A without Move left `(0.16, 0.17)` unchanged; explicit
  Move changed it to `(0.281875, 0.41375)`, and Undo restored the exact original;
- at 135% zoom, a tap whose inverse-transformed point was
  `(0.8240740741, 0.2879484671)` stored exactly those coordinates, then Undo
  restored the fixture;
- Navigate changed only the board transform—from the centred 135% transform to
  `translate(-1px, -77.35px) scale(1.35)`—while spaces, text, environment, and
  paths remained byte-for-byte equal in the DOM snapshot;
- Link showed first/second-endpoint guidance and Cancel, reset after a mode
  round trip, toggled the chosen existing path, and Undo restored it;
- Text and Environment each exposed a 44px target and the corresponding
  full-width selected inspector directly below the viewport;
- Artwork view left all sampled document entities unchanged, removed every map
  hit target, made Board/Zones and both inspectors inert, and disabled Undo,
  Add Map, map enablement, artwork replacement, and persisted view toggles.

At 768×1024:

- the document again had 0px horizontal overflow;
- the viewport measured 676×467.7px and the zoom controls remained 44×44px;
- the inspector, environment/text list, and Board/Zones each measured the full
  676px column and appeared in matching DOM/visual order beneath the map.

At 1280×900:

- the page retained 0px horizontal overflow;
- the map, selected inspector, and visual-layer column measured 356px, 440px,
  and 360px respectively and shared the same top edge;
- Board/Zones remained beneath the map, preserving the desktop workspace.

The live Export PNG control returned to its ready state without an in-app
error, but the in-app browser did not surface its generated download event, so
this report does not claim a newly captured PNG. Structural and stored evidence
remains strong: no renderer/export source changed, all 53 Phase 0 baseline
geometries verify, and the stored 1637×1131 map baseline retains SHA-256
`E6D242AC09A5D7754529925E26EE4A69F414CD316E86733B3048529DFC8D89A1`.

Validation completed:

- `npm run check` — 0 errors and 0 warnings;
- `npm run build` — completed successfully, with only the existing ineffective
  dynamic-import and large-chunk warnings;
- `node tools/mobile-baseline/evidence.mjs verify --geometry-only` — all 53
  stored baseline files verified;
- `git diff --check` — clean apart from working-copy line-ending notices;
- 390×844, 768×1024, and 1280×900 responsive checks — passed.

## Remaining physical and raster evidence

The in-app browser exposes a fine pointer, so physical iOS Safari and Android
Chrome evidence remains open for:

- genuine two-finger pinch and one-finger page-scroll versus board-pan
  arbitration;
- touch-only creation, editing, movement, ordering, removal, and Undo for every
  map entity and zone control;
- cancellation and exact rollback during a second contact, rotation,
  backgrounding, lost capture, or map switch;
- software-keyboard reachability for text and label fields;
- touch-only switching between two populated maps;
- a fresh map PNG rendered from the same document on phone and desktop and
  compared for content and pixels without replacing the stored Phase 0 files.
