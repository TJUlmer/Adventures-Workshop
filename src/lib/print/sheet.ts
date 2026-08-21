/**
 * Which cards go on which sheet.
 *
 * Pure, no DOM — the same split as the Tabletop Simulator export, and for the
 * same reason: a sheet has one cell size, so a run of cards has to be grouped
 * by *printed size* before anything can be laid out. `PrintSheet.svelte` draws
 * what this decides.
 *
 * This is deliberately not `card-pngs.ts`'s `planJobs`. That plans an archive —
 * one image per card, foldered by what it is, quantities irrelevant because a
 * file is a file. This plans paper: a card with `quantity: 3` is three cards,
 * and a page that would come out empty must not be printed at all.
 */
import { cardLabel } from '$lib/cards/factory';
import type { CardTheme } from '$lib/cards/style';
import type { Card } from '$lib/cards/types';
import { characterLabel } from '$lib/characters/factory';
import type { Character, HeroCharacterCard } from '$lib/characters/types';
import { CARD_FORMATS } from '$lib/renderer/geometry';
import { characterForCard, outline, resolveStyleForCard } from '$lib/sets/queries';
import type { AdventureSet } from '$lib/sets/types';
import { gridFor } from './paper';
import type { PageGrid, Paper } from './paper';

/** One printed card, in the shape `CardRenderer` wants. */
export interface PrintItem {
  key: string;
  /** For the screen-only page heading, never printed on the card. */
  label: string;
  card: Card | null;
  character: Character | null;
  cardback: Character | null;
  /**
   * Draw this hero's character card. Same shape `CardRenderer` and the export
   * stage take — the stat sheet is read off the character rather than out of
   * `set.cards`, so it needs its own way in, exactly as `cardback` does.
   */
  statCard?: Character | null;
  /** Which of `statCard`'s identities. Absent draws their own. */
  statCardEntry?: HeroCharacterCard | null;
  theme: CardTheme | undefined;
  side: 'front' | 'back';
}

export interface PrintPage {
  key: string;
  label: string;
  /** Cell size in millimetres. Every card on a page shares it. */
  sizeMm: { width: number; height: number };
  grid: PageGrid;
  /**
   * Row-major, `grid.perPage` long. `null` is a cell left empty — back pages
   * need those, because a card with no designed back still has to hold its
   * place or every card after it prints on the wrong reverse.
   */
  cells: (PrintItem | null)[];
  side: 'front' | 'back';
}

export interface PrintPlan {
  pages: PrintPage[];
  /** Things the author should know before spending paper. */
  warnings: string[];
}

export interface PrintPlanOptions {
  paper: Paper;
  /** Print each card as many times as the set says it exists. */
  useQuantities: boolean;
  /**
   * Follow every sheet with its reverse, laid out for a long-edge duplex flip.
   */
  backs: boolean;
}

/** A front and the reverse it should be printed against, if it has one. */
interface Pairing {
  front: PrintItem;
  back: PrintItem | null;
}

/**
 * The formats a sheet can be built for, keyed by the printed size they share.
 *
 * A character's deck back is 63 × 88 like the action card it backs, which is
 * what lets a back page reuse the front page's grid untouched.
 */
const SIZES = {
  poker: CARD_FORMATS.action.mm,
  initiative: CARD_FORMATS.initiative.mm,
  event: CARD_FORMATS.event.mm
} as const;

type SizeName = keyof typeof SIZES;

function sizeFor(card: Card): SizeName {
  if (card.type === 'initiative') return 'initiative';
  if (card.type === 'event') return 'event';
  return 'poker';
}

/**
 * A hero's character card sheets, as print items.
 *
 * Heroes only — the stat sheet is a hero-only face, drawn by
 * `HeroCharacterCardFace` and reached through `CardRenderer`'s `statCard`
 * rather than through `set.cards`, which is why no amount of walking the decks
 * finds one. Same enumeration `AssetsOverview` uses: the primary identity,
 * then `additionalCards` in order.
 *
 * `theme: undefined` because this card does not go through the style cascade
 * at all — `Character.characterCard` is its own small design object. Passing a
 * resolved card theme here would be passing a look it cannot read.
 */
function characterCardItems(character: Character): PrintItem[] {
  if (character.role !== 'hero') return [];

  const base = {
    card: null,
    character: null,
    cardback: null,
    statCardEntry: null,
    theme: undefined,
    side: 'front' as const
  };

  return [
    {
      ...base,
      key: `${character.id}-charactercard`,
      label: `${characterLabel(character)} character card`,
      statCard: character
    },
    ...character.additionalCards.map((extra) => ({
      ...base,
      key: `${extra.id}-charactercard`,
      label: `${characterLabel(character)} — ${extra.name.trim() || 'second character card'}`,
      statCard: character,
      statCardEntry: extra
    }))
  ];
}

/**
 * Every printable card, paired with its reverse, grouped by printed size.
 *
 * Order follows the set outline, so a printed run comes out in the order the
 * author sees in the sidebar — which is what makes a stack of cut cards
 * sortable without reading every one.
 */
function planPairings(
  set: AdventureSet,
  options: PrintPlanOptions
): { groups: Map<SizeName, Pairing[]>; warnings: string[] } {
  const groups = new Map<SizeName, Pairing[]>();
  const warnings: string[] = [];
  const view = outline(set);

  const add = (size: SizeName, pairing: Pairing, quantity: number): void => {
    const bucket = groups.get(size) ?? [];
    // `quantity` is the physical count, so a 3-of is three cards on the paper.
    for (let copy = 0; copy < quantity; copy += 1) {
      bucket.push(
        copy === 0
          ? pairing
          : {
              front: { ...pairing.front, key: `${pairing.front.key}#${copy}` },
              back: pairing.back ? { ...pairing.back, key: `${pairing.back.key}#${copy}` } : null
            }
      );
    }
    groups.set(size, bucket);
  };

  const pairingFor = (card: Card, character: Character | null): Pairing => {
    const theme = resolveStyleForCard(set, card);
    const front: PrintItem = {
      key: `${card.id}-front`,
      label: cardLabel(card),
      card,
      character,
      cardback: null,
      theme,
      side: 'front'
    };

    /*
     * An event card is designed on both sides, so its reverse is a face the
     * renderer already draws. Everything a figure owns backs onto that
     * figure's deck back. A rules card has no designed reverse and prints
     * single-sided — its cell on the back page stays empty rather than being
     * filled with something the author never asked for.
     */
    if (card.type === 'event') {
      return {
        front,
        back: { ...front, key: `${card.id}-back`, side: 'back' }
      };
    }

    if (character) {
      return {
        front,
        back: {
          key: `${card.id}-deckback`,
          label: `${characterLabel(character)} deck back`,
          card: null,
          character: null,
          cardback: character,
          theme: undefined,
          side: 'front'
        }
      };
    }

    return { front, back: null };
  };

  /*
   * Heroes first, matching the sidebar's own order — which is the point of
   * following the outline at all: a printed run comes out sortable without
   * reading every card.
   *
   * Written as one loop over both halves rather than a hero pass and a villain
   * pass, because heroes were left out of exactly this kind of hand-written
   * role list for a whole release and printed nothing at all.
   */
  for (const entry of [...view.heroes, ...view.villains, ...view.minions, ...view.others]) {
    for (const deck of entry.decks) {
      for (const card of deck.cards) {
        add(
          sizeFor(card),
          pairingFor(card, entry.character),
          options.useQuantities ? card.quantity : 1
        );
      }
    }

    /*
     * A hero's character card, which is not in `set.cards` and so cannot come
     * out of the deck loop above. One per identity — a duo prints two sheets.
     * Single-sided by design: it is a reference card, so like a rules card its
     * cell on the back page stays empty rather than being filled with a deck
     * back the author never asked for.
     *
     * Always one copy, never `card.quantity`: there is no quantity to read,
     * and one stat sheet per identity is what a box holds.
     */
    for (const sheet of characterCardItems(entry.character)) {
      add('poker', { front: sheet, back: null }, 1);
    }
  }

  // A figure's deck outlives it; its cards still print.
  for (const entries of [view.initiative, view.rules, view.events, view.loose]) {
    for (const entry of entries) {
      for (const card of entry.cards) {
        const character = characterForCard(set, card);
        add(sizeFor(card), pairingFor(card, character), options.useQuantities ? card.quantity : 1);
      }
    }
  }

  if (options.backs) {
    const initiative = view.initiative.some((entry) => entry.cards.length > 0);
    if (initiative) {
      /*
       * The initiative deck's printed back is a finished image with no face
       * behind it — nothing in the renderer draws it, which is the same gap
       * the Tabletop Simulator export works around by swapping a URL. Saying
       * so is better than printing a blank and letting it be discovered after
       * the paper is used.
       */
      warnings.push(
        'Initiative cards print single-sided: the initiative deck back has no face to draw.'
      );
    }
    if (view.rules.some((entry) => entry.cards.length > 0)) {
      warnings.push('Rules cards print single-sided: they have no designed reverse.');
    }
    if (view.heroes.length > 0) {
      warnings.push(
        'Character cards print single-sided: a hero’s stat sheet is a reference ' +
          'card, so it has no reverse to design.'
      );
    }
  }

  return { groups, warnings };
}

/**
 * Reverse each row.
 *
 * A duplex printer flipping on the long edge turns the sheet about its vertical
 * axis, so the leftmost cell of a row comes back as the rightmost. Laying the
 * backs out in reading order is what puts every card's reverse on its
 * neighbour.
 */
function mirror<T>(cells: T[], columns: number): T[] {
  const out: T[] = [];
  for (let start = 0; start < cells.length; start += columns) {
    out.push(...cells.slice(start, start + columns).reverse());
  }
  return out;
}

const SIZE_LABELS: Readonly<Record<SizeName, string>> = {
  poker: 'Cards',
  initiative: 'Initiative cards',
  event: 'Event cards'
};

export function planPrintPages(set: AdventureSet, options: PrintPlanOptions): PrintPlan {
  const { groups, warnings } = planPairings(set, options);
  const pages: PrintPage[] = [];

  for (const [size, pairings] of groups) {
    if (pairings.length === 0) continue;

    const sizeMm = SIZES[size];
    const grid = gridFor(options.paper, sizeMm);

    if (grid.perPage === 0) {
      warnings.push(
        `${SIZE_LABELS[size]} are ${sizeMm.width} × ${sizeMm.height} mm and will not fit on this paper with a 10 mm margin.`
      );
      continue;
    }

    const sheets = Math.ceil(pairings.length / grid.perPage);
    for (let sheet = 0; sheet < sheets; sheet += 1) {
      const slice = pairings.slice(sheet * grid.perPage, (sheet + 1) * grid.perPage);
      const pad = <T>(cells: (T | null)[]): (T | null)[] => [
        ...cells,
        ...Array.from({ length: grid.perPage - cells.length }, () => null)
      ];

      pages.push({
        key: `${size}-${sheet}-front`,
        label: `${SIZE_LABELS[size]} — sheet ${sheet + 1} of ${sheets}`,
        sizeMm,
        grid,
        cells: pad(slice.map((pairing) => pairing.front)),
        side: 'front'
      });

      if (!options.backs) continue;

      const backs = pad(slice.map((pairing) => pairing.back));
      // A sheet whose cards all print single-sided has no reverse worth paper.
      if (backs.every((cell) => cell === null)) continue;

      pages.push({
        key: `${size}-${sheet}-back`,
        label: `${SIZE_LABELS[size]} — sheet ${sheet + 1} of ${sheets}, reverse`,
        sizeMm,
        grid,
        cells: mirror(backs, grid.columns),
        side: 'back'
      });
    }
  }

  return { pages, warnings };
}

/** Total physical cards a plan puts on paper. Drives the summary line. */
export function countCards(plan: PrintPlan): number {
  return plan.pages
    .filter((page) => page.side === 'front')
    .reduce((total, page) => total + page.cells.filter((cell) => cell !== null).length, 0);
}
