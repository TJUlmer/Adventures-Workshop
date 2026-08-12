<script lang="ts">
  /**
   * A labelled range with a live readout. Double-click the readout to reset —
   * the fastest path back to a default when a slider has been dragged around.
   */
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
    onchange: (value: number) => void;
  }

  let { label, value, min, max, step = 1, neutral, format, onchange }: Props = $props();

  const display = $derived(format ? format(value) : String(value));
  const modified = $derived(neutral !== undefined && Math.abs(value - neutral) > 1e-6);
  const fraction = $derived((value - min) / (max - min || 1));
</script>

<div class="slider">
  <div class="head">
    <span class="label">{label}</span>
    <button
      type="button"
      class="readout numeric"
      class:modified
      title={neutral === undefined ? undefined : 'Reset'}
      onclick={() => neutral !== undefined && onchange(neutral)}
    >
      {display}
    </button>
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
