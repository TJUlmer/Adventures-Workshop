import type { EntityRef } from '$lib/state/workshop.svelte';

/** A stable identity for editor-only artwork interaction state. */
export function artworkAdjustmentKey(target: EntityRef): string {
  switch (target.entity) {
    case 'card':
      return `card:${target.id}`;
    case 'cardArtworkLayer':
      return `card-layer:${target.id}:${target.layerId}`;
    case 'character':
      return `character:${target.id}`;
    case 'characterBand':
      return `character-band:${target.id}:${target.cardId ?? 'primary'}:${target.band}`;
    case 'threat':
      return 'threat';
    case 'figure':
      return `figure:${target.id}`;
  }
}

/**
 * The one artwork surface that currently owns one-finger gestures.
 *
 * This state is deliberately ephemeral. It coordinates the inline controls
 * and live-preview overlay without becoming part of a set, its history, or an
 * exported card.
 */
class ArtworkAdjustmentView {
  activeKey = $state<string | null>(null);

  active(target: EntityRef): boolean {
    return this.activeKey === artworkAdjustmentKey(target);
  }

  begin(target: EntityRef): void {
    this.activeKey = artworkAdjustmentKey(target);
  }

  end(target?: EntityRef): void {
    if (target && !this.active(target)) return;
    this.activeKey = null;
  }

  endKey(key: string): void {
    if (this.activeKey === key) this.activeKey = null;
  }
}

export const artworkAdjustmentView = new ArtworkAdjustmentView();
