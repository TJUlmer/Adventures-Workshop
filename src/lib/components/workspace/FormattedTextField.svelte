<script lang="ts">
  /** Compact bold/italic editor for action-card title and ability copy. */
  import { untrack } from 'svelte';
  import type { CustomSymbol } from '$lib/symbols/types';
  import { actionTextIsEmpty, sanitizeActionText } from '$lib/text/action-text';
  import { toDisplayTokens, toStoredTokens } from '$lib/text/tokens';
  import { Icon } from '$lib/ui';
  import SymbolPalette from './SymbolPalette.svelte';

  interface Props {
    label: string;
    value: string;
    placeholder?: string;
    multiline?: boolean;
    rows?: number;
    prominent?: boolean;
    onremove?: () => void;
    onchange: (value: string) => void;
    customSymbols?: CustomSymbol[];
  }

  let {
    label,
    value = '',
    placeholder,
    multiline = true,
    rows = 3,
    prominent = false,
    onremove,
    onchange,
    customSymbols = []
  }: Props = $props();

  let editor = $state<HTMLDivElement | null>(null);
  let display = $state(
    untrack(() => toDisplayTokens(sanitizeActionText(value, !multiline), customSymbols))
  );

  /*
   * The stored-token round trip distinguishes a local edit from a card switch,
   * undo or custom-symbol rename. Only the latter redraws the DOM, so typing
   * and toolbar actions do not throw the current selection away.
   */
  $effect(() => {
    const incoming = toDisplayTokens(sanitizeActionText(value, !multiline), customSymbols);
    const element = editor;
    untrack(() => {
      if (toStoredTokens(display, customSymbols) !== value) display = incoming;
      if (element && element.innerHTML !== display) element.innerHTML = display;
    });
  });

  function offsetWithin(root: Node, container: Node, offset: number): number {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(container, offset);
    return range.toString().length;
  }

  function pointAtOffset(root: Node, target: number): { node: Node; offset: number } {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = target;
    let last: Text | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      if (remaining <= text.data.length) return { node: text, offset: remaining };
      remaining -= text.data.length;
      last = text;
    }
    return last ? { node: last, offset: last.data.length } : { node: root, offset: 0 };
  }

  function commit(): void {
    if (!editor) return;
    let clean = sanitizeActionText(editor.innerHTML, !multiline);
    if (actionTextIsEmpty(clean)) clean = '';

    if (clean !== editor.innerHTML) {
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const preserved =
        range && editor.contains(range.startContainer) && editor.contains(range.endContainer)
          ? {
              start: offsetWithin(editor, range.startContainer, range.startOffset),
              end: offsetWithin(editor, range.endContainer, range.endOffset)
            }
          : null;

      editor.innerHTML = clean;
      if (preserved && selection) {
        const start = pointAtOffset(editor, preserved.start);
        const end = pointAtOffset(editor, preserved.end);
        const kept = document.createRange();
        kept.setStart(start.node, start.offset);
        kept.setEnd(end.node, end.offset);
        selection.removeAllRanges();
        selection.addRange(kept);
      }
    }

    display = clean;
    onchange(toStoredTokens(clean, customSymbols));
  }

  function exec(command: 'bold' | 'italic'): void {
    editor?.focus();
    document.execCommand(command, false);
    commit();
  }

  function insert(token: string): void {
    if (!editor) return;
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!range || !editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
      editor.append(document.createTextNode(token));
    } else {
      editor.focus();
      document.execCommand('insertText', false, token);
    }
    commit();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    if (multiline) {
      document.execCommand('insertLineBreak', false);
      commit();
    }
  }

  function handlePaste(event: ClipboardEvent): void {
    event.preventDefault();
    let text = event.clipboardData?.getData('text/plain') ?? '';
    if (!multiline) text = text.replace(/\s*\r?\n\s*/g, ' ');
    document.execCommand('insertText', false, text);
    commit();
  }
</script>

<div class="block">
  <div class="head">
    <span class="label">{label}</span>
    <div class="tools">
      <SymbolPalette oninsert={insert} onformat={exec} {customSymbols} />

      {#if onremove}
        <button type="button" class="remove" title="Remove {label}" onclick={onremove}>
          <Icon name="minus" size={12} />
        </button>
      {/if}
    </div>
  </div>

  <div
    bind:this={editor}
    class="input"
    class:multiline
    class:prominent
    contenteditable="true"
    role="textbox"
    tabindex="0"
    aria-label={label}
    aria-multiline={multiline}
    data-placeholder={placeholder}
    spellcheck={multiline}
    style:min-height={multiline ? `${rows * 20 + 18}px` : undefined}
    oninput={commit}
    onkeydown={handleKeydown}
    onpaste={handlePaste}
  ></div>
</div>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .head,
  .tools {
    display: flex;
    align-items: center;
  }

  .head {
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 22px;
  }

  .tools {
    flex: 1 1 auto;
    flex-wrap: wrap;
    justify-content: flex-end;
    min-width: 0;
    margin-left: auto;
    gap: 1px;
  }

  .label {
    white-space: nowrap;
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .block:hover,
  .block:focus-within {
    --palette-opacity: 1;
  }

  .remove {
    display: grid;
    place-items: center;
    width: 20px;
    height: 22px;
    border-radius: var(--radius-xs);
    color: var(--text-muted);
    transition:
      color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out);
  }

  .remove {
    width: 20px;
    height: 20px;
    margin-left: var(--space-2);
  }

  .remove:hover {
    color: var(--danger);
    background: var(--surface-hover);
  }

  .input {
    width: 100%;
    height: 32px;
    padding: 5px var(--space-3);
    overflow-x: auto;
    overflow-y: hidden;
    white-space: nowrap;
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    color: var(--text-primary);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    transition:
      border-color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out);
  }

  .input.multiline {
    height: auto;
    padding: var(--space-3);
    overflow-x: hidden;
    overflow-y: auto;
    white-space: pre-wrap;
  }

  .input.prominent {
    height: 40px;
    padding-block: 6px;
    font-family: var(--font-display);
    font-size: var(--text-lg);
    letter-spacing: var(--tracking-tight);
  }

  /*
   * Card fonts intentionally disable synthetic weight globally because their
   * ordinary 400-weight copy should stay faithful to the supplied cut. Bold is
   * an explicit author instruction, though, and most card faces have no real
   * 700 file to select, so only that marked run opts synthesis back in.
   */
  .input :global(b),
  .input :global(strong) {
    font-weight: 700;
    font-synthesis-weight: auto;
  }

  .input :global(i),
  .input :global(em) {
    font-style: italic;
  }

  .input:empty::before {
    content: attr(data-placeholder);
    color: var(--text-muted);
    pointer-events: none;
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
