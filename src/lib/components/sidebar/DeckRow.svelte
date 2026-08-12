<script lang="ts">
  import { deckLabel } from '$lib/decks/factory';
  import type { Deck } from '$lib/decks/types';
  import { DECK_KIND_META } from '$lib/decks/types';
  import { cardDrag } from '$lib/state/card-drag.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import Icon from '$lib/ui/Icon.svelte';

  interface Props {
    deck: Deck;
    /** Printed cards in this deck, counting quantities. */
    printCount: number;
    /** Owner name, shown when the deck is listed away from its character. */
    ownerName?: string | null;
    /** Indent step; decks under a character sit one level in. */
    depth?: 0 | 1;
  }

  let { deck, printCount, ownerName = null, depth = 1 }: Props = $props();

  const meta = $derived(DECK_KIND_META[deck.kind]);

  const dropTarget = $derived(cardDrag.overDeckId === deck.id);

  /** Dropping on the deck header appends to that deck — the way into an empty one. */
  function onDragOver(event: DragEvent): void {
    if (!cardDrag.active) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    cardDrag.hoverDeck(deck.id);
  }

  function onDrop(event: DragEvent): void {
    if (!cardDrag.active) return;
    event.preventDefault();
    event.stopPropagation();
    const source = cardDrag.sourceId;
    cardDrag.end();
    if (source) workshop.reorderCardIntoDeck(source, deck.id);
  }
</script>

<div
  class="row"
  class:drop-target={dropTarget}
  style:--depth={depth}
  ondragover={onDragOver}
  ondragleave={() => cardDrag.leaveDeck(deck.id)}
  ondrop={onDrop}
  role="presentation"
>
  <div class="label">
    <span class="bar" style:background="var({meta.colorVar})"></span>
    <span class="name">{deckLabel(deck)}</span>
    {#if ownerName}
      <span class="owner">{ownerName}</span>
    {/if}
    <span class="count numeric">{printCount}</span>
  </div>

  <button
    type="button"
    class="add"
    aria-label="Add card to {deckLabel(deck)}"
    onclick={() => workshop.addCard(deck.id)}
  >
    <Icon name="plus" size={12} />
  </button>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    height: 24px;
    padding-left: calc(var(--space-2) + var(--depth) * var(--space-3));
    padding-right: var(--space-1);
    border-radius: var(--radius-sm);
  }

  .row:hover {
    background: var(--surface-hover);
  }

  .row.drop-target {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--border-accent);
  }

  .label {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .bar {
    width: 3px;
    height: 10px;
    flex: none;
    border-radius: var(--radius-full);
    opacity: 0.8;
  }

  .name {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .owner {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    opacity: 0.65;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex: none;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    opacity: 0.6;
  }

  .add {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex: none;
    border-radius: var(--radius-xs);
    color: var(--text-muted);
    opacity: 0;
    transition:
      opacity var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .row:hover .add,
  .add:focus-visible {
    opacity: 1;
  }

  .add:hover {
    color: var(--text-primary);
  }
</style>
