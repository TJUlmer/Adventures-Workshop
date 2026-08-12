import type { CharacterId } from '$lib/characters/types';
import { createId, now } from '$lib/core/id';
import type { Deck, DeckId, DeckKind } from './types';
import { DECK_KIND_META } from './types';

export type DeckDraft = Partial<Pick<Deck, 'name' | 'ownerId' | 'notes'>>;

export function createDeck(kind: DeckKind, draft: DeckDraft = {}): Deck {
  const timestamp = now();

  return {
    id: createId<DeckId>('deck'),
    name: draft.name ?? DECK_KIND_META[kind].defaultName,
    kind,
    ownerId: draft.ownerId ?? null,
    notes: draft.notes ?? '',
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

/** The action deck every new character starts with. */
export function createActionDeck(ownerId: CharacterId): Deck {
  return createDeck('action', { ownerId });
}

export function deckLabel(deck: Deck): string {
  return deck.name.trim().length > 0 ? deck.name : DECK_KIND_META[deck.kind].defaultName;
}
