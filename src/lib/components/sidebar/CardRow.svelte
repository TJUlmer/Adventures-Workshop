<script lang="ts">
  import { cardLabel } from '$lib/cards/factory';
  import type { Card } from '$lib/cards/types';
  import { CARD_TYPE_META, initiativeHeading } from '$lib/cards/types';
  import { characterLabel } from '$lib/characters/factory';
  import { cardDrag, sideOf } from '$lib/state/card-drag.svelte';
  import { isCardSelected } from '$lib/state/selection';
  import { workshop } from '$lib/state/workshop.svelte';
  import Icon from '$lib/ui/Icon.svelte';

  interface Props {
    card: Card;
    /** Indent step. Cards sit under their deck, which sits under its owner. */
    depth?: 0 | 1 | 2;
  }

  let { card, depth = 2 }: Props = $props();

  const meta = $derived(CARD_TYPE_META[card.type]);
  const selected = $derived(isCardSelected(workshop.selection, card.id));
  const unnamed = $derived(cardLabel(card).startsWith('Untitled'));

  let row = $state<HTMLDivElement | null>(null);

  const dragging = $derived(cardDrag.sourceId === card.id);
  const dropBefore = $derived(cardDrag.overId === card.id && cardDrag.side === 'before');
  const dropAfter = $derived(cardDrag.overId === card.id && cardDrag.side === 'after');

  function onDragStart(event: DragEvent): void {
    cardDrag.start(card.id);
    // The payload is unused — the store holds the drag — but Firefox needs one.
    event.dataTransfer?.setData('text/plain', card.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(event: DragEvent): void {
    if (!cardDrag.active || !row) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    cardDrag.hover(card.id, sideOf(event, row));
  }

  function onDrop(event: DragEvent): void {
    if (!cardDrag.active) return;
    event.preventDefault();
    event.stopPropagation();
    const source = cardDrag.sourceId;
    const side = cardDrag.side;
    cardDrag.end();
    if (source) workshop.reorderCard(source, card.id, side);
  }

  /**
   * A hero's action card prints one combat symbol and one value in the
   * ribbon — `attack`/`defense` on the same card are meaningless there, left
   * over from the villain/minion shape every action card shares, and never
   * edited for a hero's own deck. Reading them regardless of `symbol` is what
   * showed every hero card as "A2 D2": the two leftover fields, not the
   * card's actual value. `symbol` is `null` outside a hero's deck (see
   * `ActionCard` in `cards/types.ts`), so that alone is enough to pick which
   * pair of fields is the real one, with no need to know the character's role
   * here.
   */
  const SYMBOL_LETTERS: Readonly<Record<'attack' | 'defense' | 'versatile', string>> = {
    attack: 'A',
    defense: 'D',
    versatile: 'V'
  };

  /** A compact read of what the card carries, right-aligned in the row. */
  const trailing = $derived.by(() => {
    if (card.type === 'action') {
      if (card.symbol !== null) {
        if (card.symbol === 'scheme' || card.symbolValue === null) return '';
        return `${SYMBOL_LETTERS[card.symbol]}${card.symbolValue}`;
      }

      const parts: string[] = [];
      if (card.attack !== null) parts.push(`A${card.attack}`);
      if (card.defense !== null) parts.push(`D${card.defense}`);
      return parts.join(' ');
    }

    /*
     * A character card names its figure rather than its role, so the deck can
     * be checked for a missing one at a glance — "Minion" three times over
     * cannot answer which minion still needs a card. Read from the figure
     * rather than the card's own copy of the name, so a rename shows up here.
     * An effect belongs to no one figure, so it keeps its role heading.
     */
    if (card.type === 'initiative') {
      /* An effect card names what it *is*, which is its card type text — one
         deck of "Villain Effect" told the author nothing about which is which. */
      if (card.variant === 'effect') {
        return card.subjectText.trim() || initiativeHeading(card);
      }
      const figure = card.characterId
        ? workshop.adventure.characters.find((entry) => entry.id === card.characterId)
        : null;
      return figure ? characterLabel(figure) : card.subjectText.trim() || initiativeHeading(card);
    }

    return '';
  });
</script>

<div
  bind:this={row}
  class="row"
  class:selected
  class:dragging
  class:drop-before={dropBefore}
  class:drop-after={dropAfter}
  style:--depth={depth}
  draggable="true"
  ondragstart={onDragStart}
  ondragover={onDragOver}
  ondragleave={() => cardDrag.leave(card.id)}
  ondrop={onDrop}
  ondragend={() => cardDrag.end()}
  role="listitem"
>
  <button type="button" class="main" onclick={() => workshop.selectCard(card.id)}>
    <span class="dot" style:background="var({meta.colorVar})"></span>
    <span class="name" class:unnamed>{cardLabel(card)}</span>
    {#if trailing}<span class="trailing numeric">{trailing}</span>{/if}
    {#if card.quantity > 1}<span class="qty numeric">×{card.quantity}</span>{/if}
  </button>

  <button
    type="button"
    class="remove"
    aria-label="Delete card"
    onclick={() => workshop.removeCard(card.id)}
  >
    <Icon name="trash" size={12} />
  </button>
</div>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  .row:hover {
    background: var(--surface-hover);
  }

  .row.dragging {
    opacity: 0.4;
  }

  /* A hairline where the card will land, rather than a shifting placeholder. */
  .row.drop-before::after,
  .row.drop-after::after {
    content: '';
    position: absolute;
    left: calc(var(--space-2) + var(--depth) * var(--space-3));
    right: var(--space-2);
    height: 2px;
    border-radius: var(--radius-full);
    background: var(--accent);
    pointer-events: none;
  }

  .row.drop-before::after {
    top: -1px;
  }

  .row.drop-after::after {
    bottom: -1px;
  }

  .selected {
    background: var(--surface-selected);
  }

  .selected::before {
    content: '';
    position: absolute;
    left: 0;
    top: 20%;
    bottom: 20%;
    width: 2px;
    border-radius: var(--radius-full);
    background: var(--accent);
  }

  .main {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    height: 26px;
    padding-left: calc(var(--space-2) + var(--depth) * var(--space-3));
    padding-right: var(--space-2);
    text-align: left;
    color: var(--text-secondary);
  }

  .selected .main {
    color: var(--text-primary);
  }

  .dot {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: var(--radius-full);
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .unnamed {
    color: var(--text-muted);
    font-style: italic;
  }

  .trailing,
  .qty {
    flex: none;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .trailing {
    letter-spacing: 0.02em;
  }

  .remove {
    display: grid;
    place-items: center;
    width: 22px;
    height: 26px;
    flex: none;
    color: var(--text-muted);
    opacity: 0;
    border-radius: var(--radius-xs);
    transition:
      opacity var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .row:hover .remove,
  .remove:focus-visible {
    opacity: 1;
  }

  .remove:hover {
    color: var(--danger);
  }
</style>
