/**
 * The paper a print sheet is laid out on.
 *
 * Everything here is in millimetres, and that is the point: a print sheet is
 * the one place in the app where the physical size *is* the specification. A
 * card that comes off the printer at 62mm will not sleeve, however good it
 * looks on screen.
 *
 * There is no bleed anywhere in this module. Bleed is a commercial printer's
 * requirement — it exists so a guillotine can miss — and someone cutting at a
 * kitchen table with a craft knife is cutting *to* the line, not through it.
 */

export interface Paper {
  readonly id: PaperId;
  readonly label: string;
  readonly widthMm: number;
  readonly heightMm: number;
}

export const PAPER_IDS = ['a4', 'letter'] as const;
export type PaperId = (typeof PAPER_IDS)[number];

/**
 * `letter` is 8.5 × 11 inches carried to a tenth of a millimetre rather than
 * rounded to 216 × 279: the rounding is worth half a millimetre across the
 * sheet, which is enough to lose a column at the margin.
 */
export const PAPERS: Readonly<Record<PaperId, Paper>> = {
  a4: { id: 'a4', label: 'A4 — 210 × 297 mm', widthMm: 210, heightMm: 297 },
  letter: { id: 'letter', label: 'US Letter — 216 × 279 mm', widthMm: 215.9, heightMm: 279.4 }
} as const;

/**
 * Margin kept clear on every edge.
 *
 * Consumer inkjets and lasers hold a few millimetres of unprintable edge that
 * they do not agree on, and a card clipped by the hardware is wasted paper.
 * 10mm clears every printer we could find a specification for, and it is also
 * where the crop marks live — outside the grid, so no mark is ever drawn on a
 * card.
 */
export const PAGE_MARGIN_MM = 10;

/**
 * How far a crop mark runs into the margin, and how heavy it is drawn.
 *
 * The marks sit in the margin and stop short of the grid, so the knife has two
 * points to line up against and the card itself carries no ink from us.
 */
export const CROP_MARK_MM = 4;
export const HAIRLINE_MM = 0.2;

/**
 * The calibration rule printed on every sheet.
 *
 * This exists because of the one failure mode a print view cannot design its
 * way out of: the browser's own print dialogue defaults to "Fit to page" in
 * several browsers, which silently scales the whole sheet by a few per cent.
 * Cards come out very slightly small, which is invisible until they will not
 * go into a sleeve.
 *
 * So the sheet prints a ruler. Measure it; if it is not 100mm, the scaling is
 * wrong and no amount of care in this module will have helped.
 */
export const CALIBRATION_MM = 100;

export interface PageGrid {
  readonly columns: number;
  readonly rows: number;
  readonly perPage: number;
}

/** Usable area once the margins are taken off. */
export function printableArea(paper: Paper): { widthMm: number; heightMm: number } {
  return {
    widthMm: paper.widthMm - PAGE_MARGIN_MM * 2,
    heightMm: paper.heightMm - PAGE_MARGIN_MM * 2
  };
}

/**
 * How many cards of one size fit on one sheet.
 *
 * Cards butt against each other with no gutter, which is deliberate: one cut
 * serves the two cards either side of it, so a full sheet is nine cuts rather
 * than eighteen, and every cut that is not made is a cut that cannot wander.
 *
 * A grid of zero is a real answer — the event card's 67mm long edge does not
 * fit two across a 190mm printable width — and the caller has to handle it
 * rather than divide by it.
 */
export function gridFor(paper: Paper, card: { width: number; height: number }): PageGrid {
  const area = printableArea(paper);
  const columns = Math.floor(area.widthMm / card.width);
  const rows = Math.floor(area.heightMm / card.height);
  return { columns, rows, perPage: columns * rows };
}
