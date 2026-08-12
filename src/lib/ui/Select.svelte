<script lang="ts" generics="TValue extends string">
  import Icon from './Icon.svelte';

  interface Option {
    value: TValue;
    label: string;
  }

  interface Props {
    value: TValue;
    options: readonly Option[];
    disabled?: boolean;
    placeholder?: string;
    /** Called after the selection changes, for store-mediated updates. */
    onchange?: (value: TValue) => void;
  }

  let {
    value = $bindable(),
    options,
    disabled = false,
    placeholder,
    onchange
  }: Props = $props();
</script>

<div class="select-wrap" class:disabled>
  <select class="select" {disabled} bind:value onchange={() => onchange?.(value)}>
    {#if placeholder}
      <option value="" disabled>{placeholder}</option>
    {/if}
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
  <span class="chevron"><Icon name="chevronDown" size={13} /></span>
</div>

<style>
  .select-wrap {
    position: relative;
    display: block;
    width: 100%;
  }

  .select {
    width: 100%;
    height: 32px;
    padding-inline: var(--space-3) var(--space-7);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    color: var(--text-primary);
    font-size: var(--text-sm);
    appearance: none;
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .select:hover:not(:disabled) {
    border-color: var(--border-strong);
  }

  .select:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  /* Native popup lists inherit the OS surface, not ours. */
  .select option {
    background: var(--surface-overlay);
    color: var(--text-primary);
  }

  .chevron {
    position: absolute;
    top: 50%;
    right: var(--space-3);
    translate: 0 -50%;
    color: var(--text-muted);
    pointer-events: none;
  }

  .disabled {
    opacity: 0.45;
  }
</style>
