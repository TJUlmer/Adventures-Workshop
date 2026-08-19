<script lang="ts">
  /**
   * One ability: the untimed paragraph, then the three timed blocks abreast.
   *
   * All three are always on screen. They used to be added from chips so the
   * editor stayed as short as the card, but a fixed row is quicker to fill and
   * quicker to read — and an empty block still prints nothing, so the card is
   * unaffected either way.
   */
  import { CARD_SYMBOLS, CARD_SYMBOL_LABELS } from '$lib/renderer/assets';
  import type { CardSymbolName } from '$lib/renderer/assets';
  import type { CardTheme } from '$lib/cards/style';
  import { ABILITY_TIMING_LABELS, ABILITY_TIMINGS } from '$lib/cards/types';
  import type { AbilityBlocks } from '$lib/cards/types';
  import type { StyleTarget } from '$lib/state/workshop.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import type { CustomSymbol } from '$lib/symbols/types';
  import { customSymbolLabel } from '$lib/symbols/types';
  import { customSymbolToken, symbolToken } from '$lib/text/tokens';
  import { ColorInput, Slider } from '$lib/ui';
  import AbilityField from './AbilityField.svelte';
  import EditorSection from './EditorSection.svelte';

  interface Props {
    title: string;
    /** Symbol shown beside the title, so each side of a split is identifiable. */
    symbol?: string;
    hint?: string;
    ability: AbilityBlocks;
    onchange: (patch: Partial<AbilityBlocks>) => void;
    /** For the Bonus ability colour and the ability text size, below. */
    target: StyleTarget;
    resolved: CardTheme;
    originFor: (key: keyof CardTheme) => string;
    /**
     * A split card's two stacks share one size and one Bonus ability colour
     * — both are printed the same whichever side they are on — so showing
     * the controls twice would just be the same value in two places. Off on
     * every stack but the first.
     */
    textStyle?: boolean;
    /** Author-uploaded glyphs, offered in every block's symbol palette. */
    customSymbols?: CustomSymbol[];
  }

  let {
    title,
    symbol,
    hint,
    ability,
    onchange,
    target,
    resolved,
    originFor,
    textStyle = true,
    customSymbols = []
  }: Props = $props();

  const layer = $derived(workshop.styleFor(target) ?? {});

  const SYMBOL_NAMES = Object.keys(CARD_SYMBOLS) as CardSymbolName[];
</script>

<EditorSection {title} {hint}>
  {#if symbol}
    <div class="plain">
      <img class="side-symbol" src={symbol} alt="" />
      <div class="plain-field">
        <AbilityField
          label="Ability text"
          value={ability.plain}
          rows={3}
          placeholder="Plain ability text, printed with no label…"
          onchange={(value) => onchange({ plain: value })}
          {customSymbols}
        />
      </div>
    </div>
  {:else}
    <!--
      No side symbol, no icon column to reserve — a two-column grid here
      would leave a gap held open for nothing, which is what left this a
      few pixels narrower than Bonus ability below it. Full width, same as
      every other block on this face.
    -->
    <AbilityField
      label="Ability text"
      value={ability.plain}
      rows={3}
      placeholder="Plain ability text, printed with no label…"
      onchange={(value) => onchange({ plain: value })}
      {customSymbols}
    />
  {/if}

  <div class="timings">
    {#each ABILITY_TIMINGS as timing (timing)}
      <AbilityField
        label={ABILITY_TIMING_LABELS[timing]}
        value={ability[timing]}
        rows={2}
        placeholder="What happens {ABILITY_TIMING_LABELS[timing].toLowerCase()}…"
        onchange={(value) => onchange({ [timing]: value })}
        {customSymbols}
      />
    {/each}
  </div>

  <!-- Printed last, below After Combat, with no label — see `AbilityBlocks.bonusAbility`. -->
  <AbilityField
    label="Bonus ability"
    value={ability.bonusAbility}
    rows={2}
    placeholder="An extra ability, printed below After Combat…"
    onchange={(value) => onchange({ bonusAbility: value })}
    {customSymbols}
  />

  <!--
    A larger icon printed beside the Bonus ability paragraph, in its own
    column rather than inline with the text — a select-one control, unlike
    the insert-at-caret palette on the field above. Per side, not gated by
    `textStyle`, since it travels with this side's own Bonus ability text.
  -->
  <div class="bonus-icon-picker" role="group" aria-label="Bonus ability icon">
    <span class="bonus-icon-label">Bonus icon</span>
    <button
      type="button"
      class="icon-choice"
      class:active={!ability.bonusIcon}
      onclick={() => onchange({ bonusIcon: '' })}
    >
      None
    </button>
    {#each SYMBOL_NAMES as name (name)}
      <button
        type="button"
        class="icon-choice"
        class:active={ability.bonusIcon === symbolToken(name)}
        onclick={() => onchange({ bonusIcon: symbolToken(name) })}
      >
        <img src={CARD_SYMBOLS[name]} alt="" />
        {CARD_SYMBOL_LABELS[name]}
      </button>
    {/each}
    {#each customSymbols.filter((s) => s.source) as symbol (symbol.id)}
      <button
        type="button"
        class="icon-choice"
        class:active={ability.bonusIcon === customSymbolToken(symbol.id)}
        onclick={() => onchange({ bonusIcon: customSymbolToken(symbol.id) })}
      >
        <img src={symbol.source} alt="" />
        {customSymbolLabel(symbol)}
      </button>
    {/each}
  </div>

  {#if textStyle}
    <div class="text-style">
      <label class="ink">
        <span class="ink-label">Bonus ability colour</span>
        <ColorInput
          value={layer.bonusAbilityInk}
          inherited={resolved.bonusAbilityInk}
          origin={originFor('bonusAbilityInk')}
          onchange={(value) => workshop.setStyle(target, 'bonusAbilityInk', value)}
        />
      </label>

      <Slider
        label="Ability text size"
        value={resolved.abilityFontSize}
        min={50}
        max={130}
        step={1}
        neutral={90}
        format={(value) => `${Math.round(value)}`}
        onchange={(abilityFontSize) => workshop.setStyle(target, 'abilityFontSize', abilityFontSize)}
      />

      <!-- The icon's size, not its choice — see `AbilityBlocks.bonusIcon` for that. -->
      <Slider
        label="Bonus icon size"
        value={resolved.bonusIconSize}
        min={1}
        max={4}
        step={0.1}
        neutral={2.1}
        format={(value) => value.toFixed(1)}
        onchange={(bonusIconSize) => workshop.setStyle(target, 'bonusIconSize', bonusIconSize)}
      />
    </div>
  {/if}
</EditorSection>

<style>
  .plain {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: var(--space-3);
  }

  .plain-field {
    grid-column: 2;
    min-width: 0;
  }

  .side-symbol {
    grid-column: 1;
    width: 22px;
    height: 22px;
    margin-top: var(--space-1);
    object-fit: contain;
  }

  /* The three timings read as one row of the card's timeline, in printed order. */
  .timings {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }

  @container workspace (max-width: 620px) {
    .timings {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .bonus-icon-picker {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .bonus-icon-label {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .icon-choice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 28px;
    padding-inline: var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
    font-size: var(--text-xs);
    color: var(--text-muted);
    transition:
      color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out);
  }

  .icon-choice:hover {
    color: var(--text-secondary);
    border-color: var(--border-strong);
  }

  .icon-choice.active {
    color: var(--text-primary);
    border-color: var(--border-accent);
    background: var(--accent-soft);
  }

  .icon-choice img {
    width: 14px;
    height: 14px;
    object-fit: contain;
  }

  .text-style {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
    padding-top: var(--space-1);
  }

  .ink {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .ink-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  @container workspace (max-width: 620px) {
    .text-style {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
