/**
 * The small picture a gallery tile is drawn with.
 *
 * A gallery cannot read `document` to find one: that column is the whole set,
 * so drawing thirty tiles would mean pulling thirty multi-megabyte documents to
 * show thirty thumbnails. The picture therefore has to be *on the row*, which
 * means making one at publish time — this is what makes it.
 *
 * Deliberately not a render of the set. Photographing a card costs a second
 * apiece and needs the whole card stage mounted; a set already carries pictures
 * an author chose, and the best of them is a better cover than anything
 * generated. So this only ever downscales something that already exists.
 */
import type { Artwork } from '$lib/core/artwork';
import { hasArtwork } from '$lib/core/artwork';
import type { AdventureSet } from '$lib/sets/types';

/**
 * Longest edge of a thumbnail, in pixels.
 *
 * Sized for a tile on a dense grid at two-times pixel density, and no larger:
 * every one of these is fetched by every visitor to the gallery, so this figure
 * is multiplied by the whole audience. The full artwork is a click away inside
 * the set itself.
 */
export const THUMBNAIL_MAX = 512;

/** WebP quality. 0.8 is where the artefacts stop being visible at tile size. */
const QUALITY = 0.8;

/**
 * The picture that best stands for a set.
 *
 * Box art first, because that is what it is *for*. Failing that, the
 * villain — the antagonist is who an adventure is played *against*, and one
 * portrait says more about a set than a blank tile does — then the first
 * hero, for a set with none. Neither is guaranteed to exist (a box of heroes
 * has no villain; a set mid-authoring may have neither), so this falls
 * through to the first character in the set with artwork at all, whatever
 * its role, rather than turning up nothing when a perfectly good picture is
 * sitting on a minion or a sidekick.
 *
 * This is also why `sets/scope.ts`'s `computeScopedSet` drops `boxArt` from
 * every scoped document it builds, in both directions: with no box art to
 * catch on, a hero-scoped publish falls straight through to that hero's own
 * portrait and a villain-scoped one falls through to the villain's, with no
 * scope-awareness needed here at all. Change this order and that stops
 * being true.
 */
export function coverArtwork(set: AdventureSet): Artwork | null {
  if (hasArtwork(set.boxArt)) return set.boxArt;

  const villain = set.characters.find((character) => character.role === 'villain');
  if (villain && hasArtwork(villain.artwork)) return villain.artwork;

  const hero = set.characters.find((character) => character.role === 'hero');
  if (hero && hasArtwork(hero.artwork)) return hero.artwork;

  for (const character of set.characters) {
    if (hasArtwork(character.artwork)) return character.artwork;
  }

  return null;
}

/** Settles either way: a picture that will not load must not hang a publish. */
function settled(image: HTMLImageElement): Promise<boolean> {
  if (image.complete) return Promise.resolve(image.naturalWidth > 0);
  return new Promise((resolve) => {
    image.addEventListener('load', () => resolve(true), { once: true });
    image.addEventListener('error', () => resolve(false), { once: true });
  });
}

/**
 * Downscale a set's cover to a thumbnail, or `null` if it has no picture.
 *
 * WebP where the browser will encode it, PNG where it will not. `toBlob`
 * answers `null` for a format it does not support rather than throwing, which
 * is the only signal there is — so the fallback hangs off that.
 */
export async function renderThumbnail(set: AdventureSet): Promise<Blob | null> {
  const artwork = coverArtwork(set);
  if (!artwork?.source) return null;

  const image = new Image();
  image.src = artwork.source;
  // `decode()` can stall indefinitely in a backgrounded tab; `load` cannot.
  if (!(await settled(image))) return null;

  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width === 0 || height === 0) return null;

  /*
   * Never *up*scale. A small original stays its own size rather than being
   * blown up to the ceiling, which would cost bytes to add nothing — the tile
   * scales it down again in CSS either way.
   */
  const scale = Math.min(1, THUMBNAIL_MAX / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const encode = (type: string, quality?: number): Promise<Blob | null> =>
    new Promise((resolve) => canvas.toBlob(resolve, type, quality));

  return (await encode('image/webp', QUALITY)) ?? (await encode('image/png'));
}
