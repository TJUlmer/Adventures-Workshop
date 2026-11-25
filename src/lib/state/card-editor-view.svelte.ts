import type { CardEditAddress } from '$lib/cards/edit-targets';

export interface CardEditorTargetRequest {
  revision: number;
  address: CardEditAddress;
}

export type CardContentTab = 'content' | 'design';

/** Ephemeral cross-pane focus requests; no part of this state is persisted. */
class CardEditorView {
  tab = $state<CardContentTab>('content');
  request = $state<CardEditorTargetRequest | null>(null);
  previewEditAddress = $state<CardEditAddress | null>(null);
  #revision = 0;

  requestTarget(address: CardEditAddress): void {
    this.#revision += 1;
    this.request = { revision: this.#revision, address };
  }

  beginPreviewEdit(address: CardEditAddress): void {
    this.previewEditAddress = address;
  }

  endPreviewEdit(address?: CardEditAddress): void {
    if (address && this.previewEditAddress !== address) return;
    this.previewEditAddress = null;
  }
}

export const cardEditorView = new CardEditorView();
