<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ActionCard, CardArtworkLayerId } from '$lib/cards/types';
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
</script>

<div class="layer-heading">
  <p class="hint">
    Add transparent images over the finished card to let figures, props, or effects cross its
    frame. Select a layer, then drag or transform it directly in the preview. Layers at the bottom
    of this list paint first.
  </p>
  <Button size="sm" onclick={addLayer}>
    <Icon name="plus" size={13} />
    Artwork layer
  </Button>
</div>

{#if card.artworkLayers.length === 0}
  <div class="empty">
    <Icon name="image" size={18} />
    <span>No overlay layers</span>
  </div>
{:else}
  <div class="layers" role="list" aria-label="Artwork layers">
    {#each card.artworkLayers as layer, index (layer.id)}
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
            <strong>Layer {index + 1}</strong>
            <small>{layer.artwork.label || 'No image attached'}</small>
          </span>
        </button>

        <div class="layer-actions">
          <Button
            size="sm"
            variant="ghost"
            disabled={index === 0}
            title="Move layer backward"
            onclick={() => workshop.moveCardArtworkLayer(card.id, layer.id, -1)}
          >Back</Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={index === card.artworkLayers.length - 1}
            title="Move layer forward"
            onclick={() => workshop.moveCardArtworkLayer(card.id, layer.id, 1)}
          >Forward</Button>
          <Button
            size="sm"
            variant="danger"
            onclick={() => removeLayer(layer.id)}
          >
            {confirmingRemoval === layer.id ? 'Confirm remove' : 'Remove'}
          </Button>
        </div>
      </div>
    {/each}
  </div>

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
  }
</style>
