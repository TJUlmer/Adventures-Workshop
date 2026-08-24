/**
 * The display faces an author can choose between.
 *
 * Stored as a key rather than as a font stack, so a document can never put
 * arbitrary CSS into a `font-family` — the renderer looks the key up here and
 * an unknown one falls back to the default rather than being passed through.
 *
 * Every entry is bundled in `public/assets/fonts` and registered in
 * `styles/card-fonts.css`; the fallbacks are for the moment before a face has
 * loaded.
 */

const FALLBACK = `'Haettenschweiler', 'Arial Narrow', sans-serif`;
const CONDENSED = `'Oswald Custom Condensed', ${FALLBACK}`;
const JUNIOR = `'Oswald Custom Junior', ${FALLBACK}`;

/*
 * Generic fallbacks by kind, for the moment before a face has loaded.
 *
 * A condensed fallback behind a script or a fat display face would reflow the
 * heading noticeably when the real file arrived — `fitDisplaySize` works off
 * the *recorded* advance either way, so the fallback's job is only to be the
 * least wrong shape while it waits.
 */
const SANS = 'sans-serif';
const SERIF = 'serif';
const SCRIPT = 'cursive';
const TYPEWRITER = 'monospace';

/**
 * The display faces, with the numbers a heading is sized from.
 *
 * `advance` is the face's mean capital advance in ems, and `weight` the weight
 * it is set at. Together they let a heading be fitted to its box without
 * measuring anything at render time; see `fitDisplaySize`.
 *
 * The six Oswald weights that used to be listed here were one variable file
 * driven along its `wght` axis, and the file that replaced them carried a
 * single weight — so those six would have set identically and five of the
 * labels would have been lying. What stands in for Knockout now is two *cuts*
 * rather than two weights, which is how the printed cards get their contrast in
 * the first place, so both are offered and the old keys resolve to the
 * condensed one through `LEGACY_DISPLAY_FONTS`.
 *
 * `advance` is the **mean capital advance in ems**, and it is measured, never
 * estimated: `python tools/display-advance.py` prints one line per file in
 * `public/assets/fonts` and is what every number below was pasted from. That
 * script's `--check` mode reproduces the three faces measured by hand before it
 * existed — Edo, Oswald Condensed and Oswald Junior — to within 0.02%, which is
 * what establishes it means the same thing by "advance" that `fitDisplaySize`
 * does.
 *
 * Re-measure whenever a file is replaced. Junior's read 0.4189 for a while
 * after the file behind it had changed, which sized the event heading 3% small
 * — the kind of drift that looks like a design choice rather than a stale
 * number.
 *
 * The keys are persisted in documents (`CardTheme.displayFont`), so a key here
 * may be **added but never renamed**; a rename needs an entry in
 * `LEGACY_DISPLAY_FONTS` below instead. Order is the order the picker lists
 * them: the stock face first, then the project's own card cuts, then the rest
 * alphabetically.
 */
export const DISPLAY_FONTS = {
  /** The brush face the printed event cards use. Caps only — it has no lower case. */
  edo: { label: 'Edo', stack: `'Edo', ${FALLBACK}`, advance: 0.525, weight: 400 },

  /* The project's own card cuts, offered here as well as used by the card's
     fixed roles — see `styles/card-fonts.css`. */
  /** Standing in for Knockout HTF48 Featherweight — the titling cut. */
  oswaldCustom: { label: 'Oswald Condensed', stack: CONDENSED, advance: 0.3295, weight: 400 },
  /** Standing in for HTF29 JuniorLiteweight — the cut the copy is set in. */
  oswaldJunior: { label: 'Oswald Junior', stack: JUNIOR, advance: 0.4322, weight: 400 },
  /**
   * The name-ribbon and card-title face. **Caps only** — every lowercase
   * codepoint is drawn as a capital, so a heading given this face sets
   * entirely in capitals whatever is typed. See `card-fonts.css`.
   */
  bebasNeue: {
    label: 'Bebas Neue',
    stack: `'Bebas Neue', ${FALLBACK}`,
    advance: 0.393,
    weight: 400
  },

  abrilFatface: {
    label: 'Abril Fatface',
    stack: `'Abril Fatface', ${SERIF}`,
    advance: 0.6798,
    weight: 400
  },
  /** Amatic SC's two static files are one family; this is the pair's whole point. */
  amaticSc: { label: 'Amatic SC', stack: `'Amatic SC', ${SCRIPT}`, advance: 0.3215, weight: 400 },
  amaticScBold: {
    label: 'Amatic SC Bold',
    stack: `'Amatic SC', ${SCRIPT}`,
    advance: 0.3305,
    weight: 700
  },
  bangers: { label: 'Bangers', stack: `'Bangers', ${SANS}`, advance: 0.4197, weight: 400 },
  caveat: { label: 'Caveat', stack: `'Caveat', ${SCRIPT}`, advance: 0.5092, weight: 400 },
  cinzel: { label: 'Cinzel', stack: `'Cinzel', ${SERIF}`, advance: 0.6827, weight: 400 },
  greatVibes: {
    label: 'Great Vibes',
    stack: `'Great Vibes', ${SCRIPT}`,
    advance: 0.9498,
    weight: 400
  },
  leagueGothic: {
    label: 'League Gothic',
    stack: `'League Gothic', ${FALLBACK}`,
    advance: 0.3534,
    weight: 400
  },
  leagueGothicSemiCondensed: {
    label: 'League Gothic SemiCond.',
    stack: `'League Gothic SemiCondensed', ${FALLBACK}`,
    advance: 0.2944,
    weight: 400
  },
  leagueGothicCondensed: {
    label: 'League Gothic Condensed',
    stack: `'League Gothic Condensed', ${FALLBACK}`,
    advance: 0.2353,
    weight: 400
  },
  montserrat: {
    label: 'Montserrat',
    stack: `'Montserrat', ${SANS}`,
    advance: 0.7046,
    weight: 400
  },
  montserratItalic: {
    label: 'Montserrat Italic',
    stack: `'Montserrat Italic', ${SANS}`,
    advance: 0.7032,
    weight: 400
  },
  /** Google's Oswald as shipped, not one of the project's redrawn cuts. */
  oswald: { label: 'Oswald', stack: `'Oswald', ${FALLBACK}`, advance: 0.4886, weight: 400 },
  pacifico: { label: 'Pacifico', stack: `'Pacifico', ${SCRIPT}`, advance: 0.8093, weight: 400 },
  permanentMarker: {
    label: 'Permanent Marker',
    stack: `'Permanent Marker', ${SCRIPT}`,
    advance: 0.6746,
    weight: 400
  },
  playfairDisplay: {
    label: 'Playfair Display',
    stack: `'Playfair Display', ${SERIF}`,
    advance: 0.6423,
    weight: 400
  },
  playfairDisplayItalic: {
    label: 'Playfair Display Italic',
    stack: `'Playfair Display Italic', ${SERIF}`,
    advance: 0.6685,
    weight: 400
  },
  righteous: { label: 'Righteous', stack: `'Righteous', ${SANS}`, advance: 0.6332, weight: 400 },
  specialElite: {
    label: 'Special Elite',
    stack: `'Special Elite', ${TYPEWRITER}`,
    advance: 0.6007,
    weight: 400
  }
} as const;

/**
 * Keys written before the family was two named cuts. Kept so an existing event
 * card keeps setting in the face it was given.
 */
const LEGACY_DISPLAY_FONTS: Readonly<Record<string, keyof typeof DISPLAY_FONTS>> = {
  oswaldExtraLight: 'oswaldCustom',
  oswaldLight: 'oswaldCustom',
  oswaldRegular: 'oswaldCustom',
  oswaldMedium: 'oswaldCustom',
  oswaldSemiBold: 'oswaldCustom',
  oswaldBold: 'oswaldCustom'
};

export type DisplayFont = keyof typeof DISPLAY_FONTS;

export const DISPLAY_FONT_NAMES = Object.keys(DISPLAY_FONTS) as DisplayFont[];

/** The stock display face: the one the printed event cards are set in. */
export const DEFAULT_DISPLAY_FONT: DisplayFont = 'edo';

function displayFont(name: string) {
  const key = LEGACY_DISPLAY_FONTS[name] ?? (name as DisplayFont);
  return DISPLAY_FONTS[key] ?? DISPLAY_FONTS[DEFAULT_DISPLAY_FONT];
}

/** CSS `font-family` for a stored key. Unknown keys fall back to the default. */
export function displayFontStack(name: string): string {
  return displayFont(name).stack;
}

/** CSS `font-weight` for a stored key. */
export function displayFontWeight(name: string): number {
  return displayFont(name).weight;
}

/** The longest line, in characters, of the best balanced split into `lines`. */
function widestLine(words: readonly string[], lines: number): number {
  const whole = words.join(' ').length;
  if (lines === 1 || words.length === 1) return whole;

  let best = whole;
  for (let split = 1; split < words.length; split += 1) {
    const head = words.slice(0, split).join(' ').length;
    const tail = words.slice(split).join(' ').length;
    best = Math.min(best, Math.max(head, tail));
  }
  return best;
}

/**
 * The largest size at which a heading still fits its box.
 *
 * A card's name is whatever the author types, and the printed lockup it is
 * imitating was hand-set to fill its panel — so a fixed size would either
 * overflow a long name or leave a short one stranded. This picks the size the
 * way a typesetter would: try it on one line, try it on two, keep whichever
 * sets larger.
 *
 * Derived from the face's mean advance rather than measured, so it costs
 * nothing and holds at any card size.
 */
export function fitDisplaySize(
  text: string,
  box: { readonly width: number; readonly height: number },
  font: string,
  maxSize: number,
  lineHeight: number
): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return maxSize;

  const { advance } = displayFont(font);
  let best = 0;
  for (let lines = 1; lines <= Math.min(2, words.length); lines += 1) {
    const byWidth = box.width / (advance * widestLine(words, lines));
    const byHeight = box.height / (lines * lineHeight);
    best = Math.max(best, Math.min(byWidth, byHeight));
  }
  return Math.min(maxSize, best);
}
