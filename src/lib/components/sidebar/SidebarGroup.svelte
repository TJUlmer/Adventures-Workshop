<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import type { IconName } from '$lib/ui/Icon.svelte';

  interface Props {
    title: string;
    icon: IconName;
    count?: number;
    /**
     * CSS custom property carrying this section's accent colour — e.g.
     * `--role-hero`, `--section-rules` — for a soft wash behind the whole
     * group and the header icon. Omit for a neutral section (Others,
     * Unassigned); `SidebarGroup` does not know or care what the name means,
     * it only paints whatever var it is handed.
     */
    tint?: string;
    /** Buttons revealed on hover in the group header. */
    actions?: Snippet;
    children: Snippet;
  }

  let { title, icon, count, tint, actions, children }: Props = $props();

  let open = $state(true);
</script>

<section class="group" class:collapsed={!open} style:--tint={tint ? `var(${tint})` : undefined}>
  <div class="head">
    <button
      type="button"
      class="toggle"
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      <span class="chevron" class:open><Icon name="chevronRight" size={12} /></span>
      <span class="icon"><Icon name={icon} size={15} /></span>
      <span class="title">{title}</span>
      {#if count !== undefined}
        <span class="count numeric">{count}</span>
      {/if}
    </button>

    {#if actions}
      <div class="actions">{@render actions()}</div>
    {/if}
  </div>

  {#if open}
    <div class="body">{@render children()}</div>
  {/if}
</section>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-block: var(--space-3);
    /*
     * `var(--tint, transparent)` falls back to `transparent` when no `tint`
     * prop is set, so `color-mix` resolves to fully transparent and an
     * untinted group (Others, Unassigned) looks exactly as it did before —
     * no separate class needed to opt out.
     */
    background: color-mix(in oklab, var(--tint, transparent) 9%, transparent);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding-inline: var(--space-2);
  }

  /*
   * A section header has to outrank everything nested under it — the rows
   * below run 11–13px — so it is the largest type in the tree, not the
   * smallest. Size, weight and ink all step up together; caps alone were not
   * enough to read as a heading.
   */
  .toggle {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    height: 28px;
    padding-inline: var(--space-1);
    border-radius: var(--radius-xs);
    color: var(--text-secondary);
    transition: color var(--duration-fast) var(--ease-out);
  }

  .toggle:hover {
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

  .icon {
    display: grid;
    place-items: center;
    color: var(--tint, inherit);
    opacity: 0.85;
  }

  .title {
    font-size: var(--text-sm);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The count is a footnote to the header, so it stays at the old size. */
  .count {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    opacity: 0.7;
  }

  .actions {
    display: flex;
    gap: var(--space-1);
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-out);
  }

  .head:hover .actions,
  .actions:focus-within {
    opacity: 1;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-inline: var(--space-2);
  }
</style>
