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
  const hasPlain = $derived(ability.plain.trim().length > 0);
  const hasBonus = $derived(ability.bonusAbility.trim().length > 0);
  const empty = $derived(!hasPlain && !hasBonus && timings.length === 0);

  /**
   * Resolved the same way an inline `{{token}}` is — `bonusIcon` is stored as
   * that same token string rather than a separate reference type, so it runs
   * through the same `CARD_SYMBOLS`/`CustomSymbol` lookup, just read once
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

<!--
  Written without a line break anywhere inside the loop, and that is load
  bearing rather than a style choice: `.line` below sets `white-space:
  pre-wrap` so an author's own newlines print, which also means *this file's*
  indentation prints. Laid out readably — one branch per line, the `<img>`
  indented under it — every inserted symbol printed a line break before and
  after itself, turning a one-line ability into three. `ActionCardFace`'s
  title loop already carries the same warning for the same reason.
-->
{#snippet run(text: string)}
  {#each parseAbilityText(text) as segment, index (index)}{#if segment.kind === 'symbol'}<img
        class="symbol"
        src={symbolUrl(segment.name)}
        alt={segment.name}
      />{:else if segment.kind === 'customSymbol'}{@const custom = customSymbols.find(
        (s) => s.id === segment.id
      )}{#if custom?.source}<img
          class="symbol"
          src={custom.source}
          alt={custom.name}
        />{/if}{:else if segment.kind === 'subject'}{subject}{:else}{segment.value}{/if}{/each}
{/snippet}

<div class="ability">
  {#if empty}
    <p class="line placeholder">{placeholder}</p>
  {:else}
    {#if hasPlain}
      <p class="line">{@render run(ability.plain)}</p>
    {/if}

    {#each timings as timing (timing)}
      <p class="line">
        <span class="label">{ABILITY_TIMING_LABELS[timing]}:</span>
        {@render run(ability[timing])}
      </p>
    {/each}

    {#if hasBonus}
      <p class="line bonus" style:color={bonusInk}>
        {#if bonusIconSrc}
          <img class="bonus-icon" src={bonusIconSrc} alt="" style:height="{bonusIconSize}em" />
        {/if}
        <span>{@render run(ability.bonusAbility)}</span>
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

  .symbol {
    display: inline-block;
    height: 0.82em;
    width: auto;
    vertical-align: -0.08em;
    margin-inline: 0.06em;
  }
</style>
