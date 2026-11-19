# Future feature ideas

Captured on 17 November 2026. Status is recorded per feature below.

## Admin-only gallery metrics panel

Requested for future planning on 18 November 2026; do not implement yet.

Private view/export tracking is already deployed. Add an admin-only in-app panel
to inspect those existing measurements when useful, without opening Supabase.

- Show readable set names with their view and export totals.
- Offer month, year and all-time periods when relevant.
- Allow inspection of character activity and export scope/format breakdowns.
- Respect the existing browser-day deduplication: overlapping breakdowns must
  not be added together as though they were independent totals.
- Keep access restricted to admins. Making any counts public is a separate,
  future decision, not part of this panel.

See `PRIVATE_GALLERY_METRICS.md` for the deployed data model and counting rules.

## Visual variants of a card's copies

An implementation plan is recorded in `CARD_VARIANTS_PLAN.md`. The first release
was narrowed on 18 November 2026 to artwork and standalone symbols; broader
styling was initially excluded. The user approved
implementation; the initial version is in preview. On 19 November the user added
per-copy boost value, tuck text and badge content, with no Copies tab number badge.
That refinement is in preview as `53fa96b`. A further refinement adds ribbon
symbol size/strip fill, badge fill/opacity/content colour and tuck fill/text colour,
plus boost/ribbon symbol choices with None and shared resets. It is implemented
locally awaiting commit/deployment. Tuck orientation remains shared.

One logical card has shared content and quantity, with optional visual overrides
for individual physical copies. These are not independently editable cards linked
by title. Combat ability text stays shared; the three permitted detail fields
above are explicit exceptions.

Official examples supplied by the user:

- Little Red's **Into the Woods**: three copies with identical text and a
  different basket symbol on each; every copy prints **×3**.
- Shakespeare's **Horror**: five copies with identical text and different artwork
  on all five; every copy prints **×5**.

Scope confirmed by the user:

- Card title, name, combat ability text/values, ownership, split combat, boost
  effects and bonus attacks belong to the shared card. Boost value, tuck effect
  text and corner badge content may differ by copy; other content stays shared.
- Individual copies may override artwork and designated symbols, such as the
  basket symbols in the example. Basket symbols can matter to play, so this is
  an explicit permitted variation rather than a promise that every visual change
  is mechanically irrelevant. Do not infer permission to vary combat values or
  combat type.
- A Gallery-style **Show all copies** toggle expands the card into its individual
  copies for viewing and visual editing. The collapsed view shows one card with
  its total quantity. The preview toggle must not change actual deck contents.
- Physical counts and printed totals remain separate: three copies produce three
  physical cards, not nine, with **×3** on each face.
- Existing cards with no copy overrides continue to use the same design for
  every copy. Clearing an override returns that copy to the shared design.

The implementation plan records the selected controls, quantity retention rules
and copy 1 as the representative for the collapsed preview.

## View previous card versions

Let an author look back at earlier builds or iterations of an individual card.
The initial request is to view past versions; comparing or restoring a version
are possible extensions to discuss separately.

This needs durable card history distinct from session-only Undo/Redo and from
the current published snapshot. Superseded publication assets should not be
assumed to provide a reliable history.

Storage approaches to investigate:

- User-created checkpoints or a bounded number of automatic snapshots, rather
  than saving every keystroke forever.
- Store changed card data and reuse unchanged artwork where practical.
- Retain any artwork and other rendering inputs needed by an old version;
  text-only history cannot reproduce artwork that has been deleted.
- Decide whether history is device-only or synced, its retention and storage
  limits, and how the author exports or removes it.

Recording this idea does not change existing revision retention or cleanup.

## Feasibility assessment — 17 November 2026

### Card variants: feasible, moderate scope

The confirmed visual-only scope fits one existing card record with shared content
and quantity, plus sparse overrides for copies. The exact persisted structure is
still to be designed. Normalization would supply no overrides for existing cards.

The renderer would receive the shared card resolved with a selected copy's visual
overrides. Print sheets and Tabletop Simulator would expand physical copies with
their individual appearances while every face retains the shared printed count.
PNG export and gallery previews would need to expose the distinct appearances
instead of assuming one rendered face per card. Their cache keys and fingerprints
would also need to distinguish copies and invalidate after shared content edits.

The editor needs shared content controls, copy-specific visual controls, and an
expanded preview. Quantity changes must not silently discard authored copy art.
Deck analysis should continue counting the logical card and its physical quantity
without mistaking visual copies for new rules-text cards; any future analysis of
per-copy basket symbols would need the resolved copy data.

This replaces the earlier suggestion of independently editable linked records.
It remains moderate scope because every output must agree about copy identity,
appearance and quantity, but the restriction prevents shared text from drifting
between copies and avoids a general-purpose content-override system.

### Card history: feasible, with two different scopes

**A view-only checkpoint gallery is the smaller option.** An explicit Save version
action can capture the card through the existing image exporter, with a timestamp
and optional note. That picture preserves the appearance at capture time, including
the font, inherited design and artwork. It does not need the old published set or
original artwork to remain available. Keep a bounded number or byte budget of
these images. This supports looking back, but cannot restore editable fields.

**Editable snapshots are a larger persistence feature.** Store the card data and
the rendering context it depends on, such as inherited styles, character names
and custom symbols. A card record alone is insufficient to reconstruct a past
appearance. Retaining editable inputs still does not freeze the renderer itself;
an archived image is needed if exact historical appearance matters.

Current IndexedDB documents are serialized JSON with embedded artwork, so writing
whole documents repeatedly would duplicate image data on disk. The in-memory
sharing used by Undo/Redo does not solve that persistence cost. Efficient editable
history would need reusable asset storage and retention tracking. Cloud asset
hashing offers a reusable starting point, but cleanup must explicitly protect
history-owned assets; existing cleanup only knows its existing live references.

Start with local, explicit visual checkpoints if viewing is the goal. Synced
history adds private storage, authorization, offline synchronization, quota and
cleanup work. Neither option can recover versions already discarded, except from
copies or backups that still exist. Device-only history would remain on the
device unless explicitly included in exports or later synchronization.

Recommended order: card variants, then view-only checkpoints; consider editable
and synced history separately if those capabilities are wanted. This assessment
does not authorize implementing either feature.
