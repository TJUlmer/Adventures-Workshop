/**
 * The stand-in for a picture that is not there.
 *
 * A tile — a set in the gallery, a character, a set on the shelf, a deck in a
 * collection — wants something in its cover box even when nothing has an
 * image yet. Rather than a grey rectangle repeated down the page, each gets a
 * colour derived from its own id and its own initials over the top, so a grid
 * of pictureless things still reads as a grid of *different* things.
 *
 * Extracted because there were three byte-identical copies of both functions
 * (`GalleryScreen`, `AuthorProfileScreen`, `HomeScreen`) and a fourth was
 * about to be written for the collection page. Pure, no DOM, no reactivity —
 * which is what makes moving them safe where moving the tile *markup* around
 * them would not be: each screen's tile has its own proportions and its own
 * documented specificity traps, and only these two helpers were ever the
 * same thing.
 */

/**
 * A stable colour for an id.
 *
 * Deliberately deterministic rather than random: the same set gets the same
 * swatch on every visit and on every screen that draws it, which is the only
 * reason a colour is useful for telling tiles apart at all.
 *
 * Fixed saturation and lightness, so every swatch sits at the same weight
 * against the surrounding chrome and only the hue moves. `| 0` keeps the
 * running hash a 32-bit int rather than drifting into float territory on a
 * long id.
 */
export function tint(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360} 30% 26%)`;
}

/** Up to two letters for a name, or `?` when there is nothing to take. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}
