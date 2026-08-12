<script lang="ts">
  /**
   * Ability copy: the untimed paragraph first, then Immediately, During Combat
   * and After Combat in that fixed order, each printed only if it carries text.
   * Inline `{{attack}}` tokens become print-resolution symbols, and `{{name}}`
   * becomes whoever the card belongs to.
   */
  import type { AbilityBlocks } from '$lib/cards/types';
  import { ABILITY_TIMING_LABELS, usedTimings } from '$lib/cards/types';
  import { parseAbilityText } from '$lib/text/tokens';
  import { symbolUrl } from './assets';

  interface Props {
    ability: AbilityBlocks;
    /** Shown when the card has no ability text at all. */
    placeholder?: string;
    /** What `{{name}}` prints as — the figure this card belongs to. */
    subject?: string;
  }

  let {
    ability,
    placeholder = 'Ability text appears here.',
    subject = 'Villain Name'
  }: Props = $props();

  const timings = $derived(usedTimings(ability));
  const hasPlain = $derived(ability.plain.trim().length > 0);
  const empty = $derived(!hasPlain && timings.length === 0);
</script>

{#snippet run(text: string)}
  {#each parseAbilityText(text) as segment, index (index)}
    {#if segment.kind === 'symbol'}
      <img class="symbol" src={symbolUrl(segment.name)} alt={segment.name} />
    {:else if segment.kind === 'subject'}{subject}{:else}{segment.value}{/if}
  {/each}
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
