---
inclusion: always
---

# Product

**Adventures Workshop** is a local-first builder for custom **Unmatched Adventures**
sets — heroes, villains, minions, initiative decks, rules and event cards, the
adventure map and threat track, and the printable card art that goes with them.

## Who it is for

Unmatched Adventures fans authoring their own content. They are not developers.
Signing in is optional — only needed to publish, share, or contribute back.

## Goals that shape the product

- **Authoring works fully offline.** No account or network call is required to
  build a set. The open document lives in the browser (IndexedDB, not
  `localStorage` — see `schema-and-persistence.md`) and every user asset is
  embedded as a data URL, so a set survives being handed to someone else as one
  file.
- **The cloud is a publish target, never the source of truth.** Publishing,
  the gallery, forking and contributions (`src/lib/cloud/`) are all optional
  layers on top of a document that still lives in the author's browser. Losing
  the network loses sharing, never the set.
- **Print fidelity is the product.** Cards are laid out against the real print
  templates at bleed resolution, so what the author approves in the preview is
  what comes out of the exporter.
- **The exported card is the previewed card.** There is deliberately no second
  drawing path; see `renderer-and-export.md`.

## Shape of the app

Three panes, each with one job:

- **Left — set hierarchy.** Heroes, Villains, Minions, Initiative, Rules and
  Events, with each character's decks nested beneath it. An *Unassigned* group
  appears only when a deleted character leaves decks behind.
- **Centre — workspace.** The editor for whatever is selected: a card, a
  character, the adventure map, the threat track, or the set itself.
- **Right — preview.** The selected card rendered by the same component that
  drives export. Zoom, cut-line overlay, and a difference-blend comparison
  against the print template.

The card editor splits into **Content** (touched on every card: name, copies,
combat values, ability text) and **Design** (set once: artwork placement and
grade, then surfaces, ink, pattern and texture).

Editor decisions worth preserving:

- **A combat value's symbol is its on/off switch.** `attack: null` means the card
  does not print an attack at all, so adding or removing a defense value is one
  click, not a checkbox plus a field.
- **Timed ability blocks appear only when used.** Immediately, During Combat and
  After Combat are added from chips in the section header and always print in that
  fixed order.
- **Symbols are tokens.** The palette inserts `{{attack}}` at the caret; the
  renderer swaps in the print-resolution PNG. Stored text stays plain and searchable.
- **Sections are hairlines, not boxes.** Hierarchy comes from type and spacing, not
  from nested panels.

## The hero role

`hero` is a selectable character role alongside `villain` and `minion`
(`sidekick` exists in the model but is not directly selectable — it lives as a
field on a hero, not a roster entity). A hero's action card is one extra field
(`symbol`/`symbolValue`/`owner`), not a new card type; the villain/minion
renderer, geometry and template art are reused unchanged everywhere but the
ribbon and the who-may-play line. A hero also gets its own printed
**character card** (`HeroCharacterCardFace`) — a stat sheet with health, move,
attack type, ability, and an optional sidekick or quote — which is not a `Card`
at all, since it is read straight off `Character`.

**Print sheets, PNG export and the Tabletop Simulator bundle do not yet know
about heroes.** A hero can be fully authored and previewed but not exported
outside a single-card PNG. This is a known, deliberately scoped gap — see
"Still open" in `CHANGELOG.md`.

## Sharing and collaboration

- **Publishing** puts a set (or a scoped slice — a single hero, say) into a
  public/unlisted Supabase row with a share link. A shared set is viewed
  read-only through the same components the author reviews with, never
  "adopted" into the visitor's own library automatically.
- **Forking** copies a published set into the visitor's own library, preserving
  every entity id and recording a per-entity content hash (`SetOrigin`) so a
  later change can be described as "this card changed and nothing else did."
- **Contributions** let a fork's author propose entity-level changes back to
  the original owner, who reviews and accepts or declines each one. A
  contribution is always a proposal; nothing lets a stranger's row mutate a
  published set directly.

See `CLAUDE.md`'s "Sharing and the gallery" / "Contributions" sections and
`COLLABORATION.md` for the reasoning and the RLS boundaries.

## Deliberately not built yet

Declared-but-empty seams, not oversights: PDF export as a file (print sheets are
a browser-print screen instead, deliberately — see `renderer-and-export.md`),
direct manipulation of artwork (sliders only for now), and a real schema
migration ladder (repair-on-load instead). `README.md` and `CLAUDE.md` explain
the reasoning for each; "Still open" in `CHANGELOG.md` tracks current known gaps
(hero export coverage, email sign-in delivery, map+threat-track as one TTS
object, map polish, the health dial's TTS button quirks).

`SET-HEALTH.md` documents what set-health grades like "Playable, still rough" mean
and every check behind them.
