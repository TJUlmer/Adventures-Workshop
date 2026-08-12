<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    /** Short helper line under the control. */
    hint?: string;
    /** Right-aligned note in the label row — units, counts, shortcuts. */
    note?: string;
    /** Lay the label and control out side by side instead of stacked. */
    inline?: boolean;
    children: Snippet;
  }

  let { label, hint, note, inline = false, children }: Props = $props();
</script>

<!-- Wrapping the control keeps the label associated without id plumbing. -->
<label class="field" class:inline>
  <span class="row">
    <span class="label">{label}</span>
    {#if note}<span class="note numeric">{note}</span>{/if}
  </span>
  <span class="control">{@render children()}</span>
  {#if hint}<span class="hint">{hint}</span>{/if}
</label>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .label {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .note {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .control {
    display: block;
    min-width: 0;
  }

  .hint {
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    color: var(--text-muted);
  }

  .inline {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--space-3);
  }

  .inline .control {
    justify-self: end;
  }

  .inline .hint {
    grid-column: 1 / -1;
  }
</style>
