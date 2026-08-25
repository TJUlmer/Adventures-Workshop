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

// -- Writing a custom symbol by name ------------------------------------
//
// A custom symbol is *stored* as `{{custom:symbol_<uuid>}}` and always will
// be: the id is what survives a rename, so a card that uses a symbol keeps
// using it after its author renames it, and nothing has to rewrite every
// card's text to keep up. That is worth keeping and is not what anyone wants
// to read or type.
//
// So the id form is the storage form and `{{hook}}` is the *display* form,
// translated at the edge of the two fields that show token text at all —
// `AbilityField` and `TokenInput`. (Rich text has never shown a token: it
// carries a real `<img data-symbol-id>`, so there is nothing to translate.)
// The document is untouched by any of this, which means an older set opens
// exactly as before and a name can be changed as often as the author likes.

/** Names a custom symbol may not take, because a token already means them. */
const RESERVED = new Set([...Object.keys(CARD_SYMBOLS), 'name']);

/** What a name has to look like to be a token: the token grammar, minus `:`. */
const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * Which symbols may be written by name, as `name → id`.
 *
 * A name earns that only if it is unambiguous — anything else keeps the id
 * form, in the editor as well as in storage, so what is shown is always
 * something that can be typed back. Excluded: a blank name, one that is not
 * shaped like a token (spaces, punctuation, a leading digit), one that a
 * built-in token already claims (`attack`, `name`, …), and one that two
 * symbols share, where resolving it would be a guess. Case-insensitive,
 * because typing `{{Hook}}` and meaning `hook` is not a mistake worth
 * punishing.
 */
export function namedSymbols(
  symbols: readonly { id: CustomSymbolId; name: string }[]
): Map<string, CustomSymbolId> {
  const seen = new Map<string, CustomSymbolId | null>();
  for (const symbol of symbols) {
    const name = symbol.name.trim().toLowerCase();
    if (!name || !NAME_PATTERN.test(name) || RESERVED.has(name)) continue;
    // A repeat poisons the name for everyone, rather than the first winning.
    seen.set(name, seen.has(name) ? null : symbol.id);
  }
  const usable = new Map<string, CustomSymbolId>();
  for (const [name, id] of seen) if (id) usable.set(name, id);
  return usable;
}

/** The token to show and to insert for a symbol — its name where it can be. */
export function displaySymbolToken(
  symbol: { id: CustomSymbolId; name: string },
  symbols: readonly { id: CustomSymbolId; name: string }[]
): string {
  for (const [name, id] of namedSymbols(symbols)) {
    if (id === symbol.id) return `{{${name}}}`;
  }
  return customSymbolToken(symbol.id);
}

/** Storage form → what the author reads: `{{custom:…}}` becomes `{{hook}}`. */
export function toDisplayTokens(
  text: string,
  symbols: readonly { id: CustomSymbolId; name: string }[]
): string {
  const byId = new Map<CustomSymbolId, string>();
  for (const [name, id] of namedSymbols(symbols)) byId.set(id, name);
  if (byId.size === 0) return text;
  return text.replace(TOKEN_PATTERN, (raw, inner: string) => {
    if (!inner.startsWith(CUSTOM_SYMBOL_PREFIX)) return raw;
    const name = byId.get(inner.slice(CUSTOM_SYMBOL_PREFIX.length) as CustomSymbolId);
    return name ? `{{${name}}}` : raw;
  });
}

/**
 * What the author typed → storage form.
 *
 * A name this does not recognise is left exactly as written rather than
 * dropped, so a typo stays visible and fixable instead of silently becoming
 * nothing — the same way `parseAbilityText` leaves an unknown token as
 * literal text.
 */
export function toStoredTokens(
  text: string,
  symbols: readonly { id: CustomSymbolId; name: string }[]
): string {
  const byName = namedSymbols(symbols);
  if (byName.size === 0) return text;
  return text.replace(TOKEN_PATTERN, (raw, inner: string) => {
    const id = byName.get(inner.toLowerCase());
    return id ? customSymbolToken(id) : raw;
  });
}
