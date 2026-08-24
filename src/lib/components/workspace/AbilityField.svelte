<script lang="ts">
  /**
   * One block of ability copy, with a symbol palette that inserts at the caret.
   *
   * Timed blocks can be removed, which is what keeps the editor as short as the
   * card actually is — an ability with no "After Combat" clause shows no
   * "After Combat" field.
   */
  import type { CustomSymbol } from '$lib/symbols/types';
  import { insertToken } from '$lib/text/tokens';
  import { Icon } from '$lib/ui';
  import SymbolPalette from './SymbolPalette.svelte';

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
   * newline-insertion, insert it explicitly.
   *
   * The first attempt at this used `execCommand('insertText', …)` — it
   * worked wherever it was tested, then turned out not to insert anything at
   * all in a browser where `execCommand` doesn't support `insertText` on a
   * plain (non-contenteditable) form control, which several do not: Enter
   * was still swallowed, just from a different cause than the one this was
   * written to fix. `setRangeText()` is the standards-track replacement for
   * exactly this — splice text into a range and place the caret — and,
   * unlike `execCommand`, is not itself an event: it has to be followed by a
   * manually-dispatched `input` event for the existing `oninput` handler
   * below to see the change at all. Every modifier combination still inserts
   * a newline, matching what a plain textarea already does natively — only
   * IME composition is left alone, so composing non-Latin text is
   * unaffected.
   */
  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing) return;
    const element = event.currentTarget as HTMLTextAreaElement;
    event.preventDefault();
    element.setRangeText('\n', element.selectionStart, element.selectionEnd, 'end');
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }

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
      <SymbolPalette oninsert={insert} {customSymbols} />

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
   * The palette lights up for the whole field, not just for itself — hovering
   * the text box has to reveal it too. Set as an inherited custom property
   * because the row now lives in `SymbolPalette`, whose scoped styles no
   * selector here can reach; see the note on `.symbols` there.
   */
  .block:hover,
  .block:focus-within {
    --palette-opacity: 1;
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
