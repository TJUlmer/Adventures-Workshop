<script lang="ts">
  /**
   * One ability: the untimed paragraph, then the three timed blocks abreast.
   *
   * All three are always on screen. They used to be added from chips so the
   * editor stayed as short as the card, but a fixed row is quicker to fill and
   * quicker to read — and an empty block still prints nothing, so the card is
   * unaffected either way.
   */
  import type { CardTheme } from '$lib/cards/style';
  import { ABILITY_TIMING_LABELS, ABILITY_TIMINGS } from '$lib/cards/types';
  import type { AbilityBlocks } from '$lib/cards/types';
  import type { StyleTarget } from '$lib/state/workshop.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { ColorInput, Slider, TextArea } from '$lib/ui';
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
    textStyle = true
  }: Props = $props();

  const layer = $derived(workshop.styleFor(target) ?? {});
</script>

<EditorSection {title} {hint}>
  <div class="plain">
    {#if symbol}
      <img class="side-symbol" src={symbol} alt="" />
    {/if}
    <TextArea
      value={ability.plain}
      rows={3}
      placeholder="Plain ability text, printed with no label…"
      oninput={(event) => onchange({ plain: event.currentTarget.value })}
    />
  </div>

  <div class="timings">
    {#each ABILITY_TIMINGS as timing (timing)}
      <AbilityField
        label={ABILITY_TIMING_LABELS[timing]}
        value={ability[timing]}
        rows={2}
        placeholder="What happens {ABILITY_TIMING_LABELS[timing].toLowerCase()}…"
        onchange={(value) => onchange({ [timing]: value })}
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
  />

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

  .side-symbol {
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

  .text-style {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
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
