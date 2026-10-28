<script lang="ts">
  import type { CardTheme } from '$lib/cards/style';
  import { ACTION_SURFACES, EVENT_SURFACES, PROSE_SURFACES, styleOrigin, STYLE_ORIGIN_LABELS } from '$lib/cards/theme';
  import { characterLabel } from '$lib/characters/factory';
  import { deckLabel } from '$lib/decks/factory';
  import { DECK_KIND_META } from '$lib/decks/types';
  import { deckOwner, resolveStyleForDeck } from '$lib/sets/queries';
  import { deckEditorView } from '$lib/state/deck-editor-view.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, Field, Tabs, TextInput, TextArea } from '$lib/ui';
  import CardbackPanel from './CardbackPanel.svelte';
  import StylePanel from './StylePanel.svelte';
  import WorkspaceHeader from './WorkspaceHeader.svelte';

  const deck = $derived(workshop.selectedDeck);
  const owner = $derived(deck ? deckOwner(workshop.adventure, deck) : null);
  const resolved = $derived(deck ? resolveStyleForDeck(workshop.adventure, deck) : null);
  const surfaces = $derived(deck?.kind === 'rules' ? PROSE_SURFACES : deck?.kind === 'event' ? EVENT_SURFACES : deck?.kind === 'initiative' ? ['frame'] as const : ACTION_SURFACES);
  const tabs = [
    { value: 'cardback', label: 'Deck back' },
    { value: 'defaults', label: 'Card defaults' },
    { value: 'details', label: 'Details' }
  ];
  $effect(() => { void deck?.id; deckEditorView.tab = 'cardback'; });
  function originFor(key: keyof CardTheme): string {
    return STYLE_ORIGIN_LABELS[styleOrigin(key, workshop.adventure.style, owner?.style ?? null, null)];
  }
</script>

{#if deck && resolved}
  <WorkspaceHeader eyebrow={`${DECK_KIND_META[deck.kind].label} deck`} title={deckLabel(deck)} subtitle={owner ? `Defaults for this deck only. Inherits from ${characterLabel(owner)}.` : 'Defaults for this deck only. Inherits from the set.'} colorVar={DECK_KIND_META[deck.kind].colorVar} />
  <div class="tabs"><Tabs bind:value={deckEditorView.tab} {tabs} label="Deck editor sections" /></div>
  <div class="body scroll-y">
    {#if deckEditorView.tab === 'cardback'}
      <CardbackPanel target={{ entity: 'deck', id: deck.id }} />
    {:else if deckEditorView.tab === 'defaults'}
      <div class="inheritance">
        <p>Only this deck's cards use these overrides. Individual card overrides still take precedence.</p>
        <Button size="sm" disabled={Object.keys(deck.style ?? {}).length === 0} onclick={() => workshop.clearStyle({ entity: 'deck', id: deck.id })}>Reset card defaults</Button>
      </div>
      <StylePanel target={{ entity: 'deck', id: deck.id }} {resolved} {originFor} {surfaces} />
    {:else}
      <Field label="Deck name"><TextInput bind:value={deck.name} /></Field>
      <Field label="Private notes"><TextArea bind:value={deck.notes} rows={3} /></Field>
    {/if}
  </div>
{/if}

<style>
  .tabs { flex: none; padding-inline: var(--workspace-inline-padding, var(--space-7)); }
  .body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: var(--space-5); padding: var(--space-5) var(--workspace-inline-padding, var(--space-7)) var(--space-9); }
  .inheritance { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-3); }
  .inheritance p { margin: 0; color: var(--text-secondary); font-size: var(--text-sm); }
</style>
