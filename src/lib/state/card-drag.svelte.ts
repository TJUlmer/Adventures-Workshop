/**
 * Drag state for reordering cards in the sidebar.
 *
 * Module-level rather than per-row: a drag is a single conversation between one
 * source row and whichever row the pointer is over, and every row needs to know
 * about it to draw the drop indicator.
 */
import type { CardId } from '$lib/cards/types';
import type { DeckId } from '$lib/decks/types';

export type DropSide = 'before' | 'after';

class CardDragState {
  /** The card being dragged, or `null` when nothing is in flight. */
  sourceId = $state<CardId | null>(null);
  /** The row currently under the pointer. */
  overId = $state<CardId | null>(null);
  side = $state<DropSide>('before');
  /** Set when hovering an empty deck, so it can accept a drop. */
  overDeckId = $state<DeckId | null>(null);

  readonly active = $derived(this.sourceId !== null);

  start(id: CardId): void {
    this.sourceId = id;
  }

  /** Which half of the row the pointer is in decides before or after. */
  hover(id: CardId, side: DropSide): void {
    if (this.sourceId === null || id === this.sourceId) return;
    this.overId = id;
    this.side = side;
    this.overDeckId = null;
  }

  hoverDeck(id: DeckId): void {
    if (this.sourceId === null) return;
    this.overDeckId = id;
    this.overId = null;
  }

  leave(id: CardId): void {
    if (this.overId === id) this.overId = null;
  }

  leaveDeck(id: DeckId): void {
    if (this.overDeckId === id) this.overDeckId = null;
  }

  end(): void {
    this.sourceId = null;
    this.overId = null;
    this.overDeckId = null;
  }
}

export const cardDrag = new CardDragState();

/** Which half of an element's box a pointer sits in. */
export function sideOf(event: DragEvent, element: HTMLElement): DropSide {
  const box = element.getBoundingClientRect();
  return event.clientY < box.top + box.height / 2 ? 'before' : 'after';
}
