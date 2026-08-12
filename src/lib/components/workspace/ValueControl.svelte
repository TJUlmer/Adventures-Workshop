<script lang="ts">
  /**
   * One combat value: the printed symbol, the number, and whether the card
   * carries it at all.
   *
   * `null` means "not on this card", so the symbol itself is the on/off switch —
   * one click to add a defense value, one click to take it away, no separate
   * checkbox. Scroll or arrow keys change the number without leaving the mouse.
   */
  interface Props {
    label: string;
    /** `null` when the card does not print this value. */
    value: number | null;
    /** Symbol image, or a drawn ring for boost. */
    symbol?: string;
    min?: number;
    max?: number;
    /** Value used the first time the control is switched on. */
    defaultValue?: number;
    onchange: (value: number | null) => void;
  }

  let {
    label,
    value,
    symbol,
    min = 0,
    max = 20,
    defaultValue = 1,
    onchange
  }: Props = $props();

  const on = $derived(value !== null);

  /**
   * The number this value last carried, so taking it off the card and putting
   * it back restores what the author chose rather than the template's default.
   *
   * `null` on the card means "not printed" — the right model for the document,
   * but it leaves nowhere to keep the old number, so the control holds it.
   * `null` here means nothing to restore yet, which is what `defaultValue` is
   * for. The editor re-creates these per card, so one card's value cannot
   * surface on another.
   */
  let remembered = $state<number | null>(null);

  $effect(() => {
    if (value !== null) remembered = value;
  });

  function clamp(next: number): number {
    return Math.min(max, Math.max(min, next));
  }

  function toggle(): void {
    onchange(on ? null : clamp(remembered ?? defaultValue));
  }

  function nudge(delta: number): void {
    if (value === null) return;
    onchange(clamp(value + delta));
  }

  function onWheel(event: WheelEvent): void {
    if (!on) return;
    event.preventDefault();
    nudge(event.deltaY < 0 ? 1 : -1);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      nudge(1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      nudge(-1);
    }
  }
</script>

<div class="value" class:on>
  <!--
    The whole tile is the switch, not just the label: the stepper sits on top
    of it and stops the click, so anywhere else in the control toggles.
  -->
  <button
    type="button"
    class="toggle"
    aria-pressed={on}
    title={on ? `Remove ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}
    onclick={toggle}
  >
    {#if symbol}
      <img class="symbol" src={symbol} alt="" />
    {:else}
      <span class="ring"></span>
    {/if}
    <span class="name">{label}</span>
  </button>

  {#if on && value !== null}
    <div class="stepper">
      <button type="button" class="step" aria-label="Decrease {label}" onclick={() => nudge(-1)}>
        −
      </button>
      <input
        class="number numeric"
        type="number"
        {min}
        {max}
        {value}
        aria-label={label}
        onwheel={onWheel}
        onkeydown={onKey}
        oninput={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (!Number.isNaN(next)) onchange(clamp(next));
        }}
      />
      <button type="button" class="step" aria-label="Increase {label}" onclick={() => nudge(1)}>
        +
      </button>
    </div>
  {:else}
    <span class="off">Not printed</span>
  {/if}
</div>

<style>
  .value {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    height: 44px;
    padding: 0 var(--space-2) 0 var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    transition:
      border-color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out);
  }

  .value.on {
    background: var(--surface-raised);
    border-color: var(--border-default);
  }

  /* Stretched across the tile so the whole surface is the hit area. */
  .toggle {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-left: var(--space-3);
    min-width: 0;
    color: var(--text-muted);
    transition: color var(--duration-fast) var(--ease-out);
  }

  .on .toggle {
    color: var(--text-secondary);
  }

  .toggle:hover {
    color: var(--text-primary);
  }

  .symbol {
    width: 20px;
    height: 20px;
    flex: none;
    object-fit: contain;
    filter: grayscale(1) opacity(0.45);
    transition: filter var(--duration-fast) var(--ease-out);
  }

  .on .symbol {
    filter: none;
  }

  .ring {
    width: 18px;
    height: 18px;
    flex: none;
    border-radius: 50%;
    border: 2px solid currentColor;
    opacity: 0.55;
  }

  .on .ring {
    opacity: 1;
    border-color: var(--brand-gold);
  }

  .name {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    white-space: nowrap;
  }

  .off {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    padding-right: var(--space-2);
  }

  .stepper {
    position: relative;
    display: flex;
    align-items: center;
    gap: 1px;
    background: inherit;
    border-radius: var(--radius-sm);
  }

  .off {
    position: relative;
  }

  .step {
    display: grid;
    place-items: center;
    width: 22px;
    height: 26px;
    border-radius: var(--radius-xs);
    color: var(--text-muted);
    font-size: var(--text-md);
    line-height: 1;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .step:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .number {
    width: 2.6ch;
    height: 26px;
    text-align: center;
    font-family: var(--font-display);
    font-size: var(--text-lg);
    color: var(--text-primary);
    appearance: textfield;
    -moz-appearance: textfield;
  }

  .number::-webkit-outer-spin-button,
  .number::-webkit-inner-spin-button {
    appearance: none;
    margin: 0;
  }

  .number:focus {
    outline: none;
  }
</style>
