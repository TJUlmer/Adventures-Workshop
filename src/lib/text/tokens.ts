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
import type { CustomSymbolId } from '$lib/symbols/types';

export type AbilitySegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'symbol'; readonly name: CardSymbolName }
  /** An author-uploaded glyph, resolved against the set's registry at render time. */
  | { readonly kind: 'customSymbol'; readonly id: CustomSymbolId }
  /** Stands in for the figure the card belongs to. */
  | { readonly kind: 'subject' };

/**
 * Widened from the original `[a-z]+` to admit a custom symbol's id, which
 * contains hyphens and underscores (`createId` mints `prefix_<uuid>`) and a
 * `custom:` prefix that keeps it from ever colliding with a bare built-in
 * name or `name`.
 */
const TOKEN_PATTERN = /\{\{([a-zA-Z][a-zA-Z0-9:_-]*)\}\}/g;

const CUSTOM_SYMBOL_PREFIX = 'custom:';

/** The token that prints the owning figure's name. */
export const SUBJECT_TOKEN = '{{name}}';

export function symbolToken(name: CardSymbolName): string {
  return `{{${name}}}`;
}

export function customSymbolToken(id: CustomSymbolId): string {
  return `{{${CUSTOM_SYMBOL_PREFIX}${id}}}`;
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
    const raw = match[1] ?? '';
    const name = raw.toLowerCase();
    const token: AbilitySegment | null = isSymbolName(name)
      ? { kind: 'symbol', name }
      : name === 'name'
        ? { kind: 'subject' }
        : raw.startsWith(CUSTOM_SYMBOL_PREFIX) && raw.length > CUSTOM_SYMBOL_PREFIX.length
          ? { kind: 'customSymbol', id: raw.slice(CUSTOM_SYMBOL_PREFIX.length) as CustomSymbolId }
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
