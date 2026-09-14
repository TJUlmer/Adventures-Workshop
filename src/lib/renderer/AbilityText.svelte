<script lang="ts">
  /**
   * Ability copy: the untimed paragraph first, then Immediately, During Combat
   * and After Combat in that fixed order, each printed only if it carries text.
   * Inline `{{attack}}` tokens become print-resolution symbols, and `{{name}}`
   * becomes whoever the card belongs to.
   */
  import type { AbilityBlocks, BonusAbility } from '$lib/cards/types';
  import { ABILITY_TIMING_LABELS, usedTimings } from '$lib/cards/types';
  import type { CustomSymbol } from '$lib/symbols/types';
  import { actionTextIsEmpty, renderActionText } from '$lib/text/action-text';
  import { parseAbilityText } from '$lib/text/tokens';
  import { symbolUrl } from './assets';
  import { BONUS_ABILITY_DIVIDER_HEIGHT, pu } from './geometry';

  interface Props {
    ability: AbilityBlocks;
    /** Shown when the card has no ability text at all. */
    placeholder?: string;
    /** What `{{name}}` prints as — the figure this card belongs to. */
    subject?: string;
    /** Inherited defaults; an individual Bonus ability may override each one. */
    bonusInk?: string;
    bonusTextSize?: number;
    bonusIconSize?: number;
    /** The set's author-uploaded glyphs, for resolving `{{custom:…}}` tokens. */
    customSymbols?: CustomSymbol[];
  }

  let {
    ability,
    placeholder = 'Ability text appears here.',
    subject = 'Villain Name',
    bonusInk,
    bonusTextSize = 90,
    bonusIconSize = 2.1,
    customSymbols = []
  }: Props = $props();

  const timings = $derived(usedTimings(ability));
  const hasPlain = $derived(!actionTextIsEmpty(ability.plain));
  const bonuses = $derived(
    ability.bonusAbilities.filter((bonus) => !actionTextIsEmpty(bonus.text))
  );
  const empty = $derived(!hasPlain && bonuses.length === 0 && timings.length === 0);

  /**
   * Resolved the same way an inline `{{token}}` is — `BonusAbility.icon` stores
   * that same token string rather than a separate reference type, so it runs
   * through the same built-in/custom-symbol lookup, just read once
   * instead of per glyph in a run of text.
   */
  function bonusIconSource(bonus: BonusAbility): string | null {
    if (!bonus.icon) return null;
    const [segment] = parseAbilityText(bonus.icon);
    if (segment?.kind === 'symbol') return symbolUrl(segment.name);
    if (segment?.kind === 'customSymbol') {
      return customSymbols.find((s) => s.id === segment.id)?.source ?? null;
    }
    return null;
  }
</script>

<!-- `renderActionText` sanitises the stored inline HTML before this insertion. -->
<div class="ability" style:--bonus-divider-thickness={pu(BONUS_ABILITY_DIVIDER_HEIGHT)}>
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

    {#each bonuses as bonus}
      {@const bonusIconSrc = bonusIconSource(bonus)}
      <p
        class="line bonus"
        class:with-divider={bonus.showDivider}
        style:color={bonus.ink ?? bonusInk}
        style:font-size={`${(bonus.textSize ?? bonusTextSize) / 90}em`}
      >
        {#if bonusIconSrc}
          <img
            class="bonus-icon"
            src={bonusIconSrc}
            alt=""
            style:height={`${bonus.iconSize ?? bonusIconSize}em`}
          />
        {/if}
        <span>{@html renderActionText(bonus.text, subject, customSymbols)}</span>
      </p>
    {/each}
  {/if}
</div>

<style>
  .ability {
    display: flex;
    flex-direction: column;
    gap: 0.45em;
    /*
     * The card face clips genuinely over-full ability regions. This face's low
     * descenders extend just beyond the final flex line's calculated box, so
     * whichever row comes last — plain, timed, or Bonus — needs a sliver of
     * clearance for letters such as p and g while the panel still has room to
     * grow upward.
     */
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

  .line.bonus.with-divider {
    /* The rule belongs to the paragraph, so it automatically follows that
       Bonus ability's colour without gaining a second colour control. */
    border-top: var(--bonus-divider-thickness) solid currentColor;
    padding-top: 0.4em;
  }

  .bonus-icon {
    flex: 0 0 auto;
    /* Height set inline from this Bonus ability's effective icon size. */
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
