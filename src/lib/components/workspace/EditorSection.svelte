<script lang="ts">
  /**
   * A group of related controls.
   *
   * Deliberately lighter than a boxed panel: a small caps label, a hairline,
   * and the controls themselves. Nesting boxes inside boxes is what makes an
   * editor feel busy, so the hierarchy here comes from type and spacing.
   */
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    /** One short line under the title. Omit unless it earns its place. */
    hint?: string;
    /** Controls aligned right of the title. */
    actions?: Snippet;
    /** Grid columns for the body. */
    columns?: 1 | 2 | 3;
    children: Snippet;
  }

  let { title, hint, actions, columns = 1, children }: Props = $props();
</script>

<section class="group">
  <header class="head">
    <h2 class="title">{title}</h2>
    <span class="line"></span>
    {#if actions}
      <div class="actions">{@render actions()}</div>
    {/if}
  </header>

  {#if hint}<p class="hint">{hint}</p>{/if}

  <div class="body" data-columns={columns}>
    {@render children()}
  </div>
</section>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .title {
    flex: none;
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  .line {
    flex: 1 1 auto;
    height: 1px;
    background: var(--border-subtle);
  }

  .actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .hint {
    margin-top: calc(var(--space-2) * -1);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .body {
    display: grid;
    gap: var(--space-4);
  }

  .body[data-columns='2'] {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .body[data-columns='3'] {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  @container workspace (max-width: 620px) {
    .body[data-columns='2'],
    .body[data-columns='3'] {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
