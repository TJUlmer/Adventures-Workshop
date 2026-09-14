/**
 * Derived source material for an automatic set cover.
 *
 * Nothing here writes to `AdventureSet.boxArt`: an automatic cover is a
 * presentation fallback, not artwork the author supplied and not another
 * persisted asset to migrate, fingerprint or contribute.
 */
import type { Character } from '$lib/characters/types';
import type { Artwork } from '$lib/core/artwork';
import { hasArtwork } from '$lib/core/artwork';
import { cardsForCharacter, charactersByRole } from './queries';
import type { AdventureSet } from './types';

/**
 * The picture that represents one character inside a compilation cover.
 *
 * Their deck back comes first because it was composed to be that character's
 * identity. A portrait follows when one exists, then the first illustrated
 * card in the author's own document order. Keeping the last choice stable is
 * important: a random pick would make the cover, its content-addressed upload
 * URL and the gallery cache change on every publish.
 *
 * `character_picture` in `supabase/migrations/0007_gallery_browse.sql`
 * answers the same question for published rows. Keep the order aligned.
 */
export function characterCoverArtwork(
  set: AdventureSet,
  character: Character
): Artwork | null {
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
 * Whether a full product gets a derived cover when the author supplied none.
 *
 * Actual hero count, rather than `singleHero`, is the presentation boundary:
 * that creation flag controls identity editing and deliberately survives a
 * temporary second hero. Callers publishing a scope must additionally require
 * `{ kind: 'full' }`, because a villain slice remains an Adventure document.
 */
export function usesAutomaticBoxArt(set: AdventureSet): boolean {
  if (hasArtwork(set.boxArt)) return false;
  return set.kind === 'adventure' || charactersByRole(set, 'hero').length > 1;
}

/** Every independently-authored roster entry that receives an equal panel. */
export function automaticBoxArtCharacters(set: AdventureSet): Character[] {
  if (set.kind === 'heroes') return charactersByRole(set, 'hero');

  return [
    ...charactersByRole(set, 'hero'),
    ...charactersByRole(set, 'villain'),
    ...charactersByRole(set, 'minion')
  ];
}
