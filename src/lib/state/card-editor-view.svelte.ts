import type { CardEditAddress } from '$lib/cards/edit-targets';

export interface CardEditorTargetRequest {
  revision: number;
  address: CardEditAddress;
}

/** Ephemeral cross-pane focus requests; no part of this state is persisted. */
class CardEditorView {
  request = $state<CardEditorTargetRequest | null>(null);
  #revision = 0;

  requestTarget(address: CardEditAddress): void {
    this.#revision += 1;
    this.request = { revision: this.#revision, address };
  }
}

export const cardEditorView = new CardEditorView();
