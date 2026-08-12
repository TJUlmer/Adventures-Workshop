# Adventures Workshop

A local-first builder for custom **Unmatched Adventures** sets — villains, minions,
initiative decks, and the cards that go with them.

Everything runs in the browser. There is no backend, no account, and no network
call: the open document lives in `localStorage` and leaves the machine only when
you export it yourself.

## Getting started

```bash
npm install
```

```bash
npm run dev
```

| Script            | What it does                                    |
| ----------------- | ----------------------------------------------- |
| `npm run dev`     | Vite dev server with HMR on `:5173`             |
| `npm run build`   | Typecheck, then a production build into `dist/` |
| `npm run preview` | Serve the production build locally              |
| `npm run check`   | `svelte-check` over the whole project           |

> **TypeScript note.** `svelte-check` does not yet run on TypeScript 7, so the
> project pins `typescript@~6`. Move the pin when `svelte-check` catches up.

## The shell

Three panes, each with one job:

- **Left — set hierarchy.** Villains, Minions, Initiative, Rules and Events, with each
  character's decks nested beneath it. An *Unassigned* group appears only when a
  deleted character leaves decks behind.
- **Centre — workspace.** The editor for whatever is selected: a card, a
  character, or the set itself.
- **Right — preview.** The selected card, rendered by the same component that
  will drive image and print export. Zoom, a cut-line overlay, and a
  difference-blend comparison against the print template.

## The card editor

Two tabs rather than one long scroll:

- **Content** is what you touch on every card — name, copies, combat values,
  ability text.
- **Design** is what you set once — artwork placement and grade, then the
  surfaces, ink, pattern and texture.

A few decisions worth knowing about:

- **A combat value's symbol is its on/off switch.** `attack: null` means the
  card does not print an attack at all, so adding or removing a defense value is
  one click, not a checkbox plus a field. Scroll or arrow-key over the number to
  change it.
- **Timed ability blocks appear only when used.** Immediately, During Combat and
  After Combat are added from chips in the section header and always print in
  that fixed order, so the editor stays as short as the card actually is.
- **Symbols are tokens.** The palette inserts `{{attack}}` at the caret; the
  renderer swaps in the print-resolution PNG. The stored text stays plain and
  searchable.
- **Sections are hairlines, not boxes.** Nesting panels inside panels is what
  makes an editor feel busy; the hierarchy here comes from type and spacing.

## The card renderer

The printed chrome is the real template art — `outer_border.png`,
`inner_border.png`, `banner_fill.png`, `boost_fill.png`, the initiative and
rules frames — used as **CSS alpha masks** over a colour or gradient. The shapes
stay exactly as drawn while the frame, ribbon, divider and boost disc take any
fill, which is what makes the border customisable without redrawing it.

Everything else is positioned from `renderer/geometry.ts` in **bleed pixels**
(1632 × 2222 for action cards; the initiative and rules templates carry their
own sizes). Those numbers were read off the alpha channel and ink of the print
templates, not estimated: the interior window, the divider run, the banner
taper, the symbol boxes, the ability text block. Positions convert to
percentages and sizes to `cqw`, so the same markup is correct at a 120px
thumbnail and at 300 DPI.

Three of those measurements are a **default rather than a constant**, because
the card has to fit copy of any length. The name ribbon is as long as the name,
the body panel is as tall as its copy — rising *over* the art window, never
past `ART_WINDOW.minHeight` — and the rule between the values and the copy is
as long as the taller of the two. The artwork keeps its full window throughout:
the panel covers it rather than resizing it, so an image is never rescaled by
something the author did not touch. All three fall out of ordinary flex layout
rather than being computed, which is why nothing measures text at runtime: the
type is set in a vertical writing mode so its length is its box's height, and
the panel is bottom-anchored so growing it moves the divider. Art that has shape
where it stretches — the pennant point, the split separator — is sliced out of
its file at natural size and placed, never scaled.

Text is placed by **cap height**, not by CSS box: `capTopToBoxTop()` converts a
measured ink position into a `top`, using the Knockout faces' real metrics
(cap 0.67em, ascent 0.84em). That is why the title, values, ability copy and
quantity land on the template's positions to the pixel.

Set health — what "Playable, still rough" means and every check behind it — is
written up in [SET-HEALTH.md](SET-HEALTH.md), which is where to go to retune
what counts as a blocker.

## Project structure

```
public/assets/      Card chrome, served as stable offline URLs
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
│  ├─ ui/           Design-system primitives (Button, Slider, FillEditor, …)
│  └─ components/   Shell, sidebar, workspace editors, preview
└─ styles/          Tokens, card fonts, reset, utilities
```

### Data model

The document is four flat arrays related by ID:

```
AdventureSet ─┬─ characters
              ├─ decks   (ownerId → Character, or null for the adventure)
              └─ cards   (deckId  → Deck)
```

Nothing is nested, so re-parenting anything is a one-field edit, every grouping
the UI shows stays *derived* rather than duplicated, and the whole document is
plain JSON — no Maps, Sets or Dates to reconstruct on load.
`src/lib/sets/queries.ts` holds every derivation.

**Cards.** `Card` is a discriminated union over the printed templates —
`ActionCard | InitiativeCard | RulesCard | EventCard`. An action card carries an attack
value, a defense value, or both, each nullable so "not printed" is a state the
type can express. An initiative card carries its variant (card or effect),
subject (villain or minion), Right Now and End of Round copy. A rules card
carries a heading and sanitised rich text. `createCard(type, deckId)` narrows
its return type to the template requested.

**Decks.** A character owns as many decks as it needs; the adventure itself owns
the initiative deck. A deck outlives its owner — deleting a character unsets
`ownerId` rather than destroying the author's cards, and those decks surface
under *Unassigned* in the sidebar.

**Artwork.** A local reference (data URL) plus four independent blocks: a
normalised `CropRect` over the source, a `transform` (scale, offset, rotation,
mirror), non-destructive `adjustments` (brightness, contrast, saturation, hue,
greyscale, sepia), and `effects` (edge mask and vignette). They are separate so
re-cropping does not throw away a careful position, and each can be reset alone.

**Style.** Every card's look resolves through a four-layer cascade:

```
stock template → set.style → character.style → card.style
```

Each layer above the first is a sparse `CardStyleOverride`, so "inherit" is the
*absence* of a key, not a sentinel. `resolveStyleForCard()` flattens it and
`styleOriginForCard()` reports which layer a value came from, which is what the
editor's "from set" / "from template" hints display.

A theme is built from `Fill`s — solid or two-stop gradient — for the frame,
ribbon, body, artwork bed and boost disc, plus flat inks, a masked body pattern,
and a card-wide texture. Card colours are concrete values rather than references
to the app's design tokens: a printed card must not change because the editor's
theme did, and a PNG export has no stylesheet to resolve `var(--…)` against.

IDs are branded (`CardId`, `CharacterId`, `DeckId`, `SetId`), so the compiler
rejects passing one where another is expected.

### State

`src/lib/state/workshop.svelte.ts` exports a single `workshop` store built on
Svelte 5 runes. `outline`, `stats`, `previewCard` and `previewTheme` are all
`$derived` from the document, so nothing can drift out of sync with it.

Because `$state` is deeply reactive, editors bind straight into the document for
field-level edits; the store's commands cover structural changes (create,
convert, re-parent, delete) that a form cannot express.

Two conventions keep mutation honest:

- Editors read their subject from the store rather than receiving it as a prop.
  The document is module-owned state, and mutating it across a prop boundary is
  exactly what Svelte's ownership warnings are for.
- Shared child editors (style, artwork) address their subject by a typed
  reference — `{ entity: 'card', id }` — and mutate through store commands, so
  they never touch an object they were handed.

### Design system

`src/styles/tokens.css` is the source of truth for colour, type, space, radii,
elevation, and motion. Components use the semantic layer (`--surface-raised`,
`--text-secondary`, `--kind-attack`) rather than raw palette steps, so the whole
app re-tunes from one file. No component hardcodes a hex value.

Card kinds and character roles each own a colour token, which is why a card kind
looks identical in the sidebar, the editor, and the rendered card.

## Not built yet

Deliberately left as declared-but-empty seams:

- **PNG and PDF export.** Registered in `src/lib/export/registry.ts` and shown
  disabled in the UI. `src/lib/renderer/types.ts` already carries the print
  geometry they need.
- **Direct manipulation of artwork.** Scale, offset, rotation and crop are
  sliders. Dragging the image inside the art window, with a handle that
  constrains the crop to the window's aspect ratio, is the natural next step —
  the model already supports everything it would write.
- **Schema migrations.** `SET_SCHEMA_VERSION` is checked on import and files
  from a newer schema are refused rather than guessed at. What exists instead
  is repair: `normalize.ts` fills missing fields with the factories' defaults
  and renames what has been renamed — the v6 `modifier` → `event` rename is the
  only one so far. A real migration ladder lands when a *shape* changes, not
  just a name.
- **Storage headroom.** Embedded artwork is stored as data URLs, which will
  outgrow `localStorage` on a set with many images. The autosave failure is
  surfaced in the status bar rather than swallowed; the real fix is IndexedDB
  or a file handle.
