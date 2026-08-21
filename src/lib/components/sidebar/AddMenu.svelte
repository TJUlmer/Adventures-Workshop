<script lang="ts">
  /**
   * The Contents "+" button. Adding is the one action that needs a choice
   * first — a villain, a minion, an initiative card, a rules card — so the
   * button opens a short menu rather than guessing.
   */
  import { workshop } from '$lib/state/workshop.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import type { IconName } from '$lib/ui/Icon.svelte';

  let open = $state(false);
  let host = $state<HTMLDivElement | null>(null);

  interface Entry {
    label: string;
    hint: string;
    icon: IconName;
    disabled?: boolean;
    run: () => void;
  }

  const villainCount = $derived(
    workshop.adventure.characters.filter((character) => character.role === 'villain').length
  );

  /*
   * A heroes set offers five fewer things to add. Four of them — Villain,
   * Minion, Initiative card, Event card — are dropped because the sidebar has
   * stopped drawing anywhere for them to appear; a menu that can add something
   * with nowhere to go is a menu that loses people's work. The fifth,
   * Deception card, is dropped for a different reason: it is an Adventures
   * preset (the card that survives being discarded, which only matters
   * against an opponent reading your discards), not something a heroes set
   * has no room for. Dropped rather than disabled either way: a row
   * explaining why you cannot add a villain, in a set that never mentions
   * villains anywhere else, raises a question nobody asked. Settings is where
   * the kind is explained, and it says what it hides.
   */
  const heroesSet = $derived(workshop.isHeroesSet);

  const entries = $derived<Entry[]>([
    {
      label: 'Hero',
      hint: 'A playable protagonist',
      icon: 'users',
      run: () => workshop.addCharacter('hero')
    },
    ...(heroesSet
      ? []
      : ([
          {
            label: 'Villain',
            hint: villainCount >= 2 ? 'Two villains is the limit' : 'A figure with its own deck',
            icon: 'skull',
            disabled: villainCount >= 2,
            run: () => workshop.addCharacter('villain')
          },
          {
            label: 'Minion',
            hint: 'Rank-and-file figure',
            icon: 'users',
            run: () => workshop.addCharacter('minion')
          }
        ] satisfies Entry[])),
    /* Deception is an Adventures preset — the card that sends a discarded
       card back into its own deck rather than the discard pile, which only
       matters against an opponent reading your discards. A heroes set has no
       such opponent, so it joins the adventure-only group below. */
    ...(heroesSet
      ? []
      : ([
          {
            label: 'Deception card',
            hint: 'The preset every deck carries',
            icon: 'copy',
            run: () => workshop.addDeceptionCard()
          }
        ] satisfies Entry[])),
    ...(heroesSet
      ? []
      : ([
          {
            label: 'Initiative card',
            hint: 'Drives the villain’s turn',
            icon: 'hourglass',
            run: () => workshop.addInitiativeCard()
          }
        ] satisfies Entry[])),
    {
      label: 'Rules card',
      hint: 'Reference text',
      icon: 'book',
      run: () => workshop.addRulesCard()
    },
    ...(heroesSet
      ? []
      : ([
          {
            label: 'Event card',
            hint: 'Dealt out mid-fight',
            icon: 'sparkle',
            run: () => workshop.addEventCard()
          }
        ] satisfies Entry[]))
  ]);

  function choose(entry: Entry): void {
    if (entry.disabled) return;
    entry.run();
    open = false;
  }

  /** Close on an outside click or Escape, the way a menu should. */
  $effect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (host && !host.contains(event.target as Node)) open = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') open = false;
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="add" bind:this={host}>
  <button
    type="button"
    class="trigger"
    title="Add to this set"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <Icon name="plus" size={13} />
  </button>

  {#if open}
    <div class="menu" role="menu">
      {#each entries as entry (entry.label)}
        <button
          type="button"
          class="item"
          role="menuitem"
          disabled={entry.disabled}
          onclick={() => choose(entry)}
        >
          <span class="item-icon"><Icon name={entry.icon} size={14} /></span>
          <span class="item-text">
            <span class="item-label">{entry.label}</span>
            <span class="item-hint">{entry.hint}</span>
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .add {
    position: relative;
  }

  .trigger {
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

  .trigger:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .menu {
    position: absolute;
    top: calc(100% + var(--space-2));
    right: 0;
    z-index: var(--z-dropdown);
    min-width: 208px;
    padding: var(--space-1);
    border-radius: var(--radius-md);
    background: var(--surface-overlay);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg);
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    text-align: left;
    color: var(--text-secondary);
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  .item:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .item-icon {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex: none;
    border-radius: var(--radius-xs);
    background: var(--surface-sunken);
    color: var(--text-muted);
  }

  .item-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .item-label {
    font-size: var(--text-sm);
  }

  .item-hint {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
</style>
