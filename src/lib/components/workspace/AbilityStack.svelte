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
  import {
    ABILITY_TIMING_LABELS,
    ABILITY_TIMINGS,
    createBonusAbility,
    MAX_BONUS_ABILITIES
  } from '$lib/cards/types';
  import type { AbilityBlocks, BonusAbility } from '$lib/cards/types';
  import type { CustomSymbol } from '$lib/symbols/types';
  import { customSymbolLabel } from '$lib/symbols/types';
  import { customSymbolToken, symbolToken } from '$lib/text/tokens';
  import { ColorInput, Slider, Switch } from '$lib/ui';
  import AbilityField from './AbilityField.svelte';
  import EditorSection from './EditorSection.svelte';

  interface Props {
    title: string;
    /** Symbol shown beside the title, so each side of a split is identifiable. */
    symbol?: string;
    hint?: string;
    ability: AbilityBlocks;
    onchange: (patch: Partial<AbilityBlocks>) => void;
    /** Theme values are inherited until one Bonus ability overrides them. */
    resolved: CardTheme;
    originFor: (key: keyof CardTheme) => string;
    /** Author-uploaded glyphs, offered in every block's symbol palette. */
    customSymbols?: CustomSymbol[];
  }

  let {
    title,
    symbol,
    hint,
    ability,
    onchange,
    resolved,
    originFor,
    customSymbols = []
  }: Props = $props();

  const SYMBOL_NAMES = Object.keys(CARD_SYMBOLS) as CardSymbolName[];

  function updateBonus(index: number, patch: Partial<BonusAbility>): void {
    onchange({
      bonusAbilities: ability.bonusAbilities.map((bonus, at) =>
        at === index ? { ...bonus, ...patch } : bonus
      )
    });
  }

  function addBonus(): void {
    if (ability.bonusAbilities.length >= MAX_BONUS_ABILITIES) return;
    onchange({ bonusAbilities: [...ability.bonusAbilities, createBonusAbility()] });
  }

  function removeBonus(index: number): void {
    if (index === 0) return;
    onchange({ bonusAbilities: ability.bonusAbilities.filter((_, at) => at !== index) });
  }
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
          formatted
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
      formatted
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
        formatted
        placeholder="What happens {ABILITY_TIMING_LABELS[timing].toLowerCase()}…"
        onchange={(value) => onchange({ [timing]: value })}
        {customSymbols}
      />
    {/each}
  </div>

  <div class="bonus-abilities">
    {#each ability.bonusAbilities as bonus, index}
      <section class="bonus-ability">
        <div class="bonus-heading">
          <span class="bonus-title">
            {index === 0 ? 'Bonus ability' : `Bonus ability ${index + 1}`}
          </span>
          {#if index > 0}
            <button
              type="button"
              class="remove-bonus"
              aria-label="Remove Bonus ability {index + 1}"
              onclick={() => removeBonus(index)}
            >
              Remove
            </button>
          {/if}
        </div>

        <Switch
          label="Divider above"
          hint="Draw a line in this Bonus ability's colour."
          checked={bonus.showDivider}
          onchange={(showDivider) => updateBonus(index, { showDivider })}
        />

        <AbilityField
          label="Bonus ability text"
          value={bonus.text}
          rows={2}
          formatted
          placeholder="An extra ability, printed below After Combat…"
          onchange={(text) => updateBonus(index, { text })}
          {customSymbols}
        />

        <!-- A block decoration rather than an insert-at-caret symbol. -->
        <div
          class="bonus-icon-picker"
          role="group"
          aria-label="Bonus ability {index + 1} icon"
        >
          <span class="bonus-icon-label">Bonus icon</span>
          <button
            type="button"
            class="icon-choice"
            class:active={!bonus.icon}
            onclick={() => updateBonus(index, { icon: '' })}
          >
            None
          </button>
          {#each SYMBOL_NAMES as name (name)}
            <button
              type="button"
              class="icon-choice"
              class:active={bonus.icon === symbolToken(name)}
              onclick={() => updateBonus(index, { icon: symbolToken(name) })}
            >
              <img src={CARD_SYMBOLS[name]} alt="" />
              {CARD_SYMBOL_LABELS[name]}
            </button>
          {/each}
          {#each customSymbols.filter((symbol) => symbol.source) as symbol (symbol.id)}
            <button
              type="button"
              class="icon-choice"
              class:active={bonus.icon === customSymbolToken(symbol.id)}
              onclick={() => updateBonus(index, { icon: customSymbolToken(symbol.id) })}
            >
              <img src={symbol.source} alt="" />
              {customSymbolLabel(symbol)}
            </button>
          {/each}
        </div>

        <div class="text-style">
          <label class="ink">
            <span class="ink-label">Bonus ability colour</span>
            <ColorInput
              value={bonus.ink ?? undefined}
              inherited={resolved.bonusAbilityInk}
              origin={originFor('bonusAbilityInk')}
              onchange={(ink) => updateBonus(index, { ink: ink ?? null })}
            />
          </label>

          <Slider
            label="Ability text size"
            value={bonus.textSize ?? resolved.abilityFontSize}
            min={50}
            max={130}
            step={1}
            neutral={resolved.abilityFontSize}
            format={(value) => `${Math.round(value)}`}
            onchange={(textSize) => updateBonus(index, { textSize })}
          />

          <Slider
            label="Bonus icon size"
            value={bonus.iconSize ?? resolved.bonusIconSize}
            min={1}
            max={4}
            step={0.1}
            neutral={resolved.bonusIconSize}
            format={(value) => value.toFixed(1)}
            onchange={(iconSize) => updateBonus(index, { iconSize })}
          />
        </div>
      </section>
    {/each}

    {#if ability.bonusAbilities.length < MAX_BONUS_ABILITIES}
      <button type="button" class="add-bonus" onclick={addBonus}>+ Bonus Ability</button>
    {/if}
  </div>
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

  .bonus-abilities {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .bonus-ability {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
  }

  .bonus-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .bonus-title {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--text-secondary);
  }

  .remove-bonus,
  .add-bonus {
    width: fit-content;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .remove-bonus:hover,
  .add-bonus:hover {
    color: var(--text-primary);
  }

  .add-bonus {
    padding: var(--space-1) 0;
    color: var(--text-accent);
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
