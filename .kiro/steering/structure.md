---
inclusion: always
---

# Structure and conventions

## Layout

```
public/assets/      Card chrome, served as stable offline URLs (never bundler-imported)
├─ templates/       Print frames and border masks (measured, see geometry.ts)
├─ symbols/         Attack, defense, versatile, scheme, attack-type lockups…
├─ patterns/        Body pattern shapes, recoloured by masking
└─ fonts/           Knockout-standin card-face type (Bebas/Oswald/Junior cuts)

src/
├─ lib/
│  ├─ cards/        Card templates, ability blocks, style cascade, factories
│  ├─ characters/   Character model: roles (hero/villain/minion/sidekick), stats,
│  │                abilities, hero character-card design
│  ├─ decks/        Deck model: action, initiative, rules, event/special
│  ├─ sets/         The document, pure queries, normalize/repair, health,
│  │                fork + fingerprint, contribution model
│  ├─ core/         Branded IDs, timestamps, artwork placement/grading,
│  │                image import/downscale
│  ├─ text/         Rich-text sanitiser, inline symbol tokens
│  ├─ renderer/     Card faces, measured print geometry, asset registry
│  ├─ export/       Serialisation, PNG/TTS export, the exporter registry
│  ├─ storage/      IndexedDB persistence, the set library, migrations
│  ├─ state/        Runes store, selection model, autosave, navigation
│  ├─ figures/      Miniature / figure models, the health dial
│  ├─ threat/       Threat track model
│  ├─ map/          Adventure map model: spaces, paths, board
│  ├─ models/       STL and OBJ parsing, generated token meshes
│  ├─ symbols/      Custom symbol model (author-defined inline tokens)
│  ├─ print/        Print-sheet planning and the print screen
│  ├─ cloud/        Hand-rolled Supabase HTTP: auth, publish/fork, gallery,
│  │                contributions, thumbnails — never the source of truth
│  ├─ ui/           Design-system primitives (Button, Slider, FillEditor, …)
│  └─ components/   Shell, sidebar, workspace editors, preview, home/library,
│                   cloud UI (gallery, sign-in, account), export panel, print,
│                   map/threat editors ("tools/")
└─ styles/          Tokens, card fonts, reset, utilities
```

`middleware.ts` (project root) is a Vercel Edge Middleware for `/shared/:slug`
link unfurling — self-contained, does not import from `src/lib/cloud/` because it
runs outside Vite.

## Data model

The document is four flat arrays related by ID:

```
AdventureSet ─┬─ characters
              ├─ decks   (ownerId → Character, or null for the adventure)
              └─ cards   (deckId  → Deck)
```

Plus set-level singletons: `style`, `threat`, `map`, box art, card backs. Nothing
in the four arrays is nested. Re-parenting anything is a one-field edit, every
grouping the UI shows stays **derived** rather than duplicated, and the whole
document is plain JSON — no Maps, Sets or Dates to reconstruct on load.
`src/lib/sets/queries.ts` holds every derivation.

- **Cards.** `Card` is a discriminated union over the printed templates —
  `ActionCard | InitiativeCard | RulesCard | EventCard`. Nullable combat values
  mean "not printed" is a state the type can express. A hero's `ActionCard`
  additionally carries `symbol`/`symbolValue`/`owner`. `createCard(type, deckId)`
  narrows its return type to the template requested.
- **Characters.** `role` is `'hero' | 'villain' | 'minion' | 'sidekick'`
  (`SELECTABLE_ROLES` excludes `sidekick` — it is a field on a hero, not a
  roster entity an author adds directly). A hero also carries
  `characterCard: HeroCharacterCard` (health, move, attack type, ability,
  optional `sidekick`/`quote`, band artwork and fills) — a fixed stat-sheet
  layout, not a `Card` and not routed through the style cascade.
- **Decks.** A deck outlives its owner — deleting a character unsets `ownerId`
  rather than destroying cards, and those decks surface under *Unassigned*.
- **Artwork.** A data-URL reference plus four independent blocks: `CropRect`,
  `transform`, `adjustments`, `effects`. Separate so re-cropping does not throw
  away a careful position, and each resets alone. Large images are downscaled
  through `core/image-import.ts` before they ever reach the document.
- **Origin / lineage.** `AdventureSet.origin?: SetOrigin` records where a set was
  forked from — slug, revision, author name, and a per-entity content hash
  (`fingerprint`) taken at fork time. It is the only way to later tell "this
  entity changed since the fork" with no server-side revision history. See
  `sets/fork.ts`, `sets/fingerprint.ts`, `COLLABORATION.md`.
- **IDs are branded** (`CardId`, `CharacterId`, `DeckId`, `SetId`, …), so the
  compiler rejects passing one where another is expected. A fork preserves every
  id except the set's own.

## Style cascade

```
stock template → set.style → character.style → card.style
```

Flattened by `resolveStyleForCard()`; `styleOriginForCard()` reports which layer a
value came from, which drives the editor's "from set" / "from template" hints. Each
layer above the first is a **sparse** `CardStyleOverride`, so "inherit" is the
*absence* of a key, not a sentinel.

Two things `README.md` predates:

- **The stock layer is per template.** `stockTheme(type)` returns `EVENT_CARD_THEME`
  for event cards — they are a red placard, not a slate card.
- Each template declares which surfaces it actually draws (`ACTION_SURFACES`,
  `PROSE_SURFACES`, `EVENT_SURFACES` in `cards/theme.ts`), and `StylePanel` filters
  to them. A control for something a card cannot show reads as broken, not as
  inapplicable.

Card colours are **concrete values**, never references to the app's design tokens: a
printed card must not change because the editor's theme did, and a PNG export has no
stylesheet to resolve `var(--…)` against. The hero character card is the one
exception to the cascade itself — it exposes only a border colour and three band
fills as its own small design object, because its layout is fixed rather than
templated.

## State

`src/lib/state/workshop.svelte.ts` exports a single `workshop` store built on Svelte
5 runes. `outline`, `stats`, `previewCard` and `previewTheme` are `$derived` from the
document, so nothing can drift out of sync with it. `state/navigation.svelte.ts`
holds the current view (a set page, Home, the gallery, a shared set, print…).

Because `$state` is deeply reactive, editors bind straight into the document for
field-level edits; store commands cover structural changes (create, convert,
re-parent, delete). Library and persistence commands (`createSet`, `openSet`,
`closeSet`, `removeSet`, `duplicateSet`, `saveNow`) are `async`, because IndexedDB
has no synchronous API.

Two conventions keep mutation honest:

- **Editors read their subject from the store**, not from a prop. The document is
  module-owned state, and mutating it across a prop boundary is exactly what
  Svelte's ownership warnings are for.
- **Shared child editors** (style, artwork) address their subject by a typed
  reference — `{ entity: 'card', id }`, `{ entity: 'characterBand', id, band }` —
  and mutate through store commands, so they never touch an object they were
  handed. This is also how a viewer-owned published set is drawn read-only: the
  exporters and overview components take a `set` prop and never reach into the
  store.

## Design system

`src/styles/tokens.css` is the source of truth for colour, type, space, radii,
elevation, and motion. Components use the semantic layer (`--surface-raised`,
`--text-secondary`, `--kind-attack`) rather than raw palette steps. **No component
hardcodes a hex value.** Card kinds and character roles each own a colour token.

## Writing code here

Match the surrounding code, which is deliberate about this: **comments explain *why*
a thing is the way it is** — usually the failure that forced it — and never restate
what the line does. Several files carry the history of a bug in a comment precisely
so it is not reintroduced. Follow that.

**British spelling** in prose and comments; `colour` in user-facing copy, `color`
only where a CSS or DOM API demands it.
