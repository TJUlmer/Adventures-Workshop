<script lang="ts">
  /**
   * A labelled range with a live readout. Its readout or reset button returns
   * a modified value to its neutral default.
   */
  import Icon from './Icon.svelte';

  interface Props {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    /** Value considered "unmodified". Shown dimmed and used by reset. */
    neutral?: number;
    /** Formats the readout. Defaults to the raw number. */
    format?: (value: number) => string;
    /** Replace the readout with a typeable stepper for precision work. */
    editable?: boolean;
    /** Convert the stored value for entry, such as a 0–1 fraction to 0–100. */
    inputMultiplier?: number;
    /** Suffix shown beside an editable value. */
    inputUnit?: string;
    onchange: (value: number) => void;
  }

  let {
    label,
    value,
    min,
    max,
    step = 1,
    neutral,
    format,
    editable = false,
    inputMultiplier = 1,
    inputUnit,
    onchange
  }: Props = $props();

  const display = $derived(format ? format(value) : String(value));
  const modified = $derived(neutral !== undefined && Math.abs(value - neutral) > 1e-6);
  const fraction = $derived((value - min) / (max - min || 1));
  const entryValue = $derived(Math.round(value * inputMultiplier * 1000) / 1000);
  const entryMin = $derived(min * inputMultiplier);
  const entryMax = $derived(max * inputMultiplier);
  const entryStep = $derived(step * inputMultiplier);

  function clamp(next: number): number {
    return Math.min(max, Math.max(min, next));
  }

  function nudge(direction: -1 | 1): void {
    const next = Math.round((value + direction * step) * 1_000_000) / 1_000_000;
    onchange(clamp(next));
  }

  function enter(event: Event & { currentTarget: HTMLInputElement }): void {
    const next = event.currentTarget.valueAsNumber;
    if (Number.isNaN(next)) return;
    onchange(clamp(next / inputMultiplier));
  }

  function restoreEntry(event: FocusEvent & { currentTarget: HTMLInputElement }): void {
    event.currentTarget.value = String(entryValue);
  }
</script>

<div class="slider">
  <div class="head">
    <span class="label">{label}</span>
    {#if editable}
      <span class="precision" class:modified>
        <button
          type="button"
          class="nudge"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onclick={() => nudge(-1)}
        >−</button>
        <span class="entry-wrap">
          <input
            class="entry numeric"
            aria-label={`${label} value`}
            type="number"
            min={entryMin}
            max={entryMax}
            step={entryStep}
            value={entryValue}
            oninput={enter}
            onblur={restoreEntry}
          />
          {#if inputUnit}<span class="unit">{inputUnit}</span>{/if}
        </span>
        <button
          type="button"
          class="nudge"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onclick={() => nudge(1)}
        >+</button>
        {#if neutral !== undefined}
          <button
            type="button"
            class="nudge reset"
            aria-label={`Reset ${label} to default`}
            title="Return to default"
            disabled={!modified}
            onclick={() => onchange(neutral)}
          >
            <Icon name="rotate" size={12} />
          </button>
        {/if}
      </span>
    {:else}
      <button
        type="button"
        class="readout numeric"
        class:modified
        title={neutral === undefined ? undefined : 'Reset'}
        onclick={() => neutral !== undefined && onchange(neutral)}
      >
        {display}
      </button>
    {/if}
  </div>

  <input
    class="range"
    type="range"
    {min}
    {max}
    {step}
    {value}
    aria-label={label}
    style:--fill="{(fraction * 100).toFixed(2)}%"
    oninput={(event) => onchange(event.currentTarget.valueAsNumber)}
  />
</div>

<style>
  .slider {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .readout {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    padding-inline: 3px;
    border-radius: var(--radius-xs);
    transition: color var(--duration-fast) var(--ease-out);
  }

  .readout:hover {
    color: var(--text-secondary);
    background: var(--surface-hover);
  }

  .readout.modified {
    color: var(--text-accent);
  }

  .precision {
    display: inline-flex;
    align-items: center;
    height: 26px;
    overflow: hidden;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    color: var(--text-muted);
  }

  .precision:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .precision.modified {
    color: var(--text-accent);
  }

  .nudge {
    display: grid;
    width: 24px;
    height: 100%;
    place-items: center;
    color: inherit;
    font-size: var(--text-sm);
  }

  .nudge:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .nudge:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .entry-wrap {
    display: inline-flex;
    align-items: baseline;
    gap: 2px;
  }

  .entry {
    width: 5ch;
    color: var(--text-primary);
    font-size: var(--text-xs);
    text-align: right;
    appearance: textfield;
    -moz-appearance: textfield;
  }

  .entry::-webkit-outer-spin-button,
  .entry::-webkit-inner-spin-button {
    margin: 0;
    appearance: none;
  }

  .entry:focus {
    outline: none;
  }

  .unit {
    padding-right: 3px;
    color: var(--text-muted);
    font-size: var(--text-2xs);
  }

  .range {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 18px;
    background: transparent;
    cursor: pointer;
  }

  .range::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: var(--radius-full);
    background: linear-gradient(
      90deg,
      var(--accent) 0 var(--fill),
      var(--grey-750) var(--fill) 100%
    );
  }

  .range::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    margin-top: -4.5px;
    border-radius: 50%;
    background: var(--grey-100);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.5);
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .range:hover::-webkit-slider-thumb {
    transform: scale(1.15);
  }

  .range::-moz-range-track {
    height: 3px;
    border-radius: var(--radius-full);
    background: var(--grey-750);
  }

  .range::-moz-range-progress {
    height: 3px;
    border-radius: var(--radius-full);
    background: var(--accent);
  }

  .range::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border: none;
    border-radius: 50%;
    background: var(--grey-100);
  }
</style>
