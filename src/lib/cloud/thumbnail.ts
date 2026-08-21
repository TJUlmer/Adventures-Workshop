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
import type { Character } from '$lib/characters/types';
import { cardsForCharacter } from '$lib/sets/queries';
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
 * The picture that stands for one character.
 *
 * **Their deck back first.** It is the one picture in a set drawn deliberately
 * to *be* that character's face — their name and their portrait, composed by
 * the author for exactly this purpose — where a card's artwork is a scene from
 * one of their moves and `Character.artwork` is a portrait field most authors
 * never fill. `useReplacement` is checked before `artwork` because when the
 * flag is on the replacement *is* the back, and the artwork underneath it is
 * not what prints.
 *
 * Then the portrait, then the first picture off one of their own cards — in
 * document order, the one its author put first, not a random or a "best" one.
 * That last step is what rescues a set at all: of the first six published,
 * every character in every one had `artwork` null and their pictures on cards,
 * so a search stopping at the portrait came up empty for four of them and
 * their tiles drew initials on a coloured square over a set full of art.
 *
 * `character_image` in `supabase/migrations/0007_gallery_browse.sql` answers
 * this same question in SQL, for rows already published. The two must not
 * drift.
 */
function characterCover(set: AdventureSet, character: Character): Artwork | null {
  const back = character.cardback;
  if (back.useReplacement && hasArtwork(back.replacement)) return back.replacement;
  if (hasArtwork(back.artwork)) return back.artwork;
  if (hasArtwork(character.artwork)) return character.artwork;
  for (const card of cardsForCharacter(set, character.id)) {
    if (hasArtwork(card.artwork)) return card.artwork;
  }
  return null;
}

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
 * sitting on a minion or a sidekick — and then, last, to any card in the set,
 * so that a set whose only pictures are on cards nobody owns still gets one.
 *
 * Every step reads through `characterCover`, so "the villain's picture" means
 * their portrait *or one of their cards*. Before that it meant the portrait
 * alone, and a set with no box art therefore got no thumbnail at all.
 *
 * This is also why `sets/scope.ts`'s `computeScopedSet` drops `boxArt` from
 * every scoped document it builds, in both directions: with no box art to
 * catch on, a hero-scoped publish falls straight through to that hero's own
 * picture and a villain-scoped one falls through to the villain's, with no
 * scope-awareness needed here at all. Change this order and that stops
 * being true.
 */
export function coverArtwork(set: AdventureSet): Artwork | null {
  if (hasArtwork(set.boxArt)) return set.boxArt;

  const villain = set.characters.find((character) => character.role === 'villain');
  if (villain) {
    const cover = characterCover(set, villain);
    if (cover) return cover;
  }

  const hero = set.characters.find((character) => character.role === 'hero');
  if (hero) {
    const cover = characterCover(set, hero);
    if (cover) return cover;
  }

  for (const character of set.characters) {
    const cover = characterCover(set, character);
    if (cover) return cover;
  }

  /* Set-level decks have no owner, so nothing above reaches their cards — an
     events deck is exactly the case, and a set that is only events would
     otherwise still come up blank. */
  for (const card of set.cards) {
    if (hasArtwork(card.artwork)) return card.artwork;
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
