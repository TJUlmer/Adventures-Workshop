<script lang="ts">
  import { onMount } from 'svelte';
  import type { PreviewDirectField, PreviewEditValue } from '$lib/cards/edit-targets';
  import type { CustomSymbol } from '$lib/symbols/types';
  import { cleanActionText } from '$lib/text/action-text';
  import { toDisplayTokens, toStoredTokens } from '$lib/text/tokens';
  import {
    installSelectionRange,
    rangeAtEnd,
    rangeFromOffsets,
    selectionOffsets,
    selectionRangeInside
  } from '$lib/ui/contenteditable-selection';
  import SymbolPalette from '$lib/components/workspace/SymbolPalette.svelte';
  import { clampPreviewNumber } from '$lib/cards/edit-targets';

  interface Props {
    field: PreviewDirectField;
    label: string;
    left: number;
    top: number;
    width: number;
    height: number;
    canvasWidth: number;
    customSymbols?: CustomSymbol[];
    ondraft: (value: PreviewEditValue, valid: boolean) => void;
    oncommit: (returnFocus: boolean) => void;
    oncancel: (returnFocus: boolean) => void;
  }

  let {
    field,
    label,
    left,
    top,
    width,
    height,
    canvasWidth,
    customSymbols = [],
    ondraft,
    oncommit,
    oncancel
  }: Props = $props();

  let root = $state<HTMLDivElement | null>(null);
  let editor = $state<HTMLDivElement | null>(null);
  let numberInput = $state<HTMLInputElement | null>(null);
  let coarsePointer = $state(false);
  let composing = false;
  let valid = $state(true);
  let savedRange: Range | null = null;

  const shellWidth = $derived.by(() => {
    const available = Math.max(96, canvasWidth - 8);
    const desired =
      field.kind === 'title'
        ? Math.max(width, 240)
        : Math.max(width, coarsePointer ? 140 : 96);
    return Math.min(desired, available);
  });
  const shellLeft = $derived(
    Math.min(
      Math.max(4, left + width / 2 - shellWidth / 2),
      Math.max(4, canvasWidth - shellWidth - 4)
    )
  );

  function syncTitleDraft(): void {
    if (!editor || composing) return;
    const live = selectionRangeInside(editor);
    const preserved = live ? selectionOffsets(editor, live) : null;
    const clean = cleanActionText(editor.innerHTML, { singleLine: true });

    if (clean !== editor.innerHTML) {
      editor.innerHTML = clean;
      if (preserved) {
        const kept = rangeFromOffsets(editor, preserved);
        savedRange = kept.cloneRange();
        installSelectionRange(editor, kept);
      }
    }

    const current = selectionRangeInside(editor);
    if (current) savedRange = current.cloneRange();
    valid = true;
    ondraft(toStoredTokens(clean, customSymbols), true);
  }

  function restoreTitleSelection(fallbackToEnd = false): Range | null {
    if (!editor) return null;
    let range = selectionRangeInside(editor) ?? savedRange?.cloneRange() ?? null;
    editor.focus({ preventScroll: true });
    range ??= fallbackToEnd ? rangeAtEnd(editor) : null;
    if (!range) return null;
    const installed = installSelectionRange(editor, range);
    savedRange = installed?.cloneRange() ?? null;
    return installed;
  }

  function formatTitle(command: 'bold' | 'italic'): void {
    restoreTitleSelection();
    document.execCommand(command, false);
    syncTitleDraft();
  }

  function insertTitleToken(token: string): void {
    restoreTitleSelection(true);
    document.execCommand('insertText', false, token);
    syncTitleDraft();
  }

  function handleTitlePaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = (event.clipboardData?.getData('text/plain') ?? '').replace(/\s*\r?\n\s*/g, ' ');
    document.execCommand('insertText', false, text);
    syncTitleDraft();
  }

  function handleNumberInput(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const parsed = input.valueAsNumber;
    if (Number.isNaN(parsed)) {
      valid = false;
      ondraft(null, false);
      return;
    }

    const next = clampPreviewNumber(field, parsed);
    if (next !== parsed) input.value = String(next);
    valid = true;
    ondraft(next, true);
  }

  function commitFromKeyboard(): void {
    if (!valid) {
      numberInput?.focus({ preventScroll: true });
      return;
    }
    oncommit(true);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      oncancel(true);
      return;
    }
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      if (field.kind === 'title') syncTitleDraft();
      commitFromKeyboard();
    }
  }

  function handleFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && root?.contains(next)) return;
    if (valid) oncommit(false);
    else oncancel(false);
  }

  onMount(() => {
    coarsePointer = window.matchMedia('(any-pointer: coarse)').matches;
    if (field.kind === 'title' && editor) {
      editor.innerHTML = toDisplayTokens(String(field.value), customSymbols);
      restoreTitleSelection(true);
    } else if (numberInput) {
      numberInput.focus({ preventScroll: true });
      numberInput.select();
    }
  });
</script>

<div
  bind:this={root}
  class="field-editor"
  class:title={field.kind === 'title'}
  class:number={field.kind === 'number'}
  class:invalid={!valid}
  style:left="{shellLeft}px"
  style:top="{top}px"
  style:width="{shellWidth}px"
  onfocusout={handleFocusOut}
  role="group"
  aria-label="Editing {label}"
>
  {#if field.kind === 'title'}
    <div
      bind:this={editor}
      class="title-input"
      contenteditable="true"
      role="textbox"
      tabindex="0"
      aria-label="{label} on card"
      aria-multiline="false"
      data-placeholder="Card Title"
      style:min-height="{Math.max(height, 32)}px"
      spellcheck="false"
      oncompositionstart={() => (composing = true)}
      oncompositionend={() => {
        composing = false;
        syncTitleDraft();
      }}
      oninput={syncTitleDraft}
      onkeydown={handleKeydown}
      onpaste={handleTitlePaste}
    ></div>
    <div class="toolbar">
      <SymbolPalette
        oninsert={insertTitleToken}
        onformat={formatTitle}
        {customSymbols}
      />
      <div class="actions">
        <button type="button" class="action" aria-label="Commit {label}" title="Commit" onclick={() => oncommit(true)}>✓</button>
        <button type="button" class="action" aria-label="Cancel editing {label}" title="Cancel" onclick={() => oncancel(true)}>×</button>
      </div>
    </div>
  {:else}
    <span class="number-label">{label}</span>
    <div class="number-row">
      <input
        bind:this={numberInput}
        class="number-input numeric"
        type="number"
        value={field.value}
        min={field.min}
        max={field.max}
        aria-label="{label} on card"
        aria-invalid={!valid}
        oninput={handleNumberInput}
        onkeydown={handleKeydown}
      />
      <button type="button" class="action" aria-label="Commit {label}" title="Commit" onclick={commitFromKeyboard}>✓</button>
      <button type="button" class="action" aria-label="Cancel editing {label}" title="Cancel" onclick={() => oncancel(true)}>×</button>
    </div>
  {/if}
</div>

<style>
  .field-editor {
    position: absolute;
    z-index: 2;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-1);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--surface-overlay);
    box-shadow: var(--shadow-lg), 0 0 0 2px var(--accent-soft);
  }

  .title-input {
    width: 100%;
    padding: 4px var(--space-2);
    overflow-x: auto;
    overflow-y: hidden;
    white-space: nowrap;
    border-radius: var(--radius-xs);
    background: var(--surface-inset);
    color: var(--text-primary);
    font-family: var(--font-display);
    font-size: var(--text-md);
    line-height: var(--leading-tight);
  }

  .title-input:focus,
  .number-input:focus {
    outline: none;
  }

  .title-input:empty::before {
    content: attr(data-placeholder);
    color: var(--text-muted);
    pointer-events: none;
  }

  .title-input :global(b),
  .title-input :global(strong) {
    font-weight: 700;
    font-synthesis-weight: auto;
  }

  .title-input :global(i),
  .title-input :global(em) {
    font-style: italic;
  }

  .toolbar,
  .actions,
  .number-row {
    display: flex;
    align-items: center;
  }

  .toolbar {
    min-width: 0;
    gap: var(--space-1);
  }

  .actions {
    flex: none;
    gap: 1px;
  }

  .action {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex: none;
    border-radius: var(--radius-xs);
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .action:hover,
  .action:focus-visible {
    background: var(--surface-hover);
    color: var(--text-primary);
    outline: none;
  }

  .field-editor.number {
    gap: 2px;
  }

  .number-label {
    padding-inline: 2px;
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .number-row {
    gap: 1px;
  }

  .number-input {
    min-width: 0;
    width: 100%;
    height: 28px;
    padding-inline: var(--space-1);
    border-radius: var(--radius-xs);
    background: var(--surface-inset);
    color: var(--text-primary);
    text-align: center;
    appearance: textfield;
    -moz-appearance: textfield;
  }

  .number-input::-webkit-outer-spin-button,
  .number-input::-webkit-inner-spin-button {
    appearance: none;
    margin: 0;
  }

  .invalid {
    border-color: var(--danger);
    box-shadow: var(--shadow-lg), 0 0 0 2px color-mix(in oklab, var(--danger) 25%, transparent);
  }

  @media (hover: none), (any-pointer: coarse) {
    .action,
    .number-input {
      min-width: var(--touch-target);
      min-height: var(--touch-target);
    }
  }
</style>
