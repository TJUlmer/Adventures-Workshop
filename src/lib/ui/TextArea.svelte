<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLTextareaAttributes, 'value'> {
    value: string;
    /** Italic serif treatment, for flavour text. */
    flavor?: boolean;
  }

  let { value = $bindable(''), flavor = false, rows = 4, ...rest }: Props = $props();
</script>

<textarea class="textarea" class:flavor {rows} {...rest} bind:value></textarea>

<style>
  .textarea {
    width: 100%;
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    color: var(--text-primary);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    transition:
      border-color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out);
  }

  .textarea::placeholder {
    color: var(--text-muted);
  }

  .textarea:hover {
    border-color: var(--border-strong);
  }

  .textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .flavor {
    font-family: var(--font-display);
    font-style: italic;
    color: var(--text-secondary);
  }
</style>
