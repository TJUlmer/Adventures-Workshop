<script lang="ts" generics="TValue extends string">
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
</script>

<div class="tabs" role="tablist" aria-label={label}>
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
    border-bottom: 1px solid var(--border-subtle);
  }

  .tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding-block: var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-tight);
    color: var(--text-muted);
    transition: color var(--duration-fast) var(--ease-out);
  }

  .tab::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
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
</style>
