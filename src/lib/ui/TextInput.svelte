<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLInputAttributes, 'value' | 'type'> {
    value: string;
    /** Renders larger, for the primary name field of an entity. */
    prominent?: boolean;
  }

  let { value = $bindable(''), prominent = false, ...rest }: Props = $props();
</script>

<input class="input" class:prominent type="text" spellcheck="false" {...rest} bind:value />

<style>
  .input {
    width: 100%;
    height: 32px;
    padding-inline: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    color: var(--text-primary);
    font-size: var(--text-sm);
    transition:
      border-color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out);
  }

  .input::placeholder {
    color: var(--text-muted);
  }

  .input:hover {
    border-color: var(--border-strong);
  }

  .input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .prominent {
    height: 40px;
    font-family: var(--font-display);
    font-size: var(--text-lg);
    letter-spacing: var(--tracking-tight);
  }
</style>
