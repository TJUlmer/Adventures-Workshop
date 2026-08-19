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
  /**
   * The hero action card's own frame and combat ribbon.
   *
   * All three are derived — `tools/hero-card-assets.py` splits them out of the
   * supplied `hero_action_card_border.png`, which paints the frame, the
   * ribbon's head and a leftover boost numeral into one picture. Regenerate
   * rather than hand-editing.
   *
   * The frame is a separate file from `outerBorder` rather than a reuse of it
   * because the supplied art really is different: its bottom right corner
   * takes the same radius as the other three, where the villain frame sweeps
   * out to clear the copies count.
   *
   * There is no file for the ribbon's straight run: it is a rectangle, and the
   * renderer draws it as one so the ribbon can be any length. Only the head
   * and the point have shape.
   */
  heroActionBorder: `${TEMPLATES}/hero_action_frame.png`,
  /** The ribbon's head, chevron foot and all: it takes the symbol's colour. */
  heroCombatBanner: `${TEMPLATES}/hero_combat_banner.png`,
  /** The pennant point, and its outline, at the ribbon's foot. */
  heroRibbonPoint: `${TEMPLATES}/hero_ribbon_point.png`,
  heroRibbonPointEdge: `${TEMPLATES}/hero_ribbon_point_edge.png`,
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
   * A hero's deck back: a cream ring at the card's own `INTERIOR` bounds, and
   * nothing else — the supplied template carries no lockup or rule to stand in
   * for. Generated with Python/PIL rather than extracted from the template,
   * because a drawn rounded-rectangle at `INTERIOR`'s own measured bounds is
   * more precise than tracing the template's anti-aliased edge would be.
   * Regenerate rather than hand-editing if the border position ever moves.
   */
  heroCardback: `${TEMPLATES}/hero_cardback_border.png`,
  /**
   * A hero's character card, in three pieces per layout.
   *
   * `tools/hero-card-assets.py` splits each supplied frame into its **border**
   * — the pink outline and the bars between the bands — and its **badge** —
   * the health badge behind the START HEALTH number — both colours an author
   * would want to choose, so both are masks; and its **ink**: every tab
   * label, the START HEALTH captions, the move arrow and the word MOVE, which
   * are already in the colours they print and are nobody's choice, so they
   * stay a picture. None of the three overlap.
   *
   * Three layouts, because each supplied frame is one flat picture with
   * nothing in it to switch off: a quote panel, a sidekick's two bands, and a
   * derived third for a swarm sidekick with the lower health badge taken out.
   */
  heroCharacterBorder: {
    quote: `${TEMPLATES}/hero_character_border.png`,
    sidekick: `${TEMPLATES}/hero_character_border_sidekick.png`,
    multi: `${TEMPLATES}/hero_character_border_multi.png`
  },
  /**
   * The hero's own (upper) health badge only — never the sidekick's — the
   * whole shield, its own natural taper included.
   */
  heroCharacterBadge: {
    quote: `${TEMPLATES}/hero_character_badge.png`,
    sidekick: `${TEMPLATES}/hero_character_badge_sidekick.png`,
    multi: `${TEMPLATES}/hero_character_badge_multi.png`
  },
  /** A small triangle notched into the badge, printed as its own decorative colour. */
  heroCharacterBadgeAccent: {
    quote: `${TEMPLATES}/hero_character_badge_accent.png`,
    sidekick: `${TEMPLATES}/hero_character_badge_accent_sidekick.png`,
    multi: `${TEMPLATES}/hero_character_badge_accent_multi.png`
  },
  heroCharacterInk: {
    quote: `${TEMPLATES}/hero_character_ink.png`,
    sidekick: `${TEMPLATES}/hero_character_ink_sidekick.png`,
    multi: `${TEMPLATES}/hero_character_ink_multi.png`
  },
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

/**
 * A figure's attack type, for the character card's attack rows.
 *
 * A different set from `CARD_SYMBOLS`: those name a card's combat *symbol*,
 * these name how a figure attacks, and the character card is the only place
 * that prints them.
 *
 * Each file is the **whole lockup** — the word and its icon drawn together,
 * in the colour that identifies the type — so the renderer places one picture
 * and sets no type at all. That is not a shortcut: the words are letterspaced
 * artwork rather than a face this project has, and an earlier pass that set
 * the word itself and lifted the icon out beside it had to guess at both.
 */
export const ATTACK_TYPE_SYMBOLS = {
  melee: `${SYMBOLS}/melee.png`,
  ranged: `${SYMBOLS}/ranged.png`,
  lunge: `${SYMBOLS}/lunge.png`,
  reach: `${SYMBOLS}/reach.png`,
  large: `${SYMBOLS}/large.png`
} as const;

export type AttackTypeName = keyof typeof ATTACK_TYPE_SYMBOLS;

/**
 * Printed width of each lockup, and how far its ink sits inside the file's
 * left edge.
 *
 * The files do not share a scale. `melee`, `ranged` and `reach` were exported
 * at print size — `ranged` measures 720 × 137 against the 718 × 135 the
 * template draws — while `lunge` and `large` came out about 1.86× that. What
 * *is* common to all five is the word: its caps stand 58 in every file at
 * print size, because on the printed card they are one size set once. So the
 * two oversized files are scaled by their own word rather than by a guessed
 * factor, and the ink inset that scaling leaves is carried here so every
 * lockup still starts on the same line.
 */
export const ATTACK_TYPE_SIZES: Readonly<
  Record<AttackTypeName, { width: number; inset: number }>
> = {
  melee: { width: 653, inset: 0 },
  ranged: { width: 720, inset: 0 },
  reach: { width: 738, inset: 0 },
  lunge: { width: 728, inset: 8 },
  large: { width: 684, inset: 23 }
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

/**
 * Fixed colours for a hero card's combat ribbon: white ink on a background of
 * the symbol's own colour, rather than a coloured icon on the card's body fill
 * — the reverse of how a villain or minion card prints attack and defense.
 *
 * Not part of `CardTheme` and not styleable through the cascade, on purpose.
 * These identify *which symbol this is* — attack is always this red, whatever
 * set it appears in — the same way `CARD_SYMBOLS` and `CARD_SYMBOL_SIZES` are
 * fixed rather than themed. Measured against the printed template, where the
 * ribbon head this example card shows is exactly `versatile`'s colour.
 */
export const CARD_SYMBOL_COLORS: Readonly<Record<CardSymbolName, string>> = {
  attack: '#cf2931',
  defense: '#2c76ac',
  versatile: '#6c4e8d',
  scheme: '#fcbd71'
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
