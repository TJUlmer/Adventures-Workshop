<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    eyebrow: string;
    title: string;
    subtitle?: string;
    /** CSS custom property tinting the eyebrow and the accent bar. */
    colorVar?: string;
    actions?: Snippet;
  }

  let { eyebrow, title, subtitle, colorVar = '--accent', actions }: Props = $props();
</script>

<header class="header" style:--header-accent="var({colorVar})">
  <div class="text">
    <span class="eyebrow">{eyebrow}</span>
    <h1 class="title">{title}</h1>
    {#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
  </div>
  {#if actions}
    <div class="actions">{@render actions()}</div>
  {/if}
</header>

<style>
  .header {
    position: relative;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-5);
    padding: var(--space-6) var(--space-7) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
    background: linear-gradient(
      180deg,
      color-mix(in oklab, var(--header-accent) 6%, transparent),
      transparent
    );
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .eyebrow {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: color-mix(in oklab, var(--header-accent) 70%, var(--grey-200));
  }

  .title {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    line-height: var(--leading-tight);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .subtitle {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    flex: none;
  }
</style>
