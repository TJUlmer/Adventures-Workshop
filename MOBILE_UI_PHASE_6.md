# Mobile UI Phase 6 — Conventional Pages and Public Flows

**Status:** Browser implementation complete; physical coarse-pointer, signed-in
collaboration, and keyboard-open evidence remains

**Completed:** 26 September 2026

**Applies to:** Set-level tools, Home and Gallery discovery, public shared sets
and collections, creator profiles, collection collaboration screens, account
and export controls, and browser print preview

This document records the implemented Phase 6 contract from
`MOBILE_UI_PROJECT.md`. It changes responsive chrome and interaction only. It
does not change the set schema, storage authority, publication model, renderer
geometry, print-sheet planning, or exported content.

## Plain-language summary

The remaining utility pages now behave like phone screens instead of squeezed
desktop screens. Overview gives a phone author a clear choice between reviewing
the set and saving or exporting it, plus a visible **Full screen** action for
giving the review the whole viewport. Components, Symbols, Analysis, and
Settings use the whole width and keep their own scrolling area. Short landscape
screens receive an extra-compact Overview header so the content itself still
has room to move.

Gallery is easier to operate with a thumb: browsing spans the available width,
search is full width, filters form a predictable compact stack, and creator,
favourite, and parent-set actions are real targets instead of tiny text. The
character-card surprise that previously depended on hover now has a **Card
preview** toggle on touch devices. The same explicit preview exists on the Home
shelf and in published collections without eagerly downloading every card.

Public shared sets retain their existing compact identity. Their masthead,
scope, zoom, jump links, full-screen view, actions, comments, fork explanation,
and export choices remain reachable at 320px. Creator profiles and collection
invitations stack cleanly, while collection-management, discussion, and
contribution rows no longer assume desktop width.

Print now keeps a useful sheet preview on screen. A small toolbar holds Back,
Options, and Print; options open in a bounded scrolling panel, and an always
visible reminder preserves the important 100% scale/background-graphics
instruction. This still leaves preview space when a phone is sideways.

## Technical log

### Set-level tools

- `OverviewScreen` keeps Review and Save/export mounted at usable dimensions,
  then switches their visibility with a 44px mobile control. This preserves
  `AssetsOverview`'s own scroll root and deferred artwork observers.
- Its Full screen action uses the same fixed in-app viewing mode as shared
  sets. It keeps the existing Overview mounted, hides the app chrome and export
  rail, preserves scroll position, and exits from the button or Escape without
  invoking the browser Fullscreen API.
- The phone Overview header uses one horizontal metrics row and compact control
  row. A short-height rule removes non-essential summary chrome in landscape.
- `FiguresPanel` stacks its header, figure fields, notes, rulebook links, source
  controls, and Tabletop Simulator actions at narrow widths. Coarse-pointer
  upload, link, and remove actions meet the shared touch target.
- `SymbolsPanel` moves each symbol's artwork/removal controls above a full-width
  field area on phones.
- `SetSettings` now responds to the workspace container rather than assuming the
  browser width, so the box-art row and action can reflow inside the shell.
- Analysis data and derivation code were not changed.

### Home, Gallery, and public identity

- Gallery uses a two-column mobile filter grid which becomes one column below
  390px. Browse, favourites, and search each occupy the full row.
- Gallery set and character rows expose a dedicated creator-profile action.
  Favourite, engagement, creator, and parent-set actions receive mobile/coarse
  sizing without changing their destinations.
- Gallery, Home, and collection character tiles each keep a separate
  `aria-pressed` **Card preview** button for touch. The preview image is still
  inserted only after hover, keyboard focus, or that explicit request.
- Creator profiles reduce padding, stack the header below 480px, and turn the
  invitation form into a bounded responsive grid.
- Welcome and Home keep their established single-column presentation; the New
  Set and New Collection flows continue to use the shared viewport-bounded
  dialog frame with one scrolling body and a reachable footer.

### Collections and collaboration

- Collection workspace link, organizer, invitation, member, and action rows
  stack below 720px; difficulty and management actions receive coarse-pointer
  target sizing.
- Discussion headings, privacy copy, thread bodies, comment actions, and form
  actions wrap deliberately. Contribution review cards and comparison renders
  stay within the phone width while actionable list chevrons remain beside their
  rows.
- Collection export group headings can wrap rather than forcing dialog width.
- The existing shared-set 700px action sheet, collection 920/700/430px
  breakpoints, independent project-tab scrolling, deep links, and lazy published
  artwork gates were retained.

### Account, export, and print

- Long account names and explanatory text can wrap inside the existing
  dynamic-viewport, independently scrolling menu.
- Collection export groups use the same narrow-dialog wrapping contract as the
  other export selectors.
- `PrintScreen` separates a persistent compact toolbar from a bounded settings
  panel. On short screens the panel owns its scroll and is capped at 35dvh.
- Paper choice, zoom, duplicate, back, printer-friendly, card-back, crop-mark,
  warning, scale-note, selection, and Print semantics are unchanged.
- `PrintSheet`, millimetre geometry, planning, scale calculations, renderer
  stages, and export modules were not edited.

## Browser evidence

The Phase 0 deterministic fixture and live public Supabase data were exercised
in the in-app Chromium browser at browser zoom 100% and a fine pointer.

At 320×568:

- Overview's review content had a 196px internal scrolling viewport after its
  compact header, while Save/export had a 349px scroll viewport and did not
  widen the document;
- the 44px Full screen action remained completely visible in the 288px control
  row, and full screen increased the Overview content viewport from 196px to
  415px in the final control configuration;
- Analysis, Components, Symbols, and Settings each remained 320px wide and
  kept one vertical content scroller;
- Home remained 320px wide with no overflowing controls;
- the New Set dialog kept one 225px scrolling body and a visible footer at the
  equivalent short-height test;
- Gallery browse/search/filter controls occupied the available 278–288px, and
  creator, engagement, and favourite actions measured 44px high;
- a live shared set exposed masthead, scope, zoom, jump links, full screen,
  actions, fork copy, export choices, and comments with no page-width overflow;
- the shared-set action sheet owned one 443px scrolling region and kept its
  44px close action reachable;
- only seven images were mounted while inspecting a live 53-design shared set,
  confirming that off-screen card artwork was still deferred;
- the account menu stayed inside the viewport and scrolled 639px of content
  within a 486px panel.

At 568×320 landscape:

- the short Overview header shrank from 131px to 61px, leaving a 72px content
  scroller plus the 44px Review/Save switch; entering full screen provided a
  259px Overview scroller;
- a full-screen shared set kept a 155px content viewport and its jump links
  reachable;
- Print left a 187px preview with options closed and a 75px preview with the
  options panel open; the open settings panel was independently scrollable.

At 768×1024, Overview preserved its two-pane tablet layout and Analysis,
Components, Symbols, and Settings all matched the 768px document width without
horizontal overflow.

Validation completed:

- `npm run check` — 0 errors and 0 warnings;
- `npm run build` — completed successfully, with only the existing ineffective
  dynamic-import and large-chunk warnings;
- Phase 0 rendered baseline geometry — all 53 files verified unchanged;
- `git diff --check` — clean apart from working-copy line-ending notices;
- 320×568, 568×320, and 768×1024 responsive checks — passed.

## Remaining device and account evidence

The in-app browser exposes a fine pointer, the test account is signed out, and
the live Gallery currently has no published collection. Physical/device or
authenticated testing therefore remains open for:

- using the **Card preview** controls with VoiceOver/TalkBack and a coarse
  pointer on Home, Gallery, and a published collection;
- opening New Set/New Collection and collection collaboration forms with the
  iOS and Android software keyboards visible;
- exercising invitations, contribution review, timeline editing, discussion,
  difficulty, Ready state, and publishing as a signed-in collaborator;
- traversing a live published collection's roster, creator credits, components,
  and Play or print path in portrait and landscape;
- completing the full physical mobile authoring smoke path through save,
  reload, publish/export, and a PNG comparison with desktop.
