import type { CardArtworkLayerId, CardId } from '$lib/cards/types';

/**
 * The border-break layer currently exposed for direct manipulation.
 *
 * The layer list and the live preview are siblings, so this small piece of
 * editor-only state is shared rather than persisted in the set. Closing the
 * Border breaks panel clears it; exports therefore never need to know that a
 * layer happened to be selected in the editor.
 */
class CardArtworkLayerView {
  cardId = $state<CardId | null>(null);
  layerId = $state<CardArtworkLayerId | null>(null);

  select(cardId: CardId, layerId: CardArtworkLayerId | null): void {
    this.cardId = cardId;
    this.layerId = layerId;
  }

  clear(cardId?: CardId): void {
    if (cardId && this.cardId !== cardId) return;
    this.cardId = null;
    this.layerId = null;
  }
}

export const cardArtworkLayerView = new CardArtworkLayerView();
