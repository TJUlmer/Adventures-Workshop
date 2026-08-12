<script lang="ts">
  /**
   * The set hierarchy: Set → Character → Deck → Cards, grouped as
   * Villain / Minions / Initiative.
   *
   * Everything shown here comes from `workshop.outline`, a single derived view
   * of the document. The sidebar keeps no state of its own beyond which groups
   * are open.
   */
  import { INITIATIVE_VARIANTS } from '$lib/cards/types';
  import type { InitiativeVariant } from '$lib/cards/types';
  import type { CharacterEntry, DeckEntry } from '$lib/sets/types';
  import { workshop } from '$lib/state/workshop.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import AddMenu from './AddMenu.svelte';
  import CardRow from './CardRow.svelte';
  import CharacterBranch from './CharacterBranch.svelte';
  import DeckRow from './DeckRow.svelte';
  import SidebarGroup from './SidebarGroup.svelte';

  const outline = $derived(workshop.outline);

  /**
   * How the two initiative variants read in the tree. `card` is the model's
   * name for a figure taking its turn; "Character" is what that is to an
   * author, and it sits better beside "Effect".
   */
  const INITIATIVE_VARIANT_GROUPS: Record<InitiativeVariant, string> = {
    card: 'Character',
    effect: 'Effect'
  };
</script>

{#snippet deckBlock(entry: DeckEntry, ownerName: string | null, depth: 0 | 1)}
  <DeckRow deck={entry.deck} printCount={entry.printCount} {ownerName} {depth} />
  {#each entry.cards as card (card.id)}
    <CardRow {card} depth={depth === 0 ? 1 : 2} />
  {/each}
  {#if entry.cards.length === 0}
    <button
      type="button"
      class="add-row"
      style:--depth={depth === 0 ? 1 : 2}
      onclick={() => workshop.addCard(entry.deck.id)}
    >
      <Icon name="plus" size={12} />
      Add card
    </button>
  {/if}
{/snippet}

<!--
  The initiative deck holds two different things — figures acting and effects
  resolving — and reading it as one list makes neither easy to find. Each
  variant is its own run with its own way in, so a new card starts as the kind
  the author was reaching for. The deck itself needs no row: there is only ever
  one, and these two headings are what an author is actually looking for.
-->
{#snippet initiativeBlock(entry: DeckEntry)}
  {#each INITIATIVE_VARIANTS as variant (variant)}
    {@const cards = entry.cards.filter(
      (card) => card.type === 'initiative' && card.variant === variant
    )}
    <div class="subhead">
      <span class="subhead-title">{INITIATIVE_VARIANT_GROUPS[variant]}</span>
      <button
        type="button"
        class="subhead-add"
        title="Add {INITIATIVE_VARIANT_GROUPS[variant].toLowerCase()} card"
        onclick={() => workshop.addInitiativeCard(variant)}
      >
        <Icon name="plus" size={12} />
      </button>
    </div>

    {#each cards as card (card.id)}
      <CardRow {card} depth={1} />
    {/each}
  {/each}
{/snippet}

{#snippet characterBlock(entry: CharacterEntry)}
  <CharacterBranch {entry}>
    {#each entry.decks as deckEntry (deckEntry.deck.id)}
      {@render deckBlock(deckEntry, null, 1)}
    {/each}
  </CharacterBranch>
{/snippet}

<div class="sidebar-inner">
  <div class="head">
    <span class="eyebrow">Contents</span>
    <AddMenu />
  </div>

  <nav class="scroll scroll-y">
    <!-- Villain --------------------------------------------------------- -->
    <SidebarGroup title="Villains" icon="skull" count={outline.villains.length}>
      {#snippet actions()}
        {#if workshop.canAddVillain()}
          <button
            type="button"
            class="group-action"
            title="Add villain"
            onclick={() => workshop.addCharacter('villain')}
          >
            <Icon name="plus" size={12} />
          </button>
        {/if}
      {/snippet}

      {#if outline.villains.length === 0}
        <button type="button" class="prompt" onclick={() => workshop.addCharacter('villain')}>
          <Icon name="plus" size={12} />
          Create the villain
        </button>
      {:else}
        {#each outline.villains as entry (entry.character.id)}
          {@render characterBlock(entry)}
        {/each}
      {/if}
    </SidebarGroup>

    <!-- Minions --------------------------------------------------------- -->
    <SidebarGroup title="Minions" icon="users" count={outline.minions.length}>
      {#snippet actions()}
        <button
          type="button"
          class="group-action"
          title="Add minion"
          onclick={() => workshop.addCharacter('minion')}
        >
          <Icon name="plus" size={12} />
        </button>
      {/snippet}

      {#if outline.minions.length === 0}
        <button type="button" class="prompt" onclick={() => workshop.addCharacter('minion')}>
          <Icon name="plus" size={12} />
          Add a minion
        </button>
      {:else}
        {#each outline.minions as entry (entry.character.id)}
          {@render characterBlock(entry)}
        {/each}
      {/if}
    </SidebarGroup>

    <!-- Initiative ------------------------------------------------------ -->
    <SidebarGroup title="Initiative" icon="hourglass" count={outline.initiative.length}>
      {#snippet actions()}
        <button
          type="button"
          class="group-action"
          title="Add initiative card"
          onclick={() => workshop.addInitiativeCard()}
        >
          <Icon name="plus" size={12} />
        </button>
      {/snippet}

      {#if outline.initiative.length === 0}
        <button type="button" class="prompt" onclick={() => workshop.addInitiativeCard()}>
          <Icon name="plus" size={12} />
          Build the initiative deck
        </button>
      {:else}
        {#each outline.initiative as entry (entry.deck.id)}
          {@render initiativeBlock(entry)}
        {/each}
      {/if}
    </SidebarGroup>

    <!-- Rules ----------------------------------------------------------- -->
    <SidebarGroup title="Rules" icon="book" count={outline.rules.length}>
      {#snippet actions()}
        <button
          type="button"
          class="group-action"
          title="Add rules card"
          onclick={() => workshop.addRulesCard()}
        >
          <Icon name="plus" size={12} />
        </button>
      {/snippet}

      {#if outline.rules.length === 0}
        <button type="button" class="prompt" onclick={() => workshop.addRulesCard()}>
          <Icon name="plus" size={12} />
          Add a rules card
        </button>
      {:else}
        {#each outline.rules as entry (entry.deck.id)}
          {@render deckBlock(entry, null, 0)}
        {/each}
      {/if}
    </SidebarGroup>

    <!-- Events ---------------------------------------------------------- -->
    <SidebarGroup title="Events" icon="sparkle" count={outline.events.length}>
      {#snippet actions()}
        <button
          type="button"
          class="group-action"
          title="Add event card"
          onclick={() => workshop.addEventCard()}
        >
          <Icon name="plus" size={12} />
        </button>
      {/snippet}

      {#if outline.events.length === 0}
        <button type="button" class="prompt" onclick={() => workshop.addEventCard()}>
          <Icon name="plus" size={12} />
          Add an event card
        </button>
      {:else}
        {#each outline.events as entry (entry.deck.id)}
          {@render deckBlock(entry, null, 0)}
        {/each}
      {/if}
    </SidebarGroup>

    <!-- Sidekicks and heroes: only when the author has added any --------- -->
    {#if outline.others.length > 0}
      <SidebarGroup title="Others" icon="users" count={outline.others.length}>
        {#each outline.others as entry (entry.character.id)}
          {@render characterBlock(entry)}
        {/each}
      </SidebarGroup>
    {/if}

    <!-- Decks whose character was deleted -------------------------------- -->
    {#if outline.loose.length > 0}
      <SidebarGroup title="Unassigned" icon="card" count={outline.loose.length}>
        {#each outline.loose as entry (entry.deck.id)}
          {@render deckBlock(entry, null, 0)}
        {/each}
      </SidebarGroup>
    {/if}
  </nav>
</div>

<style>
  .sidebar-inner {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    height: 34px;
    padding-inline: var(--space-4) var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
  }

  .group-action {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-xs);
    color: var(--text-muted);
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .group-action:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .scroll {
    flex: 1 1 auto;
    min-height: 0;
    padding-block: var(--space-2) var(--space-6);
  }

  /* Groups the cards inside a deck without pretending to be another deck row. */
  .subhead {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 26px;
    padding-left: var(--space-2);
    margin-top: var(--space-2);
  }

  .subhead-title {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .subhead-add {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex: none;
    border-radius: var(--radius-xs);
    color: var(--text-muted);
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .subhead-add:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .add-row,
  .prompt {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: 26px;
    padding-inline: var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-align: left;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .add-row {
    padding-left: calc(var(--space-2) + var(--depth) * var(--space-3));
    margin-bottom: var(--space-1);
  }

  .add-row:hover,
  .prompt:hover {
    background: var(--surface-hover);
    color: var(--text-secondary);
  }

  .prompt {
    height: 30px;
    border: 1px dashed var(--border-default);
  }
</style>
