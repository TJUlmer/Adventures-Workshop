<script lang="ts">
  /** Compact bold/italic editor for action-card title and ability copy. */
  import { untrack } from 'svelte';
  import type { CustomSymbol } from '$lib/symbols/types';
  import { actionTextIsEmpty, sanitizeActionText } from '$lib/text/action-text';
  import { toDisplayTokens, toStoredTokens } from '$lib/text/tokens';
  import { Icon } from '$lib/ui';
  import {
    installSelectionRange,
    rangeAtEnd,
    rangeFromOffsets,
    rangeInside,
    selectionOffsets,
    selectionRangeInside
  } from '$lib/ui/contenteditable-selection';
  import SymbolPalette from './SymbolPalette.svelte';

  interface Props {
    label: string;
    value: string;
    placeholder?: string;
    multiline?: boolean;
    rows?: number;
    prominent?: boolean;
    /** Keep a whitespace-only edit as an intentional blank value. */
    preserveWhitespace?: boolean;
    onremove?: () => void;
    onchange: (value: string) => void;
    customSymbols?: CustomSymbol[];
    /** Stable destination for preview-to-editor navigation. */
    editorTarget?: string;
  }

  let {
    label,
    value = '',
    placeholder,
    multiline = true,
    rows = 3,
    prominent = false,
    preserveWhitespace = false,
    onremove,
    onchange,
    customSymbols = [],
    editorTarget
  }: Props = $props();

  function hasIntentionalWhitespace(html: string): boolean {
    const template = document.createElement('template');
    template.innerHTML = html;
    const text = template.content.textContent ?? '';
    return text.length > 0 && text.trim().length === 0;
  }

  function cleanValue(html: string): string {
    if (preserveWhitespace && hasIntentionalWhitespace(html)) return ' ';
    const clean = sanitizeActionText(html, !multiline);
    return actionTextIsEmpty(clean) ? '' : clean;
  }

  let editor = $state<HTMLDivElement | null>(null);
  let display = $state(untrack(() => toDisplayTokens(cleanValue(value), customSymbols)));
  let composing = false;
  let savedRange: Range | null = null;

  /*
   * The stored-token round trip distinguishes a local edit from a card switch,
   * undo or custom-symbol rename. Only the latter redraws the DOM, so typing
   * and toolbar actions do not throw the current selection away.
   */
  $effect(() => {
    const incoming = toDisplayTokens(cleanValue(value), customSymbols);
    const element = editor;
    untrack(() => {
      if (toStoredTokens(display, customSymbols) !== value) display = incoming;
      if (element && element.innerHTML !== display) {
        element.innerHTML = display;
        savedRange = null;
      }
    });
  });

  function rememberedRange(): Range | null {
    if (!editor || !savedRange || !rangeInside(editor, savedRange)) {
      savedRange = null;
      return null;
    }
    return savedRange.cloneRange();
  }

  function restoreEditorSelection(fallbackToEnd = false): Range | null {
    if (!editor) return null;
    const live = selectionRangeInside(editor);
    let range =
      (document.activeElement === editor ? live : null) ?? rememberedRange() ?? live;
    editor.focus({ preventScroll: true });
    range ??= selectionRangeInside(editor);
    range ??= fallbackToEnd ? rangeAtEnd(editor) : null;
    if (!range) return null;
    const installed = installSelectionRange(editor, range);
    savedRange = installed?.cloneRange() ?? null;
    return installed;
  }

  function commit(): void {
    if (!editor || composing) return;
    const liveRange = selectionRangeInside(editor);
    const range = liveRange ?? rememberedRange();
    const preserved = range ? selectionOffsets(editor, range) : null;
    const clean = cleanValue(editor.innerHTML);

    if (clean !== editor.innerHTML) {
      editor.innerHTML = clean;
      if (preserved) {
        const kept = rangeFromOffsets(editor, preserved);
        savedRange = kept.cloneRange();
        if (liveRange) installSelectionRange(editor, kept);
      }
    }

    const current = selectionRangeInside(editor);
    if (current) savedRange = current.cloneRange();
    display = clean;
    onchange(toStoredTokens(clean, customSymbols));
  }

  function exec(command: 'bold' | 'italic'): void {
    restoreEditorSelection();
    document.execCommand(command, false);
    commit();
  }

  function insert(token: string): void {
    if (!editor) return;
    restoreEditorSelection(true);
    document.execCommand('insertText', false, token);
    commit();
  }

  $effect(() => {
    const captureSelection = (): void => {
      if (!editor) return;
      const range = selectionRangeInside(editor);
      if (range && document.activeElement === editor) savedRange = range.cloneRange();
    };
    document.addEventListener('selectionchange', captureSelection);
    return () => document.removeEventListener('selectionchange', captureSelection);
  });

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
    data-card-editor-target={editorTarget}
    data-placeholder={placeholder}
    spellcheck={multiline}
    style:min-height={multiline ? `${rows * 20 + 18}px` : undefined}
    oncompositionstart={() => (composing = true)}
    oncompositionend={() => {
      composing = false;
      commit();
    }}
    oninput={() => {
      if (!composing) commit();
    }}
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
    flex-wrap: nowrap;
    justify-content: flex-end;
    min-width: 0;
    overflow: hidden;
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
    flex: none;
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

  @media (max-width: 760px) {
    .input {
      font-size: var(--text-md);
    }
  }

  @media (hover: none), (any-pointer: coarse) {
    .remove {
      width: var(--touch-target);
      height: var(--touch-target);
    }
  }
</style>
