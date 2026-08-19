/**
 * The visual language of a printed card.
 *
 * Colours here are concrete values rather than references to the app's design
 * tokens: a card must look identical whatever the editor chrome is doing, and a
 * PNG or PDF export has no `--grey-900` to resolve.
 *
 * This module has no imports on purpose — `cards/types.ts` depends on it, so
 * anything that depends back on card types belongs in `cards/theme.ts`.
 */

// -- Fills --------------------------------------------------------------

export type FillKind = 'solid' | 'gradient';

/** A paintable surface: one colour, or a two-stop linear gradient. */
export interface Fill {
  kind: FillKind;
  color: string;
  /** Second stop. Ignored when `kind` is `solid`. */
  color2: string;
  /** Gradient direction in degrees, 0 = upward. */
  angle: number;
}

export function solid(color: string): Fill {
  return { kind: 'solid', color, color2: color, angle: 180 };
}

export function gradient(color: string, color2: string, angle = 180): Fill {
  return { kind: 'gradient', color, color2, angle };
}

/** CSS `background` value for a fill. */
export function fillCss(fill: Fill): string {
  if (fill.kind === 'solid') return fill.color;
  return `linear-gradient(${fill.angle}deg, ${fill.color}, ${fill.color2})`;
}

// -- Body pattern -------------------------------------------------------

/**
 * Pattern files are single-colour shapes on transparency, so the renderer
 * masks `color` through them instead of using them as images. Any pattern can
 * therefore take any colour.
 */
export interface PatternStyle {
  /** File stem in `/assets/patterns`, or `null` for no pattern. */
  name: string | null;
  color: string;
  /** 0..1 */
  opacity: number;
  /** Tile size multiplier. 1 = the file's natural size. */
  scale: number;
}

export const NO_PATTERN: PatternStyle = {
  name: null,
  color: '#ffffff',
  opacity: 0.12,
  scale: 1
};

export const TEXTURES = [
  'none',
  'grain',
  'paper',
  'linen',
  'canvas',
  'crosshatch',
  'halftone',
  'speckle',
  'vignette',
  'glow'
] as const;
export type TextureKind = (typeof TEXTURES)[number];

export const TEXTURE_LABELS: Readonly<Record<TextureKind, string>> = {
  none: 'None',
  grain: 'Grain',
  paper: 'Paper',
  linen: 'Linen',
  canvas: 'Canvas',
  crosshatch: 'Crosshatch',
  halftone: 'Halftone',
  speckle: 'Speckle',
  vignette: 'Vignette',
  glow: 'Glow'
} as const;

export interface TextureStyle {
  kind: TextureKind;
  /** 0..1 */
  opacity: number;
}

// -- Theme --------------------------------------------------------------

/** A fully resolved look. Every field has a value; nothing is left to inherit. */
export interface CardTheme {
  /** Printed border and the bleed around it. */
  frame: Fill;
  /** Name ribbon. */
  banner: Fill;
  bannerInk: string;
  /** Lower panel behind the title, values and ability text. */
  body: Fill;
  bodyInk: string;
  /**
   * The heading band: a rules card's, above the template's rule, and an event
   * card's front, where the heading has a panel of its own. Other templates
   * have no such band and ignore both of these.
   */
  header: Fill;
  headerInk: string;
  /** An event card's reverse: its field, and the heading printed on it. */
  back: Fill;
  backInk: string;
  /**
   * Face for the display heading, as a key into `DISPLAY_FONTS` — never a font
   * stack, so a document cannot put arbitrary CSS into `font-family`.
   */
  displayFont: string;
  /** Behind the artwork, and visible wherever the art does not cover. */
  artBackground: Fill;
  /** Divider line under the art window, and the boost ring. */
  divider: string;
  /** Disc behind the boost value. */
  boost: Fill;
  boostInk: string;
  /**
   * The Bonus ability line, printed last on an action card's ability text —
   * its own ink rather than `bodyInk`, since it is meant to stand apart from
   * the timed blocks above it.
   */
  bonusAbilityInk: string;
  /**
   * `AbilityBlocks.bonusIcon`'s printed height, in multiples of the ability
   * text's own font size — the same unit `AbilityText.svelte`'s `.bonus-icon`
   * already sizes itself in, just promoted from a fixed constant to a themed
   * one. Shared across a split card's two sides, like `bonusAbilityInk` and
   * `abilityFontSize` below, since it is a look rather than content — the
   * icon *choice* stays per side, on `AbilityBlocks` itself.
   */
  bonusIconSize: number;
  /**
   * Ability text size on an action card, in the same "artwork units" every
   * other measured size in `renderer/geometry.ts` is expressed in — see
   * `ABILITY.size` there, which this overrides. A temporary dial rather than
   * a genuine author-facing surface: it exists to find the right printed
   * size by eye, not to let two cards in one set carry different ones.
   */
  abilityFontSize: number;
  /** Pattern laid over the body panel. */
  pattern: PatternStyle;
  /** Texture laid over the whole card face. */
  texture: TextureStyle;
}

/**
 * A sparse set of overrides. An absent key inherits from the layer above;
 * clearing a key is a delete, never a write of `undefined`.
 */
export type CardStyleOverride = Partial<CardTheme>;

/**
 * The stock Unmatched Adventures look, taken from the print template.
 *
 * The boost disc is the body panel's own colour: on the printed card the disc
 * is not a shape *on* the panel, it is a hole in the divider, and the ring
 * around it is what makes it read.
 */
export const DEFAULT_CARD_THEME: CardTheme = {
  frame: solid('#001722'),
  banner: solid('#3c4348'),
  bannerInk: '#ffffff',
  body: solid('#3f474c'),
  bodyInk: '#ffffff',
  header: solid('#3f474c'),
  headerInk: '#ffffff',
  back: solid('#f1d7be'),
  backInk: '#1a1a1a',
  displayFont: 'edo',
  artBackground: solid('#ffffff'),
  divider: '#001722',
  boost: solid('#3f474c'),
  boostInk: '#ffffff',
  bonusAbilityInk: '#ffffff',
  /*
   * A judgement call, not a measured constant — unlike most sizes in this
   * app, there is no printed Adventures template this decoration is read
   * off (it doesn't exist on a real card). Adjustable per set/character/card
   * from here down for exactly that reason.
   */
  bonusIconSize: 2.1,
  abilityFontSize: 90,
  pattern: NO_PATTERN,
  texture: { kind: 'none', opacity: 0.3 }
};

/**
 * The event card's own stock look, sampled from `event_front_template.png` and
 * `event_back_template.png`.
 *
 * It is a different printed object from the rest of the set — a red placard
 * rather than a slate card — so it starts from its own values rather than
 * inheriting slate ones it would have to override away. Everything the author
 * sets at set, character or card level still layers on top of this.
 */
export const EVENT_CARD_THEME: CardTheme = {
  ...DEFAULT_CARD_THEME,
  /* Border, corner wedge and logo box on the reverse. */
  frame: solid('#ca402d'),
  /* The heading panel on the face, and the heading itself. */
  header: solid('#cb4734'),
  headerInk: '#f1d7be',
  /* The band under it, and its copy. */
  body: solid('#000000'),
  bodyInk: '#ffffff',
  back: solid('#f1d7be'),
  backInk: '#1a1a1a'
};

/**
 * The hero action card's own stock look, measured off
 * `Hero_Action_Card_Template.png`.
 *
 * A colour inversion of the default rather than a fresh palette: `frame`
 * takes the cream the default card uses nowhere, and `banner`/`body`/`boost`
 * take the navy the default frame is drawn in. `bannerInk`, `bodyInk` and
 * `boostInk` are already white on the default theme, so nothing about them
 * needs restating here.
 *
 * `divider` follows `frame` rather than staying at its default — on the
 * *default* theme the two already happen to match (`#001722` each), which is
 * what makes the boost ring and the ribbon's outline read as the same
 * structural cream as the border here rather than as a leftover navy stroke
 * nobody asked for.
 */
export const HERO_ACTION_CARD_THEME: CardTheme = {
  ...DEFAULT_CARD_THEME,
  frame: solid('#f6eada'),
  banner: solid('#001722'),
  body: solid('#001722'),
  boost: solid('#001722'),
  divider: '#f6eada'
};

export const THEME_KEYS = [
  'frame',
  'banner',
  'bannerInk',
  'body',
  'bodyInk',
  'header',
  'headerInk',
  'back',
  'backInk',
  'displayFont',
  'artBackground',
  'divider',
  'boost',
  'boostInk',
  'bonusAbilityInk',
  'bonusIconSize',
  'abilityFontSize',
  'pattern',
  'texture'
] as const;

/** Drop keys whose value is `undefined` so a sparse layer never clobbers. */
function definedEntries(override: CardStyleOverride): CardStyleOverride {
  const result: CardStyleOverride = {};
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) Object.assign(result, { [key]: value });
  }
  return result;
}

/**
 * Flatten a cascade. Later layers win, and only for the keys they define.
 * The app's order is: stock theme → set → character → card.
 */
export function mergeCardStyle(
  base: CardTheme,
  ...layers: readonly (CardStyleOverride | null | undefined)[]
): CardTheme {
  let theme = base;
  for (const layer of layers) {
    if (layer) theme = { ...theme, ...definedEntries(layer) };
  }
  return theme;
}
