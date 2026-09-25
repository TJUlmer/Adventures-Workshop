<script lang="ts">
  import { onDestroy } from 'svelte';
  import { CARD_ARTWORK_LAYER_PLACEMENTS } from '$lib/cards/types';
  import type {
    ActionCard,
    CardArtworkLayer,
    CardArtworkLayerId,
    CardArtworkLayerPlacement
  } from '$lib/cards/types';
  import { BLEED } from '$lib/renderer/geometry';
  import { cardArtworkLayerView } from '$lib/state/card-artwork-layer-view.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, Icon } from '$lib/ui';
  import ArtworkPanel from './ArtworkPanel.svelte';

  interface Props {
    card: ActionCard;
  }

  let { card }: Props = $props();
  let confirmingRemoval = $state<CardArtworkLayerId | null>(null);

  const selectedId = $derived(
    cardArtworkLayerView.cardId === card.id ? cardArtworkLayerView.layerId : null
  );

  const selectedLayer = $derived(
    card.artworkLayers.find((layer) => layer.id === selectedId) ?? null
  );

  $effect(() => {
    if (selectedId && card.artworkLayers.some((layer) => layer.id === selectedId)) return;
    cardArtworkLayerView.select(card.id, card.artworkLayers[0]?.id ?? null);
    confirmingRemoval = null;
  });

  onDestroy(() => cardArtworkLayerView.clear(card.id));

  function addLayer(): void {
    cardArtworkLayerView.select(card.id, workshop.addCardArtworkLayer(card.id));
    confirmingRemoval = null;
  }

  function removeLayer(layerId: CardArtworkLayerId): void {
    if (confirmingRemoval !== layerId) {
      confirmingRemoval = layerId;
      return;
    }
    workshop.removeCardArtworkLayer(card.id, layerId);
    confirmingRemoval = null;
  }

  /** Top-to-bottom for the visual stack; storage and painting are back-to-front. */
  function layersAt(placement: CardArtworkLayerPlacement): CardArtworkLayer[] {
    return card.artworkLayers.filter((layer) => layer.placement === placement).reverse();
  }

  function canMove(layer: CardArtworkLayer, direction: -1 | 1): boolean {
    const placementIndex = CARD_ARTWORK_LAYER_PLACEMENTS.indexOf(layer.placement);
    const bucket = card.artworkLayers.filter((entry) => entry.placement === layer.placement);
    const layerIndex = bucket.findIndex((entry) => entry.id === layer.id);
    if (direction > 0) {
      return layerIndex < bucket.length - 1 || placementIndex < CARD_ARTWORK_LAYER_PLACEMENTS.length - 1;
    }
    return layerIndex > 0 || placementIndex > 0;
  }
</script>

{#snippet fixedLayer(title: string, description: string)}
  <div class="fixed-row" role="listitem" aria-label="{title}, fixed card layer">
    <span class="fixed-mark"><Icon name="layers" size={14} /></span>
    <span class="layer-copy">
      <strong>{title}</strong>
      <small>{description}</small>
    </span>
    <span class="fixed-tag">Fixed</span>
  </div>
{/snippet}

{#snippet artworkRows(placement: CardArtworkLayerPlacement)}
  {#each layersAt(placement) as layer (layer.id)}
    {@const index = card.artworkLayers.indexOf(layer)}
    <div class="layer-row" class:selected={layer.id === selectedId} role="listitem">
      <button
        type="button"
        class="layer-select"
        aria-pressed={layer.id === selectedId}
        onclick={() => {
          cardArtworkLayerView.select(card.id, layer.id);
          confirmingRemoval = null;
        }}
      >
        <span class="thumb" class:empty={!layer.artwork.source}>
          {#if layer.artwork.source}
            <img src={layer.artwork.source} alt="" />
          {:else}
            <Icon name="image" size={14} />
          {/if}
        </span>
        <span class="layer-copy">
          <strong>Artwork layer {index + 1}</strong>
          <small>{layer.artwork.label || 'No image attached'}</small>
        </span>
      </button>

      <div class="layer-actions">
        <Button
          size="sm"
          variant="ghost"
          disabled={!canMove(layer, 1)}
          title="Move above the next layer"
          onclick={() => workshop.moveCardArtworkLayer(card.id, layer.id, 1)}
        >Up</Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!canMove(layer, -1)}
          title="Move below the next layer"
          onclick={() => workshop.moveCardArtworkLayer(card.id, layer.id, -1)}
        >Down</Button>
        <Button size="sm" variant="danger" onclick={() => removeLayer(layer.id)}>
          {confirmingRemoval === layer.id ? 'Confirm remove' : 'Remove'}
        </Button>
      </div>
    </div>
  {/each}
{/snippet}

<div class="layer-heading">
  <p class="hint">
    Add transparent images over the finished card to let figures, props, or effects cross its
    frame. The card layers are fixed; move artwork above or below them, then position it directly
    in the preview.
  </p>
  <Button size="sm" onclick={addLayer}>
    <Icon name="plus" size={13} />
    Artwork layer
  </Button>
</div>

<div class="layers" role="list" aria-label="Card and artwork layer stack">
  {@render artworkRows('above-frame')}
  {@render fixedLayer('Outer frame', 'The card border and rounded edge')}
  {@render artworkRows('above-ribbon')}
  {@render fixedLayer('Name / combat ribbon', 'Ribbon fill, text, symbol and value')}
  {@render artworkRows('above-content')}
  {@render fixedLayer(
    'Card content & effects',
    'Title, values, abilities, boost, owner, copies and special effects'
  )}
  {@render artworkRows('above-artwork')}
  {@render fixedLayer('Main artwork', 'The card’s ordinary illustration')}
</div>

{#if card.artworkLayers.length === 0}
  <div class="empty">
    <Icon name="image" size={18} />
    <span>Add artwork, then move it through the fixed card stack.</span>
  </div>
{/if}

{#if selectedLayer}
  <div class="selected-controls">
    <ArtworkPanel
      target={{ entity: 'cardArtworkLayer', id: card.id, layerId: selectedLayer.id }}
      hint="Transparent PNG or WebP works best. Positioning uses the entire card, including its border."
      aspect={BLEED.width / BLEED.height}
      fit="contain"
      resizeMode="stretch"
    />
  </div>
{/if}

<style>
  .layer-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .hint {
    max-width: 66ch;
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1.45;
  }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: 72px;
    border: 1px dashed var(--border-default);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .layers {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .fixed-row {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    min-height: 48px;
    padding: var(--space-2);
    border: 1px dashed var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
  }

  .fixed-mark {
    display: grid;
    place-items: center;
    width: 40px;
    height: 32px;
    border-radius: var(--radius-xs);
    color: var(--text-tertiary);
    background: var(--surface-raised);
  }

  .fixed-tag {
    padding: 2px var(--space-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
  }

  .layer-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
  }

  .layer-row.selected {
    border-color: var(--border-accent);
    background: var(--accent-soft);
  }

  .layer-select {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    text-align: left;
  }

  .thumb {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    flex: none;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background-color: var(--surface-raised);
    background-image:
      linear-gradient(45deg, var(--border-subtle) 25%, transparent 25%),
      linear-gradient(-45deg, var(--border-subtle) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--border-subtle) 75%),
      linear-gradient(-45deg, transparent 75%, var(--border-subtle) 75%);
    background-position: 0 0, 0 5px, 5px -5px, -5px 0;
    background-size: 10px 10px;
    color: var(--text-muted);
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .thumb.empty {
    background-image: none;
  }

  .layer-copy {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .layer-copy strong {
    color: var(--text-primary);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }

  .layer-copy small {
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .layer-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .selected-controls {
    margin-top: var(--space-3);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-subtle);
  }

  @container workspace (max-width: 600px) {
    .layer-heading,
    .layer-row {
      grid-template-columns: 1fr;
      flex-direction: column;
    }

    .layer-actions {
      justify-content: flex-end;
    }

    .fixed-row {
      grid-template-columns: 40px minmax(0, 1fr);
    }

    .fixed-tag {
      display: none;
    }
  }
</style>
