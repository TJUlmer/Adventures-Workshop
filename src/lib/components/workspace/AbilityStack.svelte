<script lang="ts">
  /**
   * One ability: the untimed paragraph, then the three timed blocks abreast.
   *
   * All three are always on screen. They used to be added from chips so the
   * editor stayed as short as the card, but a fixed row is quicker to fill and
   * quicker to read — and an empty block still prints nothing, so the card is
   * unaffected either way.
   */
  import type { AbilityBlocks } from '$lib/cards/types';
  import { ABILITY_TIMING_LABELS, ABILITY_TIMINGS } from '$lib/cards/types';
  import { TextArea } from '$lib/ui';
  import AbilityField from './AbilityField.svelte';
  import EditorSection from './EditorSection.svelte';

  interface Props {
    title: string;
    /** Symbol shown beside the title, so each side of a split is identifiable. */
    symbol?: string;
    hint?: string;
    ability: AbilityBlocks;
    onchange: (patch: Partial<AbilityBlocks>) => void;
  }

  let { title, symbol, hint, ability, onchange }: Props = $props();
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
</style>
