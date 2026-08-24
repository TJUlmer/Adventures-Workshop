<script lang="ts">
  /**
   * The insert-at-caret symbol row: the four combat symbols, the figure's
   * name, then whatever the set has uploaded.
   *
   * Extracted from `AbilityField` when the card title wanted the same row.
   * The rule it carries with it: **only offer this beside a field whose
   * renderer parses tokens.** Every button here writes a `{{…}}` token into
   * plain text, and a field that prints its value verbatim would print the
   * braces — so adding this to a new field means teaching that field's face
   * `parseAbilityText` in the same change.
   */
  import { CARD_SYMBOL_LABELS, CARD_SYMBOLS } from '$lib/renderer/assets';
  import type { CardSymbolName } from '$lib/renderer/assets';
  import type { CustomSymbol } from '$lib/symbols/types';
  import { customSymbolLabel } from '$lib/symbols/types';
  import { customSymbolToken, SUBJECT_TOKEN, symbolToken } from '$lib/text/tokens';

  interface Props {
    /** Called with the token to splice in at the caret. */
    oninsert: (token: string) => void;
    /** Author-uploaded glyphs, offered alongside the four built-in symbols. */
    customSymbols?: CustomSymbol[];
  }

  let { oninsert, customSymbols = [] }: Props = $props();

  const SYMBOL_NAMES = Object.keys(CARD_SYMBOLS) as CardSymbolName[];
</script>

<div class="symbols" role="group" aria-label="Insert symbol">
  {#each SYMBOL_NAMES as name (name)}
    <button
      type="button"
      class="symbol"
      title="Insert {CARD_SYMBOL_LABELS[name]} symbol"
      onclick={() => oninsert(symbolToken(name))}
    >
      <img src={CARD_SYMBOLS[name]} alt={CARD_SYMBOL_LABELS[name]} />
    </button>
  {/each}

  <!--
    Prints the figure the card belongs to, so a card that names its owner
    keeps naming it after a rename or a move to another deck.
  -->
  <button
    type="button"
    class="symbol token"
    title="Insert the figure’s name"
    onclick={() => oninsert(SUBJECT_TOKEN)}
  >
    Name
  </button>

  {#each customSymbols.filter((s) => s.source) as symbol (symbol.id)}
    <button
      type="button"
      class="symbol"
      title="Insert {customSymbolLabel(symbol)} symbol"
      onclick={() => oninsert(customSymbolToken(symbol.id))}
    >
      <img src={symbol.source} alt={customSymbolLabel(symbol)} />
    </button>
  {/each}
</div>

<style>
  /*
   * Quiet at rest, full strength on hover or focus — but never invisible.
   * It was `opacity: 0` until touched, which hid the whole custom-symbol
   * feature from anyone who did not already know to hover an ability field:
   * the palette is the only route to inserting a symbol at the caret, so a
   * palette nobody sees is a feature nobody finds.
   *
   * Driven by a custom property rather than the palette's own `:hover`,
   * because the reveal belongs to the *whole field* — hovering the text box
   * has to light the row up too. A parent selector cannot reach in here
   * (component styles are scoped per component), and an inherited custom
   * property can, without either side resorting to `:global`.
   */
  .symbols {
    display: flex;
    gap: 1px;
    opacity: var(--palette-opacity, 0.55);
    transition: opacity var(--duration-fast) var(--ease-out);
  }

  .symbol {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-xs);
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  .symbol:hover {
    background: var(--surface-hover);
  }

  .symbol img {
    width: 14px;
    height: 14px;
    object-fit: contain;
  }

  .symbol.token {
    width: auto;
    padding-inline: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .symbol.token:hover {
    color: var(--text-primary);
  }
</style>
