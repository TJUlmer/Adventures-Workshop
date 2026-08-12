<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './Icon.svelte';

  interface Props {
    icon?: IconName;
    title: string;
    description?: string;
    /** Optional call-to-action row. */
    actions?: Snippet;
    /** Tighter treatment for empty states inside a list. */
    compact?: boolean;
  }

  let { icon = 'sparkle', title, description, actions, compact = false }: Props = $props();
</script>

<div class="empty" class:compact>
  <span class="glyph"><Icon name={icon} size={compact ? 15 : 20} /></span>
  <p class="title">{title}</p>
  {#if description}<p class="description">{description}</p>{/if}
  {#if actions}
    <div class="actions">{@render actions()}</div>
  {/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-2);
    padding: var(--space-8) var(--space-6);
    max-width: 34ch;
    margin-inline: auto;
  }

  .glyph {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    margin-bottom: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    color: var(--text-muted);
  }

  .title {
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
    color: var(--text-secondary);
    letter-spacing: var(--tracking-tight);
  }

  .description {
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: balance;
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .compact {
    padding: var(--space-5) var(--space-4);
    gap: var(--space-1);
  }

  .compact .glyph {
    width: 30px;
    height: 30px;
    margin-bottom: var(--space-1);
  }

  .compact .title {
    font-size: var(--text-sm);
  }
</style>
