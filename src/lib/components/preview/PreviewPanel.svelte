<script lang="ts">
  /**
   * The live card. This panel is the point of the app, so it carries as little
   * chrome as it can get away with: a bleed toggle, the cut line, and zoom.
   */
  import { createCard } from '$lib/cards/factory';
  import { resolveCardTheme } from '$lib/cards/theme';
  import { CARD_TYPE_META } from '$lib/cards/types';
  import { characterLabel, primaryCardName } from '$lib/characters/factory';
  import type { HeroCharacterCard } from '$lib/characters/types';
  import { asId } from '$lib/core/id';
  import { deckLabel } from '$lib/decks/factory';
  import type { DeckId } from '$lib/decks/types';
  import { formatForCard, renderCardImage, renderPlateImage, saveExport, slugify } from '$lib/export';
  import { CardRenderer } from '$lib/renderer';
  import type { CardFormat } from '$lib/renderer/geometry';
  import { BLEED_MM, CARD_FORMATS, trimBox } from '$lib/renderer/geometry';
  import { characterEditorView } from '$lib/state/character-editor-view.svelte';
  import { findDeck } from '$lib/sets/queries';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, EmptyState, Icon } from '$lib/ui';

  let showBleed = $state(false);
  let showGuides = $state(false);
  /** Preview width as a fraction of the panel's available width. */
  let zoom = $state(1);

  /**
   * A selected character previews its deck back — that is what the character
   * workspace is for. A selected card previews the card.
   */
  const cardback = $derived(workshop.selectedCharacter);
  const card = $derived(cardback ? null : workshop.previewCard);

  /**
   * A hero's character card(s), shown above its deck back.
   *
   * Only a hero prints one — it is the sheet the figure is set up from, and
   * the one thing in the character workspace with no other preview: its stats,
   * its ability and its sidekick are all edited there and until now none of
   * them appeared anywhere until the card was exported.
   */
  const statCard = $derived(cardback?.role === 'hero' ? cardback : null);

  /**
   * Which one thing the character workspace's active tab is about, so this
   * panel shows exactly that rather than stacking every identity, the deck
   * back and the action-card-defaults sample all at once. `null` outside a
   * hero (nothing to choose between — see below), else the primary sheet, a
   * specific additional card, the deck back, or the defaults sample.
   */
  type HeroSlot =
    | { kind: 'card'; entry: HeroCharacterCard | null }
    | { kind: 'cardback' }
    | { kind: 'defaults' };

  const heroSlot = $derived.by((): HeroSlot | null => {
    if (!statCard) return null;
    const tab = characterEditorView.tab;
    if (tab === 'cardback' || tab === 'identity') return { kind: 'cardback' };
    if (tab === 'defaults') return { kind: 'defaults' };
    if (tab.startsWith('card:')) {
      const id = tab.slice(5);
      return { kind: 'card', entry: statCard.additionalCards.find((entry) => entry.id === id) ?? null };
    }
    // 'primary', 'design', and anything unrecognised all mean the primary sheet.
    return { kind: 'card', entry: null };
  });

  const owner = $derived(workshop.previewCharacter);
  const theme = $derived(workshop.previewTheme);
  const deck = $derived(card ? findDeck(workshop.adventure, card.deckId) : null);
  const meta = $derived(card ? CARD_TYPE_META[card.type] : null);

  /**
   * A stand-in action card, so the figure's style controls have something to
   * act on. It is invented here and belongs to no deck: it is never saved,
   * counted or exported — the point is only to answer "what will my cards look
   * like" without making the author create a card to find out.
   */
  const sampleCard = $derived.by(() => {
    if (!cardback) return null;
    const sample = createCard('action', asId<DeckId>('sample'));
    sample.title = 'Card title';
    sample.ability.plain = 'Ability text appears here.';
    return sample;
  });

  /** The figure's layer of the cascade, which is what its controls edit. */
  const sampleTheme = $derived(
    cardback ? resolveCardTheme(workshop.adventure.style, cardback.style, null) : undefined
  );

  /**
   * The template on screen. A selected character previews its deck back —
   * which for a hero is drawn on the action card's own bleed canvas rather
   * than the villain/minion back's trim-only one, so it is the one deck back
   * with a bleed to show. `CardRenderer` picks the same way.
   */
  const format = $derived.by((): CardFormat | null => {
    if (cardback) return cardback.role === 'hero' ? CARD_FORMATS.action : CARD_FORMATS.cardback;
    return card ? formatForCard(card) : null;
  });

  /**
   * Some templates — the deck back among them — are drawn at trim size. There
   * is no bleed to show or hide, so the toggle is turned off rather than left
   * to crop into art that was never oversized.
   */
  const hasBleed = $derived(format === null || (format.bleedMm ?? BLEED_MM) > 0);
  const bleeding = $derived(showBleed && hasBleed);

  /** The finished size the viewer is looking at, so the crop is verifiable. */
  const dimensions = $derived.by(() => {
    if (!format) return null;
    const box = bleeding ? format.bleed : trimBox(format);
    return {
      label: format.label,
      pixels: `${Math.round(box.width)} × ${Math.round(box.height)}`
    };
  });

  let stage = $state<HTMLDivElement | null>(null);
  let exporting = $state<string | null>(null);
  let exportError = $state<string | null>(null);

  /**
   * A regular card exports through `renderCardImage`, which already knows how
   * to derive its own format and filename. The character card is not a
   * `Card` — nothing in `set.cards` — so it takes the same underlying
   * `renderPlateImage` a regular card's export ultimately calls, with the
   * format and filename worked out here instead.
   */
  async function exportPng(bleed: boolean): Promise<void> {
    const plate = stage?.querySelector<HTMLElement>('.plate');
    if (!plate) return;

    exporting = bleed ? 'bleed' : 'trim';
    exportError = null;
    try {
      if (card) {
        saveExport(await renderCardImage(plate, card, { bleed }));
      } else if (statCard && format) {
        const label =
          (heroSlot?.kind === 'card' ? heroSlot.entry?.name.trim() : '') ||
          primaryCardName(statCard) ||
          characterLabel(statCard);
        const blob = await renderPlateImage(plate, format, { bleed });
        saveExport({
          filename: `${slugify(label, 'character-card')}${bleed ? '-bleed' : ''}.png`,
          mimeType: 'image/png',
          blob
        });
      }
    } catch (cause) {
      exportError = cause instanceof Error ? cause.message : 'Export failed.';
    } finally {
      exporting = null;
    }
  }
</script>

{#snippet exportButtons()}
  <div class="exports">
    <Button size="sm" disabled={exporting !== null} onclick={() => exportPng(false)}>
      <Icon name="download" size={13} />
      {exporting === 'trim' ? 'Rendering…' : 'Export PNG'}
    </Button>
    <Button
      size="sm"
      variant="secondary"
      disabled={exporting !== null}
      onclick={() => exportPng(true)}
    >
      <Icon name="download" size={13} />
      {exporting === 'bleed' ? 'Rendering…' : 'PNG — bleed'}
    </Button>
  </div>

  {#if exportError}<p class="export-error">{exportError}</p>{/if}
{/snippet}

<div class="panel">
  <div class="head">
    <span class="eyebrow">Preview</span>

    <div class="tools">
      <button
        type="button"
        class="tool label"
        class:on={bleeding}
        title={hasBleed
          ? "Show the printer's bleed"
          : 'This template is drawn at trim size — it has no bleed'}
        aria-pressed={bleeding}
        disabled={!hasBleed}
        onclick={() => (showBleed = !showBleed)}
      >
        Bleed
      </button>
      <button
        type="button"
        class="tool"
        class:on={showGuides}
        class:disabled={!bleeding}
        title="Show the cut line"
        aria-pressed={showGuides}
        disabled={!bleeding}
        onclick={() => (showGuides = !showGuides)}
      >
        <Icon name="crop" size={13} />
      </button>
    </div>
  </div>

  <div class="stage scroll-y" bind:this={stage}>
    {#if statCard && heroSlot?.kind === 'card'}
      <!--
        Exactly one sheet at a time, matching whichever tab the character
        workspace has open — labelled with its name only once there is more
        than one identity to tell apart, the same as before this showed every
        identity stacked together.
      -->
      <span class="face-label">
        Character card{statCard.additionalCards.length > 0
          ? ` — ${heroSlot.entry?.name.trim() || primaryCardName(statCard) || 'Untitled'}`
          : ''}
      </span>
      <div class="card-slot" style:width="{zoom * 100}%">
        <CardRenderer
          card={null}
          {statCard}
          statCardEntry={heroSlot.entry}
          options={{ showBleed: bleeding, showGuides: showGuides && bleeding }}
          customSymbols={workshop.adventure.customSymbols}
        />
      </div>
    {/if}

    {#if !statCard || heroSlot?.kind === 'cardback'}
      {#if statCard}<span class="face-label">Deck back</span>{/if}
      <div class="card-slot" style:width="{zoom * 100}%">
        <CardRenderer
          {card}
          {cardback}
          character={owner}
          {theme}
          options={{ showBleed: bleeding, showGuides: showGuides && bleeding }}
          customSymbols={workshop.adventure.customSymbols}
        />
      </div>
    {/if}

    {#if card?.type === 'event'}
      <!--
        An event card is designed on both sides, so both are on screen. The
        reverse is part of the card rather than a shared deck back, which is
        why it sits in the same stack rather than in a panel of its own.
      -->
      <span class="face-label">Reverse</span>
      <div class="card-slot" style:width="{zoom * 100}%">
        <CardRenderer
          {card}
          character={owner}
          {theme}
          side="back"
          options={{ showBleed: bleeding, showGuides: showGuides && bleeding }}
          customSymbols={workshop.adventure.customSymbols}
        />
      </div>
    {/if}

    {#if cardback && sampleCard && (!statCard || heroSlot?.kind === 'defaults')}
      <!--
        The figure's card style, shown on a card. Labelled as a sample so it is
        never mistaken for one of the set's own — it is not in the document and
        no export will ever contain it.
      -->
      <div class="sample">
        <span class="sample-label">Action card defaults</span>
        <div class="card-slot" style:width="{zoom * 100}%">
          <CardRenderer
            card={sampleCard}
            character={cardback}
            theme={sampleTheme}
            options={{ showBleed: bleeding, showGuides: showGuides && bleeding }}
            customSymbols={workshop.adventure.customSymbols}
          />
        </div>
        <span class="sample-note">A preview of this figure’s defaults. Not part of the set.</span>
      </div>
    {/if}

    {#if card && meta}
      <div class="facts">
        <span class="fact type" style:--type-color="var({meta.colorVar})">{meta.label}</span>
        <span class="fact">{deck ? deckLabel(deck) : 'No deck'}</span>
        {#if owner}<span class="fact">{characterLabel(owner)}</span>{/if}
        <span class="fact numeric">×{card.quantity}</span>
      </div>

      {#if dimensions}
        <div class="size">
          <span>{dimensions.label}</span>
          <span class="numeric">{dimensions.pixels} px</span>
        </div>
      {/if}

      {@render exportButtons()}
    {:else if statCard && heroSlot?.kind === 'card'}
      <div class="facts">
        <span class="fact type" style:--type-color="var(--role-{statCard.role})">Character card</span>
        <span class="fact">
          {heroSlot.entry?.name.trim() || primaryCardName(statCard) || characterLabel(statCard)}
        </span>
      </div>

      {#if dimensions}
        <div class="size">
          <span>{dimensions.label}</span>
          <span class="numeric">{dimensions.pixels} px</span>
        </div>
      {/if}

      {@render exportButtons()}
    {:else if cardback}
      <div class="facts">
        <span class="fact type" style:--type-color="var(--role-{cardback.role})">Deck back</span>
        <span class="fact">{characterLabel(cardback)}</span>
      </div>

      {#if dimensions}
        <div class="size">
          <span>{dimensions.label}</span>
          <span class="numeric">{dimensions.pixels} px</span>
        </div>
      {/if}
    {:else}
      <EmptyState
        icon="card"
        title="Nothing to preview"
        description="Pick a card in the sidebar, or add one to a deck."
        compact
      />
    {/if}
  </div>

  <div class="zoom">
    <Icon name="search" size={12} />
    <input
      class="zoom-range"
      type="range"
      min="0.5"
      max="1"
      step="0.01"
      value={zoom}
      aria-label="Preview size"
      oninput={(event) => (zoom = event.currentTarget.valueAsNumber)}
    />
    <span class="zoom-value numeric">{Math.round(zoom * 100)}%</span>
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    height: 34px;
    padding-inline: var(--space-4) var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
  }

  .tools {
    display: flex;
    gap: 2px;
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
    color: var(--text-secondary);
  }

  .tool.on {
    background: var(--accent-soft);
    color: var(--text-accent);
  }

  .tool.label {
    width: auto;
    padding-inline: var(--space-2);
    font-size: var(--text-2xs);
  }

  .tool:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .tool:disabled:hover {
    background: transparent;
    color: var(--text-muted);
  }

  .stage {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
    padding: var(--space-6) var(--space-5);
  }

  .card-slot {
    max-width: 372px;
    transition: width var(--duration-fast) var(--ease-out);
  }

  /* Set apart from the deck back above it, which *is* part of the set. */
  .sample {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding-top: var(--space-5);
    border-top: 1px dashed var(--border-subtle);
  }

  .face-label,
  .sample-label {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  .sample-note {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    text-align: center;
    max-width: 30ch;
    text-wrap: pretty;
  }

  .facts {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .fact {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .size {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    opacity: 0.75;
  }

  .exports {
    display: flex;
    gap: var(--space-2);
  }

  .export-error {
    font-size: var(--text-xs);
    color: var(--danger);
    text-align: center;
    max-width: 32ch;
  }

  .type {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-tertiary);
  }

  .type::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--type-color);
  }

  .zoom {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-top: 1px solid var(--border-subtle);
    color: var(--text-muted);
  }

  .zoom-range {
    flex: 1 1 auto;
    -webkit-appearance: none;
    appearance: none;
    height: 14px;
    background: transparent;
    cursor: pointer;
  }

  .zoom-range::-webkit-slider-runnable-track {
    height: 2px;
    border-radius: var(--radius-full);
    background: var(--grey-750);
  }

  .zoom-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 10px;
    height: 10px;
    margin-top: -4px;
    border-radius: 50%;
    background: var(--grey-300);
  }

  .zoom-value {
    font-size: var(--text-2xs);
    min-width: 4ch;
    text-align: right;
  }
</style>
