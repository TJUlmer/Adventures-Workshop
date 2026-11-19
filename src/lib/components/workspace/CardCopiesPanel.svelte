<script lang="ts">
  import { copySymbolAvailable, physicalCopies } from '$lib/cards/copy-visuals';
  import { hasArtwork } from '$lib/core/artwork';
  import { COPY_SYMBOL_SLOTS } from '$lib/cards/types';
  import { ART_WINDOW, HERO_ART_WINDOW_HEIGHT } from '$lib/renderer/geometry';
  import CardRenderer from '$lib/renderer/CardRenderer.svelte';
  import { characterForCard, resolveStyleForCard } from '$lib/sets/queries';
  import { workshop } from '$lib/state/workshop.svelte';
  import type { CustomSymbolId } from '$lib/symbols/types';
  import { customSymbolLabel } from '$lib/symbols/types';
  import { Button, Field, Section, Select } from '$lib/ui';
  import ArtworkPanel from './ArtworkPanel.svelte';

  const card = $derived(workshop.selectedCard?.type === 'action' ? workshop.selectedCard : null);
  const copy = $derived(workshop.selection.target === 'card' ? workshop.selection.copy ?? 1 : 1);
  const visual = $derived(card?.copyVisuals.find((entry) => entry.copy === copy));
  const owner = $derived(card ? characterForCard(workshop.adventure, card) : null);
  const theme = $derived(card ? resolveStyleForCard(workshop.adventure, card) : undefined);
  const symbolOptions = $derived([
    { value: '', label: 'Use shared symbol' },
    ...workshop.adventure.customSymbols.filter((symbol) => symbol.source).map((symbol) => ({ value: symbol.id as string, label: customSymbolLabel(symbol) }))
  ]);
  const labels = { ribbonSymbol: 'Ribbon foot symbol', boostSymbol: 'Boost symbol', cornerBadge: 'Corner badge symbol' };
</script>

{#if card}
  <Section title="Copies" description="Text, values and quantity are shared. Only artwork and standalone symbols can differ.">
    <Button size="sm" onclick={() => workshop.selectCard(card.id)}>Edit shared content</Button>
    <div class="copies" aria-label="Choose a copy">
      {#each physicalCopies(card) as position (position)}
        <button type="button" class:selected={copy === position} aria-pressed={copy === position}
          aria-label={`Edit copy ${position} of ${card.quantity}`}
          onclick={() => workshop.selectCard(card.id, position)}>
          <div class="thumbnail"><CardRenderer {card} copy={position} character={owner} {theme} customSymbols={workshop.adventure.customSymbols}/></div>
          <span>Copy {position}</span>
          <small>{card.copyVisuals.some((entry) => entry.copy === position) ? 'Custom visuals' : 'Shared visuals'}</small>
        </button>
      {/each}
    </div>
  </Section>
  {#if card.useReplacement && hasArtwork(card.replacement)}
    <p class="hint">Copy visuals apply to composed cards. Turn off the shared replacement image in Design to customize copies.</p>
  {:else}
    <Section title={`Copy ${copy} artwork`} description={visual?.artwork ? 'This copy has artwork overrides.' : 'Currently following the shared artwork.'}>
      {#if visual?.artwork}<Button size="sm" onclick={() => workshop.resetCopyVisual(card.id, copy, 'artwork')}>Use shared artwork</Button>{/if}
      <ArtworkPanel target={{entity:'cardCopy',id:card.id,copy}}
        aspect={owner?.role === 'hero' ? ART_WINDOW.width / HERO_ART_WINDOW_HEIGHT : ART_WINDOW.width / ART_WINDOW.height}/>
    </Section>
    <Section title={`Copy ${copy} symbols`} description="Replace uploaded icons in existing standalone symbol slots. Their size and placement follow the shared card.">
      {#each COPY_SYMBOL_SLOTS as slot (slot)}
        {#if copySymbolAvailable(card, slot)}
          <Field label={labels[slot]}>
            <Select value={visual?.symbols?.[slot] ?? ''} options={symbolOptions}
              onchange={(value) => workshop.setCopySymbol(card.id, copy, slot, value ? value as CustomSymbolId : null)}/>
            {#if visual?.symbols?.[slot] && !workshop.adventure.customSymbols.some((symbol) => symbol.id === visual.symbols?.[slot] && symbol.source)}
              <p class="hint">This uploaded symbol is missing. Choose another or use the shared symbol.</p>
            {/if}
          </Field>
        {/if}
      {/each}
      {#if !COPY_SYMBOL_SLOTS.some((slot) => copySymbolAvailable(card, slot))}
        <p class="hint">First choose an uploaded symbol for the ribbon foot, boost symbol or a symbol-only corner badge in shared Content.</p>
      {/if}
    </Section>
    {#if visual}<Button size="sm" onclick={() => workshop.resetCopyVisual(card.id, copy)}>Reset all visuals for this copy</Button>{/if}
  {/if}
{/if}

<style>
  .copies { display:grid; grid-template-columns:repeat(auto-fill,minmax(90px,1fr)); gap:var(--space-3); margin-top:var(--space-3); }
  .copies button { min-width:0; padding:var(--space-2); display:flex; flex-direction:column; gap:var(--space-1); border:1px solid var(--border-subtle); border-radius:var(--radius-md); background:var(--surface-raised); color:var(--text-primary); cursor:pointer; }
  .copies button.selected { border-color:var(--accent); background:var(--accent-soft); }
  .thumbnail { width:100%; pointer-events:none; }
  small,.hint { color:var(--text-muted); font-size:var(--text-xs); }
</style>
