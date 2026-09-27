<script lang="ts">
  /**
   * Small rich text field for rules copy.
   *
   * `contenteditable` with a fixed toolbar. Everything that lands in the field —
   * typed, pasted or dropped — goes through the allowlist sanitiser before it
   * reaches the document.
   */
	import {
		INSERTABLE_TEXT_SYMBOL_NAMES,
		TEXT_SYMBOL_LABELS,
		TEXT_SYMBOLS
	} from '$lib/renderer/assets';
	import type { InsertableTextSymbolName } from '$lib/renderer/assets';
  import type { CustomSymbol } from '$lib/symbols/types';
  import { customSymbolLabel } from '$lib/symbols/types';
  import {
    clampTextSize,
    escapeHtml,
    readTextColor,
    readTextSize,
    sanitizeRichText,
    TEXT_COLOR_CLASS,
    TEXT_SIZE,
    TEXT_SIZE_CLASS,
    textColorStyle,
    textSizeStyle
  } from '$lib/text/rich-text';
  import Icon from './Icon.svelte';
  import {
    installSelectionRange,
    rangeAtEnd,
    rangeFromOffsets,
    rangeInside,
    selectionOffsets,
    selectionRangeInside
  } from './contenteditable-selection';

  interface Props {
    value: string;
    placeholder?: string;
    minHeight?: number;
    onchange: (html: string) => void;
    /** Author-uploaded glyphs, offered alongside the built-in symbols. */
    customSymbols?: CustomSymbol[];
  }

  let {
    value,
    placeholder = 'Write the rules…',
    minHeight = 140,
    onchange,
    customSymbols = []
  }: Props = $props();

  let editor = $state<HTMLDivElement | null>(null);
  let focused = $state(false);
  let composing = false;
  let savedRange: Range | null = null;

  /**
   * Only write back into the DOM when the incoming value is not what the field
   * already holds — otherwise every keystroke would reset the caret.
   */
  $effect(() => {
    const html = value;
    if (editor && editor.innerHTML !== html) {
      editor.innerHTML = html;
      savedRange = null;
      resetSelectionFormatting();
    }
  });

  const isEmpty = $derived(value.trim().length === 0);

  function rememberedRange(): Range | null {
    if (!editor || !savedRange || !rangeInside(editor, savedRange)) {
      savedRange = null;
      return null;
    }
    return savedRange.cloneRange();
  }

  function editorSelectionRange(fallbackToEnd = false): Range | null {
    if (!editor) return null;
    const live = selectionRangeInside(editor);
    return (
      (document.activeElement === editor ? live : null) ??
      rememberedRange() ??
      live ??
      (fallbackToEnd ? rangeAtEnd(editor) : null)
    );
  }

  function detachLiveSelectionFromToolbar(): void {
    if (!editor || document.activeElement === editor || !selectionRangeInside(editor)) return;
    window.getSelection()?.removeAllRanges();
  }

  /**
   * Toolbar focus is allowed to move naturally on touch. The cloned editor
   * range is installed afterwards, before the command runs, so mobile Safari
   * cannot redirect formatting to whichever caret it kept after closing the
   * keyboard. Native range/colour inputs can ask not to reclaim focus.
   */
  function restoreEditorSelection(focusEditor = true, fallbackToEnd = false): Range | null {
    if (!editor) return null;
    let range = editorSelectionRange();
    if (focusEditor) editor.focus({ preventScroll: true });
    range ??= selectionRangeInside(editor);
    range ??= fallbackToEnd ? rangeAtEnd(editor) : null;
    if (!range) return null;
    const installed = installSelectionRange(editor, range);
    savedRange = installed?.cloneRange() ?? null;
    return installed;
  }

  /**
   * Rebuilding `editor.innerHTML` (below) throws away every node the current
   * `Selection` points into, which collapses it — so a caret sitting in the
   * text a toolbar action just touched silently jumps back to nowhere, and a
   * "reset to normal" that leaves nothing to say (`applySize`/`applyColor`
   * below, back at the field's own size or colour) unwraps its own marker
   * span, which makes *that* rebuild fire on every such reset. Wrapping the
   * rebuild in a capture/restore by character offset — rather than trying to
   * keep the specific node alive — is what survives it regardless of what
   * triggered it, including a browser-injected span (spellcheck, an
   * extension) this sanitiser was always going to strip anyway.
   */
  function commit(preferredRange: Range | null = null, restoreLiveSelection = true): void {
    if (!editor || composing) return;
    const liveRange = selectionRangeInside(editor);
    const preferred =
      preferredRange && rangeInside(editor, preferredRange) ? preferredRange.cloneRange() : null;
    const range = preferred ?? liveRange ?? rememberedRange();
    const preserved = range ? selectionOffsets(editor, range) : null;
    const clean = sanitizeRichText(editor.innerHTML);
    if (clean !== editor.innerHTML) {
      editor.innerHTML = clean;
      if (preserved) {
        const kept = rangeFromOffsets(editor, preserved);
        savedRange = kept.cloneRange();
        if (restoreLiveSelection && liveRange) installSelectionRange(editor, kept);
      }
    } else if (preferred) {
      savedRange = preferred.cloneRange();
    }
    const current = restoreLiveSelection ? selectionRangeInside(editor) : null;
    if (current) savedRange = current.cloneRange();
    const formattingRange = current ?? rememberedRange();
    if (formattingRange) syncSelectionFormatting(formattingRange);
    onchange(clean);
  }

  function exec(command: string): void {
    restoreEditorSelection(true);
    document.execCommand(command, false);
    commit();
  }

  function onPaste(event: ClipboardEvent): void {
    // Paste as plain text: card copy never wants a website's markup.
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text);
    commit();
  }

  const TOOLS = [
    { command: 'bold', icon: 'bold', label: 'Bold' },
    { command: 'italic', icon: 'italic', label: 'Italic' },
    { command: 'underline', icon: 'underline', label: 'Underline' },
    { command: 'insertUnorderedList', icon: 'list', label: 'Bulleted list' },
    { command: 'insertOrderedList', icon: 'listOrdered', label: 'Numbered list' }
  ] as const;

  /**
   * `execCommand`'s own justify commands: they set `text-align` on whichever
   * block ancestor the selection sits in (wrapping it in a `div` first if
   * there is none yet), which is exactly the declaration `readTextAlign`
   * allows through the sanitiser — no bespoke apply function needed here,
   * unlike size and colour, which the sanitiser has no native command for.
   */
  const ALIGN_TOOLS = [
    { command: 'justifyLeft', icon: 'alignLeft', label: 'Align left' },
    { command: 'justifyCenter', icon: 'alignCenter', label: 'Align center' },
    { command: 'justifyRight', icon: 'alignRight', label: 'Align right' }
  ] as const;

  const BLOCKS = [
    { tag: 'h3', label: 'Header' },
    { tag: 'h4', label: 'Subheader' },
    { tag: 'p', label: 'Body' }
  ] as const;

  const SYMBOL_NAMES = INSERTABLE_TEXT_SYMBOL_NAMES;

  function setBlock(tag: string): void {
    restoreEditorSelection(true);
    document.execCommand('formatBlock', false, tag);
    commit();
  }

  /** The size and colour of whatever the caret is inside, for the toolbar to show. */
  let size = $state<number>(TEXT_SIZE.normal);
  let color = $state<string | null>(null);
  let hasTextSelection = $state(false);

  function resetSelectionFormatting(): void {
    size = TEXT_SIZE.normal;
    color = null;
    hasTextSelection = false;
  }

  /** One walk up from the caret answers both, rather than one each. */
  function syncSelectionFormatting(range: Range): void {
    if (!editor || !rangeInside(editor, range)) {
      resetSelectionFormatting();
      return;
    }

    hasTextSelection = !range.collapsed;
    /*
     * A text-node caret's `startContainer` already *is* the node to read from,
     * but `applySize`/`applyColor` select the wrapping span with `selectNode`
     * (not `selectNodeContents`) — see the comment there — which makes
     * `startContainer` the span's *parent* with `startOffset` pointing at the
     * span among its siblings. Starting the walk from `startContainer` in
     * that case would step over the span entirely and read whatever it
     * happens to sit inside instead, showing the toolbar's own last action as
     * if it had not applied. Index in only when `startContainer` is an
     * element and really does have a child there.
     */
    const indexedChild =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer.childNodes[range.startOffset] ?? null)
        : null;
    let node: Node | null = indexedChild ?? range.startContainer;
    let foundSize: number | null = null;
    let foundColor: string | null = null;

    const readFormatting = (candidate: Node): void => {
      if (candidate.nodeType !== Node.ELEMENT_NODE) return;
      const style = (candidate as Element).getAttribute('style');
      if (foundSize === null) foundSize = readTextSize(style);
      if (foundColor === null) foundColor = readTextColor(style);
    };

    // `selectNode()` puts the range around a wrapper. Read down its first
    // content branch as well as up through its ancestors so a coloured span
    // wrapped around a sized run reports both values on the next adjustment.
    if (indexedChild) {
      const branch: Node[] = [];
      for (let current: Node | null = indexedChild; current; current = current.firstChild) {
        branch.push(current);
      }
      for (const current of branch.reverse()) readFormatting(current);
      node = indexedChild.parentNode;
    }

    while (node && node !== editor && (foundSize === null || foundColor === null)) {
      readFormatting(node);
      node = node.parentNode;
    }
    size = foundSize ?? TEXT_SIZE.normal;
    color = foundColor;
  }

  /**
   * `selectionchange` is the only event that fires for every way a caret can
   * move — keys, touch handles, mouse, and browser adjustments after an edit.
   * A range outside this editor is deliberately ignored: tapping a toolbar
   * control must not discard the last intentional editor selection.
   */
  $effect(() => {
    const captureSelection = (): void => {
      if (!editor) return;
      const range = selectionRangeInside(editor);
      if (!range || document.activeElement !== editor) return;
      savedRange = range.cloneRange();
      syncSelectionFormatting(range);
    };
    document.addEventListener('selectionchange', captureSelection);
    return () => document.removeEventListener('selectionchange', captureSelection);
  });

  function preserveSelectionForPointer(event: PointerEvent): void {
    // Mouse users expect toolbar clicks not to move focus. Touch and pen keep
    // their native defaults so horizontal scrolling and selection handles work.
    if (event.pointerType === 'mouse' && event.button === 0) event.preventDefault();
  }

  function isMarkerSpan(el: Element): boolean {
    return [...el.classList].some(
      (name) => name === TEXT_SIZE_CLASS || name === TEXT_COLOR_CLASS || name.startsWith('size-')
    );
  }

  function isInlineFormattingWrapper(el: Element): boolean {
    return isMarkerSpan(el) || ['B', 'STRONG', 'I', 'EM', 'U', 'S'].includes(el.tagName);
  }

  /**
   * Find the outermost inline-formatting ancestor that starts at this exact
   * boundary. Preserving the whole wrapper matters when another format is
   * layered over it; extracting only its text would strand an empty shell.
   */
  function outermostFormattingAtStart(node: Node, offset: number, root: Node): Element | null {
    const indexedChild =
      node.nodeType === Node.ELEMENT_NODE ? (node.childNodes[offset] ?? null) : null;
    if (!indexedChild && offset !== 0) return null;
    let current: Node = indexedChild ?? node;
    let result: Element | null =
      current instanceof Element && isInlineFormattingWrapper(current) ? current : null;
    for (;;) {
      const parent: Node | null = current.parentNode;
      if (!parent || parent === root || parent.firstChild !== current) return result;
      if (parent instanceof Element && isInlineFormattingWrapper(parent)) result = parent;
      current = parent;
    }
  }

  /** The end-boundary counterpart of `outermostFormattingAtStart`. */
  function outermostFormattingAtEnd(node: Node, offset: number, root: Node): Element | null {
    const length = node.nodeType === Node.TEXT_NODE ? (node as Text).data.length : node.childNodes.length;
    const indexedChild =
      node.nodeType === Node.ELEMENT_NODE && offset > 0 ? (node.childNodes[offset - 1] ?? null) : null;
    if (!indexedChild && offset !== length) return null;
    let current: Node = indexedChild ?? node;
    let result: Element | null =
      current instanceof Element && isInlineFormattingWrapper(current) ? current : null;
    for (;;) {
      const parent: Node | null = current.parentNode;
      if (!parent || parent === root || parent.lastChild !== current) return result;
      if (parent instanceof Element && isInlineFormattingWrapper(parent)) result = parent;
      current = parent;
    }
  }

  /**
   * If `range` exactly spans one or more inline formatting wrappers, widen it
   * to select those wrappers themselves rather than just their text. Otherwise `extractContents()`
   * below takes only the text and leaves an empty wrapper shell behind in
   * the live DOM: neither the strip loop after it (which only inspects what
   * actually got extracted) nor the sanitiser (which only unwraps a span
   * that is itself empty, not one that still wraps other content) ever
   * cleans that up, so a size change quietly drops the very colour it was
   * layered over, and a second size change on the same run nests a new span
   * inside the stale one instead of replacing it — which is also what left a
   * reset to normal with the old size still in effect, on an outer span the
   * new, now-unwrapped run had moved out from under.
   */
  function widenToFormattingAncestors(range: Range, root: Node): void {
    const startWrapper = outermostFormattingAtStart(range.startContainer, range.startOffset, root);
    if (startWrapper) range.setStartBefore(startWrapper);
    const endWrapper = outermostFormattingAtEnd(range.endContainer, range.endOffset, root);
    if (endWrapper) range.setEndAfter(endWrapper);
  }

  /**
   * Size is applied as a wrapping span rather than through
   * `execCommand('fontSize')`, which emits `<font>` tags the sanitiser strips.
   *
   * The old size, if the selection carried one, is removed rather than layered
   * over: setting a size means the selection *is* that size.
   */
  function applySize(percent: number): void {
    if (!editor) return;
    const range = editorSelectionRange();
    if (!range || range.collapsed) return;
    detachLiveSelectionFromToolbar();

    const next = clampTextSize(percent);
    widenToFormattingAncestors(range, editor);
    const fragment = range.extractContents();

    for (const element of fragment.querySelectorAll(`.${TEXT_SIZE_CLASS}, [class*="size-"]`)) {
      element.removeAttribute('style');
      element.classList.remove(TEXT_SIZE_CLASS, 'size-sm', 'size-lg', 'size-xl');
      if (element.classList.length === 0) element.removeAttribute('class');
    }

    // At the default there is nothing to say, so nothing is wrapped: the
    // sanitiser unwraps a span carrying neither a size nor a class.
    const holder = document.createElement('span');
    holder.append(fragment);
    if (next !== TEXT_SIZE.normal) {
      holder.className = TEXT_SIZE_CLASS;
      holder.setAttribute('style', textSizeStyle(next));
    }
    range.insertNode(holder);

    // Keep the *span* selected, not merely its contents — set before
    // `commit()`, whose own offset-based preserve/restore is what carries
    // this through the sanitiser unwrapping `holder` right back out again on
    // a reset to normal (see `commit`). Selecting only the contents was tried
    // first and is the wrong node: the size can still be nudged again
    // without reselecting either way, but a range that starts and ends
    // *inside* `holder` extracts only its text on the next call, leaving
    // this now-empty wrapper behind in the live DOM rather than in the
    // extracted fragment the strip loop above actually inspects — so a
    // second size on the same run nested a new span inside the old one
    // instead of replacing it, and a reset to normal left the stale
    // `--size` on the untouched outer span.
    const kept = document.createRange();
    kept.selectNode(holder);
    savedRange = kept.cloneRange();

    size = next;
    commit(kept, false);
  }

  /**
   * Colour as a wrapping span, exactly as size is — see `applySize`. This is
   * what keeps a coloured run independent of the field's own `theme.bodyInk`:
   * that colour is the *default* for text nobody has touched, painted by the
   * face reading `theme.bodyInk` where no such span wraps a run, so changing
   * it in Design never repaints a run an author already coloured here.
   *
   * `hex === null` clears the override rather than setting one — the same
   * "back to normal" shape `applySize(TEXT_SIZE.normal)` uses.
   */
  function applyColor(hex: string | null): void {
    if (!editor) return;
    const range = editorSelectionRange();
    if (!range || range.collapsed) return;
    detachLiveSelectionFromToolbar();

    widenToFormattingAncestors(range, editor);
    const fragment = range.extractContents();

    for (const element of fragment.querySelectorAll(`.${TEXT_COLOR_CLASS}`)) {
      element.removeAttribute('style');
      element.classList.remove(TEXT_COLOR_CLASS);
      if (element.classList.length === 0) element.removeAttribute('class');
    }

    const holder = document.createElement('span');
    holder.append(fragment);
    if (hex !== null) {
      holder.className = TEXT_COLOR_CLASS;
      holder.setAttribute('style', textColorStyle(hex));
    }
    range.insertNode(holder);

    // Select the span itself, not its contents — see the matching comment in
    // `applySize` for why that distinction is load-bearing here.
    const kept = document.createRange();
    kept.selectNode(holder);
    savedRange = kept.cloneRange();

    color = hex;
    commit(kept, false);
  }

	function insertSymbol(name: InsertableTextSymbolName): void {
    restoreEditorSelection(true, true);
    document.execCommand(
      'insertHTML',
      false,
      `<img class="symbol" src="${TEXT_SYMBOLS[name]}" alt="${TEXT_SYMBOL_LABELS[name]}" />`
    );
    commit();
  }

  /**
   * Addressed by id (`data-symbol-id`), not baked in by picture — see
   * `resolveCustomSymbolImages` in `rich-text.ts`. `src` here is only what the
   * symbol looks like *right now*; it is what makes the field show something
   * sensible before the next render re-resolves it, not the source of truth.
   */
  function insertCustomSymbol(symbol: CustomSymbol): void {
    if (!symbol.source) return;
    restoreEditorSelection(true, true);
    const label = customSymbolLabel(symbol);
    document.execCommand(
      'insertHTML',
      false,
      `<img class="symbol" data-symbol-id="${escapeHtml(symbol.id)}" src="${symbol.source}" alt="${escapeHtml(label)}" />`
    );
    commit();
  }
</script>

<div class="rich" class:focused>
  <div class="toolbar">
    {#each TOOLS as tool (tool.command)}
      <button
        type="button"
        class="tool"
        title={tool.label}
        aria-label={tool.label}
        onpointerdown={preserveSelectionForPointer}
        onclick={() => exec(tool.command)}
      >
        <Icon name={tool.icon} size={13} />
      </button>
    {/each}

    <span class="divider"></span>

    {#each ALIGN_TOOLS as tool (tool.command)}
      <button
        type="button"
        class="tool"
        title={tool.label}
        aria-label={tool.label}
        onpointerdown={preserveSelectionForPointer}
        onclick={() => exec(tool.command)}
      >
        <Icon name={tool.icon} size={13} />
      </button>
    {/each}

    <span class="divider"></span>

    {#each BLOCKS as block (block.tag)}
      <button
        type="button"
        class="tool text"
        title="{block.label} paragraph"
        onpointerdown={preserveSelectionForPointer}
        onclick={() => setBlock(block.tag)}
      >
        {block.label}
      </button>
    {/each}

    <span class="divider"></span>

    <!--
      Any size, not a short list of them. The value is a percentage of the
      card's body copy, so what is typed here means the same thing on a
      thumbnail as it does at print size.
    -->
    <div class="size" title="Text size — applies to the selection">
      <input
        class="size-range"
        type="range"
        min={TEXT_SIZE.min}
        max={TEXT_SIZE.max}
        step={TEXT_SIZE.step}
        value={size}
        aria-label="Text size, per cent"
        disabled={!hasTextSelection}
        style:--fill="{(((size - TEXT_SIZE.min) / (TEXT_SIZE.max - TEXT_SIZE.min)) * 100).toFixed(2)}%"
        oninput={(event) => applySize(event.currentTarget.valueAsNumber)}
      />

      <input
        class="size-value numeric"
        type="number"
        min={TEXT_SIZE.min}
        max={TEXT_SIZE.max}
        step={TEXT_SIZE.step}
        value={size}
        aria-label="Text size, per cent"
        disabled={!hasTextSelection}
        onchange={(event) => applySize(event.currentTarget.valueAsNumber || TEXT_SIZE.normal)}
      />
      <span class="size-unit">%</span>

      <button
        type="button"
        class="tool text"
        title="Back to the card’s own size"
        disabled={!hasTextSelection}
        onpointerdown={preserveSelectionForPointer}
        onclick={() => applySize(TEXT_SIZE.normal)}
      >
        Reset
      </button>

      {#if !hasTextSelection}
        <span class="selection-hint">Select text to resize</span>
      {/if}
    </div>

    <span class="divider"></span>

    <!--
      Wraps the selection in its own colour, independent of `theme.bodyInk` —
      see `applyColor`. The swatch shows the selection's own colour, or a
      hollow ring when nothing here overrides the field's default.
    -->
    <div class="color-tool" title="Text colour — applies to the selection">
      <label
        class="swatch"
        class:empty={color === null}
        class:disabled={!hasTextSelection}
        style:--swatch={color ?? 'transparent'}
      >
        <input
          type="color"
          value={color ?? '#000000'}
          aria-label="Text colour"
          disabled={!hasTextSelection}
          oninput={(event) => applyColor(event.currentTarget.value)}
        />
        <span class="swatch-face" aria-hidden="true"></span>
      </label>

      {#if color !== null}
        <button
          type="button"
          class="tool text"
          title="Back to the card’s own colour"
          disabled={!hasTextSelection}
          onpointerdown={preserveSelectionForPointer}
          onclick={() => applyColor(null)}
        >
          Reset
        </button>
      {/if}
    </div>

    <span class="divider"></span>

    {#each SYMBOL_NAMES as name (name)}
      <button
        type="button"
        class="tool symbol-tool"
        title="Insert {TEXT_SYMBOL_LABELS[name]} symbol"
        aria-label="Insert {TEXT_SYMBOL_LABELS[name]} symbol"
        onpointerdown={preserveSelectionForPointer}
        onclick={() => insertSymbol(name)}
      >
        <img
          class:bonus-attack-symbol={name === 'bonus_attack'}
          src={TEXT_SYMBOLS[name]}
          alt={TEXT_SYMBOL_LABELS[name]}
        />
      </button>
    {/each}

    {#each customSymbols.filter((s) => s.source) as symbol (symbol.id)}
      <button
        type="button"
        class="tool symbol-tool"
        title="Insert {customSymbolLabel(symbol)} symbol"
        aria-label="Insert {customSymbolLabel(symbol)} symbol"
        onpointerdown={preserveSelectionForPointer}
        onclick={() => insertCustomSymbol(symbol)}
      >
        <img src={symbol.source} alt={customSymbolLabel(symbol)} />
      </button>
    {/each}
  </div>

  <div class="field" style:min-height="{minHeight}px">
    {#if isEmpty && !focused}
      <span class="placeholder">{placeholder}</span>
    {/if}
    <div
      bind:this={editor}
      class="editable"
      contenteditable="true"
      role="textbox"
      tabindex="0"
      aria-multiline="true"
      aria-label="Rules body"
      onfocus={() => (focused = true)}
      onblur={() => {
        focused = false;
        commit();
      }}
      oncompositionstart={() => (composing = true)}
      oncompositionend={() => {
        composing = false;
        commit();
      }}
      oninput={() => {
        if (!composing) commit();
      }}
      onpaste={onPaste}
    ></div>
  </div>
</div>

<style>
  .rich {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    overflow: hidden;
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .rich:hover {
    border-color: var(--border-strong);
  }

  .focused {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .toolbar {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 2px;
    padding: var(--space-1);
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-inline: contain;
    scrollbar-width: thin;
    -webkit-overflow-scrolling: touch;
    border-bottom: 1px solid var(--border-subtle);
  }

  .divider {
    flex: none;
    width: 1px;
    height: 16px;
    margin-inline: var(--space-1);
    background: var(--border-default);
  }

  .tool.text {
    width: auto;
    padding-inline: var(--space-2);
    font-size: var(--text-2xs);
  }

  .symbol-tool img {
    width: 14px;
    height: 14px;
    object-fit: contain;
  }

  .symbol-tool img.bonus-attack-symbol {
    width: 12px;
    height: 12px;
  }

  .tool {
    display: grid;
    place-items: center;
    flex: none;
    width: 24px;
    height: 22px;
    border-radius: var(--radius-xs);
    color: var(--text-muted);
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .tool:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .tool:active:not(:disabled) {
    background: var(--surface-active);
    color: var(--text-primary);
  }

  .field {
    position: relative;
    padding: var(--space-3);
  }

  .placeholder {
    position: absolute;
    top: var(--space-3);
    left: var(--space-3);
    font-size: var(--text-sm);
    color: var(--text-muted);
    pointer-events: none;
  }

  .size {
    display: flex;
    flex: none;
    align-items: center;
    gap: 1px;
  }

  .size-value {
    width: 40px;
    height: 22px;
    padding-inline: var(--space-1);
    border-radius: var(--radius-xs);
    background: transparent;
    border: 1px solid transparent;
    font-size: var(--text-2xs);
    color: var(--text-secondary);
    text-align: right;
    -moz-appearance: textfield;
    appearance: textfield;
  }

  .size-value::-webkit-inner-spin-button,
  .size-value::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .size-value:hover {
    border-color: var(--border-default);
  }

  .size-value:focus {
    outline: none;
    border-color: var(--accent);
  }

  .size-unit {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .selection-hint {
    margin-inline-start: var(--space-1);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .size :is(.size-range, .size-value, .tool):disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* Compact enough to sit inline in the toolbar row — see Slider.svelte for
     the same track/thumb treatment at its own, larger scale. */
  .size-range {
    -webkit-appearance: none;
    appearance: none;
    width: 64px;
    height: 22px;
    background: transparent;
    cursor: pointer;
  }

  .size-range::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: var(--radius-full);
    background: linear-gradient(
      90deg,
      var(--accent) 0 var(--fill),
      var(--grey-750) var(--fill) 100%
    );
  }

  .size-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 11px;
    height: 11px;
    margin-top: -4px;
    border-radius: 50%;
    background: var(--grey-100);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.5);
  }

  .size-range::-moz-range-track {
    height: 3px;
    border-radius: var(--radius-full);
    background: var(--grey-750);
  }

  .size-range::-moz-range-progress {
    height: 3px;
    border-radius: var(--radius-full);
    background: var(--accent);
  }

  .size-range::-moz-range-thumb {
    width: 11px;
    height: 11px;
    border: none;
    border-radius: 50%;
    background: var(--grey-100);
  }

  .color-tool {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
  }

  .swatch {
    position: relative;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    flex: none;
    cursor: pointer;
  }

  /* No override yet: a hollow ring rather than a colour, so an empty swatch
     never reads as "black". */
  .swatch.empty .swatch-face {
    background: none;
    box-shadow: inset 0 0 0 1.5px var(--text-muted);
  }

  .swatch input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  .swatch-face {
    width: 18px;
    height: 18px;
    border-radius: var(--radius-xs);
    background: var(--swatch);
    box-shadow: inset 0 0 0 1px hsl(0 0% 100% / 0.18);
    pointer-events: none;
    transition:
      box-shadow var(--duration-fast) var(--ease-out),
      transform var(--duration-instant) var(--ease-out);
  }

  .swatch:focus-within .swatch-face {
    box-shadow:
      inset 0 0 0 1px hsl(0 0% 100% / 0.18),
      0 0 0 3px var(--accent-soft);
  }

  .swatch.empty:focus-within .swatch-face {
    box-shadow:
      inset 0 0 0 1.5px var(--text-muted),
      0 0 0 3px var(--accent-soft);
  }

  .swatch:active .swatch-face {
    transform: scale(0.94);
  }

  .swatch.disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .swatch.disabled :is(input, .swatch-face) {
    cursor: not-allowed;
  }

  /*
   * The size a sized run is a percentage *of*. Declared once here so a run
   * inside another run resolves against the field rather than against its
   * parent — which is what stops sizes multiplying together.
   */
  .editable {
    --copy-size: var(--text-sm);
    font-size: var(--copy-size);
    line-height: var(--leading-normal);
    color: var(--text-primary);
    outline: none;
    min-height: inherit;
  }

  .editable :global(.sized) {
    font-size: calc(var(--copy-size) * var(--size, 1));
  }

  .editable :global(p) {
    margin: 0 0 0.6em;
  }

  .editable :global(ul),
  .editable :global(ol) {
    margin: 0 0 0.6em;
    padding-left: 1.4em;
  }

  .editable :global(ul) {
    list-style: disc;
  }

  .editable :global(ol) {
    list-style: decimal;
  }

  .editable :global(h3) {
    margin: 0 0 0.3em;
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
  }

  .editable :global(h4) {
    margin: 0 0 0.3em;
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    color: var(--text-secondary);
  }

  /* Sizes the editor used to write. Still rendered so old cards look right. */
  .editable :global(.size-sm) {
    font-size: 0.82em;
  }

  .editable :global(.size-lg) {
    font-size: 1.25em;
  }

  .editable :global(.size-xl) {
    font-size: 1.6em;
  }

  .editable :global(img.symbol) {
    display: inline-block;
    height: 1.05em;
    width: auto;
    vertical-align: -0.15em;
    margin-inline: 0.08em;
  }

  @media (any-pointer: coarse) {
    .tool,
    .swatch {
      min-width: var(--touch-target);
      min-height: var(--touch-target);
    }

    .size-range,
    .size-value {
      min-height: var(--touch-target);
    }

    .size-value {
      min-width: var(--touch-target);
    }
  }

  @media (max-width: 760px) {
    .placeholder,
    .size-value {
      font-size: var(--text-md);
    }

    .editable {
      --copy-size: var(--text-md);
    }
  }
</style>
