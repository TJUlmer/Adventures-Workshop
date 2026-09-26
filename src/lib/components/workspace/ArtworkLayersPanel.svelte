<script lang="ts">
  import { onDestroy } from 'svelte';
  import { CARD_FIXED_LAYERS } from '$lib/cards/types';
  import type {
    ActionCard,
    CardArtworkLayer,
    CardArtworkLayerId,
    CardCompositeLayerId,
    CardFixedLayer
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

  const FIXED_LAYER_META: Record<CardFixedLayer, { title: string; description: string }> = {
    'outer-frame': {
      title: 'Outer frame',
      description: 'The card border and rounded edge'
    },
    'name-ribbon': {
      title: 'Name / combat ribbon',
      description: 'Ribbon fill, text, symbol and value'
    },
    'card-content': {
      title: 'Card content & effects',
      description: 'Title, values, abilities, boost, owner, copies and special effects'
    },
    'main-artwork': {
      title: 'Main artwork',
      description: 'The card’s ordinary illustration'
    }
  };

  type StackRow =
    | { kind: 'fixed'; id: CardFixedLayer }
    | { kind: 'artwork'; id: CardArtworkLayerId; layer: CardArtworkLayer };

  function isFixedLayer(id: CardCompositeLayerId): id is CardFixedLayer {
    return (CARD_FIXED_LAYERS as readonly string[]).includes(id);
  }

  const stackRows = $derived.by(() => {
    const artwork = new Map(card.artworkLayers.map((layer) => [layer.id, layer]));
    const rows: StackRow[] = [];
    for (const id of [...card.layerOrder].reverse()) {
      if (isFixedLayer(id)) rows.push({ kind: 'fixed', id });
      else {
        const layer = artwork.get(id as CardArtworkLayerId);
        if (layer) rows.push({ kind: 'artwork', id: layer.id, layer });
      }
    }
    return rows;
  });

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

  function canMove(layerId: CardCompositeLayerId, direction: -1 | 1): boolean {
    const index = card.layerOrder.indexOf(layerId);
    const nextIndex = index + direction;
    return index >= 0 && nextIndex >= 0 && nextIndex < card.layerOrder.length;
  }
</script>

{#snippet moveActions(layerId: CardCompositeLayerId)}
  <Button
    size="sm"
    variant="ghost"
    disabled={!canMove(layerId, 1)}
    title="Move above the next layer"
    onclick={() => workshop.moveCardCompositeLayer(card.id, layerId, 1)}
  >Up</Button>
  <Button
    size="sm"
    variant="ghost"
    disabled={!canMove(layerId, -1)}
    title="Move below the next layer"
    onclick={() => workshop.moveCardCompositeLayer(card.id, layerId, -1)}
  >Down</Button>
{/snippet}

{#snippet fixedLayer(layerId: CardFixedLayer)}
  {@const meta = FIXED_LAYER_META[layerId]}
  <div class="fixed-row" role="listitem" aria-label="{meta.title}, card element layer">
    <span class="fixed-mark"><Icon name="layers" size={14} /></span>
    <span class="layer-copy">
      <strong>{meta.title}</strong>
      <small>{meta.description}</small>
    </span>
    <div class="layer-actions">{@render moveActions(layerId)}</div>
  </div>
{/snippet}

{#snippet artworkRow(layer: CardArtworkLayer)}
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
      {@render moveActions(layer.id)}
      <Button size="sm" variant="danger" onclick={() => removeLayer(layer.id)}>
        {confirmingRemoval === layer.id ? 'Confirm remove' : 'Remove'}
      </Button>
    </div>
  </div>
{/snippet}

<div class="layer-heading">
  <p class="hint">
    Add transparent images over the finished card to let figures, props, or effects cross its
    frame. Move artwork and card elements into any paint order, then position artwork directly in
    the preview.
  </p>
  <Button size="sm" onclick={addLayer}>
    <Icon name="plus" size={13} />
    Artwork layer
  </Button>
</div>

<div class="layers" role="list" aria-label="Card and artwork layer stack">
  {#each stackRows as row (row.id)}
    {#if row.kind === 'fixed'}
      {@render fixedLayer(row.id)}
    {:else}
      {@render artworkRow(row.layer)}
    {/if}
  {/each}
</div>

{#if card.artworkLayers.length === 0}
  <div class="empty">
    <Icon name="image" size={18} />
    <span>Add artwork, then arrange it with the card elements above.</span>
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
  }
</style>
