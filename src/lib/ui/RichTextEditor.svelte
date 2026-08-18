<script lang="ts">
  /**
   * Small rich text field for rules copy.
   *
   * `contenteditable` with a fixed toolbar. Everything that lands in the field —
   * typed, pasted or dropped — goes through the allowlist sanitiser before it
   * reaches the document.
   */
  import { CARD_SYMBOL_LABELS, CARD_SYMBOLS } from '$lib/renderer/assets';
  import type { CardSymbolName } from '$lib/renderer/assets';
  import type { CustomSymbol } from '$lib/symbols/types';
  import { customSymbolLabel } from '$lib/symbols/types';
  import {
    clampTextSize,
    escapeHtml,
    readTextSize,
    sanitizeRichText,
    TEXT_SIZE,
    TEXT_SIZE_CLASS,
    textSizeStyle
  } from '$lib/text/rich-text';
  import Icon from './Icon.svelte';

  interface Props {
    value: string;
    placeholder?: string;
    minHeight?: number;
    onchange: (html: string) => void;
    /** Author-uploaded glyphs, offered alongside the four built-in symbols. */
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

  /**
   * Only write back into the DOM when the incoming value is not what the field
   * already holds — otherwise every keystroke would reset the caret.
   */
  $effect(() => {
    const html = value;
    if (editor && editor.innerHTML !== html) editor.innerHTML = html;
  });

  const isEmpty = $derived(value.trim().length === 0);

  function commit(): void {
    if (!editor) return;
    const clean = sanitizeRichText(editor.innerHTML);
    if (clean !== editor.innerHTML) editor.innerHTML = clean;
    onchange(clean);
  }

  function exec(command: string): void {
    editor?.focus();
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

  const BLOCKS = [
    { tag: 'h3', label: 'Header' },
    { tag: 'h4', label: 'Subheader' },
    { tag: 'p', label: 'Body' }
  ] as const;

  const SYMBOL_NAMES = Object.keys(CARD_SYMBOLS) as CardSymbolName[];

  function setBlock(tag: string): void {
    editor?.focus();
    document.execCommand('formatBlock', false, tag);
    commit();
  }

  /** The size of whatever the caret is inside, for the toolbar to show. */
  let size = $state<number>(TEXT_SIZE.normal);

  function selectionSize(): number {
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return TEXT_SIZE.normal;

    let node: Node | null = selection.getRangeAt(0).startContainer;
    while (node && node !== editor) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const found = readTextSize((node as Element).getAttribute('style'));
        if (found !== null) return found;
      }
      node = node.parentNode;
    }
    return TEXT_SIZE.normal;
  }

  /**
   * `selectionchange` is the only event that fires for every way a caret can
   * move — keys, mouse, and the browser's own adjustments after an edit.
   */
  $effect(() => {
    if (!focused) return;
    const sync = () => (size = selectionSize());
    document.addEventListener('selectionchange', sync);
    sync();
    return () => document.removeEventListener('selectionchange', sync);
  });

  /**
   * Size is applied as a wrapping span rather than through
   * `execCommand('fontSize')`, which emits `<font>` tags the sanitiser strips.
   *
   * The old size, if the selection carried one, is removed rather than layered
   * over: setting a size means the selection *is* that size.
   */
  function applySize(percent: number): void {
    editor?.focus();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

    const next = clampTextSize(percent);
    const range = selection.getRangeAt(0);
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

    size = next;
    commit();

    // Keep the run selected so the size can be nudged again without reselecting.
    if (holder.isConnected) {
      const kept = document.createRange();
      kept.selectNodeContents(holder);
      selection.removeAllRanges();
      selection.addRange(kept);
    }
  }

  function insertSymbol(name: CardSymbolName): void {
    editor?.focus();
    document.execCommand(
      'insertHTML',
      false,
      `<img class="symbol" src="${CARD_SYMBOLS[name]}" alt="${CARD_SYMBOL_LABELS[name]}" />`
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
    editor?.focus();
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
        onmousedown={(event) => event.preventDefault()}
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
        onmousedown={(event) => event.preventDefault()}
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
      <button
        type="button"
        class="tool"
        aria-label="Smaller"
        onmousedown={(event) => event.preventDefault()}
        onclick={() => applySize(size - TEXT_SIZE.step)}
      >
        <Icon name="minus" size={13} />
      </button>

      <input
        class="size-value numeric"
        type="number"
        min={TEXT_SIZE.min}
        max={TEXT_SIZE.max}
        step={TEXT_SIZE.step}
        value={size}
        aria-label="Text size, per cent"
        onmousedown={(event) => event.stopPropagation()}
        onchange={(event) => applySize(event.currentTarget.valueAsNumber || TEXT_SIZE.normal)}
      />
      <span class="size-unit">%</span>

      <button
        type="button"
        class="tool"
        aria-label="Larger"
        onmousedown={(event) => event.preventDefault()}
        onclick={() => applySize(size + TEXT_SIZE.step)}
      >
        <Icon name="plus" size={13} />
      </button>

      <button
        type="button"
        class="tool text"
        title="Back to the card’s own size"
        onmousedown={(event) => event.preventDefault()}
        onclick={() => applySize(TEXT_SIZE.normal)}
      >
        Reset
      </button>
    </div>

    <span class="divider"></span>

    {#each SYMBOL_NAMES as name (name)}
      <button
        type="button"
        class="tool symbol-tool"
        title="Insert {CARD_SYMBOL_LABELS[name]} symbol"
        onmousedown={(event) => event.preventDefault()}
        onclick={() => insertSymbol(name)}
      >
        <img src={CARD_SYMBOLS[name]} alt={CARD_SYMBOL_LABELS[name]} />
      </button>
    {/each}

    {#each customSymbols.filter((s) => s.source) as symbol (symbol.id)}
      <button
        type="button"
        class="tool symbol-tool"
        title="Insert {customSymbolLabel(symbol)} symbol"
        onmousedown={(event) => event.preventDefault()}
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
      oninput={commit}
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
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    padding: var(--space-1);
    border-bottom: 1px solid var(--border-subtle);
  }

  .divider {
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

  .tool {
    display: grid;
    place-items: center;
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
</style>
