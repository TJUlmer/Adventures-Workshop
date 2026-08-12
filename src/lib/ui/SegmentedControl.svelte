<script lang="ts" generics="TValue extends string">
  interface Segment {
    value: TValue;
    label: string;
    /** CSS custom property name supplying this segment's accent colour. */
    colorVar?: string;
    disabled?: boolean;
  }

  interface Props {
    value: TValue;
    segments: readonly Segment[];
    /** Accessible name for the group. */
    label: string;
    /**
     * Called after a segment is picked. Use instead of `bind:` when the choice
     * needs to go through a store command rather than a direct assignment.
     */
    onchange?: (value: TValue) => void;
  }

  let { value = $bindable(), segments, label, onchange }: Props = $props();

  function pick(next: TValue): void {
    value = next;
    onchange?.(next);
  }

  const activeColor = $derived(
    segments.find((segment) => segment.value === value)?.colorVar ?? '--accent'
  );
</script>

<div class="segmented" role="radiogroup" aria-label={label} style:--segment-accent="var({activeColor})">
  {#each segments as segment (segment.value)}
    <button
      type="button"
      role="radio"
      class="segment"
      class:selected={segment.value === value}
      aria-checked={segment.value === value}
      disabled={segment.disabled}
      onclick={() => pick(segment.value)}
    >
      {#if segment.colorVar}
        <span class="swatch" style:background="var({segment.colorVar})"></span>
      {/if}
      {segment.label}
    </button>
  {/each}
</div>

<style>
  .segmented {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-md);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
  }

  .segment {
    flex: 1 1 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-width: 0;
    height: 26px;
    padding-inline: var(--space-2);
    border-radius: var(--radius-xs);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-tertiary);
    white-space: nowrap;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .segment:hover:not(:disabled):not(.selected) {
    background: var(--surface-hover);
    color: var(--text-secondary);
  }

  .segment:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .selected {
    background: color-mix(in oklab, var(--segment-accent) 16%, var(--surface-overlay));
    color: var(--text-primary);
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, var(--segment-accent) 34%, transparent),
      var(--shadow-xs);
  }

  .swatch {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    flex: none;
  }
</style>
