<script lang="ts">
  /**
   * A one-line text field with the symbol palette above it — `AbilityField`'s
   * single-line sibling, for the card title.
   *
   * Not `Field` + `TextInput` with the palette added, which was the first
   * shape tried: `Field` wraps its contents in a `<label>`, and a `<label>`
   * may contain only one labelable descendant. Six palette buttons inside one
   * are five too many — clicks resolve against the label rather than the
   * button they landed on. `AbilityField` already solved this by labelling its
   * control with `aria-label` under a plain `<span>` heading instead, so this
   * borrows that structure wholesale, down to the class names, and reads
   * identically to the `Field`s beside it.
   */
  import { untrack } from 'svelte';
  import type { CustomSymbol } from '$lib/symbols/types';
  import { insertToken, toDisplayTokens, toStoredTokens } from '$lib/text/tokens';
  import SymbolPalette from './SymbolPalette.svelte';

  interface Props {
    label: string;
    value: string;
    placeholder?: string;
    /** Renders larger, matching `TextInput`'s own primary-field treatment. */
    prominent?: boolean;
    onchange: (value: string) => void;
    customSymbols?: CustomSymbol[];
  }

  let {
    label,
    value = '',
    placeholder,
    prominent = false,
    onchange,
    customSymbols = []
  }: Props = $props();

  let field = $state<HTMLInputElement | null>(null);

  /**
   * The DOM value: the title with every custom symbol shown by name rather
   * than by id. `AbilityField` carries the same pair and the same reasoning —
   * the document keeps the id form, this is only what the author reads and
   * types, and `emit` converts back on the way out.
   */
  // `untrack`: this seeds the field once and the effect below owns every
  // sync after it, the same deliberate one-time read `PreviewPanel` marks
  // the same way for its zoom.
  let display = $state(untrack(() => toDisplayTokens(value, customSymbols)));

  /*
   * Re-render only when `display` has stopped being a *view* of `value`.
   *
   * The test is the round trip, not "did `value` change since I wrote it".
   * That was the first version and it missed a rename: renaming a symbol
   * leaves the stored text untouched, so the field went on showing the old
   * name forever. Converting `display` back and comparing catches both cases
   * from one rule — mid-edit the round trip matches by construction (`emit`
   * sets `value` to exactly it) so the caret is left alone, while a card
   * switch, an undo, or a rename all fail it and redraw.
   *
   * `display` is read untracked: it is written just below, and tracking it
   * here would make this effect its own trigger.
   */
  $effect(() => {
    const incoming = toDisplayTokens(value, customSymbols);
    untrack(() => {
      if (toStoredTokens(display, customSymbols) !== value) display = incoming;
    });
  });

  function emit(next: string): void {
    display = next;
    onchange(toStoredTokens(next, customSymbols));
  }

  /**
   * Splice the token in where the caret was.
   *
   * Reading `selectionStart` *after* the button has taken focus works because
   * a blurred input keeps its last selection — the same assumption
   * `AbilityField` has always run on. The fallback appends, which is the right
   * answer for the one case that cannot know a caret: a palette clicked before
   * the field has ever been focused.
   */
  function insert(token: string): void {
    const element = field;
    if (!element) {
      emit(display + token);
      return;
    }

    const { text, caret } = insertToken(
      display,
      element.selectionStart ?? display.length,
      element.selectionEnd ?? display.length,
      token
    );
    emit(text);

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
    <SymbolPalette oninsert={insert} {customSymbols} />
  </div>

  <!--
    `bind:value` *and* `onchange`, the same pair `AbilityField` uses: the bind
    keeps the DOM value local so typing never round-trips through the store
    mid-keystroke (which is what moves a caret to the end), and `onchange`
    is what actually writes to the document.
  -->
  <input
    bind:this={field}
    bind:value={display}
    class="input"
    class:prominent
    type="text"
    spellcheck="false"
    {placeholder}
    aria-label={label}
    oninput={(event) => emit(event.currentTarget.value)}
  />
</div>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 22px;
  }

  /* Matches `Field`'s label exactly, so this sits in a grid of them unnoticed. */
  .label {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  /* See `AbilityField`: the reveal belongs to the field, not to the palette. */
  .block:hover,
  .block:focus-within {
    --palette-opacity: 1;
  }

  /* Copied from `TextInput` rather than shared, since that component is the
     one inside a `<label>` this deliberately avoids. */
  .input {
    width: 100%;
    height: 32px;
    padding-inline: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    color: var(--text-primary);
    font-size: var(--text-sm);
    transition:
      border-color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out);
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

  .prominent {
    height: 40px;
    font-family: var(--font-display);
    font-size: var(--text-lg);
    letter-spacing: var(--tracking-tight);
  }
</style>
