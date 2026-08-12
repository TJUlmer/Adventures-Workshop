<script lang="ts">
  /**
   * Every component of the set in one place.
   *
   * This is the review page — the one you scroll before calling a set done, and
   * the source for a future set-overview sheet. Cards render through the same
   * component the editor previews, so what is here is what prints.
   *
   * It is also what a published set looks like to a stranger, which is why it
   * takes the set as a prop rather than only reading the store: a shared set is
   * never in the library, so there is nothing in the store to read. That view
   * passes `interactive={false}`, and the difference is only in the wrappers —
   * a tile that opens the editor is a button, and one belonging to somebody
   * else's set is not a control at all. What is *drawn* is identical, which is
   * the point: a viewer sees the set, not a summary of it.
   */
  import { cardLabel } from '$lib/cards/factory';
  import type { Card } from '$lib/cards/types';
  import { CARD_TYPE_META, INITIATIVE_VARIANTS } from '$lib/cards/types';
  import { characterLabel } from '$lib/characters/factory';
  import type { Character, CharacterRole } from '$lib/characters/types';
  import { hasArtwork } from '$lib/core/artwork';
  import type { Deck, DeckKind } from '$lib/decks/types';
  import { figureLabel, FIGURE_KIND_LABELS } from '$lib/figures/types';
  import { CardRenderer, MapBoard, ThreatBoard } from '$lib/renderer';
  import { resolveStyleForCard } from '$lib/sets/queries';
  import type { AdventureSet } from '$lib/sets/types';
  import { threatTotal } from '$lib/threat/types';
  import { navigation } from '$lib/state/navigation.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { EmptyState, Icon } from '$lib/ui';

  interface Props {
    /** The set to lay out. The open one unless another is handed in. */
    set?: AdventureSet;
    /** Whether a tile is a way in to the editor. Off for someone else's set. */
    interactive?: boolean;
    /** Off where the screen around it has already named the set. */
    heading?: boolean;
  }

  let { set: given, interactive = true, heading = true }: Props = $props();

  const set = $derived(given ?? workshop.adventure);

  /*
   * A tile that goes nowhere is not a button.
   *
   * Not a disabled one either: disabled says "this control exists but is
   * unavailable", and reads as `cursor: not-allowed` — which is an accusation
   * rather than a fact. There is simply no control here to press.
   *
   * The `role` alongside every `type` below is not redundant, and the compiler
   * insists: it cannot see what `this` will be, so a click handler on a
   * `<svelte:element>` is a handler on an unknown tag until the role says
   * otherwise. Both are dropped in the same breath as the handler.
   */
  const tile = $derived(interactive ? 'button' : 'div');

  /** The villain the track names, for the board's nameplate and burst. */
  const threatVillain = $derived(
    set.characters.find((character) => character.id === set.threat.villainId) ?? null
  );

  /** A figure's assigned character's name, so a dial shows its owner's. */
  function figureOwnerName(figure: (typeof set.figures)[number]): string | null {
    const owner = set.characters.find((character) => character.id === figure.characterId);
    return owner ? characterLabel(owner) : null;
  }

  /** Which faces a card contributes to the gallery. Only events have two. */
  const FRONT_ONLY = ['front'] as const;
  const EVENT_SIDES = ['front', 'back'] as const;

  /** Figures in the order a set is read: the villain, then what it commands. */
  const ROLE_ORDER: readonly CharacterRole[] = ['villain', 'minion', 'sidekick', 'hero'];

  /** A figure's own decks, action first, then whatever else it deals from. */
  const OWNED_DECK_ORDER: readonly DeckKind[] = ['action', 'special', 'rules', 'event', 'initiative'];

  interface Group {
    key: string;
    title: string;
    owner: Character | null;
    cards: Card[];
  }

  /**
   * Every card in the set, in the order the set is assembled: each figure with
   * its decks, then initiative split by what the card does, then rules and
   * events. Deck order in the document is an authoring accident; this is the
   * order someone reviewing the set expects to walk it in.
   */
  const groups = $derived.by(() => {
    const out: Group[] = [];
    const placed = new Set<string>();
    const cardsIn = (deckId: string) => set.cards.filter((card) => card.deckId === deckId);

    const take = (deck: Deck, title: string, owner: Character | null): void => {
      placed.add(deck.id);
      const cards = cardsIn(deck.id);
      if (cards.length > 0) out.push({ key: deck.id, title, owner, cards });
    };

    for (const role of ROLE_ORDER) {
      for (const character of set.characters.filter((entry) => entry.role === role)) {
        const owned = set.decks
          .filter((deck) => deck.ownerId === character.id)
          .sort(
            (a, b) => OWNED_DECK_ORDER.indexOf(a.kind) - OWNED_DECK_ORDER.indexOf(b.kind)
          );
        for (const deck of owned) take(deck, deck.name, character);
      }
    }

    // Initiative reads as two things, not one deck — acting, then resolving.
    const initiative: Card[] = [];
    for (const deck of set.decks.filter((deck) => deck.kind === 'initiative')) {
      placed.add(deck.id);
      initiative.push(...cardsIn(deck.id));
    }
    for (const variant of INITIATIVE_VARIANTS) {
      const cards = initiative.filter(
        (card) => card.type === 'initiative' && card.variant === variant
      );
      if (cards.length > 0) {
        out.push({
          key: `initiative-${variant}`,
          title: `Initiative — ${variant === 'card' ? 'Character' : 'Effect'}`,
          owner: null,
          cards
        });
      }
    }

    for (const kind of ['rules', 'event'] as const) {
      for (const deck of set.decks.filter((deck) => deck.kind === kind)) {
        take(deck, deck.name, null);
      }
    }

    // Anything the passes above did not claim — an orphaned deck, say.
    for (const deck of set.decks) {
      if (placed.has(deck.id)) continue;
      take(deck, deck.name, set.characters.find((entry) => entry.id === deck.ownerId) ?? null);
    }

    return out;
  });

  let size = $state(150);
</script>

<div class="page scroll-y">
  <header class="head">
    {#if heading}
      <div>
        <span class="eyebrow">Set tool</span>
        <h1 class="title">Overview</h1>
        <p class="lede">Every card, figure and track in the set.</p>
      </div>
    {/if}

    <label class="zoom">
      <Icon name="search" size={12} />
      <input
        type="range"
        min="110"
        max="260"
        step="10"
        value={size}
        aria-label="Card size"
        oninput={(event) => (size = event.currentTarget.valueAsNumber)}
      />
    </label>
  </header>

  {#if set.cards.length === 0 && set.figures.length === 0}
    <EmptyState
      icon="layers"
      title="Nothing to review yet"
      description="Cards, figures and the threat track all appear here once the set has some."
    />
  {/if}

  <!-- Decks -------------------------------------------------------------- -->
  {#each groups as group (group.key)}
    <section class="group">
      <h2 class="group-title">
        {group.title}
        {#if group.owner}<span class="group-owner">{characterLabel(group.owner)}</span>{/if}
        <span class="group-count numeric">{group.cards.length}</span>
      </h2>

      <div class="gallery" style:--tile="{size}px">
        {#each group.cards as card (card.id)}
          <!-- An event card is designed on both sides, so both belong here. -->
          {@const sides = card.type === 'event' ? EVENT_SIDES : FRONT_ONLY}
          {#each sides as side (side)}
            <figure class="tile">
              <svelte:element
                this={tile}
                class="tile-card"
                type={interactive ? 'button' : undefined}
                role={interactive ? 'button' : undefined}
                onclick={interactive ? () => workshop.selectCard(card.id) : undefined}
              >
                <CardRenderer
                  {card}
                  character={group.owner}
                  theme={resolveStyleForCard(set, card)}
                  {side}
                />
              </svelte:element>
              <figcaption class="tile-caption">
                <span class="tile-name">{cardLabel(card)}</span>
                <span class="tile-meta">
                  {side === 'back' ? 'Reverse' : CARD_TYPE_META[card.type].label}
                  {#if card.quantity > 1}<span class="numeric">×{card.quantity}</span>{/if}
                </span>
              </figcaption>
            </figure>
          {/each}
        {/each}
      </div>
    </section>
  {/each}

  <!-- Deck backs --------------------------------------------------------- -->
  {#if set.characters.length > 0}
    <section class="group">
      <h2 class="group-title">
        Deck backs
        <span class="group-count numeric">{set.characters.length}</span>
      </h2>

      <div class="gallery" style:--tile="{size}px">
        {#each set.characters as character (character.id)}
          <figure class="tile">
            <svelte:element
              this={tile}
              class="tile-card"
              type={interactive ? 'button' : undefined}
              role={interactive ? 'button' : undefined}
              onclick={interactive ? () => workshop.selectCharacter(character.id) : undefined}
            >
              <CardRenderer card={null} cardback={character} />
            </svelte:element>
            <figcaption class="tile-caption">
              <span class="tile-name">{characterLabel(character)}</span>
              <span class="tile-meta">Deck back</span>
            </figcaption>
          </figure>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Threat track ------------------------------------------------------- -->
  {#if set.threat.enabled}
    <section class="group">
      <h2 class="group-title">
        Threat track
        <span class="group-count numeric">{threatTotal(set.threat)} total</span>
      </h2>

      <!--
        The real board, drawn read-only through the same component the editor
        and the exporter use, so the overview shows exactly what prints rather
        than a sketch of it. Click to open the track for editing.
      -->
      <svelte:element
        this={tile}
        class="track-open"
        type={interactive ? 'button' : undefined}
        role={interactive ? 'button' : undefined}
        onclick={interactive ? () => navigation.go('threat') : undefined}
      >
        <ThreatBoard
          track={set.threat}
          villainName={threatVillain ? characterLabel(threatVillain) : ''}
          editable={false}
        />
      </svelte:element>
    </section>
  {/if}

  <!-- Map ----------------------------------------------------------------- -->
  {#if set.map.enabled}
    <section class="group">
      <h2 class="group-title">
        Map
        <span class="group-count numeric">
          {set.map.spaces.length}
          {set.map.spaces.length === 1 ? 'space' : 'spaces'}, {set.map.paths.length}
          {set.map.paths.length === 1 ? 'path' : 'paths'}
        </span>
      </h2>

      <!--
        The real board, read-only, through the same component the editor draws —
        the overview shows what prints rather than a sketch of it. Same reasoning
        as the threat track above, and it sits next to it because on the table
        the two are one board.
      -->
      <svelte:element
        this={tile}
        class="track-open"
        type={interactive ? 'button' : undefined}
        role={interactive ? 'button' : undefined}
        onclick={interactive ? () => navigation.go('map') : undefined}
      >
        <MapBoard map={set.map} />
      </svelte:element>
    </section>
  {/if}

  <!-- Figures ------------------------------------------------------------ -->
  {#if set.figures.length > 0}
    <section class="group">
      <h2 class="group-title">
        Components
        <span class="group-count numeric">{set.figures.length}</span>
      </h2>

      <div class="figures">
        {#each set.figures as figure (figure.id)}
          <svelte:element
            this={tile}
            class="figure"
            type={interactive ? 'button' : undefined}
            role={interactive ? 'button' : undefined}
            onclick={interactive ? () => navigation.go('figures') : undefined}
          >
            <span class="figure-thumb" class:empty={!hasArtwork(figure.reference)}>
              {#if hasArtwork(figure.reference) && figure.reference.source}
                <img src={figure.reference.source} alt="" />
              {:else}
                <Icon name="image" size={16} />
              {/if}
            </span>
            <span class="figure-name">{figureLabel(figure, figureOwnerName(figure))}</span>
            <span class="figure-meta">
              {FIGURE_KIND_LABELS[figure.kind]}
              {#if figure.quantity > 1}<span class="numeric">×{figure.quantity}</span>{/if}
            </span>
          </svelte:element>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .page {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
    padding: var(--space-7) var(--space-8) var(--space-10);
  }

  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-5);
  }

  .eyebrow {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .title {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }

  .lede {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .zoom {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    /* Stays right when there is no heading beside it to be spaced against. */
    margin-left: auto;
    color: var(--text-muted);
  }

  .zoom input {
    width: 120px;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .group-title {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  .group-owner {
    text-transform: none;
    letter-spacing: var(--tracking-normal);
    color: var(--text-muted);
    font-weight: var(--weight-normal);
  }

  .group-count {
    margin-left: auto;
    color: var(--text-muted);
  }

  .gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--tile), 1fr));
    gap: var(--space-4);
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
  }

  .tile-card {
    display: block;
    padding: 0;
    border-radius: var(--radius-sm);
    transition: translate var(--duration-fast) var(--ease-out);
  }

  /*
   * The lift is a promise that something happens on click, so it is qualified
   * on the tag rather than the class: in a read-only overview these are divs.
   */
  button.tile-card:hover {
    translate: 0 -2px;
  }

  .tile-caption {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .tile-name {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tile-meta {
    display: flex;
    gap: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  /* -- threat track ------------------------------------------------------ */
  /*
   * A button wrapping the real board, so the whole strip is the click target
   * that opens the editor. `display: block` and full width let the board size
   * itself; the board owns its own layout and proportions.
   */
  .track-open {
    display: block;
    width: 100%;
    padding: 0;
    border-radius: var(--radius-lg);
    transition: translate var(--duration-fast) var(--ease-out);
  }

  button.track-open:hover {
    translate: 0 -2px;
  }

  /* -- figures ----------------------------------------------------------- */
  .figures {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: var(--space-3);
  }

  .figure {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    text-align: left;
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  button.figure:hover {
    border-color: var(--border-strong);
  }

  .figure-thumb {
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 1;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-sunken);
    color: var(--text-muted);
  }

  .figure-thumb.empty {
    border: 1px dashed var(--border-default);
  }

  .figure-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .figure-name {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .figure-meta {
    display: flex;
    gap: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
</style>
