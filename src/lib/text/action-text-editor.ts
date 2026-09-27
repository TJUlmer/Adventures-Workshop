import type { CustomSymbol } from '$lib/symbols/types';
import {
  installSelectionRange,
  rangeAtEnd,
  rangeFromOffsets,
  rangeInside,
  selectionOffsets,
  selectionRangeInside
} from '$lib/ui/contenteditable-selection';
import { cleanActionText } from './action-text';
import { toDisplayTokens, toStoredTokens } from './tokens';

export interface ActionTextEditorOptions {
  singleLine: boolean;
  preserveWhitespace?: boolean;
}

export interface ActionTextEditorState {
  composing: boolean;
  savedRange: Range | null;
}

export interface ActionTextEditorValue {
  display: string;
  stored: string;
}

export function createActionTextEditorState(): ActionTextEditorState {
  return { composing: false, savedRange: null };
}

function cleanDisplay(value: string, options: ActionTextEditorOptions): string {
  return cleanActionText(value, options);
}

export function displayActionTextEditorValue(
  value: string,
  customSymbols: readonly CustomSymbol[],
  options: ActionTextEditorOptions
): string {
  return toDisplayTokens(cleanDisplay(value, options), customSymbols);
}

function rememberedRange(editor: HTMLElement, state: ActionTextEditorState): Range | null {
  if (!state.savedRange || !rangeInside(editor, state.savedRange)) {
    state.savedRange = null;
    return null;
  }
  return state.savedRange.cloneRange();
}

/** Keep a stable caret bookmark while focus moves through the field's toolbar. */
export function rememberActionTextSelection(
  editor: HTMLElement | null,
  state: ActionTextEditorState
): void {
  if (!editor || document.activeElement !== editor) return;
  const range = selectionRangeInside(editor);
  if (range) state.savedRange = range.cloneRange();
}

export function restoreActionTextSelection(
  editor: HTMLElement,
  state: ActionTextEditorState,
  fallbackToEnd = false
): Range | null {
  const live = selectionRangeInside(editor);
  let range =
    (document.activeElement === editor ? live : null) ?? rememberedRange(editor, state) ?? live;
  editor.focus({ preventScroll: true });
  range ??= selectionRangeInside(editor);
  range ??= fallbackToEnd ? rangeAtEnd(editor) : null;
  if (!range) return null;
  const installed = installSelectionRange(editor, range);
  state.savedRange = installed?.cloneRange() ?? null;
  return installed;
}

/**
 * Read, sanitize and tokenise one contenteditable without rebuilding valid DOM.
 * Avoiding routine innerHTML replacement preserves the browser's native undo
 * stack; the selection bookmark is only used when sanitizing changed markup.
 */
export function syncActionTextEditor(
  editor: HTMLElement,
  state: ActionTextEditorState,
  customSymbols: readonly CustomSymbol[],
  options: ActionTextEditorOptions
): ActionTextEditorValue | null {
  if (state.composing) return null;

  const liveRange = selectionRangeInside(editor);
  const range = liveRange ?? rememberedRange(editor, state);
  const preserved = range ? selectionOffsets(editor, range) : null;
  const clean = cleanDisplay(editor.innerHTML, options);

  if (clean !== editor.innerHTML) {
    editor.innerHTML = clean;
    if (preserved) {
      const kept = rangeFromOffsets(editor, preserved);
      state.savedRange = kept.cloneRange();
      if (liveRange) installSelectionRange(editor, kept);
    }
  }

  const current = selectionRangeInside(editor);
  if (current) state.savedRange = current.cloneRange();
  return {
    display: clean,
    stored: toStoredTokens(clean, customSymbols)
  };
}

export function formatActionTextEditor(
  editor: HTMLElement,
  state: ActionTextEditorState,
  command: 'bold' | 'italic',
  customSymbols: readonly CustomSymbol[],
  options: ActionTextEditorOptions
): ActionTextEditorValue | null {
  restoreActionTextSelection(editor, state);
  document.execCommand(command, false);
  return syncActionTextEditor(editor, state, customSymbols, options);
}

export function insertActionTextEditorText(
  editor: HTMLElement,
  state: ActionTextEditorState,
  text: string,
  customSymbols: readonly CustomSymbol[],
  options: ActionTextEditorOptions
): ActionTextEditorValue | null {
  restoreActionTextSelection(editor, state, true);
  const lines = options.singleLine ? [text] : text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (index > 0) document.execCommand('insertLineBreak', false);
    if (line) document.execCommand('insertText', false, line);
  });
  return syncActionTextEditor(editor, state, customSymbols, options);
}

export function insertActionTextEditorLineBreak(
  editor: HTMLElement,
  state: ActionTextEditorState,
  customSymbols: readonly CustomSymbol[],
  options: ActionTextEditorOptions
): ActionTextEditorValue | null {
  restoreActionTextSelection(editor, state, true);
  document.execCommand('insertLineBreak', false);
  return syncActionTextEditor(editor, state, customSymbols, options);
}
