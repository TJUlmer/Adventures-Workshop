# Card visual variants — implementation plan

Planned and approved on 18 November 2026; initial implementation deployed to preview
as `3de5300`. Scope refined on 19 November: allow boost value, tuck text and corner
badge content overrides, and keep the Copies tab understated without a number badge.
Those refinements were deployed to preview as `53fa96b`. A further 19 November
refinement adds a boost symbol row above boost, full ribbon symbol choices,
ribbon size/strip fill, badge fill/opacity/content colour and tuck fill/text colour.
This styling refinement is implemented locally awaiting commit/deployment. Tuck
orientation and other shared special effects remain unchanged.

## Implementation

- Action cards have a **Copies** tab with one selector per physical copy.
  Content and Design edit the shared card; Copies edits main artwork and eligible
  standalone uploaded symbols, boost value, tuck text and badge content. Clearing
  an override restores shared values. Effect visibility, placement and tuck
  orientation stay shared. The seven permitted style fields inherit individually.
- Quantity reductions that would discard customized copies ask which to retain.
  The quantity change and retained-copy reindexing use the existing Undo/Redo.
- Overview/gallery can show every physical copy. The collapsed view uses copy 1.
  PNG archives contain one file per distinct appearance and a copy allocation guide;
  print and TTS preserve the true deck quantity and shared printed ×N.
- Document schema is 81; publication renderer version is 17. Nested copy artwork
  uses the existing structural asset extraction/hydration, and preview manifests
  accept copy-qualified keys. No database migration is required.
- Verified with synthetic hero, villain and minion cards, including three symbols
  and five artwork variants, persistence/JSON normalization, Undo/Redo, quantity
  retention, image exports, print/TTS planning and publication cache invalidation.

## Confirmed behaviour

One logical action card owns its title, name, combat ability text/values, combat
type, split combat, boost effects, bonus attacks, ownership and quantity. Physical
copies may differ in artwork, standalone symbols, boost value, tuck text and corner
badge content. They are not separate cards joined by matching titles.

The initial scope was **artwork and standalone symbols**, then expanded to the
three permitted detail fields above, then the restricted symbol/badge/tuck style
controls. General card styling, patterns and extra artwork layers remain shared.

Acceptance examples supplied by the user:

- Little Red's Into the Woods: one card, quantity three, identical text, three
  different basket symbols; every face prints **×3**.
- Shakespeare's Horror: one card, quantity five, identical text, five different
  artworks; every face prints **×5**.

Deck analysis sees one logical card and its actual quantity. Neither case may
inflate the physical count when printed or exported.

## Recommended first-release boundaries

- Support `ActionCard` for heroes, villains and minions wherever the relevant
  artwork/symbol control already exists. Keep other templates, character cards
  and deck backs unchanged.
- Per-copy artwork includes the main image, crop, transform, adjustments and
  effects. These are image controls; shared card fills and patterns stay shared.
- Boost offers None and uploaded symbols above its numeric value. Ribbon offers
  None, the shared editor's built-in choices and uploaded symbols, plus size and
  strip fill. No preconfigured shared icon is required. Ribbon visibility and
  position stay shared. Existing ID-only symbol overrides remain compatible.
- Ribbon/boost symbol fields accept single valid icon tokens, not arbitrary text.
  Corner badges have a text/icon editor, including badges containing text.
  Text-embedded icons in names/combat rules remain shared.
- Combat symbols/values, titles, names, combat ability text, split combat, boost
  effects, bonus attacks and ownership cannot be overridden. Boost value, tuck
  effect text and corner badge content can be overridden. Tuck bar fill/text colour
  and badge background fill/opacity/content colour can differ; tuck orientation,
  other styling and effect visibility stay shared. Boost analysis uses physical
  copy values and symbol choices.
- Keep extra artwork layer structure/content and whole-card replacement images
  shared initially. Whole-face copy replacements would bypass shared text and
  values, so they must not become an escape hatch in the copy editor.
- No card history, automatic grouping by title, independent combat rules text or
  per-copy deck backs in this feature.

These boundaries cover the two requested examples. Per-copy overlay artwork or
broader styling can be considered separately if needed.

## Data model and invariants

Keep `ActionCard.quantity` as the single physical count and the printed ×N value.
Add a sparse `copyVisuals` array to the action card. Each entry addresses a
one-based physical copy position and contains only permitted visual overrides.

Illustrative shape, to finalize during implementation:

```ts
interface ActionCardCopyVisual {
  copy: number;
  artwork?: ArtworkInit;
  symbols?: Partial<Record<StandaloneSymbolSlot, CustomSymbolId>>;
  boostSymbol?: string;
  ribbonSymbol?: string;
  style?: CardCopyStyle; // Restricted to the seven approved style keys.
  boost?: number | null;
  tuckEffect?: string;
  cornerBadge?: string;
}

// ActionCard.copyVisuals: ActionCardCopyVisual[]
```

- An absent entry/key inherits the shared card. Existing documents normalize to
  an empty array. Clearing a visual override deletes the key and restores that
  inheritance; do not fill absent keys with defaults.
- Artwork merging must preserve inherited source/crop/transform fields that the
  copy has not changed. Do not call `createArtwork(overrides)` alone and thereby
  replace shared artwork settings with factory defaults. Couple source and label
  changes so the displayed filename remains meaningful.
- Copy identity is `(card.id, copy position)`. Ordinary inherited copies do not
  require extra persisted entities or IDs. Editing artwork does not change that
  identity. Copy positions change only through an explicit quantity operation.
- Store commands and normalization whitelist fields. Never use a general
  `Partial<ActionCard>` override or blindly spread imported objects over a card.
- Normalize positive integral copy positions, repair duplicate positions
  deterministically, sanitize allowed fields, and reject entries outside the
  physical quantity. Normalization must be idempotent.
- Document schema moved 78 → 79 for visuals, 79 → 80 for permitted details,
  and 80 → 81 for symbol choices and the restricted style layer,
  because an older editor would silently discard copy visuals. Cover JSON
  import/export and private cloud drafts, not just new-card creation.

## Editor and quantity behaviour

1. Keep Content and Design edits attached to the shared logical card. Editing
   its title/rules updates every copy.
2. Add a Copies section with thumbnails labelled Copy 1 of N, Copy 2 of N, etc.
   Selecting one opens its artwork, eligible symbols and permitted detail fields. The large
   preview shows that resolved copy. Mark inherited values and provide reset
   controls for artwork, individual symbols, each detail and the entire copy.
3. Selecting a copy never duplicates a card or changes quantity. Retain a clear
   route back to shared content/design. Text direct-edit targets must route to
   the shared editor rather than opening a copy-specific text field.
4. Increase quantity by adding inherited copies. Do not duplicate the last
   customized appearance automatically.
5. If reducing quantity would remove customized copies, show a thumbnail chooser
   for the copies to keep before applying the change. Reindex the kept copies
   and update quantity/visuals together as one undoable action. Ordinary quantity
   reductions that discard no custom data keep the current simple interaction.
6. Duplicate logical cards with deep-copied visual configuration. Follow existing
   fork/copy ID rules and reuse immutable artwork strings; editing a duplicate
   must not mutate its source.

Use typed copy references and store commands, such as
`{ entity: 'card-copy', cardId, copy }`, for copy artwork. Editors read their
subject from `workshop`, not from a resolved preview clone. Extend only the
relevant artwork/edit-address paths, keeping text/style targets shared. Copy
selection is session state. Use the existing Undo/Redo history; add no second
history and no persisted checkpoints.

## One resolution path

Add a pure helper module, proposed as `src/lib/cards/copy-visuals.ts`, providing:

- Physical copy references: exactly N entries for quantity N.
- A resolved render subject for one copy, containing the original card ID,
  shared content and quantity, with only allowed visual fields substituted.
- The visual appearances used by a card, with identical appearances reusable
  where the existing output renders a design only once.
- A representative face: physical copy 1, including its overrides.

Keep resolution separate from physical expansion. A resolved face still prints
the shared quantity; it must never be expanded by that quantity a second time.
Resolve through the same helper in every preview and export. Keep the existing
stock → set → character → deck → card style cascade unchanged.

## Previews, printing and exports

| Surface | Required behaviour |
|---|---|
| Collapsed overview/gallery | One tile per logical card, showing copy 1; indicate alternate appearances are available. |
| Show every copy | Exactly N tiles with each copy's appearance and a Copy i of N caption. |
| Reading lightbox | Open and navigate the actual selected copy, preserving its front/back pairing. |
| PNG archive | One image per distinct used appearance; retain current single-image behaviour for ordinary cards. Use copy-aware filenames and describe copy allocations in the archive README. |
| Print with quantities | Exactly N physical fronts with correct appearances and existing deck backs. |
| Print without duplicate quantities | One of each used appearance, including alternate artworks; label this behaviour clearly. |
| Tabletop Simulator | Exactly N cards, assigned the correct face/sprite and the existing deck back. |
| Collection exports | Use the same copy expansion and face resolution as individual exports. |
| Project files/forks/contributions | Preserve the single card and all permitted visual configuration. |

The existing `AssetsOverview` toggle already expands quantity, but currently
reuses the same face for every tile. Extend its copy address and the
`GalleryCardItem`/`CardLightbox` flow rather than introducing another viewer.
Interactive thumbnails must select the copy, not only `card.id`.

TTS render identity currently uses the logical card ID, so it must include the
copy appearance/address. Otherwise all copies can incorrectly reuse the first
image even when physical expansion is correct. Keep physical copies separate
from any identical-image reuse in the atlas.

## Publishing and compatibility

- Extend `CardPngJob` and the shared `cardPngRenderJob()` projection to carry a
  copy address/resolved appearance. PNG files and gallery pictures must continue
  to use that same renderer input.
- Retain the existing default preview key as the copy-1 representative for
  compatibility; add stable copy-aware keys for additional faces. Identical
  appearances may reference the same uploaded image.
- Fingerprint the resolved subject, quantity, symbol assets, inherited style,
  side and format. Shared text/quantity changes must invalidate every affected
  appearance; one copy's art change must not reuse its old bitmap.
- Bump `CARD_PREVIEW_RENDERER_VERSION` and make published copy previews available
  to both the overview and reading lightbox. Never substitute a fresh live face
  for missing authoritative published pixels.
- Asset extraction walks documents generically and already deduplicates images
  by hash. Verify that nested copy artwork survives upload, hydration, cleanup
  reference scans, export and contribution acceptance.
- Existing manifest validation appears to allow additional nonempty keys, so no
  SQL migration is expected. Verify that assumption against the actual publish,
  refresh and cleanup paths before deciding one is unnecessary.
- Unchanged older sets must look and export as before. A stale editor must refuse
  the new schema rather than remove copy visuals on save. Test preview publication
  with disposable unlisted data while production still runs the older schema.

## Implementation sequence

1. **Model and resolver:** schema/normalization, pure helpers, typed references,
   store commands, quantity handling and duplicate/fork semantics.
2. **Authoring:** copy selector, inherited artwork controls, symbol substitution,
   resets and direct-edit routing. Keep shared Content/Design behaviour intact.
3. **Preview inspection:** actual copy resolution in the live preview, expanded
   overview, representative thumbnails and reading lightbox.
4. **Physical outputs:** PNG appearance jobs, print pairings, TTS face identities
   and collection paths. Verify all counts before considering the feature done.
5. **Published outputs:** copy-aware manifests, cache fingerprints, asset round
   trips, version updates and documentation.
6. **Verification and release:** complete the scenarios below, run check/build,
   deploy a preview for review, then promote the reviewed complete feature.

These are internal milestones of one feature, not separate partial production
releases. No implementation or deployment has been requested by this plan.

## Acceptance checks

Use disposable fixtures and the actual browser/exporter; do not add a test runner.

- Three Into the Woods copies: identical content, different basket icons, ×3 on
  each face, exactly three cards in print/TTS and one logical analysis entry.
- Five Horror copies: five artworks, ×5 on each, correct PNG images, print fronts,
  gallery expansion and TTS sprite assignment.
- Mixed inherited/customized copies: clearing a copy restores shared visuals;
  shared art changes reach only fields that still inherit.
- Shared text/value edits update all faces; copied/imported visual overrides
  cannot introduce title, ability, combat-type, ownership or quantity overrides.
- Increase/decrease quantity, choose kept visuals, Undo/Redo, duplicate the card,
  move its deck, save/reload and export/import without data loss or count drift.
- Resolve single copies without expanding them again. Verify ordinary ×3 cards
  still produce one PNG design and three physical printed/TTS cards.
- Check collapsed/expanded gallery and lightbox navigation, including keyboard
  focus, touch operation, correct copy labels and inherited deck backs.
- Publish, refresh, republish one changed copy, then change shared text. Confirm
  no stale preview reuse and that collection outputs match individual outputs.
- Cover missing/deleted symbol assets, default artwork, portrait action cards,
  split/optional action effects, and hero/villain/minion layouts.
- Confirm deck statistics and private export metrics still describe real cards
  and completed exports, with no extra events for viewing copy thumbnails.

`npm run check`, `npm run build` and `git diff --check` remain the release gates.
