import { createArtwork } from '$lib/core/artwork';
import { createId, now } from '$lib/core/id';
import { createAdventureMap } from '$lib/map/types';
import { createThreatTrack } from '$lib/threat/types';
import type { AdventureSet, SetId } from './types';
import { SET_SCHEMA_VERSION } from './types';

export type SetDraft = Partial<Pick<AdventureSet, 'name' | 'subtitle'>> & {
  author?: string;
  description?: string;
};

/**
 * A brand-new, genuinely empty set. No placeholder characters, no decks, no
 * sample cards — the UI is responsible for making "empty" look intentional.
 */
export function createEmptySet(draft: SetDraft = {}): AdventureSet {
  const timestamp = now();

  return {
    id: createId<SetId>('set'),
    schemaVersion: SET_SCHEMA_VERSION,
    name: draft.name ?? 'Untitled Adventure',
    subtitle: draft.subtitle ?? '',
    meta: {
      author: draft.author ?? '',
      description: draft.description ?? '',
      version: '0.1.0',
      createdAt: timestamp,
      updatedAt: timestamp
    },
    style: {},
    characters: [],
    decks: [],
    cards: [],
    threat: createThreatTrack(),
    map: createAdventureMap(),
    figures: [],
    customSymbols: [],
    boxArt: createArtwork(),
    initiativeBack: createArtwork(),
    useInitiativeBack: false,
    // Authored here, so it came from nowhere. `sets/fork.ts` is the only thing
    // that ever writes this.
    origin: null
  };
}

export function setLabel(set: AdventureSet): string {
  return set.name.trim().length > 0 ? set.name : 'Untitled Adventure';
}
