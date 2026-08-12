<script lang="ts">
  /**
   * Solid or gradient, in one control. The preview swatch is the control's
   * subject — the mode switch and second stop only appear once they matter.
   */
  import type { Fill } from '$lib/cards/style';
  import { fillCss } from '$lib/cards/style';
  import AngleDial from './AngleDial.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    label: string;
    value: Fill;
    /** Where the effective value comes from when nothing overrides it. */
    origin?: string;
    /** True when this layer sets the value rather than inheriting it. */
    overridden?: boolean;
    onchange: (fill: Fill) => void;
    /** Omitted when the layer cannot inherit (the stock theme). */
    onreset?: () => void;
  }

  let { label, value, origin, overridden = false, onchange, onreset }: Props = $props();

  const isGradient = $derived(value.kind === 'gradient');

  function patch(next: Partial<Fill>): void {
    onchange({ ...value, ...next });
  }
</script>

<div class="fill" class:overridden>
  <div class="head">
    <span class="label">{label}</span>

    <div class="head-actions">
      <button
        type="button"
        class="mode"
        class:on={isGradient}
        title={isGradient ? 'Switch to a solid colour' : 'Switch to a gradient'}
        onclick={() => patch({ kind: isGradient ? 'solid' : 'gradient' })}
      >
        {isGradient ? 'Gradient' : 'Solid'}
      </button>

      {#if overridden && onreset}
        <button type="button" class="reset" title="Inherit again" onclick={onreset}>
          <Icon name="minus" size={12} />
        </button>
      {:else if origin}
        <span class="origin">from {origin}</span>
      {/if}
    </div>
  </div>

  <div class="body">
    <span class="preview" style:background={fillCss(value)}></span>

    <label class="stop">
      <span class="chip" style:background={value.color}>
        <input
          type="color"
          value={value.color}
          aria-label="{label} colour"
          oninput={(event) => patch({ color: event.currentTarget.value })}
        />
      </span>
      <span class="hex numeric">{value.color}</span>
    </label>

    {#if isGradient}
      <label class="stop">
        <span class="chip" style:background={value.color2}>
          <input
            type="color"
            value={value.color2}
            aria-label="{label} second colour"
            oninput={(event) => patch({ color2: event.currentTarget.value })}
          />
        </span>
        <span class="hex numeric">{value.color2}</span>
      </label>

      <AngleDial
        value={value.angle}
        label="{label} gradient angle"
        onchange={(angle) => patch({ angle })}
      />
    {/if}
  </div>
</div>

<style>
  .fill {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .mode {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    padding: 1px var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid var(--border-subtle);
    transition:
      color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out);
  }

  .mode:hover {
    color: var(--text-secondary);
    border-color: var(--border-strong);
  }

  .mode.on {
    color: var(--text-accent);
    border-color: var(--border-accent);
  }

  .origin {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .reset {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-xs);
    color: var(--text-muted);
  }

  .reset:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .body {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 30px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
  }

  .overridden .body {
    border-color: color-mix(in oklab, var(--accent) 40%, var(--border-default));
  }

  .preview {
    width: 26px;
    height: 18px;
    flex: none;
    border-radius: var(--radius-xs);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.16);
  }

  .stop {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    cursor: pointer;
    min-width: 0;
  }

  .chip {
    position: relative;
    width: 16px;
    height: 16px;
    flex: none;
    border-radius: var(--radius-xs);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.2);
    overflow: hidden;
  }

  .chip input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  .hex {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    text-transform: uppercase;
  }

  /* The dial closes the row, so it takes the slack rather than the stops. */
  .body :global(.angle) {
    margin-left: auto;
  }
</style>
