<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    description?: string;
    /** Buttons aligned to the right of the section heading. */
    actions?: Snippet;
    /** Field columns. Two is the default for short, paired inputs. */
    columns?: 1 | 2;
    /** Give a top-level editor section a larger, centred heading. */
    prominentHeading?: boolean;
    children: Snippet;
  }

  let {
    title,
    description,
    actions,
    columns = 1,
    prominentHeading = false,
    children
  }: Props = $props();
</script>

<section class="section">
  <header class="head" class:prominent={prominentHeading}>
    <div class="titles">
      <h2 class="title">{title}</h2>
      {#if description}<p class="description">{description}</p>{/if}
    </div>
    {#if actions}
      <div class="actions">{@render actions()}</div>
    {/if}
  </header>

  <div class="body" class:two-column={columns === 2}>
    {@render children()}
  </div>
</section>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    box-shadow: inset 0 1px 0 var(--edge-highlight);
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .head.prominent {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  }

  .head.prominent .titles {
    grid-column: 2;
    align-items: center;
    text-align: center;
  }

  .head.prominent .title {
    font-size: var(--text-lg);
  }

  .head.prominent .actions {
    grid-column: 3;
    justify-self: end;
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .title {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }

  .description {
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-snug);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    flex: none;
  }

  .body {
    display: grid;
    gap: var(--space-4);
  }

  .two-column {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @container workspace (max-width: 560px) {
    .two-column {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
