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
  import type { CustomSymbol } from '$lib/symbols/types';
  import { customSymbolLabel } from '$lib/symbols/types';
  import { customSymbolToken, insertToken, SUBJECT_TOKEN, symbolToken } from '$lib/text/tokens';
  import { Icon } from '$lib/ui';

  interface Props {
    label: string;
    value: string;
    placeholder?: string;
    rows?: number;
    /** Shown when the block can be taken off the card. */
    onremove?: () => void;
    onchange: (value: string) => void;
    /** Author-uploaded glyphs, offered alongside the four built-in symbols. */
    customSymbols?: CustomSymbol[];
  }

  let {
    label,
    value = $bindable(''),
    placeholder,
    rows = 3,
    onremove,
    onchange,
    customSymbols = []
  }: Props = $props();

  let field = $state<HTMLTextAreaElement | null>(null);

  /*
   * Enter was being silently swallowed for this field in some (but not all)
   * of its mounting contexts — reproducible, but with no interceptor, remount
   * or wrapping element found anywhere in this component or its ancestors to
   * explain it. Rather than keep relying on the browser's own default
   * newline-insertion, insert it explicitly: `execCommand('insertText', …)`
   * is the same technique `RichTextEditor.svelte` already uses for
   * programmatic insertion, and it dispatches a genuine `input` event, so the
   * existing `oninput` handler below picks it up with no further wiring.
   * Every modifier combination still inserts a newline, matching what a
   * plain textarea already does natively — only IME composition is left
   * alone, so composing non-Latin text is unaffected.
   */
  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    document.execCommand('insertText', false, '\n');
  }

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

        {#each customSymbols.filter((s) => s.source) as symbol (symbol.id)}
          <button
            type="button"
            class="symbol"
            title="Insert {customSymbolLabel(symbol)} symbol"
            onclick={() => insert(customSymbolToken(symbol.id))}
          >
            <img src={symbol.source} alt={customSymbolLabel(symbol)} />
          </button>
        {/each}
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
    bind:value
    class="input"
    {rows}
    {placeholder}
    aria-label={label}
    oninput={(event) => onchange(event.currentTarget.value)}
    onkeydown={handleKeydown}
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

  /*
   * Quiet at rest, full strength on hover or focus — but never invisible.
   * It was `opacity: 0` until touched, which hid the whole custom-symbol
   * feature from anyone who did not already know to hover an ability field:
   * the palette is the only route to inserting a symbol at the caret, so a
   * palette nobody sees is a feature nobody finds.
   */
  .symbols {
    display: flex;
    gap: 1px;
    opacity: 0.55;
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
