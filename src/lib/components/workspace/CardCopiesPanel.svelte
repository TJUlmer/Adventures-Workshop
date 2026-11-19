<script lang="ts">
  import { copySymbolAvailable, physicalCopies, resolveCardCopy } from '$lib/cards/copy-visuals';
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
  import AbilityField from './AbilityField.svelte';
  import FormattedTextField from './FormattedTextField.svelte';
  import ValueControl from './ValueControl.svelte';

  const card = $derived(workshop.selectedCard?.type === 'action' ? workshop.selectedCard : null);
  const copy = $derived(workshop.selection.target === 'card' ? workshop.selection.copy ?? 1 : 1);
  const visual = $derived(card?.copyVisuals.find((entry) => entry.copy === copy));
  const face = $derived(card ? resolveCardCopy(card, copy) : null);
  const symbolSlots = COPY_SYMBOL_SLOTS.filter((slot) => slot !== 'cornerBadge');
  const owner = $derived(card ? characterForCard(workshop.adventure, card) : null);
  const theme = $derived(card ? resolveStyleForCard(workshop.adventure, card) : undefined);
  const symbolOptions = $derived([
    { value: '', label: 'Use shared symbol' },
    ...workshop.adventure.customSymbols.filter((symbol) => symbol.source).map((symbol) => ({ value: symbol.id as string, label: customSymbolLabel(symbol) }))
  ]);
  const labels = { ribbonSymbol: 'Ribbon foot symbol', boostSymbol: 'Boost symbol', cornerBadge: 'Corner badge symbol' };
</script>

{#if card}
  <Section title="Copies" description="Customize artwork, symbols, boost value, tuck text and badge content. Card identity, combat rules and quantity stay shared.">
    <Button size="sm" onclick={() => workshop.selectCard(card.id)}>Edit shared content</Button>
    <div class="copies" aria-label="Choose a copy">
      {#each physicalCopies(card) as position (position)}
        <button type="button" class:selected={copy === position} aria-pressed={copy === position}
          aria-label={`Edit copy ${position} of ${card.quantity}`}
          onclick={() => workshop.selectCard(card.id, position)}>
          <div class="thumbnail"><CardRenderer {card} copy={position} character={owner} {theme} customSymbols={workshop.adventure.customSymbols}/></div>
          <span>Copy {position}</span>
          <small>{card.copyVisuals.some((entry) => entry.copy === position) ? 'Customized' : 'Shared'}</small>
        </button>
      {/each}
    </div>
  </Section>
  {#if card.useReplacement && hasArtwork(card.replacement)}
    <p class="hint">Copy visuals apply to composed cards. Turn off the shared replacement image in Design to customize copies.</p>
  {:else}
    {#if face}
      {#key `${card.id}:${copy}`}
        <Section title={`Copy ${copy} details`} description="Tuck effect and corner badge visibility, placement and styling follow shared Content and Design.">
          <ValueControl label="Boost value" value={face.boost} defaultValue={1} min={1} max={9}
            onchange={(value) => workshop.setCopyDetail(card.id, copy, 'boost', value)}/>
          {#if visual?.boost !== undefined}
            <Button size="sm" onclick={() => workshop.setCopyDetail(card.id, copy, 'boost', undefined)}>Use shared boost</Button>
          {/if}
          {#if face.boostSymbol}<p class="hint">The boost symbol replaces the printed number. Its value remains available when the shared symbol is removed.</p>{/if}
          {#if card.showTuckEffect}
            <FormattedTextField label="Tuck effect text" value={face.tuckEffect} multiline={false}
              customSymbols={workshop.adventure.customSymbols}
              onchange={(value) => workshop.setCopyDetail(card.id, copy, 'tuckEffect', value)}/>
            {#if visual?.tuckEffect !== undefined}
              <Button size="sm" onclick={() => workshop.setCopyDetail(card.id, copy, 'tuckEffect', undefined)}>Use shared tuck text</Button>
            {/if}
          {/if}
          {#if card.showCornerBadge}
            <AbilityField label="Corner badge content" value={face.cornerBadge} placeholder="Symbol or value" rows={1}
              customSymbols={workshop.adventure.customSymbols}
              onchange={(value) => workshop.setCopyDetail(card.id, copy, 'cornerBadge', value)}/>
            {#if visual?.cornerBadge !== undefined || visual?.symbols?.cornerBadge}
              <Button size="sm" onclick={() => workshop.setCopyDetail(card.id, copy, 'cornerBadge', undefined)}>Use shared corner badge</Button>
            {/if}
          {/if}
          {#if !card.showTuckEffect || !card.showCornerBadge}
            <p class="hint">Enable a tuck effect or corner badge in shared Content to customize its text here.</p>
          {/if}
        </Section>
      {/key}
    {/if}
    <Section title={`Copy ${copy} artwork`} description={visual?.artwork ? 'This copy has artwork overrides.' : 'Currently following the shared artwork.'}>
      {#if visual?.artwork}<Button size="sm" onclick={() => workshop.resetCopyVisual(card.id, copy, 'artwork')}>Use shared artwork</Button>{/if}
      <ArtworkPanel target={{entity:'cardCopy',id:card.id,copy}}
        aspect={owner?.role === 'hero' ? ART_WINDOW.width / HERO_ART_WINDOW_HEIGHT : ART_WINDOW.width / ART_WINDOW.height}/>
    </Section>
    <Section title={`Copy ${copy} symbols`} description="Replace uploaded icons in existing standalone symbol slots. Their size and placement follow the shared card.">
      {#each symbolSlots as slot (slot)}
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
      {#if !symbolSlots.some((slot) => copySymbolAvailable(card, slot))}
        <p class="hint">First choose an uploaded symbol for the ribbon foot or boost symbol in shared Content. Badge text and icons are edited above.</p>
      {/if}
    </Section>
    {#if visual}<Button size="sm" onclick={() => workshop.resetCopyVisual(card.id, copy)}>Reset this copy to shared</Button>{/if}
  {/if}
{/if}

<style>
  .copies { display:grid; grid-template-columns:repeat(auto-fill,minmax(90px,1fr)); gap:var(--space-3); margin-top:var(--space-3); }
  .copies button { min-width:0; padding:var(--space-2); display:flex; flex-direction:column; gap:var(--space-1); border:1px solid var(--border-subtle); border-radius:var(--radius-md); background:var(--surface-raised); color:var(--text-primary); cursor:pointer; }
  .copies button.selected { border-color:var(--accent); background:var(--accent-soft); }
  .thumbnail { width:100%; pointer-events:none; }
  small,.hint { color:var(--text-muted); font-size:var(--text-xs); }
</style>
