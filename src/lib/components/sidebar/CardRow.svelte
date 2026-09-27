<script lang="ts">
  import { cardLabel } from '$lib/cards/factory';
  import type { Card, CombatSymbol } from '$lib/cards/types';
  import { CARD_TYPE_META, initiativeHeading } from '$lib/cards/types';
  import { characterLabel } from '$lib/characters/factory';
  import { deckLabel } from '$lib/decks/factory';
  import type { Deck, DeckId } from '$lib/decks/types';
  import { deckOwner } from '$lib/sets/queries';
  import { cardDrag, sideOf } from '$lib/state/card-drag.svelte';
  import { isCardSelected } from '$lib/state/selection';
  import { workshop } from '$lib/state/workshop.svelte';
  import { ConfirmAction, Icon } from '$lib/ui';
  import { tick } from 'svelte';

  interface Props {
    card: Card;
    /** Indent step. Cards sit under their deck, which sits under its owner. */
    depth?: 0 | 1 | 2;
  }

  let { card, depth = 2 }: Props = $props();

  const meta = $derived(CARD_TYPE_META[card.type]);
  const selected = $derived(isCardSelected(workshop.selection, card.id));
  const unnamed = $derived(cardLabel(card).startsWith('Untitled'));

  let host = $state<HTMLDivElement | null>(null);
  let row = $state<HTMLDivElement | null>(null);
  let moveTrigger = $state<HTMLButtonElement | null>(null);
  let actionsOpen = $state(false);
  const moveTriggerId = $derived(`card-move-${card.id}`);

  const dragging = $derived(cardDrag.sourceId === card.id);
  const dropBefore = $derived(cardDrag.overId === card.id && cardDrag.side === 'before');
  const dropAfter = $derived(cardDrag.overId === card.id && cardDrag.side === 'after');

  const cardsInDeck = $derived(
    workshop.adventure.cards.filter(
      (entry) =>
        entry.deckId === card.deckId &&
        (card.type !== 'initiative' ||
          (entry.type === 'initiative' && entry.variant === card.variant))
    )
  );
  const cardIndex = $derived(cardsInDeck.findIndex((entry) => entry.id === card.id));
  const previousCard = $derived(cardIndex > 0 ? (cardsInDeck[cardIndex - 1] ?? null) : null);
  const nextCard = $derived(
    cardIndex >= 0 && cardIndex < cardsInDeck.length - 1
      ? (cardsInDeck[cardIndex + 1] ?? null)
      : null
  );

  const compatibleDecks = $derived(
    workshop.adventure.decks.filter((deck) => {
      if (card.type === 'action') return deck.kind === 'action' || deck.kind === 'special';
      return deck.kind === card.type;
    })
  );

  function destinationLabel(deck: Deck): string {
    const owner = deckOwner(workshop.adventure, deck);
    return owner ? `${deckLabel(deck)} · ${characterLabel(owner)}` : deckLabel(deck);
  }

  async function closeActions(restoreFocus = false): Promise<void> {
    actionsOpen = false;
    if (!restoreFocus) return;

    // The action that was focused is about to unmount. Return keyboard users
    // to the persistent trigger after the row has settled in its new place.
    // A deck transfer remounts the whole CardRow under another branch, so the
    // stable DOM id is the fallback when this instance's binding is gone.
    await tick();
    const trigger = document.getElementById(moveTriggerId) ?? moveTrigger;
    if (trigger instanceof HTMLButtonElement) trigger.focus();
  }

  function moveEarlier(): void {
    if (!previousCard) return;
    workshop.reorderCard(card.id, previousCard.id, 'before');
    void closeActions(true);
  }

  function moveLater(): void {
    if (!nextCard) return;
    workshop.reorderCard(card.id, nextCard.id, 'after');
    void closeActions(true);
  }

  function moveToDeck(event: Event & { currentTarget: HTMLSelectElement }): void {
    const deckId = event.currentTarget.value as DeckId;
    if (deckId !== card.deckId) workshop.reorderCardIntoDeck(card.id, deckId);
    void closeActions(true);
  }

  $effect(() => {
    if (!actionsOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (host && !host.contains(event.target as Node)) void closeActions();
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void closeActions(true);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeydown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeydown);
    };
  });

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
  const SYMBOL_LETTERS: Readonly<Record<Exclude<CombatSymbol, 'scheme'>, string>> = {
    attack: 'A',
    defense: 'D',
    versatile: 'V',
    'hybrid-attack': 'HA',
    'hybrid-defense': 'HD',
    'hybrid-versatile': 'HV'
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

<div bind:this={host} class="entry" style:--depth={depth} role="listitem">
  <div
    bind:this={row}
    class="row"
    class:selected
    class:dragging
    class:drop-before={dropBefore}
    class:drop-after={dropAfter}
    draggable="true"
    ondragstart={onDragStart}
    ondragover={onDragOver}
    ondragleave={() => cardDrag.leave(card.id)}
    ondrop={onDrop}
    ondragend={() => cardDrag.end()}
    role="presentation"
  >
    <button type="button" class="main" onclick={() => workshop.selectCard(card.id)}>
      <span class="dot" style:background="var({meta.colorVar})"></span>
      <span class="name" class:unnamed>{cardLabel(card)}</span>
      {#if trailing}<span class="trailing numeric">{trailing}</span>{/if}
      {#if card.quantity > 1}<span class="qty numeric">×{card.quantity}</span>{/if}
    </button>

    <button
      bind:this={moveTrigger}
      id={moveTriggerId}
      type="button"
      class="move"
      aria-label="Move or reorder {cardLabel(card)}"
      aria-expanded={actionsOpen}
      onclick={() => (actionsOpen = !actionsOpen)}
    >
      <Icon name="move" size={12} />
    </button>

    <!-- Nothing in the app brings a deleted card back, so this stays a
         two-activation action even in the compact sidebar row. -->
    <ConfirmAction
      class="remove"
      size="sm"
      variant="ghost"
      armedVariant="ghost"
      iconOnly
      label="Delete card"
      confirmLabel="Delete card — activate again to confirm"
      onconfirm={() => workshop.removeCard(card.id)}
    >
      <Icon name="trash" size={12} />
    </ConfirmAction>
  </div>

  {#if actionsOpen}
    <div class="move-panel" role="group" aria-label="Move and reorder {cardLabel(card)}">
      <button type="button" class="move-action" disabled={!previousCard} onclick={moveEarlier}>
        <span class="direction earlier"><Icon name="chevronRight" size={12} /></span>
        Earlier
      </button>
      <button type="button" class="move-action" disabled={!nextCard} onclick={moveLater}>
        <span class="direction later"><Icon name="chevronRight" size={12} /></span>
        Later
      </button>

      {#if compatibleDecks.length > 1}
        <label class="deck-move">
          <span>Move to deck</span>
          <select value={card.deckId} onchange={moveToDeck}>
            {#each compatibleDecks as deck (deck.id)}
              <option value={deck.id}>{destinationLabel(deck)}</option>
            {/each}
          </select>
        </label>
      {/if}
    </div>
  {/if}
</div>

<style>
  .entry {
    min-width: 0;
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
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

  .row > :global(.remove) {
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

  .move {
    display: grid;
    place-items: center;
    width: 22px;
    height: 26px;
    flex: none;
    border-radius: var(--radius-xs);
    color: var(--text-muted);
    opacity: 0;
    transition:
      opacity var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out);
  }

  .row:hover .move,
  .move:focus-visible,
  .move[aria-expanded='true'] {
    opacity: 1;
  }

  .move:hover,
  .move[aria-expanded='true'] {
    color: var(--text-primary);
    background: var(--surface-hover);
  }

  .row:hover > :global(.remove),
  .row > :global(.remove:focus-visible) {
    opacity: 1;
  }

  .row > :global(.remove:hover) {
    color: var(--danger);
  }

  /* Armed: visibly loaded, and shown regardless of hover so the second click
     is never aimed at something that has faded back out. */
  .row > :global(.remove[data-confirm-armed='true']) {
    opacity: 1;
    color: var(--danger);
    background: color-mix(in oklab, var(--danger) 18%, transparent);
  }

  .move-panel {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
    margin: var(--space-1) var(--space-1) var(--space-2);
    margin-left: calc(var(--space-2) + var(--depth) * var(--space-3));
    padding: var(--space-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
  }

  .move-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-width: 0;
    min-height: 32px;
    padding-inline: var(--space-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-xs);
    background: var(--surface-raised);
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .move-action:hover:not(:disabled) {
    border-color: var(--border-default);
    color: var(--text-primary);
  }

  .move-action:disabled {
    opacity: 0.4;
  }

  .direction {
    display: grid;
    place-items: center;
  }

  .direction.earlier {
    rotate: -90deg;
  }

  .direction.later {
    rotate: 90deg;
  }

  .deck-move {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .deck-move select {
    width: 100%;
    min-width: 0;
    height: 32px;
    padding-inline: var(--space-2);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xs);
    background: var(--surface-raised);
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }

  @media (max-width: 760px) {
    /* Safari zooms the whole page when a focused field renders below 16px.
       This selector is opened only on demand, which hid it from the shared
       control pass until the end-to-end phone journey exercised Move. */
    .deck-move select {
      font-size: var(--text-md);
    }
  }

  @media (hover: none), (any-pointer: coarse) {
    .row {
      gap: 0;
      min-height: var(--touch-target);
    }

    .main {
      height: var(--touch-target);
    }

    .move,
    .row > :global(.remove) {
      width: var(--touch-target);
      height: var(--touch-target);
      opacity: 1;
    }

    .move-action,
    .deck-move select {
      min-height: var(--touch-target);
    }
  }
</style>
