/**
 * The printer-friendly look.
 *
 * A home printer is not a press. It is slow, its toner is the expensive part,
 * and a card whose border is a 6mm slab of near-black comes out of it wet,
 * cockled and forty pages to a cartridge. So printer-friendly mode is not a
 * greyscale conversion of the designed card — it is the *same layout* drawn as
 * line on white, which is what a photocopier-era rulebook insert looked like
 * and what still reads best across the table.
 *
 * Most of it is one more layer on the existing cascade, which is the whole
 * argument for the cascade being there: stock → set → character → card → this.
 * It goes on top of the author's choices rather than replacing them, so nothing
 * in the document is touched and switching the mode off gets the design back
 * untouched.
 *
 * What the layer cannot reach is in `CardRenderer`'s `printer-friendly`
 * stylesheet: the initiative card's bands carry their own colours on the card
 * rather than in the theme, and artwork is not a colour at all.
 */
import type { CardStyleOverride } from './style';
import { NO_PATTERN, solid } from './style';

/** Paper and ink. Not `currentColor` or a token — a print file resolves neither. */
export const MONO_PAPER = '#ffffff';
export const MONO_INK = '#000000';

/**
 * `displayFont` is deliberately absent.
 *
 * The face an author chose for their headings is information — it is how a set
 * looks — and dropping to black and white is a decision about *ink*, not about
 * typography. Everything here is a colour or a texture for that reason.
 */
export const MONO_LAYER: CardStyleOverride = {
  frame: solid(MONO_PAPER),
  banner: solid(MONO_PAPER),
  bannerInk: MONO_INK,
  body: solid(MONO_PAPER),
  bodyInk: MONO_INK,
  header: solid(MONO_PAPER),
  headerInk: MONO_INK,
  back: solid(MONO_PAPER),
  backInk: MONO_INK,
  artBackground: solid(MONO_PAPER),
  /*
   * The one surface that stays black, and it is doing three jobs: the rule
   * under the art window, the ring around the boost disc, and — the reason it
   * matters most — the name ribbon's outline. The ribbon's *fill* goes white
   * with everything else, so without this the ribbon would vanish entirely
   * rather than becoming an outline of itself.
   */
  divider: MONO_INK,
  boost: solid(MONO_PAPER),
  boostInk: MONO_INK,
  /* Both exist to lay tone over a panel. There is no tone to lay. */
  pattern: NO_PATTERN,
  texture: { kind: 'none', opacity: 0 }
};
