<script lang="ts">
  /**
   * Secondary navigation inside a set.
   *
   * "Cards" is the editor — the three-pane workspace. The rest are set-level
   * tools. The way back out used to live here too, as a back-chevron ahead of
   * the tabs — moved to `TitleBar`'s "Home" button instead, once that existed
   * beside "Gallery", rather than duplicated in both places.
   */
  import { SET_PAGE_META } from '$lib/state/navigation.svelte';
  import type { SetPage } from '$lib/state/navigation.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import type { IconName } from '$lib/ui/Icon.svelte';

  const PAGES: readonly SetPage[] = [
    'home',
    'editor',
    'threat',
    'map',
    'figures',
    'symbols',
    'assets',
    'settings'
  ];

  /**
   * The threat track is the villain's, so a heroes set does not show its tab.
   *
   * The map deliberately stays: heroes need somewhere to fight each other, and
   * `MAP_SIZES` offers boards smaller than an adventure's for exactly that.
   *
   * Hiding the tab cannot strand anyone on the page it hides — `setKind` sends
   * an author back to Home if they are standing on it when they switch. And
   * nothing is deleted: switch back to an adventure and the track is as it was.
   */
  const pages = $derived(
    workshop.isHeroesSet ? PAGES.filter((page) => page !== 'threat') : PAGES
  );

  const current = $derived(navigation.page);
</script>

<nav class="set-nav" aria-label="Set sections">
  {#each pages as page (page)}
    {@const meta = SET_PAGE_META[page]}
    <button
      type="button"
      class="tab"
      class:active={current === page}
      title={meta.hint}
      aria-current={current === page ? 'page' : undefined}
      onclick={() => navigation.go(page)}
    >
      <Icon name={meta.icon as IconName} size={13} />
      <span class="tab-label">{meta.label}</span>
    </button>
  {/each}
</nav>

<style>
  .set-nav {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: 100%;
    padding-inline: var(--space-3);
    overflow-x: auto;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 26px;
    padding-inline: var(--space-3);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .tab:hover {
    color: var(--text-secondary);
    background: var(--surface-hover);
  }

  .tab.active {
    color: var(--text-primary);
    background: var(--surface-active);
    box-shadow: inset 0 0 0 1px var(--border-default);
  }

  .tab-label {
    font-weight: var(--weight-medium);
  }
</style>
