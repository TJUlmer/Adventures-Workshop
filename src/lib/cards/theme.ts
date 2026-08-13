/**
 * Resolving a card's look.
 *
 * Four layers, each one sparse except the first:
 *   stock theme → set → character → card
 *
 * Everything below the first layer is a `CardStyleOverride`, so "inherit" is
 * the absence of a key rather than a sentinel value.
 */
import type { CardStyleOverride, CardTheme } from './style';
import { DEFAULT_CARD_THEME, EVENT_CARD_THEME, HERO_ACTION_CARD_THEME, mergeCardStyle } from './style';

/**
 * The bottom of the cascade, which is not the same for every template: an
 * event card is a red placard, not a slate card, so it starts from its own
 * values rather than from ones the author would have to override away.
 *
 * A hero's action card is the same template as a villain's or a minion's —
 * `type` alone cannot tell them apart, which is why `role` is a second,
 * separate parameter rather than a new card type. Only `'action'` plus
 * `role: 'hero'` reaches the hero stock theme; every other combination,
 * including a hero's *other* cards, falls through to the same default every
 * other role uses.
 */
export function stockTheme(type?: string, role?: string): CardTheme {
  if (type === 'event') return EVENT_CARD_THEME;
  if (type === 'action' && role === 'hero') return HERO_ACTION_CARD_THEME;
  return DEFAULT_CARD_THEME;
}

/**
 * Flatten the cascade for one card. Callers that lack a layer — a card in a
 * set-level deck has no character — pass `null`.
 */
export function resolveCardTheme(
  setStyle: CardStyleOverride | null,
  characterStyle: CardStyleOverride | null,
  cardStyle: CardStyleOverride | null,
  type?: string,
  role?: string
): CardTheme {
  return mergeCardStyle(stockTheme(type, role), setStyle, characterStyle, cardStyle);
}

/**
 * Which surfaces each template actually draws.
 *
 * Offering a control for something a card cannot show is worse than offering
 * none: it reads as a broken control rather than an inapplicable one. An
 * initiative card is absent because its bands are styled one by one, and the
 * border is the only surface it has left over.
 */
export const ACTION_SURFACES = [
  'frame',
  'banner',
  'body',
  'boost',
  'bannerInk',
  'bodyInk',
  'divider',
  'boostInk'
] as const satisfies readonly (keyof CardTheme)[];

/** Rules cards: a heading band over prose, and nothing else. */
export const PROSE_SURFACES = [
  'frame',
  'header',
  'body',
  'headerInk',
  'bodyInk'
] as const satisfies readonly (keyof CardTheme)[];

/**
 * Event cards, which print two faces: a heading panel over a copy band on the
 * front, and a bordered field on the reverse.
 */
export const EVENT_SURFACES = [
  'frame',
  'header',
  'body',
  'back',
  'headerInk',
  'bodyInk',
  'backInk'
] as const satisfies readonly (keyof CardTheme)[];

/**
 * Which layer a resolved value came from. Drives the "inherited" state in the
 * style editor so the author can see what they are actually overriding.
 */
export type StyleOrigin = 'stock' | 'set' | 'character' | 'card';

export const STYLE_ORIGIN_LABELS: Readonly<Record<StyleOrigin, string>> = {
  stock: 'template',
  set: 'set',
  character: 'character',
  card: 'card'
} as const;

export function styleOrigin(
  key: keyof CardTheme,
  setStyle: CardStyleOverride | null,
  characterStyle: CardStyleOverride | null,
  cardStyle: CardStyleOverride | null
): StyleOrigin {
  if (cardStyle && cardStyle[key] !== undefined) return 'card';
  if (characterStyle && characterStyle[key] !== undefined) return 'character';
  if (setStyle && setStyle[key] !== undefined) return 'set';
  return 'stock';
}
