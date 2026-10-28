import type { CharacterId } from '$lib/characters/types';
import { characterLabel } from '$lib/characters/factory';
import { CARD_FORMATS } from '$lib/renderer/geometry';
import { createId, now } from '$lib/core/id';
import type { CardbackSubject, Deck, DeckId, DeckKind } from './types';
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

export function cardbackLabel(subject: CardbackSubject): string {
  return 'deckName' in subject ? subject.name : characterLabel(subject);
}

export function cardbackFormat(subject: CardbackSubject) {
  return 'deckName' in subject
    ? subject.format
    : subject.role === 'hero' ? CARD_FORMATS.action : CARD_FORMATS.cardback;
}

export function hasDeckBackOverride(deck: Deck): boolean {
  return Object.keys(deck.cardback ?? {}).length > 0;
}
