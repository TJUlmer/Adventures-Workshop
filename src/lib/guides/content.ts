/**
 * Every guide, as data. See `types.ts` for the shape and the two rules that
 * shape it (clean screenshots with annotations as data; actions as names).
 *
 * Adding a guide is: write the entry, drop its screenshots into
 * `public/assets/guides/<id>/`, and it appears on Home. Nothing imports a
 * component, registers anything, or has to be told the guide exists —
 * `HomeScreen` lists whatever is in this array, and `guides.open(id)` opens
 * whatever is in this array.
 *
 * **The screenshots are captured, not drawn.** `tools/README-guides.md`
 * records how: drive the app in the dev preview, photograph the region, and
 * write it through the dev server's own `/__workshop/export` endpoint. Kept
 * repeatable on purpose — a guide's shots go stale every time the UI they
 * show moves, and a shot nobody can re-take is a guide nobody will update.
 *
 * WebP rather than PNG. These are screenshots of a UI, not card art: nothing
 * downstream reads their pixels, they are only ever looked at, and they ship
 * inside `dist/` where a dozen full-window PNGs would be several megabytes of
 * an offline-first app's download.
 */
import type { Guide } from './types';

export const GUIDES: readonly Guide[] = [
  {
    id: 'character-rules-deck',
    title: 'Give a character their own rules deck',
    summary: 'Move a rules card so it travels with one hero or villain.',
    icon: 'layers',
    steps: [
      {
        text:
          'Rules and event cards start in one deck shared by the whole set, which is right for most of them — they are reference material everyone at the table reads. Some are not. A rule that only makes sense while one character is in play should travel with that character when the set is exported or shared.',
        shot: 'character-rules-deck/01-shared-deck.webp',
        alt: 'The set sidebar, with a single Rules cards deck holding both rules cards.',
        hotspots: [
          {
            x: 0.03,
            y: 0.755,
            w: 0.94,
            h: 0.04,
            label: 'One deck, belonging to the whole set',
            labelSide: 'bottom'
          }
        ]
      },
      {
        text:
          'Select the rules card and find "Belongs to" in its editor. It lists every deck of the same kind that already exists, plus every character who does not yet have one — so picking a name is what creates their deck. You never have to go and build one first.',
        shot: 'character-rules-deck/02-belongs-to.webp',
        alt: 'The rules card editor’s Deck section, showing the Belongs to field set to "Whole set".',
        hotspots: [{ x: 0.495, y: 0.2, w: 0.495, h: 0.7 }]
      },
      {
        text:
          'Pick the character. Their own rules deck appears in the sidebar with the card in it, and the shared deck keeps everything else. A scoped export of that character now carries this card along with them.',
        shot: 'character-rules-deck/03-owned-deck.webp',
        alt: 'The sidebar showing a second Rules cards deck, labelled with the character who owns it.',
        hotspots: [
          {
            x: 0.03,
            y: 0.795,
            w: 0.94,
            h: 0.075,
            label: 'Their deck, created by naming them'
          }
        ]
      },
      {
        text:
          'Changed your mind? Empty the deck and a delete button appears beside it. A deck with cards still in it has no delete button — removing those is a separate, deliberate step, because nothing here can be undone.',
        shot: 'character-rules-deck/04-remove-empty.webp',
        alt: 'An empty rules deck in the sidebar, with its delete button showing.',
        hotspots: [
          {
            x: 0.933,
            y: 0.665,
            w: 0.045,
            h: 0.155,
            label: 'Only ever on an empty deck',
            labelSide: 'left'
          }
        ]
      }
    ],
    /*
     * Correct for this guide, and hidden for now: `GuideModal` only offers a
     * `setPage` action when the reader is actually inside a set, and Home's
     * Guides card is the only way to open a guide today. It lights up on its
     * own the moment there is a second entry point — a help control inside a
     * set, which is where half the topics worth writing about live.
     */
    action: { label: 'Open the card editor', run: { to: 'setPage', page: 'editor' } }
  }
];
