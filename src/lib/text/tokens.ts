/**
 * Inline tokens in ability text.
 *
 * Symbols are stored as `{{attack}}` rather than as pasted glyphs, so the text
 * stays plain, searchable and font-independent, and the renderer can swap in
 * the print-resolution PNG.
 *
 * `{{name}}` is the same idea applied to the figure: a card that names its
 * owner should keep naming it after the card is moved to another deck or the
 * figure is renamed, which a typed-out name cannot do.
 */
import type { CardSymbolName } from '$lib/renderer/assets';
import { CARD_SYMBOLS } from '$lib/renderer/assets';

export type AbilitySegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'symbol'; readonly name: CardSymbolName }
  /** Stands in for the figure the card belongs to. */
  | { readonly kind: 'subject' };

const TOKEN_PATTERN = /\{\{([a-z]+)\}\}/gi;

/** The token that prints the owning figure's name. */
export const SUBJECT_TOKEN = '{{name}}';

export function symbolToken(name: CardSymbolName): string {
  return `{{${name}}}`;
}

function isSymbolName(value: string): value is CardSymbolName {
  return Object.hasOwn(CARD_SYMBOLS, value);
}

/** Split text into runs and tokens. Unknown tokens stay as literal text. */
export function parseAbilityText(text: string): AbilitySegment[] {
  const segments: AbilitySegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const index = match.index;
    const name = (match[1] ?? '').toLowerCase();
    const token: AbilitySegment | null = isSymbolName(name)
      ? { kind: 'symbol', name }
      : name === 'name'
        ? { kind: 'subject' }
        : null;
    if (!token) continue;

    if (index > cursor) {
      segments.push({ kind: 'text', value: text.slice(cursor, index) });
    }
    segments.push(token);
    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ kind: 'text', value: text.slice(cursor) });
  }

  return segments;
}

/** Insert a token at a cursor position, returning the new text and caret. */
export function insertToken(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  token: string
): { text: string; caret: number } {
  const next = text.slice(0, selectionStart) + token + text.slice(selectionEnd);
  return { text: next, caret: selectionStart + token.length };
}
