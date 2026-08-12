---
inclusion: always
---

# Product

**Adventures Workshop** is a local-first builder for custom **Unmatched Adventures**
sets — villains, minions, initiative decks, rules and event cards, and the printable
card art that goes with them.

## Who it is for

Unmatched Adventures fans authoring their own content. They are not developers and
they are not signing in to anything; they open the app, build a set, and export it.

## Goals that shape the product

- **Everything runs in the browser.** No backend, no account, no network call. The
  open document lives in `localStorage` and leaves the machine only when the author
  exports it.
- **A set is one portable file.** Every user asset — artwork, models, replacement
  images — is embedded as a data URL so a set survives being handed to someone else.
- **Print fidelity is the product.** Cards are laid out against the real print
  templates at bleed resolution, so what the author approves in the preview is what
  comes out of the exporter.
- **The exported card is the previewed card.** There is deliberately no second
  drawing path; see `renderer-and-export.md`.

## Shape of the app

Three panes, each with one job:

- **Left — set hierarchy.** Villains, Minions, Initiative, Rules and Events, with
  each character's decks nested beneath it. An *Unassigned* group appears only when
  a deleted character leaves decks behind.
- **Centre — workspace.** The editor for whatever is selected: a card, a character,
  or the set itself.
- **Right — preview.** The selected card rendered by the same component that drives
  export. Zoom, cut-line overlay, and a difference-blend comparison against the
  print template.

The card editor splits into **Content** (touched on every card: name, copies,
combat values, ability text) and **Design** (set once: artwork placement and grade,
then surfaces, ink, pattern and texture).

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

## Deliberately not built yet

Declared-but-empty seams, not oversights: PNG and PDF export (registered in
`src/lib/export/registry.ts`, shown disabled), direct manipulation of artwork
(sliders only for now), a schema migration ladder (repair-on-load instead), and
storage headroom beyond `localStorage` (IndexedDB or a file handle is the real fix).
`README.md` explains the reasoning for each.

`SET-HEALTH.md` documents what set-health grades like "Playable, still rough" mean
and every check behind them.
