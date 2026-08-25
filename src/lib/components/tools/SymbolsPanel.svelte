<script lang="ts">
  /**
   * Custom symbols: author-uploaded glyphs, usable anywhere the four built-in
   * combat symbols are — inline in ability text, and in rules/event rich text.
   *
   * One upload point for the whole set, deliberately: every surface that
   * offers a symbol palette reads the same registry rather than asking for a
   * picture of its own, so a glyph uploaded here is immediately available on
   * every action card, rules card and character sheet.
   */
  import { CARD_SYMBOLS } from '$lib/renderer/assets';
  import { readArtworkFile } from '$lib/core/image-import';
  import type { CustomSymbol, CustomSymbolId } from '$lib/symbols/types';
  import { customSymbolLabel } from '$lib/symbols/types';
  import { workshop } from '$lib/state/workshop.svelte';
  import { namedSymbols } from '$lib/text/tokens';
  import { Button, EmptyState, Icon, TextInput } from '$lib/ui';

  const symbols = $derived(workshop.adventure.customSymbols);

  /**
   * The token an author writes for this symbol, or `null` when its name
   * cannot be one and only the palette button will do. Read from
   * `namedSymbols` rather than re-deriving the rule, so this panel and the
   * fields can never disagree about which names work.
   */
  const named = $derived(namedSymbols(symbols));

  function tokenFor(symbol: CustomSymbol): string | null {
    for (const [name, id] of named) if (id === symbol.id) return `{{${name}}}`;
    return null;
  }

  const reservedList = [...Object.keys(CARD_SYMBOLS), 'name'].map((n) => `{{${n}}}`).join(', ');

  let fileInputs: Record<string, HTMLInputElement | null> = $state({});
  let error = $state<string | null>(null);

  function add(): void {
    workshop.addCustomSymbol();
  }

  async function pickImage(
    id: CustomSymbolId,
    event: Event & { currentTarget: HTMLInputElement }
  ): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    error = null;
    try {
      // The same file-import path every "choose an image" control uses. Its
      // downscale re-encodes to lossy WebP above 400KB, which could soften a
      // crisp small icon that happens to be a large PNG — not worth a
      // bespoke path for, but worth knowing if a symbol looks blurry after
      // import.
      const source = await readArtworkFile(file);
      workshop.editCustomSymbol(id, (symbol) => {
        symbol.source = source;
        if (!symbol.name.trim()) symbol.name = file.name.replace(/\.[^.]+$/, '');
      });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not read that file.';
    }
  }

  function rename(symbol: CustomSymbol, name: string): void {
    workshop.editCustomSymbol(symbol.id, (target) => (target.name = name));
  }

  function remove(id: CustomSymbolId): void {
    workshop.removeCustomSymbol(id);
  }
</script>

<div class="page scroll-y">
  <header class="head">
    <div>
      <span class="eyebrow">Set tool</span>
      <h1 class="title">Symbols</h1>
      <p class="lede">
        Custom glyphs, usable in ability text and rich text anywhere the built-in
        combat symbols are.
      </p>
    </div>

    <Button size="sm" onclick={add}>
      <Icon name="plus" size={13} />
      Add symbol
    </Button>
  </header>

  {#if error}<p class="error">{error}</p>{/if}

  {#if symbols.length === 0}
    <EmptyState
      icon="sparkle"
      title="No custom symbols yet"
      description="Upload a transparent PNG and it becomes insertable everywhere ability text and rich text are edited."
    >
      {#snippet actions()}
        <Button variant="primary" onclick={add}>
          <Icon name="plus" size={13} />
          Add a symbol
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    <ul class="list">
      {#each symbols as symbol (symbol.id)}
        <li class="symbol">
          <input
            bind:this={fileInputs[symbol.id]}
            class="sr-only"
            type="file"
            accept="image/*"
            onchange={(event) => pickImage(symbol.id, event)}
          />

          <button
            type="button"
            class="thumb"
            class:empty={!symbol.source}
            title="Choose image"
            onclick={() => fileInputs[symbol.id]?.click()}
          >
            {#if symbol.source}
              <img src={symbol.source} alt="" />
            {:else}
              <Icon name="image" size={18} />
            {/if}
          </button>

          <div class="fields">
            <TextInput
              value={symbol.name}
              placeholder="Symbol name"
              oninput={(event) => rename(symbol, event.currentTarget.value)}
            />

            <!--
              What this symbol is written as in ability text. Shown because
              the fallback is otherwise silent: a name that cannot be a token
              — blank, spaced, punctuated, one a built-in already claims, or
              one shared with another symbol — keeps the id form, and an
              author who typed `{{two words}}` and got literal braces would
              have nothing to go on. See `namedSymbols`.
            -->
            {#if tokenFor(symbol) === null}
              <span class="token-hint muted">
                Insert-only — give it a one-word name no other symbol uses
                (and not {reservedList}) to write it as a word.
              </span>
            {:else}
              <span class="token-hint"><code>{tokenFor(symbol)}</code> in ability text</span>
            {/if}

            {#if symbol.source}
              <button
                type="button"
                class="ghost"
                onclick={() => fileInputs[symbol.id]?.click()}
              >
                <Icon name="upload" size={12} />
                Replace image
              </button>
            {:else}
              <button type="button" class="ghost wide" onclick={() => fileInputs[symbol.id]?.click()}>
                <Icon name="image" size={12} />
                Attach a transparent PNG
              </button>
            {/if}
          </div>

          <button
            type="button"
            class="ghost remove"
            title="Remove {customSymbolLabel(symbol)}"
            aria-label="Remove symbol"
            onclick={() => remove(symbol.id)}
          >
            <Icon name="trash" size={13} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .page {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-7) var(--space-8) var(--space-10);
  }

  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-5);
  }

  .eyebrow {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .title {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }

  .lede {
    font-size: var(--text-sm);
    color: var(--text-muted);
    max-width: 46ch;
  }

  .error {
    font-size: var(--text-xs);
    color: var(--danger);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 640px;
  }

  .symbol {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
  }

  .thumb {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    color: var(--text-muted);
  }

  .thumb.empty {
    border-style: dashed;
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .token-hint {
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--text-tertiary);
    text-wrap: pretty;
  }

  .token-hint.muted {
    color: var(--text-muted);
  }

  .token-hint code {
    padding: 1px var(--space-1);
    border-radius: var(--radius-xs);
    background: var(--surface-sunken);
    font-family: var(--font-mono, monospace);
    color: var(--text-secondary);
  }

  .ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    height: 22px;
    padding-inline: var(--space-2);
    border-radius: var(--radius-xs);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .ghost.wide {
    width: 100%;
  }

  .ghost:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .remove {
    height: 26px;
  }

  .remove:hover {
    color: var(--danger);
  }
</style>
