/**
 * Static card chrome, served from `public/assets` as stable URLs.
 *
 * Every border file carries a real alpha channel, so it is used as a CSS mask
 * over a colour or gradient rather than as a flat image. That is what makes the
 * frame, banner and boost ring recolourable without redrawing the artwork.
 */

const TEMPLATES = '/assets/templates';
const SYMBOLS = '/assets/symbols';
export const PATTERNS_DIR = '/assets/patterns';

export const TEMPLATE_ASSETS = {
  /** Outer frame: opaque border, transparent card interior. */
  outerBorder: `${TEMPLATES}/outer_border.png`,
  /**
   * Divider line under the art window, with the boost ring. Only the ring is
   * masked out of it — the bar is a plain rectangle the renderer draws, so the
   * divider can sit wherever the body panel's copy has pushed it.
   */
  innerBorder: `${TEMPLATES}/inner_border.png`,
  /** Name ribbon: outline and solid fill. */
  bannerBorder: `${TEMPLATES}/banner_border.png`,
  bannerFill: `${TEMPLATES}/banner_fill.png`,
  /** Disc behind the boost value. */
  boostFill: `${TEMPLATES}/boost_fill.png`,
  /** Separator between the halves of a split card, with curved shoulders. */
  splitSeparator: `${TEMPLATES}/split_effect_separator.png`,
  /**
   * Three-band initiative frame: `Initiative Card_border.png` with the band
   * bars and the label separators erased, so the renderer can draw those at
   * whichever band positions the card actually has.
   */
  initiativeBorder: `${TEMPLATES}/initiative_frame.png`,
  /** Rules card frame. */
  rulesBorder: `${TEMPLATES}/rules_border.png`,
  /**
   * The badge on an event card's reverse and on the threat board's nameplate.
   *
   * Two alpha layers — the plate, and whatever is knocked out of it — because
   * that is the shape the publisher's lockup had, and this stands in its
   * footprint until a licensed replacement can go back in. The ink layer is
   * deliberately empty: drop artwork into it and the badge fills again with no
   * other change. See `assets/WHERE_TO_PUT_ASSETS.txt`.
   */
  eventLogo: `${TEMPLATES}/event_logo.png`,
  eventLogoInk: `${TEMPLATES}/event_logo_ink.png`,
  /**
   * Deck back: transparent line art laid over the author's composition.
   *
   * Frame and rule only — the publisher's lockup and the line of type in the
   * lower right are both gone, rather than being stood in for. What is left is
   * the part of the printed back that is the *card's* rather than the
   * publisher's, so nothing has to be cleared from it later.
   * `adventures_minion_cardback_original.png` is the file it came from, and
   * `adventures_minion_cardback.png` the intermediate that kept an empty plate.
   */
  minionCardback: `${TEMPLATES}/adventures_minion_cardback_nologo.png`,
  /**
   * The printed back of the initiative deck. A finished image rather than a
   * mask: the initiative deck belongs to the adventure, so unlike a figure's
   * deck there is nothing per-set to compose into it.
   *
   * `adventures_initiative.png` is the one this replaced.
   */
  initiativeCardback: `${TEMPLATES}/initiative_variation.png`,
  /** "MOVE 3" badge for the Right Now band. */
  initiativeMove: `${TEMPLATES}/UMA_initiative_Move3.png`
} as const;

export const CARD_SYMBOLS = {
  attack: `${SYMBOLS}/attack.png`,
  defense: `${SYMBOLS}/defense.png`,
  versatile: `${SYMBOLS}/versatile.png`,
  scheme: `${SYMBOLS}/scheme.png`
} as const;

export type CardSymbolName = keyof typeof CARD_SYMBOLS;

/**
 * Natural pixel size of each symbol file. They are already drawn at printed
 * size for a 1632px-wide card, so the renderer places them 1:1 rather than
 * stretching them to a common box — an attack burst really is wider and
 * taller than a defense shield.
 */
export const CARD_SYMBOL_SIZES: Readonly<Record<CardSymbolName, { width: number; height: number }>> =
  {
    attack: { width: 167, height: 164 },
    defense: { width: 125, height: 145 },
    versatile: { width: 141, height: 143 },
    scheme: { width: 103, height: 242 }
  } as const;

export const CARD_SYMBOL_LABELS: Readonly<Record<CardSymbolName, string>> = {
  attack: 'Attack',
  defense: 'Defense',
  versatile: 'Versatile',
  scheme: 'Scheme'
} as const;

export function symbolUrl(name: CardSymbolName): string {
  return CARD_SYMBOLS[name];
}

export function patternUrl(name: string): string {
  return `${PATTERNS_DIR}/${name}.svg`;
}

/**
 * Every pattern in `public/assets/patterns`. The files are single-colour
 * shapes on transparency, so the renderer masks a colour through them and any
 * pattern can take any colour.
 */
export const PATTERN_NAMES = [
  '4-point-stars', 'anchors-away', 'architect', 'autumn', 'aztec', 'bamboo',
  'bank-note', 'bathroom-floor', 'bevel-circle', 'boxes', 'brick-wall', 'bubbles',
  'cage', 'charlie-brown', 'church-on-sunday', 'circles-and-squares', 'circuit-board',
  'connections', 'cork-screw', 'current', 'curtain', 'cutout', 'death-star',
  'diagonal-lines', 'diagonal-stripes', 'dominos', 'endless-clouds', 'eyes',
  'falling-triangles', 'fancy-rectangles', 'flipped-diamonds', 'floating-cogs',
  'floor-tile', 'formal-invitation', 'glamorous', 'graph-paper', 'groovy',
  'happy-intersection', 'heavy-rain', 'hexagons', 'hideout', 'houndstooth',
  'i-like-food', 'intersecting-circles', 'jigsaw', 'jupiter', 'kiwi', 'leaf',
  'line-in-motion', 'lips', 'lisbon', 'melt', 'moroccan', 'morphing-diamonds',
  'overcast', 'overlapping-circles', 'overlapping-diamonds', 'overlapping-hexagons',
  'parkay-floor', 'piano-man', 'pie-factory', 'pixel-dots', 'plus', 'polka-dots',
  'rails', 'rain', 'random-shapes', 'rounded-plus-connected', 'signal', 'skulls',
  'slanted-stars', 'squares', 'squares-in-squares', 'stamp-collection', 'steel-beams',
  'stripes', 'temple', 'texture', 'tic-tac-toe', 'tiny-checkers', 'topography',
  'volcano-lamp', 'wallpaper', 'wiggle', 'x-equals', 'yyy', 'zig-zag'
] as const;

export type PatternName = (typeof PATTERN_NAMES)[number];

/**
 * Height ÷ width of each pattern tile that is not square. Square tiles are the
 * common case and are left out.
 *
 * An SVG asked for a size that is not its own shape letterboxes rather than
 * stretching — `preserveAspectRatio` defaults to `meet` — so tiling one of
 * these into a square box leaves transparent bands where the pattern should
 * have joined up. Sizing the tile from its real proportions is what closes
 * them.
 */
const PATTERN_ASPECTS: Readonly<Record<string, number>> = {
  'architect': 1.99, 'autumn': 0.272727, 'aztec': 2, 'bamboo': 2, 'bank-note': 0.2,
  'brick-wall': 1.04762, 'cage': 0.8125, 'charlie-brown': 0.6, 'cork-screw': 0.8,
  'current': 0.236842, 'curtain': 0.272727, 'death-star': 1.3125, 'dominos': 0.666667,
  'endless-clouds': 0.5, 'eyes': 0.6, 'falling-triangles': 2, 'fancy-rectangles': 0.8,
  'flipped-diamonds': 1.25, 'formal-invitation': 0.18, 'groovy': 1.66667, 'heavy-rain': 2,
  'hexagons': 1.75, 'kiwi': 1.29412, 'leaf': 0.5, 'lips': 0.821429, 'melt': 0.833333,
  'moroccan': 1.1, 'overlapping-diamonds': 1.33333, 'overlapping-hexagons': 0.8,
  'piano-man': 0.657143, 'rails': 0.5, 'rain': 1.33333, 'signal': 0.571429,
  'stamp-collection': 1.38961, 'steel-beams': 1.38095, 'stripes': 0.025,
  'volcano-lamp': 0.666667, 'wallpaper': 0.190476, 'wiggle': 0.5, 'yyy': 1.6, 'zig-zag': 0.3
};

/** Tile height as a multiple of its width. 1 for a square tile. */
export function patternAspect(name: string | null): number {
  return (name && PATTERN_ASPECTS[name]) || 1;
}
