import type { CardId } from '$lib/cards/types';
import type { CharacterId } from '$lib/characters/types';

/**
 * What the workspace is currently editing. A discriminated union rather than
 * a pair of nullable IDs, so "a card and a character are both selected" is not
 * a state the app can get into.
 */
export type Selection =
  | { readonly target: 'set' }
  | { readonly target: 'character'; readonly id: CharacterId }
  | { readonly target: 'card'; readonly id: CardId };

export const SET_SELECTION: Selection = { target: 'set' };

export function selectCharacter(id: CharacterId): Selection {
  return { target: 'character', id };
}

export function selectCard(id: CardId): Selection {
  return { target: 'card', id };
}

export function isCardSelected(selection: Selection, id: CardId): boolean {
  return selection.target === 'card' && selection.id === id;
}

export function isCharacterSelected(selection: Selection, id: CharacterId): boolean {
  return selection.target === 'character' && selection.id === id;
}
