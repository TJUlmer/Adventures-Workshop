import type { Id, IsoDateTime } from '$lib/core/id';
import { createId, now } from '$lib/core/id';

export type CustomSymbolId = Id<'CustomSymbol'>;

/**
 * An author-supplied glyph, usable anywhere the four built-in combat symbols
 * are: inline in ability text, and in rules/event rich text. Deliberately not
 * an `Artwork` — every use is a small, fixed-height inline icon the author
 * already exported at the right proportions, exactly like the bundled symbol
 * PNGs, which carry no crop or colour grade either.
 */
export interface CustomSymbol {
  readonly id: CustomSymbolId;
  name: string;
  /** Data URL. `null` until the author picks an image. */
  source: string | null;
  readonly createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export function createCustomSymbol(name = ''): CustomSymbol {
  const timestamp = now();
  return {
    id: createId<CustomSymbolId>('symbol'),
    name,
    source: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function customSymbolLabel(symbol: CustomSymbol): string {
  return symbol.name.trim() || 'Untitled symbol';
}
