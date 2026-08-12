/**
 * Face sheets: a pile of cards drawn onto one image.
 *
 * Tabletop Simulator does not load cards one file at a time. A `DeckCustom`
 * names a single image and a grid, and slot *n* of that grid is card *n* of the
 * deck — so an export has to photograph every card and then lay the results out
 * in a lattice.
 *
 * Two limits shape everything here. TTS refuses a texture over 4096px on either
 * side, and its grid is at most 10 × 7. Between them, a full 70-card sheet
 * gives each card about 410px, which is why cell size is *derived* from the
 * count rather than picked: a four-card rules pile has no reason to be as soft
 * as a full deck of them.
 */
import type { AdventureSet } from '$lib/sets/types';
import { resolveStyleForCard } from '$lib/sets/queries';
import { CARD_FORMATS, trimBox } from '$lib/renderer/geometry';
import type { Photograph } from './card-stage';
import {
  MAX_SHEET_CARDS,
  MAX_SHEET_COLUMNS,
  MAX_SHEET_ROWS
} from './tabletop-simulator';
import type { TtsCardPlan, TtsDeckPlan } from './tabletop-simulator';

/** TTS will not take a texture larger than this on either side. */
export const MAX_SHEET_PIXELS = 4096;

/**
 * Cell width beyond which nothing is gained.
 *
 * A card is a couple of inches on a table and TTS mip-maps it anyway, so a
 * two-card pile rendered at 2800px would cost a slow export and a large file to
 * show the same card. 800px is a comfortable margin over the 410 a full sheet
 * gets.
 */
const MAX_CELL_WIDTH = 800;

export interface SheetGrid {
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
}

/**
 * The grid that gives this many cards the largest cell.
 *
 * Searched rather than computed: the two limits pull opposite ways — more
 * columns means narrower cells, fewer columns means more rows and shorter ones
 * — and with at most 70 arrangements to consider, trying them all is both
 * shorter and obviously correct.
 */
export function chooseGrid(count: number, aspect: number): SheetGrid {
  let best: SheetGrid = { columns: 1, rows: 1, cellWidth: 0, cellHeight: 0 };

  for (let columns = 1; columns <= MAX_SHEET_COLUMNS; columns += 1) {
    const rows = Math.ceil(count / columns);
    if (rows > MAX_SHEET_ROWS) continue;

    const cellWidth = Math.floor(
      Math.min(MAX_SHEET_PIXELS / columns, (MAX_SHEET_PIXELS / rows) * aspect, MAX_CELL_WIDTH)
    );
    if (cellWidth <= best.cellWidth) continue;

    best = { columns, rows, cellWidth, cellHeight: Math.floor(cellWidth / aspect) };
  }

  return best;
}

/** Pages of at most one sheet's worth, in order. */
export function paginate(cards: readonly TtsCardPlan[]): TtsCardPlan[][] {
  const pages: TtsCardPlan[][] = [];
  for (let start = 0; start < cards.length; start += MAX_SHEET_CARDS) {
    pages.push(cards.slice(start, start + MAX_SHEET_CARDS));
  }
  return pages;
}

async function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode a face sheet.');
  return blob;
}

/**
 * Draw a page's images into their slots.
 *
 * Slots are filled row by row from the top left, which is the order TTS reads
 * them in — card *n* of the deck is cell *n* of the grid, and any other order
 * would deal a shuffled deck that is also mislabelled.
 */
async function composite(images: readonly Blob[], grid: SheetGrid): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = grid.columns * grid.cellWidth;
  canvas.height = grid.rows * grid.cellHeight;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not get a drawing context.');

  for (const [index, blob] of images.entries()) {
    const bitmap = await createImageBitmap(blob);
    try {
      context.drawImage(
        bitmap,
        (index % grid.columns) * grid.cellWidth,
        Math.floor(index / grid.columns) * grid.cellHeight,
        grid.cellWidth,
        grid.cellHeight
      );
    } finally {
      bitmap.close();
    }
  }

  return toPng(canvas);
}

export interface RenderedSheet {
  readonly grid: SheetGrid;
  readonly cards: readonly TtsCardPlan[];
  readonly face: Blob;
  /** A cell per card, when the cards carry their own backs. */
  readonly back: Blob | null;
}

export interface SheetRenderContext {
  readonly set: AdventureSet;
  readonly photograph: Photograph;
  /** Called after each card image, so a long export can say where it is. */
  readonly onImage?: () => void;
}

/** How many images a plan will produce, for a progress count. */
export function imageCount(plan: TtsDeckPlan): number {
  const perCardBacks = plan.back.kind === 'perCard' ? plan.cards.length : 0;
  const sharedBack = plan.back.kind === 'character' || plan.back.kind === 'plain' ? 1 : 0;
  return plan.cards.length + perCardBacks + sharedBack;
}

export async function renderDeckSheets(
  plan: TtsDeckPlan,
  context: SheetRenderContext
): Promise<RenderedSheet[]> {
  const trim = trimBox(plan.format);
  const perCardBacks = plan.back.kind === 'perCard';
  const sheets: RenderedSheet[] = [];

  for (const page of paginate(plan.cards)) {
    const grid = chooseGrid(page.length, trim.width / trim.height);

    /*
     * Cards are photographed at trim rather than with bleed: bleed is a
     * printer's margin, and a card in TTS is the finished object — leaving it
     * on would put a sliver of the next card's art around every edge.
     */
    const options = { bleed: false, width: grid.cellWidth };
    const faces: Blob[] = [];
    const backs: Blob[] = [];

    for (const planned of page) {
      const job = {
        card: planned.card,
        character: planned.character,
        theme: resolveStyleForCard(context.set, planned.card)
      };

      const face = await context.photograph(job, plan.format, options);
      if (face) faces.push(face);
      context.onImage?.();

      if (perCardBacks) {
        const back = await context.photograph({ ...job, side: 'back' }, plan.format, options);
        if (back) backs.push(back);
        context.onImage?.();
      }
    }

    sheets.push({
      grid,
      cards: page,
      face: await composite(faces, grid),
      back: perCardBacks ? await composite(backs, grid) : null
    });
  }

  return sheets;
}

/**
 * The one image a whole pile shows face down, when it has one.
 *
 * `perCard` returns nothing — those backs are drawn into the sheets above —
 * and an `asset` back is a finished file that only has to be copied, so
 * neither reaches a renderer.
 */
export async function renderSharedBack(
  plan: TtsDeckPlan,
  context: SheetRenderContext,
  format: { width: number; height: number }
): Promise<Blob | null> {
  if (plan.back.kind === 'perCard') return null;

  if (plan.back.kind === 'asset') {
    return (await fetch(plan.back.url)).blob();
  }

  if (plan.back.kind === 'character') {
    const back = await context.photograph(
      { card: null, cardback: plan.back.character },
      CARD_FORMATS.cardback,
      { bleed: false, width: format.width }
    );
    context.onImage?.();
    return back;
  }

  /*
   * Nothing designed to draw. A flat card in the set's stock slate is still a
   * usable back — a deck whose reverse is a transparent PNG reads as a bug in
   * TTS, where the table shows through it.
   */
  const canvas = document.createElement('canvas');
  canvas.width = format.width;
  canvas.height = format.height;
  const context2d = canvas.getContext('2d');
  if (!context2d) throw new Error('Could not get a drawing context.');
  context2d.fillStyle = '#14161d';
  context2d.fillRect(0, 0, canvas.width, canvas.height);
  context.onImage?.();
  return toPng(canvas);
}
