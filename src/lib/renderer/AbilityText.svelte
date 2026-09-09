<script lang="ts">
  /**
   * Ability copy: the untimed paragraph first, then Immediately, During Combat
   * and After Combat in that fixed order, each printed only if it carries text.
   * Inline `{{attack}}` tokens become print-resolution symbols, and `{{name}}`
   * becomes whoever the card belongs to.
   */
  import type { AbilityBlocks } from '$lib/cards/types';
  import { ABILITY_TIMING_LABELS, usedTimings } from '$lib/cards/types';
  import type { CustomSymbol } from '$lib/symbols/types';
  import { actionTextIsEmpty, renderActionText } from '$lib/text/action-text';
  import { parseAbilityText } from '$lib/text/tokens';
  import { symbolUrl } from './assets';

  interface Props {
    ability: AbilityBlocks;
    /** Shown when the card has no ability text at all. */
    placeholder?: string;
    /** What `{{name}}` prints as — the figure this card belongs to. */
    subject?: string;
    /** Ink for the Bonus ability line. Defaults to whatever `.ability` inherits. */
    bonusInk?: string;
    /** `CardTheme.bonusIconSize` — the Bonus icon's height, in multiples of the ability text size. */
    bonusIconSize?: number;
    /** The set's author-uploaded glyphs, for resolving `{{custom:…}}` tokens. */
    customSymbols?: CustomSymbol[];
  }

  let {
    ability,
    placeholder = 'Ability text appears here.',
    subject = 'Villain Name',
    bonusInk,
    bonusIconSize = 2.1,
    customSymbols = []
  }: Props = $props();

  const timings = $derived(usedTimings(ability));
  const hasPlain = $derived(!actionTextIsEmpty(ability.plain));
  const hasBonus = $derived(!actionTextIsEmpty(ability.bonusAbility));
  const empty = $derived(!hasPlain && !hasBonus && timings.length === 0);

  /**
   * Resolved the same way an inline `{{token}}` is — `bonusIcon` is stored as
   * that same token string rather than a separate reference type, so it runs
   * through the same built-in/custom-symbol lookup, just read once
   * instead of per glyph in a run of text.
   */
  const bonusIconSrc = $derived.by(() => {
    if (!ability.bonusIcon) return null;
    const [segment] = parseAbilityText(ability.bonusIcon);
    if (segment?.kind === 'symbol') return symbolUrl(segment.name);
    if (segment?.kind === 'customSymbol') {
      return customSymbols.find((s) => s.id === segment.id)?.source ?? null;
    }
    return null;
  });
</script>

<!-- `renderActionText` sanitises the stored inline HTML before this insertion. -->
<div class="ability" class:has-bonus={hasBonus}>
  {#if empty}
    {#if placeholder}
      <p class="line placeholder">{placeholder}</p>
    {/if}
  {:else}
    {#if hasPlain}
      <p class="line">{@html renderActionText(ability.plain, subject, customSymbols)}</p>
    {/if}

    {#each timings as timing (timing)}
      <p class="line">
        <span class="label">{ABILITY_TIMING_LABELS[timing]}:</span>
        {@html renderActionText(ability[timing], subject, customSymbols)}
      </p>
    {/each}

    {#if hasBonus}
      <p class="line bonus" style:color={bonusInk}>
        {#if bonusIconSrc}
          <img class="bonus-icon" src={bonusIconSrc} alt="" style:height="{bonusIconSize}em" />
        {/if}
        <span>{@html renderActionText(ability.bonusAbility, subject, customSymbols)}</span>
      </p>
    {/if}
  {/if}
</div>

<style>
  .ability {
    display: flex;
    flex-direction: column;
    gap: 0.45em;
  }

  /*
   * The card face clips genuinely over-full ability regions. The face's low
   * descenders extend just beyond the final flex line's calculated box, so a
   * Bonus ability at the foot otherwise loses the bottoms of letters such as
   * j and g even when the surrounding region still has room to grow.
   */
  .ability.has-bonus {
    padding-bottom: 0.15em;
  }

  .line {
    margin: 0;
    font-family: var(--card-font-text);
    font-weight: var(--card-font-text-weight);
    font-size: inherit;
    line-height: inherit;
    text-wrap: pretty;
    /* Deliberate line breaks in the editor print as written. */
    white-space: pre-wrap;
  }

  .placeholder {
    opacity: 0.4;
  }

  /*
   * Unlike every other symbol in ability copy, the Bonus icon sits in its own
   * column beside the paragraph rather than inline with it — a block-level
   * decoration, not a text token, even though it is stored as one.
   */
  .line.bonus {
    display: flex;
    align-items: center;
    gap: 0.35em;
  }

  .bonus-icon {
    flex: 0 0 auto;
    /* Height set inline from `CardTheme.bonusIconSize` — see the prop above. */
    width: auto;
    object-fit: contain;
  }

  /* The timing label is the same face; the colon and caps carry the emphasis. */
  .label {
    white-space: nowrap;
  }

  .line :global(.symbol) {
    display: inline-block;
    height: 0.82em;
    width: auto;
    vertical-align: -0.08em;
    margin-inline: 0.06em;
  }

  /* The supplied bonus-attack badge is much wider than the four combat glyphs. */
  .line :global(.symbol[alt='bonus_attack']) {
    /* The wide badge needs a shorter box and a neutral baseline. */
    height: 0.68em;
    vertical-align: 0em;
  }

  /* The bundled card cut has no bold file; opt in only for author-marked runs. */
  .line :global(b),
  .line :global(strong) {
    font-weight: 700;
    font-synthesis-weight: auto;
  }

  .line :global(i),
  .line :global(em) {
    font-style: italic;
  }
</style>
