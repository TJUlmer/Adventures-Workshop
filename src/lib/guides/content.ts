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
  },
  {
    id: 'collaborate-on-a-project',
    title: 'Collaborate on a project',
    summary: 'Fork a published set, offer your changes back, and get credited.',
    icon: 'users',
    steps: [
      {
        text:
          'Every published set has a "Build on this" panel with one button: make a copy to work on. It records where the copy came from — who published it, and which revision — so you never lose track of the set you started from.',
        shot: 'collaborate-on-a-project/01-shared-set.webp',
        alt: 'A shared set’s page, with the "Make a copy to work on" button in its Build on this panel.',
        hotspots: [
          {
            x: 0.715,
            y: 0.57,
            w: 0.185,
            h: 0.11,
            label: 'One click makes the copy'
          }
        ]
      },
      {
        text:
          'The copy is yours — a real set of your own, in your library, free to rename, redesign, or take in a completely different direction. It always remembers what it was based on, but nothing you do to it reaches back to the original. The set you copied from is untouched by anything you do to yours.',
        shot: 'collaborate-on-a-project/02-your-copy.webp',
        alt: 'A set’s own page, showing "Based on Wicked Woods by Priya Achar · revision 3" under its title.',
        hotspots: [
          {
            x: 0.135,
            y: 0.68,
            w: 0.40,
            h: 0.14,
            label: 'Where this copy came from'
          }
        ]
      },
      {
        text:
          'Once you have made a change, an "Offer your changes back" panel appears, listing everything that is different from the set you copied. Add a note if you like, then send it — the original author decides what happens next, and your own copy is never at risk either way.',
        shot: 'collaborate-on-a-project/03-offer.webp',
        alt: 'The Offer your changes back panel, listing one changed card and a Send to Priya Achar button.',
        hotspots: [
          {
            x: 0.03,
            y: 0.79,
            w: 0.42,
            h: 0.14,
            label: 'Sends the whole list, in one offer'
          }
        ]
      },
      {
        text:
          'Changed your mind, or want to add more before the author looks at it? Withdraw the offer at any time before it is reviewed. Nothing is lost — keep working, and send an updated one whenever you are ready.',
        shot: 'collaborate-on-a-project/04-withdraw.webp',
        alt: 'The same panel, now showing "You have an offer waiting on this set" and a Withdraw the offer button.',
        hotspots: [
          {
            x: 0.03,
            y: 0.65,
            w: 0.40,
            h: 0.27,
            label: 'Only before it’s reviewed'
          }
        ]
      },
      {
        text:
          'The author sees exactly what you saw: every change, before and after, drawn as real cards rather than a list of field names. They tick the ones they want — all of it, some of it, or none — and nothing moves until they decide. Taking a change edits their own set; nothing you did to yours is affected either way.',
        shot: 'collaborate-on-a-project/05-review.webp',
        alt: 'The owner’s review screen, comparing a card as it stands against the offered version, with a checkbox and Take/Decline buttons.',
        hotspots: [
          {
            x: 0.005,
            y: 0.34,
            w: 0.375,
            h: 0.48,
            label: 'Before and after, as real cards'
          }
        ]
      },
      {
        text:
          'Once the author republishes with your change taken, your name appears on the set’s own page — a credit for what actually landed, visible to anyone who opens it. Not a changelog of what you proposed, just a plain "with contributions from" naming everyone who helped.',
        shot: 'collaborate-on-a-project/06-credit.webp',
        alt: 'The published set’s page reading "With contributions from Jonas Weir" under its latest change note.',
        hotspots: [
          {
            x: 0.008,
            y: 0.51,
            w: 0.28,
            h: 0.1,
            label: 'Everyone whose work is in this set'
          }
        ]
      }
    ],
    action: { label: 'Browse the gallery', run: { to: 'gallery' } }
  }
];
