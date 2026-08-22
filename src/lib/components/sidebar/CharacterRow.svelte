<script lang="ts">
  import { characterLabel } from '$lib/characters/factory';
  import type { Character } from '$lib/characters/types';
  import { CHARACTER_ROLE_META } from '$lib/characters/types';
  import { isCharacterSelected } from '$lib/state/selection';
  import { workshop } from '$lib/state/workshop.svelte';
  import Icon from '$lib/ui/Icon.svelte';

  interface Props {
    character: Character;
    /** Printed cards across all of this character's decks. */
    printCount: number;
    /** Whether this figure's decks are showing. Omit for a row with no branch. */
    open?: boolean;
    ontoggle?: () => void;
  }

  let { character, printCount, open, ontoggle }: Props = $props();

  const meta = $derived(CHARACTER_ROLE_META[character.role]);
  const selected = $derived(isCharacterSelected(workshop.selection, character.id));
  const unnamed = $derived(character.name.trim().length === 0);

  /**
   * Delete takes two clicks: the first arms the button, the second does it.
   *
   * A character is not a small thing to lose — its decks and cards survive as
   * orphans (`workshop.removeCharacter` only nulls their `ownerId`) but the
   * figure itself, its artwork and its whole character card do not, and
   * nothing in the app brings those back. This was one click on a 22px icon
   * that only appears on hover, right beside the row you click to *select*
   * the character, and somebody duly lost work to it.
   *
   * Armed rather than a dialogue because the row is 22px wide — there is no
   * space for a Delete/Cancel pair like `HomeScreen`'s, and a modal over a
   * sidebar row is heavier than the act deserves. The arm lapses on its own
   * so a stray first click cannot sit waiting to catch the next one.
   */
  let armed = $state(false);
  let disarm: ReturnType<typeof setTimeout> | null = null;

  function requestRemove(): void {
    if (disarm) clearTimeout(disarm);
    if (armed) {
      armed = false;
      workshop.removeCharacter(character.id);
      return;
    }
    armed = true;
    disarm = setTimeout(() => (armed = false), 3000);
  }
</script>

<div class="row" class:selected>
  <!--
    Separate from the row's own button: collapsing a figure and selecting it
    are different intentions, and a set with a dozen minions needs to be able
    to fold one away without opening it.
  -->
  {#if ontoggle}
    <button
      type="button"
      class="twist"
      aria-expanded={open}
      aria-label={open ? `Collapse ${characterLabel(character)}` : `Expand ${characterLabel(character)}`}
      onclick={ontoggle}
    >
      <span class="chevron" class:open><Icon name="chevronRight" size={10} /></span>
    </button>
  {/if}

  <button type="button" class="main" onclick={() => workshop.selectCharacter(character.id)}>
    <span class="pip" style:background="var({meta.colorVar})"></span>
    <span class="name" class:unnamed>{characterLabel(character)}</span>
    {#if character.figureCount > 1}
      <span class="meta numeric">×{character.figureCount}</span>
    {/if}
    <span class="meta numeric">{printCount}</span>
  </button>

  <button
    type="button"
    class="remove"
    class:armed
    aria-label={armed ? 'Delete character — click again to confirm' : 'Delete character'}
    title={armed ? 'Click again to delete' : 'Delete character'}
    onclick={requestRemove}
    onblur={() => (armed = false)}
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

  .twist {
    display: grid;
    place-items: center;
    width: 16px;
    height: 28px;
    flex: none;
    color: var(--text-muted);
    transition: color var(--duration-fast) var(--ease-out);
  }

  .twist:hover {
    color: var(--text-primary);
  }

  .chevron {
    display: grid;
    place-items: center;
    transition: rotate var(--duration-fast) var(--ease-out);
  }

  .chevron.open {
    rotate: 90deg;
  }

  .main {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    height: 28px;
    padding-inline: var(--space-2);
    text-align: left;
    color: var(--text-secondary);
  }

  /* The twist already carries the indent when a figure has a branch. */
  .twist + .main {
    padding-left: 0;
  }

  .selected .main {
    color: var(--text-primary);
  }

  .pip {
    width: 4px;
    height: 14px;
    flex: none;
    border-radius: var(--radius-full);
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-tight);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .unnamed {
    color: var(--text-muted);
    font-style: italic;
    font-weight: var(--weight-normal);
  }

  .meta {
    flex: none;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .remove {
    display: grid;
    place-items: center;
    width: 22px;
    height: 28px;
    flex: none;
    color: var(--text-muted);
    opacity: 0;
    border-radius: var(--radius-xs);
    transition:
      opacity var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  /* Armed: visibly loaded, and shown regardless of hover so the second click
     is never aimed at something that has faded back out. */
  .remove.armed {
    opacity: 1;
    color: var(--danger);
    background: color-mix(in oklab, var(--danger) 18%, transparent);
  }

  .row:hover .remove,
  .remove:focus-visible {
    opacity: 1;
  }

  .remove:hover {
    color: var(--danger);
  }
</style>
