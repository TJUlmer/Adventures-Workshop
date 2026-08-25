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
          'Select the rules card and find "Belongs to" in its editor. It lists every deck of the same kind that already exists, plus every character who does not yet have one, so picking a name is what creates their deck. You never have to go and build one first.',
        shot: 'character-rules-deck/02-belongs-to.webp',
        alt: 'The rules card editor’s Deck section, showing the Belongs to field set to "Whole set".',
        hotspots: [{ x: 0.495, y: 0.2, w: 0.495, h: 0.7 }]
      },
      {
        text:
          'Pick the character. Their own rules deck appears in the sidebar with the card in it, and the shared deck keeps everything else. A scoped export of that character now carries this card with them, along with any other rules card in this deck.',
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
            x: 0.925,
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
          'Every published set has a "Build on this" panel with one button: make a copy to work on. It records where the copy came from, who published it, and which revision...so you never lose track of the set you started from.',
        shot: 'collaborate-on-a-project/01-shared-set.webp',
        alt: 'A shared set’s page, with the "Make a copy to work on" button in its Build on this panel.',
        hotspots: [
          {
            x: 0.725,
            y: 0.57,
            w: 0.185,
            h: 0.13,
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
            x: 0.115,
            y: 0.66,
            w: 0.25,
            h: 0.14,
            label: 'Where this copy came from'
          }
        ]
      },
      {
        text:
          'Once you have made any changes, an "Offer your changes back" panel appears, listing everything that is different from the set you copied. Add a note if you like, then send it. The original author decides what happens next, and your own copy is never at risk either way.',
        shot: 'collaborate-on-a-project/03-offer.webp',
        alt: 'The Offer your changes back panel, listing one changed card and a Send to Priya Achar button.',
        hotspots: [
          {
            x: 0.03,
            y: 0.76,
            w: 0.85,
            h: 0.17,
            label: 'Sends the whole list, in one offer'
          }
        ]
      },
      {
        text:
          'Changed your mind, or want to add more before the author looks at it? Withdraw the offer at any time before it is reviewed. Nothing is lost, just keep working and send an updated one whenever you are ready.',
        shot: 'collaborate-on-a-project/04-withdraw.webp',
        alt: 'The same panel, now showing "You have an offer waiting on this set" and a Withdraw the offer button.',
        hotspots: [
          {
            x: 0.035,
            y: 0.63,
            w: 0.30,
            h: 0.27,
            label: 'Only before it’s reviewed'
          }
        ]
      },
      {
        text:
          'The author sees exactly what you saw: every change, showing the before and after versions. They tick the ones they want — all of it, some of it, or none. Taking a change edits their own set; nothing you did to yours is affected either way.',
        shot: 'collaborate-on-a-project/05-review.webp',
        alt: 'The owner’s review screen, comparing a card as it stands against the offered version, with a checkbox and Take/Decline buttons.',
        hotspots: [
          {
            x: 0.005,
            y: 0.34,
            w: 0.375,
            h: 0.48,
            label: 'Before and after shown for approval'
          }
        ]
      },
      {
        text:
          'Once the author republishes with your change taken, your name appears on the set’s own page with a contribution credit naming everyone who helped.',
        shot: 'collaborate-on-a-project/06-credit.webp',
        alt: 'The published set’s page reading "With contributions from Jonas Weir" under its latest change note.',
        hotspots: [
          {
            x: 0.04,
            y: 0.455,
            w: 0.25,
            h: 0.1,
            label: 'Everyone whose work is in this set'
          }
        ]
      }
    ],
    action: { label: 'Browse the gallery', run: { to: 'gallery' } }
  },
  {
    id: 'how-components-work',
    title: 'How components work',
    summary: 'Miniatures, tokens and the health dial — the pieces beyond the cards.',
    icon: 'users',
    steps: [
      {
        text:
          'A set is more than its cards: Unmatched is played with miniatures, tokens and a health dial for every hero, sidekick, villain and minion, and Tabletop Simulator needs digital versions of all of it to actually play a fan set. The Components page is where you list what your adventure needs: figures to stand in for characters, character tokens, game pieces, health dials, and anything else that goes in the box. A few common tokens have their sizes filled in for you while everything else starts blank.',
        shot: 'how-components-work/01-what.webp',
        alt: 'The Components page, with preset token buttons, kind buttons, and an empty list.',
        hotspots: [
          {
            x: 0.59,
            y: 0.11,
            w: 0.375,
            h: 0.17,
            label: 'Presets first, then any kind on its own'
          }
        ]
      },
      {
        text:
          'Every component has a kind (figure, token, health dial or game piece) and can be tied to a character. Assign one them to the characters to ensure the JSONs for each character is created accurately, and Tabletop Simulator uses the link to know whose token is whose. A component with nothing to do with a specific character like a threat track marker or a deck box insert is left unassigned.',
        shot: 'how-components-work/02-add-assign.webp',
        alt: 'A token named Red, assigned to the character Red, with a reference image attached.',
        hotspots: [
          {
            x: 0.125,
            y: 0.3,
            w: 0.8,
            h: 0.16,
            label: 'Which character this piece belongs to'
          }
        ]
      },
      {
        text:
          'A component is built from whichever of three sources you give it. Reference art is a picture the app can wrap onto a generated piece itself — see the next step. If you already have a sculpt, attach an STL or OBJ model directly.',
        shot: 'how-components-work/03-sources.webp',
        alt: 'A figure called The Huntsman with a 3D model and a Tabletop Simulator object attached, and no reference image.',
        hotspots: [
          {
            x: 0.12,
            y: 0.41,
            w: 0.8,
            h: 0.45,
            label: 'Your own model and texture, or one you attach whole'
          }
        ]
      },
      {
        text:
          'No sculpt of your own? Toggle on "Build a token from the image" and the app generates one — a flat disc or polygon with your reference art wrapped onto its face, sized however you like. Shape, diameter, thickness and the rim colour left showing at the edge are all yours to set, and the preview below updates as you go. This is what every preset token already does, and it is enough for most tokens a set needs.',
        shot: 'how-components-work/04-customize.webp',
        alt: 'A generated token\'s shape, diameter, thickness, rim colour and zoom controls, with a live 3D preview of the finished disc below.',
        hotspots: [
          {
            x: 0.115,
            y: 0.235,
            w: 0.8,
            h: 0.1,
            label: 'Shape, size and colour. The piece updates live'
          }
        ]
      },
      {
        text:
          'The health dial is one component the app already knows how to build — every hero, villain, and minion needs one (plus many sidekicks), so it is its own kind rather than something you configure from scratch. Give it a face image and the range it should count, and everything else — the disc, the click-to-adjust triggers, the script that runs them in Tabletop Simulator — comes built in.',
        shot: 'how-components-work/05-dial.webp',
        alt: 'A health dial\'s value range and face art settings, with a live 3D preview of the finished dial below.',
        hotspots: [
          {
            x: 0.12,
            y: 0.18,
            w: 0.265,
            h: 0.36,
            label: 'The one range you set'
          }
        ]
      }
    ],
    action: { label: 'Open Components', run: { to: 'setPage', page: 'figures' } }
  },
  {
    id: 'custom-symbols',
    title: 'Design your own symbols',
    summary: 'Upload a glyph once, then insert it anywhere the built-in symbols go.',
    icon: 'sparkle',
    steps: [
      {
        text:
          'Upload a transparent PNG on the Symbols page and give it a short, one-word name. "Hook" becomes {{hook}} — as long as it\'s not already claimed by another symbol or one of the four built-ins. A name that can\'t work as a word still inserts fine from the palette button; it just keeps a longer ID form in the text.',
        shot: 'custom-symbols/01-upload.webp',
        alt: 'A custom symbol named Hook, with its image attached and the {{hook}} token shown.',
        hotspots: [
          {
            x: 0.01,
            y: 0.5,
            w: 0.75,
            h: 0.4,
            label: ''
          }
        ]
      },
      {
        text:
          'Once it exists, it shows up in every symbol palette in the app — the small row above any ability field, the card title, rules and event text, and character sheets. Click it, or type its name, and it inserts right where the cursor is.',
        shot: 'custom-symbols/02-insert.webp',
        alt: 'The symbol palette above an ability field, with the custom Hook symbol as its last icon, and the printed card showing the glyph inline in its ability text.',
        hotspots: [
          {
            x: 0.415,
            y: 0.02,
            w: 0.185,
            h: 0.045,
            label: 'The same row, on every ability field'
          }
        ]
      },
      {
        text:
          'A hero or villain card can also carry a symbol below its name ribbon, standing on its own in the strip that connects the ribbon to the divider. Pick it from "Ribbon symbol" in the card\'s Combat section, set how large it prints, and it\'s there whether or not the same symbol appears anywhere else on the card.',
        shot: 'custom-symbols/03-ribbon.webp',
        alt: 'The Ribbon symbol control with Hook selected, and the printed card showing the glyph in the strip below its name ribbon.',
        hotspots: [
          {
            x: 0.445,
            y: 0.135,
            w: 0.115,
            h: 0.075,
            label: 'A different placement from ability text'
          }
        ]
      },
      {
        text:
          'A Bonus ability — the colored text printed last on the card — can carry a larger icon of its own beside the text, picked the same way. Its size is independent of everywhere else the symbol appears: the "Bonus icon size" slider only scales this one instance, so the same upload can sit small inside a sentence and large beside the bonus ability on the very same card.',
        shot: 'custom-symbols/04-bonus.webp',
        alt: 'The Bonus icon picker with Hook selected and its size slider, next to the printed card showing a large Hook glyph beside the bonus ability text.',
        hotspots: [
          {
            x: 0.0,
            y: 0.31,
            w: 0.35,
            h: 0.2,
            label: 'Which symbol'
          },
          {
            x: 0.35,
            y: 0.555,
            w: 0.3,
            h: 0.1,
            label: 'How large — independent of every other use'
          }
        ]
      }
    ],
    action: { label: 'Open Symbols', run: { to: 'setPage', page: 'symbols' } }
  },
  {
    id: 'adding-multiple-decks',
    title: 'Give a character a second deck',
    summary: 'Split cards that don\'t belong in the normal action deck into one of their own.',
    icon: 'layers',
    steps: [
      {
        text:
          'Select a character and open their Identity tab. Every figure starts with one action deck, but "Add deck" beside the Decks tile isn\'t limited to that — it gives the character a second deck of their own, empty and ready to name.',
        shot: 'adding-multiple-decks/01-add-deck.webp',
        alt: 'A character\'s Identity tab, with the Identity tile on the left and the Decks tile — one Action deck, and an "Add deck" button — on the right.',
        hotspots: [
          {
            x: 0.795,
            y: 0.045,
            w: 0.155,
            h: 0.065,
            label: 'One click, one new empty deck'
          }
        ]
      },
      {
        text:
          'Rename it to whatever the extra cards actually are — say, "Supplies" for a set of gear cards a villain hands out beyond their normal 30-card action deck. Its kind stays "Special" unless you have a real reason to change it; that\'s just the label for "not one of the deck types the app already has a use for."',
        shot: 'adding-multiple-decks/02-rename.webp',
        alt: 'The Decks tile with two decks: Action deck, and a renamed Supplies deck of kind Special, both with cards in them.',
        hotspots: [
          {
            x: 0.475,
            y: 0.44,
            w: 0.51,
            h: 0.26,
            label: 'A second deck, named for what it holds'
          }
        ]
      },
      {
        text:
          'This is where it earns its keep while you work: the sidebar lists a character\'s decks separately, each with its own card count. A villain with thirty action cards and a handful of supply cards mixed into one pile is a scroll to find anything; split apart, each deck is short enough to see at a glance.',
        shot: 'adding-multiple-decks/03-sidebar.webp',
        alt: 'The sidebar under The Huntsman, showing Action deck and Supplies as two separate, separately-counted groups.',
        hotspots: [
          {
            x: 0.0,
            y: 0.32,
            w: 1.0,
            h: 0.66,
            label: 'Two decks, two counts, easy to tell apart'
          }
        ]
      },
      {
        text:
          'One thing this does not do on its own: separate the cards into their own pile in the Tabletop Simulator export. TTS piles are built by card type, not by which deck an author filed something in — every action card a character has, whichever deck it lives in here, deals from the same pile on the table. A second deck is genuinely useful for keeping your own workspace readable, and for splitting off cards of a different type (rules text, say) that would already export separately regardless of which deck holds them. Just don\'t reach for it expecting Tabletop Simulator to hand a player two separate stacks — that isn\'t what it changes.'
      }
    ],
    action: { label: 'Open the card editor', run: { to: 'setPage', page: 'editor' } }
  },
  {
    id: 'sharing-a-set',
    title: 'Sharing a set',
    summary: 'Every way a set leaves the app — exports, print sheets, and publishing.',
    icon: 'download',
    steps: [
      {
        text:
          'The Export block on a set\'s own page (its Edit tab) covers every way to get a set out of the app. One thing applies to all of it: the picker at the top. Left on "Whole set," every export below covers everything. Pick one hero — or, if the set has a villain side, that — and every export below switches to just that slice, nothing else along for the ride.',
        shot: 'sharing-a-set/01-scope.webp',
        alt: 'The Export scope picker set to a hero named Red, with a hint reading "Just Red — not the rest of Wicked Woods."',
        hotspots: [
          {
            x: 0.0,
            y: 0.14,
            w: 0.98,
            h: 0.44,
            label: 'Everything below follows this'
          }
        ]
      },
      {
        text:
          '"All cards as PNGs" renders every card as its own full-resolution image, foldered by kind, in one zip. This is the export for anyone who wants to work with the actual card art — a print shop, another piece of design software, or just a folder of pictures to browse. "Include bleed" keeps the extra margin around each card meant to be trimmed off; leave it off for images sized to the card itself.',
        shot: 'sharing-a-set/02-pngs.webp',
        alt: 'The "All cards as PNGs (.zip)" export button with Include bleed checked.',
        hotspots: [
          {
            x: 0.0,
            y: 0.68,
            w: 0.55,
            h: 0.28,
            label: 'On for a print shop\'s margin, off for plain images'
          }
        ]
      },
      {
        text:
          'The Tabletop Simulator export is not a single JSON to import — it\'s a folder: every pile\'s face sheets, the health dial and every generated token, and one saved-object file that ties them together. Unzip it, then copy the whole unzipped folder into your Tabletop Simulator Saved Objects folder — not just the one file inside it. Type that folder\'s path in once below and every future export already points there, so nothing needs editing by hand.',
        shot: 'sharing-a-set/03-tts.webp',
        alt: 'The Tabletop Simulator export button, with its note explaining to copy the entire unzipped folder into the Saved Objects folder.',
        hotspots: [
          {
            x: 0.0,
            y: 0.26,
            w: 1.0,
            h: 0.2,
            label: 'The whole folder — not one file out of it'
          }
        ]
      },
      {
        text:
          '"Print sheets" lays cards out at true size on real paper — A4 or Letter, with crop marks if you want them. Printer friendly swaps every card to black line on white with no artwork, the cheapest way to proof a set on a home inkjet or a laser printer before committing to colour copies. The other three switches are independent of it: duplicates, reverse sheets for double-sided printing, and the crop marks themselves.',
        shot: 'sharing-a-set/04-print.webp',
        alt: 'The Print sheets screen with Printer friendly switched on, alongside Print duplicates, Card backs and Crop marks.',
        hotspots: [
          {
            x: 0.0,
            y: 0.53,
            w: 0.19,
            h: 0.2,
            label: 'Black and white, no artwork'
          }
        ]
      },
      {
        text:
          '"Set file (.json)" is the odd one out on this list: everything else is for playing the set somewhere else, this is for the app itself. It\'s the complete document, re-importable on this or any other machine running Adventures Workshop — the format to keep backups in, or to hand a finished set to a co-author to keep working on locally.',
        shot: 'sharing-a-set/05-jsonfile.webp',
        alt: 'The "Set file (.json)" export button, described as the complete, re-importable document.',
        hotspots: [{ x: 0.0, y: 0.0, w: 1.0, h: 0.95, label: 'A whole copy of the document itself' }]
      },
      {
        text:
          'Publishing is a different thing from exporting: it puts a copy on Adventures Workshop\'s own servers and hands you a link, and "Who can see it" decides who that link is good for. Listed publicly puts it in the gallery, where anyone can find it browsing. Anyone with the link is unlisted — nobody stumbles onto it, but the link itself works for whoever has it, forever. Only me stops the link working at all, without unpublishing the set itself — flip it back the moment you want it live again.',
        shot: 'sharing-a-set/06-visibility.webp',
        alt: 'The Share this set panel, with "Who can see it" set to Anyone with the link, and the share link above it.',
        hotspots: [
          {
            x: 0.06,
            y: 0.53,
            w: 0.88,
            h: 0.13,
            label: 'Three different answers to "who has this link"'
          }
        ]
      }
    ],
    action: { label: 'Open the set', run: { to: 'setPage', page: 'home' } }
  }
];
