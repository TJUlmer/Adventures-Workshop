<script lang="ts">
  import { createCard } from '$lib/cards/factory';
  import { cardbackFormat, deckLabel, hasDeckBackOverride } from '$lib/decks/factory';
  import { deckOwner, resolveDeckCardback, resolveStyleForDeck } from '$lib/sets/queries';
  import { deckEditorView } from '$lib/state/deck-editor-view.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import CardRenderer from '$lib/renderer/CardRenderer.svelte';
  import { Button, Slider } from '$lib/ui';
  const deck = $derived(workshop.selectedDeck);
  const back = $derived(deck ? resolveDeckCardback(workshop.adventure, deck) : null);
  const owner = $derived(deck ? deckOwner(workshop.adventure, deck) : null);
  const theme = $derived(deck ? resolveStyleForDeck(workshop.adventure, deck) : undefined);
  const sample = $derived.by(() => {
    if (!deck) return null;
    const card = createCard(deck.kind === 'special' ? 'action' : deck.kind, deck.id);
    if ('title' in card) card.title = 'Card title';
    if ('ability' in card) card.ability.plain = 'Ability text appears here.';
    return card;
  });
  const ownEventBack = $derived(deck?.kind === 'event' && !owner && !hasDeckBackOverride(deck));
  let bleed = $state(false);
  let guides = $state(false);
  let zoom = $state(1);
</script>

{#if deck && back && sample}
  <div class="panel">
    <header>
      <span>Preview</span>
      <Button size="sm" onclick={() => (bleed = !bleed)}>{bleed ? 'Hide bleed' : 'Show bleed'}</Button>
      <Button size="sm" disabled={!bleed} onclick={() => (guides = !guides)}>{guides ? 'Hide cut line' : 'Show cut line'}</Button>
    </header>
    <div class="stage scroll-y">
      <div class="card-slot" style:width={`${zoom * 100}%`}>
        {#if deckEditorView.tab === 'defaults'}
          <CardRenderer card={sample} character={owner} {theme} options={{ showBleed: bleed, showGuides: bleed && guides }} customSymbols={workshop.adventure.customSymbols} />
        {:else if ownEventBack}
          <CardRenderer card={sample} side="back" character={owner} {theme} options={{ showBleed: bleed, showGuides: bleed && guides }} />
        {:else}
          <CardRenderer card={null} cardback={back} options={{ showBleed: bleed, showGuides: bleed && guides }} />
        {/if}
      </div>
      <p>{deckLabel(deck)} — {deckEditorView.tab === 'defaults' ? 'card defaults sample' : 'deck back'}</p>
      <p class="note">{cardbackFormat(back).label}</p>
    </div>
    <footer><Slider label="Preview size" value={zoom} min={0.4} max={2} step={0.05} onchange={(value) => (zoom = value)} format={(value) => `${Math.round(value * 100)}%`} /></footer>
  </div>
{/if}

<style>
  .panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  header { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border-subtle); }
  header span { margin-right: auto; font-size: var(--text-xs); color: var(--text-secondary); }
  .stage { flex: 1 1 auto; min-height: 0; padding: var(--space-5); }
  .card-slot { min-width: 0; margin-inline: auto; }
  p { font-size: var(--text-sm); color: var(--text-secondary); text-align: center; margin: var(--space-3) 0 0; }
  .note { font-size: var(--text-xs); color: var(--text-muted); }
  footer { padding: var(--space-3) var(--space-4); border-top: 1px solid var(--border-subtle); }
</style>
