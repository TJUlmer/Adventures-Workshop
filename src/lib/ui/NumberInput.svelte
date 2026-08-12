<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    /** Suffix shown inside the field, e.g. "HP". */
    unit?: string;
    /** Called after the value changes, for store-mediated updates. */
    onchange?: (value: number) => void;
  }

  let {
    value = $bindable(0),
    min = 0,
    max = 99,
    step = 1,
    disabled = false,
    unit,
    onchange
  }: Props = $props();

  function clamp(next: number): number {
    return Math.min(max, Math.max(min, next));
  }

  function commit(next: number): void {
    value = next;
    onchange?.(next);
  }

  function nudge(delta: number): void {
    commit(clamp(value + delta));
  }

  // Controlled rather than bound: an empty field yields NaN, which must not
  // reach the document model.
  function onInput(event: Event & { currentTarget: HTMLInputElement }): void {
    const next = event.currentTarget.valueAsNumber;
    if (Number.isNaN(next)) return;
    commit(clamp(next));
  }

  function onBlur(event: FocusEvent & { currentTarget: HTMLInputElement }): void {
    event.currentTarget.value = String(value);
  }
</script>

<div class="stepper" class:disabled>
  <button
    type="button"
    class="nudge"
    aria-label="Decrease"
    disabled={disabled || value <= min}
    onclick={() => nudge(-step)}
  >
    <Icon name="minus" size={13} />
  </button>

  <span class="value-wrap">
    <input
      class="value numeric"
      type="number"
      {min}
      {max}
      {step}
      {disabled}
      {value}
      oninput={onInput}
      onblur={onBlur}
    />
    {#if unit}<span class="unit">{unit}</span>{/if}
  </span>

  <button
    type="button"
    class="nudge"
    aria-label="Increase"
    disabled={disabled || value >= max}
    onclick={() => nudge(step)}
  >
    <Icon name="plus" size={13} />
  </button>
</div>

<style>
  .stepper {
    display: inline-flex;
    align-items: center;
    height: 32px;
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .stepper:hover:not(.disabled) {
    border-color: var(--border-strong);
  }

  .stepper:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .disabled {
    opacity: 0.45;
  }

  .nudge {
    display: grid;
    place-items: center;
    width: 26px;
    height: 100%;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    transition: color var(--duration-fast) var(--ease-out);
  }

  .nudge:hover:not(:disabled) {
    color: var(--text-primary);
  }

  .nudge:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .value-wrap {
    display: inline-flex;
    align-items: baseline;
    gap: 2px;
  }

  .value {
    width: 2.5ch;
    text-align: center;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    -moz-appearance: textfield;
    appearance: textfield;
  }

  .value::-webkit-outer-spin-button,
  .value::-webkit-inner-spin-button {
    appearance: none;
    margin: 0;
  }

  .value:focus {
    outline: none;
  }

  .unit {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
</style>
