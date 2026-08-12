import { BLEED, TRIM } from './geometry';

export const CARD_SIZE_INCHES = { width: 2.5, height: 3.5 } as const;
export const PRINT_DPI = 300;

/** Physical geometry, re-exported so the export pipeline has one source. */
export const CARD_PIXEL_SIZE = BLEED;
export const CARD_TRIM_SIZE = TRIM;

export type RenderSurface = 'screen' | 'print';

export interface CardRenderOptions {
  surface: RenderSurface;
  /**
   * Show the bleed. Off by default, so the preview reads as the finished card
   * rather than as a print file.
   */
  showBleed: boolean;
  /** Overlay the cut line. Only meaningful while the bleed is shown. */
  showGuides: boolean;
  /**
   * Draw the card as line on white, with no artwork.
   *
   * A home printer's question, not the card's: same layout, same measured
   * geometry, a fraction of the toner. See `cards/mono.ts`.
   */
  printerFriendly: boolean;
}

export const DEFAULT_RENDER_OPTIONS: CardRenderOptions = {
  surface: 'screen',
  showBleed: false,
  showGuides: false,
  printerFriendly: false
};
