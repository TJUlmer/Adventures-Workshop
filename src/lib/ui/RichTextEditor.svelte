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

  /**
   * A plain character count from the start of `root` to `(container, offset)`
   * — `Range.toString()` already walks the DOM the same way a caret would, so
   * this is simpler than hand-rolling the walk. Used to survive `commit()`'s
   * own DOM rebuild below: node identity does not, since that rebuild throws
   * every existing node away, but a character offset means the same thing
   * before and after, because sanitising never changes the text itself.
   */
  function offsetWithin(root: Node, container: Node, offset: number): number {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(container, offset);
    return range.toString().length;
  }

  /** The inverse of `offsetWithin`: the text-node/offset pair `target` characters in. */
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
  function commit(): void {
    if (!editor) return;
    const clean = sanitizeRichText(editor.innerHTML);
    if (clean !== editor.innerHTML) {
      const selection = window.getSelection();
      const range =
        selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
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

  const SYMBOL_NAMES = Object.keys(CARD_SYMBOLS) as CardSymbolName[];

  function setBlock(tag: string): void {
    editor?.focus();
    document.execCommand('formatBlock', false, tag);
    commit();
  }

  /** The size and colour of whatever the caret is inside, for the toolbar to show. */
  let size = $state<number>(TEXT_SIZE.normal);
  let color = $state<string | null>(null);

  /** One walk up from the caret answers both, rather than one each. */
  function syncSelectionFormatting(): void {
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      size = TEXT_SIZE.normal;
      color = null;
      return;
    }

    const range = selection.getRangeAt(0);
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
    let node: Node | null =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer.childNodes[range.startOffset] ?? range.startContainer)
        : range.startContainer;
    let foundSize: number | null = null;
    let foundColor: string | null = null;
    while (node && node !== editor && (foundSize === null || foundColor === null)) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const style = (node as Element).getAttribute('style');
        if (foundSize === null) foundSize = readTextSize(style);
        if (foundColor === null) foundColor = readTextColor(style);
      }
      node = node.parentNode;
    }
    size = foundSize ?? TEXT_SIZE.normal;
    color = foundColor;
  }

  /**
   * `selectionchange` is the only event that fires for every way a caret can
   * move — keys, mouse, and the browser's own adjustments after an edit.
   */
  $effect(() => {
    if (!focused) return;
    document.addEventListener('selectionchange', syncSelectionFormatting);
    syncSelectionFormatting();
    return () => document.removeEventListener('selectionchange', syncSelectionFormatting);
  });

  function isMarkerSpan(el: Element): boolean {
    return [...el.classList].some(
      (name) => name === TEXT_SIZE_CLASS || name === TEXT_COLOR_CLASS || name.startsWith('size-')
    );
  }

  /**
   * The outermost marker-span ancestor whose content starts exactly at
   * `(node, offset)`, climbing through as many nested ancestors — marker or
   * not — as sit at that same boundary, so a marker span two levels up from
   * a `<b>` the boundary also happens to start at is still found. `null` if
   * there is no such ancestor at all, or if `(node, offset)` is not even at
   * the start of `node` itself.
   */
  function outermostMarkerAtStart(node: Node, offset: number, root: Node): Element | null {
    if (offset !== 0) return null;
    let result: Element | null = null;
    let current: Node = node;
    for (;;) {
      const parent: Node | null = current.parentNode;
      if (!parent || parent === root || parent.firstChild !== current) return result;
      if (parent instanceof Element && isMarkerSpan(parent)) result = parent;
      current = parent;
    }
  }

  /** The end-boundary counterpart of `outermostMarkerAtStart`. */
  function outermostMarkerAtEnd(node: Node, offset: number, root: Node): Element | null {
    const length = node.nodeType === Node.TEXT_NODE ? (node as Text).data.length : node.childNodes.length;
    if (offset !== length) return null;
    let result: Element | null = null;
    let current: Node = node;
    for (;;) {
      const parent: Node | null = current.parentNode;
      if (!parent || parent === root || parent.lastChild !== current) return result;
      if (parent instanceof Element && isMarkerSpan(parent)) result = parent;
      current = parent;
    }
  }

  /**
   * If `range` exactly spans one or more marker spans' full content — size,
   * colour, or a legacy size class — widen it to select those spans
   * themselves rather than just their text. Otherwise `extractContents()`
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
  function widenToMarkerAncestors(range: Range, root: Node): void {
    const startMarker = outermostMarkerAtStart(range.startContainer, range.startOffset, root);
    if (startMarker) range.setStartBefore(startMarker);
    const endMarker = outermostMarkerAtEnd(range.endContainer, range.endOffset, root);
    if (endMarker) range.setEndAfter(endMarker);
  }

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
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !editor) return;

    const next = clampTextSize(percent);
    const range = selection.getRangeAt(0);
    widenToMarkerAncestors(range, editor);
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
    selection.removeAllRanges();
    selection.addRange(kept);

    size = next;
    commit();
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
    editor?.focus();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !editor) return;

    const range = selection.getRangeAt(0);
    widenToMarkerAncestors(range, editor);
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
    selection.removeAllRanges();
    selection.addRange(kept);

    color = hex;
    commit();
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

    {#each ALIGN_TOOLS as tool (tool.command)}
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
      <input
        class="size-range"
        type="range"
        min={TEXT_SIZE.min}
        max={TEXT_SIZE.max}
        step={TEXT_SIZE.step}
        value={size}
        aria-label="Text size, per cent"
        style:--fill="{(((size - TEXT_SIZE.min) / (TEXT_SIZE.max - TEXT_SIZE.min)) * 100).toFixed(2)}%"
        onmousedown={(event) => event.stopPropagation()}
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
        onmousedown={(event) => event.stopPropagation()}
        onchange={(event) => applySize(event.currentTarget.valueAsNumber || TEXT_SIZE.normal)}
      />
      <span class="size-unit">%</span>

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

    <!--
      Wraps the selection in its own colour, independent of `theme.bodyInk` —
      see `applyColor`. The swatch shows the selection's own colour, or a
      hollow ring when nothing here overrides the field's default.
    -->
    <div class="color-tool" title="Text colour — applies to the selection">
      <label class="swatch" class:empty={color === null} style:--swatch={color ?? 'transparent'}>
        <input
          type="color"
          value={color ?? '#000000'}
          aria-label="Text colour"
          onmousedown={(event) => event.stopPropagation()}
          oninput={(event) => applyColor(event.currentTarget.value)}
        />
      </label>

      {#if color !== null}
        <button
          type="button"
          class="tool text"
          title="Back to the card’s own colour"
          onmousedown={(event) => event.preventDefault()}
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
    align-items: center;
    gap: 2px;
  }

  .swatch {
    position: relative;
    width: 18px;
    height: 18px;
    flex: none;
    border-radius: var(--radius-xs);
    background: var(--swatch);
    box-shadow: inset 0 0 0 1px hsl(0 0% 100% / 0.18);
    cursor: pointer;
    overflow: hidden;
  }

  /* No override yet: a hollow ring rather than a colour, so an empty swatch
     never reads as "black". */
  .swatch.empty {
    background: none;
    box-shadow: inset 0 0 0 1.5px var(--text-muted);
  }

  .swatch input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
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
