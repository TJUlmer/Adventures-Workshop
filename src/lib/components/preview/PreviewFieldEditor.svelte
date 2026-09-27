<script lang="ts">
  import { onMount } from 'svelte';
  import type { PreviewDirectField, PreviewEditValue } from '$lib/cards/edit-targets';
  import type { CustomSymbol } from '$lib/symbols/types';
  import {
    createActionTextEditorState,
    displayActionTextEditorValue,
    formatActionTextEditor,
    insertActionTextEditorLineBreak,
    insertActionTextEditorText,
    rememberActionTextSelection,
    restoreActionTextSelection,
    syncActionTextEditor,
    type ActionTextEditorValue
  } from '$lib/text/action-text-editor';
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
    onopenfull: () => void;
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
    oncancel,
    onopenfull
  }: Props = $props();

  let root = $state<HTMLDivElement | null>(null);
  let editor = $state<HTMLDivElement | null>(null);
  let numberInput = $state<HTMLInputElement | null>(null);
  let coarsePointer = $state(false);
  let valid = $state(true);
  const editorState = createActionTextEditorState();
  const textField = $derived(field.kind === 'title' || field.kind === 'ability');
  const multiline = $derived(field.kind === 'ability');

  const shellWidth = $derived.by(() => {
    const available = Math.max(96, canvasWidth - 8);
    const desired =
      textField
        ? Math.max(width, multiline ? 320 : 240)
        : Math.max(width, coarsePointer ? 140 : 96);
    return Math.min(desired, available);
  });
  const shellLeft = $derived(
    Math.min(
      Math.max(4, left + width / 2 - shellWidth / 2),
      Math.max(4, canvasWidth - shellWidth - 4)
    )
  );

  function editorOptions(): { singleLine: boolean } {
    return { singleLine: !multiline };
  }

  function acceptTextDraft(next: ActionTextEditorValue | null): void {
    if (!next) return;
    valid = true;
    ondraft(next.stored, true);
  }

  function syncTextDraft(): void {
    if (!editor) return;
    acceptTextDraft(
      syncActionTextEditor(editor, editorState, customSymbols, editorOptions())
    );
  }

  function formatText(command: 'bold' | 'italic'): void {
    if (!editor) return;
    acceptTextDraft(
      formatActionTextEditor(editor, editorState, command, customSymbols, editorOptions())
    );
  }

  function insertText(token: string): void {
    if (!editor) return;
    acceptTextDraft(
      insertActionTextEditorText(editor, editorState, token, customSymbols, editorOptions())
    );
  }

  function handleTextPaste(event: ClipboardEvent): void {
    event.preventDefault();
    let text = event.clipboardData?.getData('text/plain') ?? '';
    if (!multiline) text = text.replace(/\s*\r?\n\s*/g, ' ');
    insertText(text);
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
      if (field.kind === 'ability' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        if (editor) {
          acceptTextDraft(
            insertActionTextEditorLineBreak(
              editor,
              editorState,
              customSymbols,
              editorOptions()
            )
          );
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (textField) syncTextDraft();
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
    if (textField && editor) {
      editor.innerHTML = displayActionTextEditorValue(
        String(field.value),
        customSymbols,
        editorOptions()
      );
      restoreActionTextSelection(editor, editorState, true);
    } else if (numberInput) {
      numberInput.focus({ preventScroll: true });
      numberInput.select();
    }

    const captureSelection = (): void => {
      rememberActionTextSelection(editor, editorState);
    };
    document.addEventListener('selectionchange', captureSelection);
    return () => document.removeEventListener('selectionchange', captureSelection);
  });
</script>

<div
  bind:this={root}
  class="field-editor"
  class:title={field.kind === 'title'}
  class:ability={field.kind === 'ability'}
  class:number={field.kind === 'number'}
  class:invalid={!valid}
  style:left="{shellLeft}px"
  style:top="{top}px"
  style:width="{shellWidth}px"
  onfocusout={handleFocusOut}
  role="group"
  aria-label="Editing {label}"
>
  {#if textField}
    <div
      bind:this={editor}
      class="text-input"
      class:title-input={field.kind === 'title'}
      class:ability-input={field.kind === 'ability'}
      contenteditable="true"
      role="textbox"
      tabindex="0"
      aria-label="{label} on card"
      aria-multiline={multiline}
      data-placeholder={field.kind === 'title' ? 'Card Title' : 'Ability text'}
      style:min-height="{Math.max(height, multiline ? 88 : 32)}px"
      spellcheck={multiline}
      oncompositionstart={() => (editorState.composing = true)}
      oncompositionend={() => {
        editorState.composing = false;
        syncTextDraft();
      }}
      oninput={syncTextDraft}
      onkeydown={handleKeydown}
      onpaste={handleTextPaste}
    ></div>
    <div class="toolbar">
      <SymbolPalette
        oninsert={insertText}
        onformat={formatText}
        {customSymbols}
      />
      {#if field.kind === 'ability'}
        <span class="commit-hint" title="Ctrl or Command + Enter saves">Ctrl/⌘+↵</span>
      {/if}
      <div class="actions">
        {#if field.kind === 'ability'}
          <button type="button" class="open-full" onclick={onopenfull}>Open full editor</button>
        {/if}
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

  .text-input {
    width: 100%;
    padding: 4px var(--space-2);
    border-radius: var(--radius-xs);
    background: var(--surface-inset);
    color: var(--text-primary);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }

  .title-input {
    overflow-x: auto;
    overflow-y: hidden;
    white-space: nowrap;
    font-family: var(--font-display);
    font-size: var(--text-md);
    line-height: var(--leading-tight);
  }

  .ability-input {
    max-height: 180px;
    overflow-x: hidden;
    overflow-y: auto;
    white-space: pre-wrap;
  }

  .text-input:focus,
  .number-input:focus {
    outline: none;
  }

  .text-input:empty::before {
    content: attr(data-placeholder);
    color: var(--text-muted);
    pointer-events: none;
  }

  .text-input :global(b),
  .text-input :global(strong) {
    font-weight: 700;
    font-synthesis-weight: auto;
  }

  .text-input :global(i),
  .text-input :global(em) {
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

  .commit-hint {
    flex: 1 1 auto;
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-2xs);
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .action:focus-visible,
  .open-full:hover,
  .open-full:focus-visible {
    background: var(--surface-hover);
    color: var(--text-primary);
    outline: none;
  }

  .open-full {
    flex: none;
    height: 24px;
    padding-inline: var(--space-2);
    border-radius: var(--radius-xs);
    color: var(--accent);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    white-space: nowrap;
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
    .open-full,
    .number-input {
      min-width: var(--touch-target);
      min-height: var(--touch-target);
    }
  }
</style>
