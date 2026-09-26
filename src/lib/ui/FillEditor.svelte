<script lang="ts">
  /**
   * Solid or gradient, in one control. The preview swatch is the control's
   * subject — the mode switch and second stop only appear once they matter.
   */
  import type { Fill } from '$lib/cards/style';
  import { fillCss } from '$lib/cards/style';
  import AngleDial from './AngleDial.svelte';
  import HexInput from './HexInput.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    label: string;
    value: Fill;
    /** Where the effective value comes from when nothing overrides it. */
    origin?: string;
    /** True when this layer sets the value rather than inheriting it. */
    overridden?: boolean;
    onchange: (fill: Fill) => void;
    /** Omitted when there is nothing to go back to (the stock theme). */
    onreset?: () => void;
    /**
     * What the reset button says it does.
     *
     * Two different things wear this control. In the style cascade a reset
     * drops this layer's override so the value comes from the layer above
     * again — "Inherit again", the default. Everywhere else (the character
     * card, a deck back, an initiative band) the value is stored outright and
     * inherits from nothing; a reset puts the printed template's own colour
     * back. Saying "Inherit again" there would name a mechanism that card
     * explicitly does not use — see `CharacterCardDesign`, which sits outside
     * the cascade on purpose.
     */
    resetTitle?: string;
  }

  let {
    label,
    value,
    origin,
    overridden = false,
    onchange,
    onreset,
    resetTitle = 'Inherit again'
  }: Props = $props();

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
        aria-pressed={isGradient}
        title={isGradient ? 'Switch to a solid colour' : 'Switch to a gradient'}
        onclick={() => patch({ kind: isGradient ? 'solid' : 'gradient' })}
      >
        {isGradient ? 'Gradient' : 'Solid'}
      </button>

      {#if overridden && onreset}
        <button type="button" class="reset" title={resetTitle} aria-label="{label}: {resetTitle}" onclick={onreset}>
          <Icon name="minus" size={12} />
        </button>
      {:else if origin}
        <span class="origin">from {origin}</span>
      {/if}
    </div>
  </div>

  <div class="body">
    <span class="preview" style:background={fillCss(value)}></span>

    <!--
      A `<div>`, not the `<label>` this used to be: the hex readout beside the
      swatch is a real input now, and a `<label>` may only ever have one
      labelable descendant — with two, a click resolves against the label
      rather than the box it landed on. The swatch carries its own `aria-label`
      already, so nothing is lost by dropping the wrapper.
    -->
    <div class="stop">
      <span class="chip" style:background={value.color}>
        <input
          type="color"
          value={value.color}
          aria-label="{label} colour"
          oninput={(event) => patch({ color: event.currentTarget.value })}
        />
        <span class="chip-face" aria-hidden="true"></span>
      </span>
      <HexInput
        value={value.color}
        label="{label} colour, hex"
        onchange={(color) => patch({ color })}
      />
    </div>

    {#if isGradient}
      <div class="stop">
        <span class="chip" style:background={value.color2}>
          <input
            type="color"
            value={value.color2}
            aria-label="{label} second colour"
            oninput={(event) => patch({ color2: event.currentTarget.value })}
          />
          <span class="chip-face" aria-hidden="true"></span>
        </span>
        <HexInput
          value={value.color2}
          label="{label} second colour, hex"
          onchange={(color2) => patch({ color2 })}
        />
      </div>

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
    min-width: 0;
    gap: var(--space-2);
  }

  .label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .head-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-width: 0;
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

  .mode:active {
    color: var(--text-primary);
    border-color: var(--border-strong);
    background: var(--surface-active);
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

  .reset:active {
    background: var(--surface-active);
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
    min-width: 0;
  }

  .chip {
    position: relative;
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    flex: none;
  }

  .chip input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  .chip-face {
    width: 16px;
    height: 16px;
    border-radius: var(--radius-xs);
    background: inherit;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.2);
    pointer-events: none;
    transition:
      box-shadow var(--duration-fast) var(--ease-out),
      transform var(--duration-instant) var(--ease-out);
  }

  .chip:focus-within .chip-face {
    box-shadow:
      inset 0 0 0 1px rgb(255 255 255 / 0.2),
      0 0 0 3px var(--accent-soft);
  }

  .chip:active .chip-face {
    transform: scale(0.94);
  }

  /*
   * `HexInput`'s defaults are this row's sizing already — 7ch, so the row does
   * not reflow between `#fff` and `#ffffff` while it is being typed in — so
   * there is nothing to set here. Kept as a note rather than an empty rule:
   * the box is styled through `--hex-*`, see `HexInput`.
   */

  /* The dial closes the row, so it takes the slack rather than the stops. */
  .body :global(.angle) {
    margin-left: auto;
  }

  @media (any-pointer: coarse) {
    .mode,
    .reset,
    .chip {
      min-width: var(--touch-target);
      min-height: var(--touch-target);
    }

    .body {
      height: auto;
      min-height: calc(var(--touch-target) + 2px);
      padding-block: var(--space-1);
      flex-wrap: wrap;
    }
  }

  @media (max-width: 760px) {
    .head,
    .head-actions,
    .body {
      flex-wrap: wrap;
    }

    .body {
      height: auto;
      padding-block: var(--space-1);
    }

    .stop {
      flex: 1 1 8rem;
    }

    .body :global(.angle) {
      margin-left: 0;
    }
  }
</style>
