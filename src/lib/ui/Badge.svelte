<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** CSS custom property supplying the badge colour, e.g. `--kind-attack`. */
    colorVar?: string;
    /** Solid dot instead of a tinted pill — for dense lists. */
    dot?: boolean;
    children: Snippet;
  }

  let { colorVar = '--text-muted', dot = false, children }: Props = $props();
</script>

<span class="badge" class:dot style:--badge-color="var({colorVar})">
  {#if dot}<span class="marker"></span>{/if}
  {@render children()}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 18px;
    padding-inline: var(--space-2);
    border-radius: var(--radius-xs);
    background: color-mix(in oklab, var(--badge-color) 15%, transparent);
    color: color-mix(in oklab, var(--badge-color) 82%, var(--grey-50));
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-wide);
    white-space: nowrap;
  }

  .dot {
    padding-inline: 0;
    background: none;
    color: var(--text-tertiary);
  }

  .marker {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--badge-color);
    flex: none;
  }
</style>
