<script lang="ts" generics="TValue extends string">
  import { tick } from 'svelte';

  interface Tab {
    value: TValue;
    label: string;
    /** Small trailing count, e.g. number of overrides. */
    badge?: number;
  }

  interface Props {
    value: TValue;
    tabs: readonly Tab[];
    label: string;
  }

  let { value = $bindable(), tabs, label }: Props = $props();

  let tablist = $state<HTMLDivElement | null>(null);

  /**
   * Move only this strip. `scrollIntoView` also considers every scrollable
   * ancestor, so changing a tab could move the editor vertically as well as
   * revealing the tab itself.
   */
  function revealSelected(): void {
    if (!tablist) return;
    const selected = tablist.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!selected) return;

    const viewport = tablist.getBoundingClientRect();
    const item = selected.getBoundingClientRect();
    if (item.left < viewport.left) {
      tablist.scrollLeft += item.left - viewport.left;
    } else if (item.right > viewport.right) {
      tablist.scrollLeft += item.right - viewport.right;
    }
  }

  $effect(() => {
    /* Labels and badges can change without the selected value changing. The
       signature makes those width changes part of this effect's inputs. */
    const selectedValue = value;
    const tabSignature = tabs
      .map((tab) => `${tab.value}\u001f${tab.label}\u001f${tab.badge ?? ''}`)
      .join('\u001e');
    void selectedValue;
    void tabSignature;

    const scroller = tablist;
    if (!scroller) return;

    let cancelled = false;
    let observer: ResizeObserver | undefined;
    void tick().then(() => {
      if (cancelled) return;
      revealSelected();

      if (typeof ResizeObserver === 'undefined') return;
      observer = new ResizeObserver(revealSelected);
      observer.observe(scroller);
      for (const tab of scroller.querySelectorAll<HTMLElement>('[role="tab"]')) {
        observer.observe(tab);
      }
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  });
</script>

<div bind:this={tablist} class="tabs" role="tablist" aria-label={label}>
  {#each tabs as tab (tab.value)}
    <button
      type="button"
      role="tab"
      class="tab"
      class:selected={tab.value === value}
      aria-selected={tab.value === value}
      onclick={() => (value = tab.value)}
    >
      {tab.label}
      {#if tab.badge}<span class="badge numeric">{tab.badge}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    gap: var(--space-5);
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-inline: contain;
    border-bottom: 1px solid var(--border-subtle);
  }

  .tab {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    padding-block: var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-tight);
    color: var(--text-muted);
    white-space: nowrap;
    transition: color var(--duration-fast) var(--ease-out);
  }

  /* The strip clips inline overflow, so keep the global focus outline inside
     the button when the focused tab sits against either viewport edge. */
  .tab:focus-visible {
    outline-offset: -2px;
  }

  .tab::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    /* A scroll container clips the old -1px overhang; keep both pixels of the
       selected marker inside the strip instead of reducing it to a hairline. */
    bottom: 0;
    height: 2px;
    border-radius: var(--radius-full);
    background: transparent;
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  .tab:hover {
    color: var(--text-secondary);
  }

  .selected {
    color: var(--text-primary);
  }

  .selected::after {
    background: var(--accent);
  }

  .badge {
    display: inline-grid;
    place-items: center;
    min-width: 16px;
    height: 16px;
    padding-inline: 4px;
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--text-accent);
    font-size: var(--text-2xs);
  }

  @media (any-pointer: coarse) {
    .tab {
      min-height: 44px;
    }
  }
</style>
