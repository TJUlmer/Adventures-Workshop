---
inclusion: always
---

# Structure and conventions

## Layout

```
public/assets/      Card chrome, served as stable offline URLs (never bundler-imported)
├─ templates/       Print frames and border masks (measured, see geometry.ts)
├─ symbols/         Attack, defense, versatile, scheme…
├─ patterns/        Body pattern shapes, recoloured by masking
└─ fonts/           Knockout HTF card-face type

src/
├─ lib/
│  ├─ cards/        Card templates, ability blocks, style cascade, factories
│  ├─ characters/   Character model: roles, stats, abilities
│  ├─ decks/        Deck model: action, initiative, rules, special
│  ├─ sets/         The document, plus pure queries over it
│  ├─ core/         Branded IDs, timestamps, artwork placement and grading
│  ├─ text/         Rich-text sanitiser, inline symbol tokens
│  ├─ renderer/     Card faces, measured print geometry, asset registry
│  ├─ export/       Serialisation, the exporter registry, downloads
│  ├─ storage/      localStorage persistence
│  ├─ state/        Runes store, selection model, autosave
│  ├─ figures/      Miniature / figure models
│  ├─ threat/       Threat track model
│  ├─ models/       STL and OBJ parsing, generated token meshes
│  ├─ ui/           Design-system primitives (Button, Slider, FillEditor, …)
│  └─ components/   Shell, sidebar, workspace editors, preview
└─ styles/          Tokens, card fonts, reset, utilities
```

## Data model

The document is four flat arrays related by ID:

```
AdventureSet ─┬─ characters
              ├─ decks   (ownerId → Character, or null for the adventure)
              └─ cards   (deckId  → Deck)
```

Nothing is nested. Re-parenting anything is a one-field edit, every grouping the UI
shows stays **derived** rather than duplicated, and the whole document is plain JSON
— no Maps, Sets or Dates to reconstruct on load. `src/lib/sets/queries.ts` holds
every derivation.

- **Cards.** `Card` is a discriminated union over the printed templates —
  `ActionCard | InitiativeCard | RulesCard | EventCard`. Nullable combat values mean
  "not printed" is a state the type can express. `createCard(type, deckId)` narrows
  its return type to the template requested.
- **Decks.** A deck outlives its owner — deleting a character unsets `ownerId`
  rather than destroying cards, and those decks surface under *Unassigned*.
- **Artwork.** A data-URL reference plus four independent blocks: `CropRect`,
  `transform`, `adjustments`, `effects`. Separate so re-cropping does not throw away
  a careful position, and each resets alone.
- **IDs are branded** (`CardId`, `CharacterId`, `DeckId`, `SetId`), so the compiler
  rejects passing one where another is expected.

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
stylesheet to resolve `var(--…)` against.

## State

`src/lib/state/workshop.svelte.ts` exports a single `workshop` store built on Svelte
5 runes. `outline`, `stats`, `previewCard` and `previewTheme` are `$derived` from the
document, so nothing can drift out of sync with it.

Because `$state` is deeply reactive, editors bind straight into the document for
field-level edits; store commands cover structural changes (create, convert,
re-parent, delete).

Two conventions keep mutation honest:

- **Editors read their subject from the store**, not from a prop. The document is
  module-owned state, and mutating it across a prop boundary is exactly what
  Svelte's ownership warnings are for.
- **Shared child editors** (style, artwork) address their subject by a typed
  reference — `{ entity: 'card', id }` — and mutate through store commands, so they
  never touch an object they were handed.

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
