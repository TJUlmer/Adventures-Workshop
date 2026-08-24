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
  import type { CustomSymbol } from '$lib/symbols/types';
  import { insertToken } from '$lib/text/tokens';
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
    value = $bindable(''),
    placeholder,
    prominent = false,
    onchange,
    customSymbols = []
  }: Props = $props();

  let field = $state<HTMLInputElement | null>(null);

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
      onchange(value + token);
      return;
    }

    const { text, caret } = insertToken(
      value,
      element.selectionStart ?? value.length,
      element.selectionEnd ?? value.length,
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
    bind:value
    class="input"
    class:prominent
    type="text"
    spellcheck="false"
    {placeholder}
    aria-label={label}
    oninput={(event) => onchange(event.currentTarget.value)}
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
