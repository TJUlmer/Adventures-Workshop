<script lang="ts">
  /**
   * "What's actually in this export" — a deck-by-deck checklist over
   * whatever `ExportPanel` already scoped the set down to.
   *
   * A native `<dialog>`, the same reasons `NewSetDialog` gives for using one:
   * focus trapping, Escape, the top layer and an inert background for free.
   *
   * Reads the set through `outline()` rather than walking `set.decks` itself,
   * so this shows decks grouped exactly the way `AssetsOverview` and the
   * sidebar already do — one list, trusted everywhere, not a second opinion
   * about what a "hero's decks" or "the loose pile" means.
   */
  import { characterLabel } from '$lib/characters/factory';
  import { deckLabel } from '$lib/decks/factory';
  import type { DeckId } from '$lib/decks/types';
  import type { ExportSelection } from '$lib/sets/export-selection';
  import { defaultExportSelection } from '$lib/sets/export-selection';
  import { findCharacter, outline } from '$lib/sets/queries';
  import type { AdventureSet, DeckEntry } from '$lib/sets/types';
  import { figureLabel } from '$lib/figures/types';
  import type { FigureId } from '$lib/figures/types';
  import type { RulebookId } from '$lib/sets/rulebooks';
  import { Button, Switch } from '$lib/ui';

  interface Props {
    open: boolean;
    /** The set to build the checklist from — `ExportPanel`'s own `scopedSet`. */
    set: AdventureSet;
    selection: ExportSelection;
    projectFileUsesSelection: boolean;
    onchange: (next: ExportSelection) => void;
    onclose: () => void;
  }

  let { open, set, selection, projectFileUsesSelection, onchange, onclose }: Props = $props();

  let dialog = $state<HTMLDialogElement | null>(null);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  const groups = $derived(outline(set));
  const characterGroups = $derived(
    [...groups.heroes, ...groups.villains, ...groups.minions, ...groups.others].filter(
      (entry) => entry.decks.length > 0
    )
  );

  function toggleDeck(id: DeckId, checked: boolean): void {
    const next = new Set(selection.excludedDeckIds);
    if (checked) next.delete(id);
    else next.add(id);
    onchange({ ...selection, excludedDeckIds: next });
  }

  function toggleFigure(id: FigureId, checked: boolean): void {
    const next = new Set(selection.excludedFigureIds);
    if (checked) next.delete(id);
    else next.add(id);
    onchange({ ...selection, excludedFigureIds: next });
  }

  function toggleRulebook(id: RulebookId, checked: boolean): void {
    const next = new Set(selection.excludedRulebookIds);
    if (checked) next.delete(id);
    else next.add(id);
    onchange({ ...selection, excludedRulebookIds: next });
  }
</script>

{#snippet deckRow(entry: DeckEntry)}
  <Switch
    label={deckLabel(entry.deck)}
    hint="{entry.printCount} {entry.printCount === 1 ? 'card' : 'cards'}"
    checked={!selection.excludedDeckIds.has(entry.deck.id)}
    onchange={(checked) => toggleDeck(entry.deck.id, checked)}
  />
{/snippet}

<dialog
  bind:this={dialog}
  class="selector ui-dialog-viewport"
  aria-labelledby="export-selector-title"
  onclose={() => onclose()}
>
  <div class="inner ui-dialog-frame">
    <header class="head ui-dialog-header">
      <h2 class="title" id="export-selector-title">Customize what's included</h2>
      <p class="lede">
        {#if projectFileUsesSelection}
          These temporary choices apply to every export below. Nothing here is saved with the set.
        {:else}
          These temporary choices apply to print, image and Tabletop Simulator exports. The full
          project backup always keeps the whole set.
        {/if}
      </p>
    </header>

    <div class="body ui-dialog-scroll">
      {#each characterGroups as entry (entry.character.id)}
        <section class="group">
          <h3 class="group-title">{characterLabel(entry.character)}</h3>
          {#each entry.decks as deckEntry (deckEntry.deck.id)}
            {@render deckRow(deckEntry)}
          {/each}
        </section>
      {/each}

      {#if groups.initiative.length > 0}
        <section class="group">
          <h3 class="group-title">Initiative</h3>
          {#each groups.initiative as deckEntry (deckEntry.deck.id)}
            {@render deckRow(deckEntry)}
          {/each}
        </section>
      {/if}

      {#if groups.rules.length > 0}
        <section class="group">
          <h3 class="group-title">Rules</h3>
          {#each groups.rules as deckEntry (deckEntry.deck.id)}
            {@render deckRow(deckEntry)}
          {/each}
        </section>
      {/if}

      {#if groups.events.length > 0}
        <section class="group">
          <h3 class="group-title">Events</h3>
          {#each groups.events as deckEntry (deckEntry.deck.id)}
            {@render deckRow(deckEntry)}
          {/each}
        </section>
      {/if}

      {#if groups.loose.length > 0}
        <section class="group">
          <h3 class="group-title">Other decks</h3>
          {#each groups.loose as deckEntry (deckEntry.deck.id)}
            {@render deckRow(deckEntry)}
          {/each}
        </section>
      {/if}

      {#if set.threat.enabled || set.maps.some((map) => map.enabled)}
        <section class="group">
          <h3 class="group-title">Board</h3>
          {#if set.threat.enabled}
            <Switch
              label="Threat track"
              checked={selection.includeThreat}
              onchange={(checked) => onchange({ ...selection, includeThreat: checked })}
            />
          {/if}
          {#if set.maps.some((map) => map.enabled)}
            <Switch
              label={set.maps.filter((map) => map.enabled).length === 1 ? 'Map' : 'Maps'}
              checked={selection.includeMap}
              onchange={(checked) => onchange({ ...selection, includeMap: checked })}
            />
          {/if}
        </section>
      {/if}

      {#if set.figures.length > 0 || set.rulebooks.length > 0 || set.box.enabled}
        <section class="group">
          <h3 class="group-title">Components</h3>
          {#each set.figures as figure (figure.id)}
            {@const owner = findCharacter(set, figure.characterId)}
            <Switch
              label={figureLabel(figure, owner ? characterLabel(owner) : null)}
              checked={!selection.excludedFigureIds.has(figure.id)}
              onchange={(checked) => toggleFigure(figure.id, checked)}
            />
          {/each}
          {#each set.rulebooks as book (book.id)}
            <Switch
              label={book.name}
              hint="Rulebook PDF"
              checked={!selection.excludedRulebookIds.has(book.id)}
              onchange={(checked) => toggleRulebook(book.id, checked)}
            />
          {/each}
          {#if set.box.enabled}
            <Switch
              label="Presentation box"
              hint="Wraps the TTS objects; has no gameplay effect."
              checked={selection.includeBox}
              onchange={(checked) => onchange({ ...selection, includeBox: checked })}
            />
          {/if}
        </section>
      {/if}
    </div>

    <footer class="foot ui-dialog-actions">
      <Button variant="ghost" onclick={() => onchange(defaultExportSelection())}>
        Reset
      </Button>
      <Button variant="primary" onclick={() => onclose()}>Done</Button>
    </footer>
  </div>
</dialog>

<style>
  .selector {
    --ui-dialog-inline-size: 520px;
    --ui-dialog-block-cap: 720px;

    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg, 12px);
    background: var(--surface-raised);
    color: var(--text-default);
  }

  .selector::backdrop {
    background: rgb(0 0 0 / 0.55);
  }

  .inner {
    background: inherit;
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-6) var(--space-6) var(--space-4);
  }

  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .lede {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed, 1.6);
    color: var(--text-muted);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    min-height: 0;
    padding: 0 var(--space-6) var(--space-5);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .group-title {
    margin: 0;
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  .foot {
    display: flex;
    justify-content: space-between;
    padding: var(--space-4) var(--space-6);
    border-top: 1px solid var(--border-subtle);
    background: inherit;
  }

  @media (max-width: 520px) {
    .selector {
      --ui-dialog-gutter: var(--space-3);
    }

    .head,
    .body,
    .foot {
      padding-right: var(--space-4);
      padding-left: var(--space-4);
    }
  }
</style>
