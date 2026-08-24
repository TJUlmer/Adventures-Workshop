<script lang="ts">
  import HexInput from './HexInput.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    /** The override, or `undefined` when the value is inherited. */
    value: string | undefined;
    /** The colour actually in effect right now, shown while inheriting. */
    inherited: string;
    /** Where the effective value comes from, e.g. "set" or "card kind". */
    origin?: string;
    /** `undefined` means "clear the override and inherit again". */
    onchange: (value: string | undefined) => void;
  }

  let { value, inherited, origin, onchange }: Props = $props();

  const isOverridden = $derived(value !== undefined);
  const shown = $derived(value ?? inherited);
</script>

<div class="color-input" class:overridden={isOverridden}>
  <label class="swatch" style:--swatch={shown}>
    <input
      type="color"
      value={shown}
      oninput={(event) => onchange(event.currentTarget.value)}
    />
    <span class="sr-only">Choose colour</span>
  </label>

  <!--
    Typing a hex here *sets an override*, exactly as picking one does — the box
    reads the inherited colour while inheriting, so committing whatever it
    already shows is a no-op and cannot accidentally pin a value.
  -->
  <span class="readout">
    <HexInput value={shown} label="Hex colour" {onchange} />
  </span>

  {#if isOverridden}
    <button type="button" class="reset" title="Inherit again" onclick={() => onchange(undefined)}>
      <Icon name="minus" size={12} />
    </button>
  {:else if origin}
    <span class="origin">from {origin}</span>
  {/if}
</div>

<style>
  .color-input {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 32px;
    padding-inline: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .color-input:hover {
    border-color: var(--border-strong);
  }

  .color-input:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .swatch {
    position: relative;
    width: 20px;
    height: 20px;
    flex: none;
    border-radius: var(--radius-xs);
    background: var(--swatch);
    box-shadow: inset 0 0 0 1px hsl(0 0% 100% / 0.18);
    cursor: pointer;
    overflow: hidden;
  }

  /* The native picker is the real control; the swatch is its face. */
  .swatch input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  /*
   * A typable `HexInput` now rather than a static readout. This wrapper only
   * carries the sizing the row wants — the box itself is styled through
   * `--hex-*`, so it fills the row here where it is 7ch wide in `FillEditor`.
   */
  .readout {
    flex: 1 1 auto;
    min-width: 0;
    display: block;
    --hex-width: 100%;
    --hex-size: var(--text-xs);
    --hex-color: var(--text-tertiary);
  }

  .overridden .readout {
    --hex-color: var(--text-primary);
  }

  .origin {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .reset {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex: none;
    border-radius: var(--radius-xs);
    color: var(--text-muted);
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .reset:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
</style>
