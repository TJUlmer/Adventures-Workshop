<script lang="ts">
  /**
   * One block of ability copy, with a symbol palette that inserts at the caret.
   *
   * Timed blocks can be removed, which is what keeps the editor as short as the
   * card actually is — an ability with no "After Combat" clause shows no
   * "After Combat" field.
   */
  import { CARD_SYMBOL_LABELS, CARD_SYMBOLS } from '$lib/renderer/assets';
  import type { CardSymbolName } from '$lib/renderer/assets';
  import { insertToken, SUBJECT_TOKEN, symbolToken } from '$lib/text/tokens';
  import { Icon } from '$lib/ui';

  interface Props {
    label: string;
    value: string;
    placeholder?: string;
    rows?: number;
    /** Shown when the block can be taken off the card. */
    onremove?: () => void;
    onchange: (value: string) => void;
  }

  let { label, value, placeholder, rows = 3, onremove, onchange }: Props = $props();

  let field = $state<HTMLTextAreaElement | null>(null);

  const SYMBOL_NAMES = Object.keys(CARD_SYMBOLS) as CardSymbolName[];

  function insert(token: string): void {
    const element = field;
    if (!element) {
      onchange(value + token);
      return;
    }

    const { text, caret } = insertToken(
      value,
      element.selectionStart,
      element.selectionEnd,
      token
    );
    onchange(text);

    // Restore the caret after Svelte writes the new value back.
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(caret, caret);
    });
  }
</script>

<div class="block">
  <div class="head">
    <span class="label">{label}</span>

    <div class="tools">
      <div class="symbols" role="group" aria-label="Insert symbol">
        {#each SYMBOL_NAMES as name (name)}
          <button
            type="button"
            class="symbol"
            title="Insert {CARD_SYMBOL_LABELS[name]} symbol"
            onclick={() => insert(symbolToken(name))}
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
          onclick={() => insert(SUBJECT_TOKEN)}
        >
          Name
        </button>
      </div>

      {#if onremove}
        <button type="button" class="remove" title="Remove {label}" onclick={onremove}>
          <Icon name="minus" size={12} />
        </button>
      {/if}
    </div>
  </div>

  <textarea
    bind:this={field}
    class="input"
    {rows}
    {placeholder}
    {value}
    aria-label={label}
    oninput={(event) => onchange(event.currentTarget.value)}
  ></textarea>
</div>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 22px;
  }

  .label {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .tools {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* The palette stays quiet until the block is hovered or focused. */
  .symbols {
    display: flex;
    gap: 1px;
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-out);
  }

  .block:hover .symbols,
  .block:focus-within .symbols {
    opacity: 1;
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

  .remove {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-xs);
    color: var(--text-muted);
  }

  .remove:hover {
    background: var(--surface-hover);
    color: var(--danger);
  }

  .input {
    width: 100%;
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    color: var(--text-primary);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    resize: vertical;
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .input::placeholder {
    color: var(--text-muted);
  }

  .input:hover {
    border-color: var(--border-strong);
  }

  .input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
</style>
