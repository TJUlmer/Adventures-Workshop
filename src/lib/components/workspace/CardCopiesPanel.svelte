<script lang="ts">
  import { copyStyleFor, physicalCopies, resolveCardCopy } from '$lib/cards/copy-visuals';
  import { mergeCardStyle } from '$lib/cards/style';
  import { TRADITIONAL_COMBAT_SYMBOLS } from '$lib/cards/types';
  import { hasArtwork } from '$lib/core/artwork';
  import { CARD_SYMBOL_LABELS, CARD_SYMBOLS } from '$lib/renderer/assets';
  import { ART_WINDOW, HERO_ART_WINDOW_HEIGHT } from '$lib/renderer/geometry';
  import CardRenderer from '$lib/renderer/CardRenderer.svelte';
  import { characterForCard, resolveStyleForCard } from '$lib/sets/queries';
  import { workshop } from '$lib/state/workshop.svelte';
  import { customSymbolLabel } from '$lib/symbols/types';
  import { customSymbolToken, symbolToken } from '$lib/text/tokens';
  import { Button, ColorInput, FillEditor, Section, Slider } from '$lib/ui';
  import ArtworkPanel from './ArtworkPanel.svelte';
  import AbilityField from './AbilityField.svelte';
  import FormattedTextField from './FormattedTextField.svelte';
  import ValueControl from './ValueControl.svelte';

  const card = $derived(workshop.selectedCard?.type === 'action' ? workshop.selectedCard : null);
  const copy = $derived(workshop.selection.target === 'card' ? workshop.selection.copy ?? 1 : 1);
  const visual = $derived(card?.copyVisuals.find((entry) => entry.copy === copy));
  const face = $derived(card ? resolveCardCopy(card, copy) : null);
  const owner = $derived(card ? characterForCard(workshop.adventure, card) : null);
  const theme = $derived(card ? resolveStyleForCard(workshop.adventure, card) : undefined);
  const look = $derived(theme ? mergeCardStyle(theme, copyStyleFor(card, copy)) : undefined);
  const symbols = $derived(workshop.adventure.customSymbols.filter((symbol) => symbol.source));
</script>

{#snippet symbolPicker(field: 'boostSymbol' | 'ribbonSymbol', label: string)}
  {#if card && face}
    {@const available = !face[field] || symbols.some((symbol) => face[field] === customSymbolToken(symbol.id)) ||
      (field === 'ribbonSymbol' && TRADITIONAL_COMBAT_SYMBOLS.some((name) => face[field] === symbolToken(name)))}
    <div class="symbol-picker" role="group" aria-label={label}>
      <span>{label}</span>
      <button type="button" class:active={!face[field]} aria-pressed={!face[field]}
        onclick={() => workshop.setCopyDetail(card.id, copy, field, '')}>None</button>
      {#if field === 'ribbonSymbol'}
        {#each TRADITIONAL_COMBAT_SYMBOLS as name (name)}
          <button type="button" class:active={face[field] === symbolToken(name)} aria-pressed={face[field] === symbolToken(name)}
            onclick={() => workshop.setCopyDetail(card.id, copy, field, symbolToken(name))}>
            <img src={CARD_SYMBOLS[name]} alt=""/>{CARD_SYMBOL_LABELS[name]}
          </button>
        {/each}
      {/if}
      {#each symbols as symbol (symbol.id)}
        <button type="button" class:active={face[field] === customSymbolToken(symbol.id)} aria-pressed={face[field] === customSymbolToken(symbol.id)}
          onclick={() => workshop.setCopyDetail(card.id, copy, field, customSymbolToken(symbol.id))}>
          <img src={symbol.source} alt=""/>{customSymbolLabel(symbol)}
        </button>
      {/each}
    </div>
    {#if !available}<p class="hint">The selected symbol is missing. Choose another symbol or None.</p>{/if}
    {#if visual?.[field] !== undefined || visual?.symbols?.[field]}
      <Button size="sm" onclick={() => workshop.setCopyDetail(card.id, copy, field, undefined)}>Use shared {label.toLowerCase()}</Button>
    {/if}
  {/if}
{/snippet}

{#if card && face && theme && look}
  <Section title="Copies" description="Customize each copy's artwork, symbols, boost, tuck text and badge. Card identity, combat rules and quantity stay shared.">
    <Button size="sm" onclick={() => workshop.selectCard(card.id)}>Edit shared content</Button>
    <div class="copies" aria-label="Choose a copy">
      {#each physicalCopies(card) as position (position)}
        <button type="button" class:selected={copy === position} aria-pressed={copy === position}
          aria-label={`Edit copy ${position} of ${card.quantity}`} onclick={() => workshop.selectCard(card.id, position)}>
          <div class="thumbnail"><CardRenderer {card} copy={position} character={owner} {theme} customSymbols={workshop.adventure.customSymbols}/></div>
          <span>Copy {position}</span>
          <small>{card.copyVisuals.some((entry) => entry.copy === position) ? 'Customized' : 'Shared'}</small>
        </button>
      {/each}
    </div>
  </Section>
  {#if card.useReplacement && hasArtwork(card.replacement)}
    <p class="hint">Copy settings apply to composed cards. Turn off the shared replacement image in Design to customize copies.</p>
  {:else}
    {#key `${card.id}:${copy}`}
      <Section title={`Copy ${copy} boost`}>
        {@render symbolPicker('boostSymbol', 'Boost symbol')}
        <ValueControl label="Boost value" value={face.boost} defaultValue={1} min={1} max={9}
          onchange={(value) => workshop.setCopyDetail(card.id, copy, 'boost', value)}/>
        {#if visual?.boost !== undefined}
          <Button size="sm" onclick={() => workshop.setCopyDetail(card.id, copy, 'boost', undefined)}>Use shared boost</Button>
        {/if}
        {#if face.boostSymbol}<p class="hint">Choose None above to print the boost value instead.</p>{/if}
      </Section>
      <Section title={`Copy ${copy} ribbon symbol`} description="The ribbon's visibility follows shared Content. Fill colour paints the strip behind the symbol.">
        {#if card.showRibbonSymbol}
          {@render symbolPicker('ribbonSymbol', 'Ribbon symbol')}
          <Slider label="Symbol size" value={look.ribbonSymbolSize} min={40} max={220} step={2}
            neutral={theme.ribbonSymbolSize} editable
            onchange={(size) => workshop.setCopyStyle(card.id, copy, 'ribbonSymbolSize', size === theme.ribbonSymbolSize ? undefined : size)}/>
          {#if visual?.style?.ribbonSymbolSize !== undefined}
            <Button size="sm" onclick={() => workshop.setCopyStyle(card.id, copy, 'ribbonSymbolSize', undefined)}>Use shared symbol size</Button>
          {/if}
          <FillEditor label="Fill colour" value={look.ribbonFoot} origin="shared card" overridden={visual?.style?.ribbonFoot !== undefined}
            onchange={(fill) => workshop.setCopyStyle(card.id, copy, 'ribbonFoot', fill)}
            onreset={() => workshop.setCopyStyle(card.id, copy, 'ribbonFoot', undefined)}/>
        {:else}<p class="hint">Enable Ribbon symbol in shared Content to customize it here.</p>{/if}
      </Section>
      <Section title={`Copy ${copy} tuck effect`} description="Visibility and orientation follow shared Content.">
        {#if card.showTuckEffect}
          <FormattedTextField label="Tuck effect text" value={face.tuckEffect} multiline={false}
            customSymbols={workshop.adventure.customSymbols}
            onchange={(value) => workshop.setCopyDetail(card.id, copy, 'tuckEffect', value)}/>
          {#if visual?.tuckEffect !== undefined}
            <Button size="sm" onclick={() => workshop.setCopyDetail(card.id, copy, 'tuckEffect', undefined)}>Use shared tuck text</Button>
          {/if}
          <FillEditor label="Bar fill" value={look.tuckEffect} origin="shared card" overridden={visual?.style?.tuckEffect !== undefined}
            onchange={(fill) => workshop.setCopyStyle(card.id, copy, 'tuckEffect', fill)}
            onreset={() => workshop.setCopyStyle(card.id, copy, 'tuckEffect', undefined)}/>
          <div class="colour" role="group" aria-label="Tuck effect text colour"><span>Text colour</span>
            <ColorInput value={visual?.style?.tuckEffectInk} inherited={theme.tuckEffectInk} origin="shared card"
              onchange={(ink) => workshop.setCopyStyle(card.id, copy, 'tuckEffectInk', ink)}/>
          </div>
        {:else}<p class="hint">Enable Tuck effect in shared Content to customize it here.</p>{/if}
      </Section>
      <Section title={`Copy ${copy} corner badge`} description="Badge visibility and placement follow shared Content.">
        {#if card.showCornerBadge}
          <AbilityField label="Corner badge content" value={face.cornerBadge} placeholder="Symbol or value" rows={1}
            customSymbols={workshop.adventure.customSymbols}
            onchange={(value) => workshop.setCopyDetail(card.id, copy, 'cornerBadge', value)}/>
          {#if visual?.cornerBadge !== undefined || visual?.symbols?.cornerBadge}
            <Button size="sm" onclick={() => workshop.setCopyDetail(card.id, copy, 'cornerBadge', undefined)}>Use shared corner badge</Button>
          {/if}
          <FillEditor label="Background colour" value={look.cornerBadge} origin="shared card" overridden={visual?.style?.cornerBadge !== undefined}
            onchange={(fill) => workshop.setCopyStyle(card.id, copy, 'cornerBadge', fill)}
            onreset={() => workshop.setCopyStyle(card.id, copy, 'cornerBadge', undefined)}/>
          <Slider label="Background opacity" value={look.cornerBadgeOpacity} min={0} max={1} step={0.01}
            neutral={theme.cornerBadgeOpacity} format={(value) => `${Math.round(value * 100)}%`} editable inputMultiplier={100} inputUnit="%"
            onchange={(opacity) => workshop.setCopyStyle(card.id, copy, 'cornerBadgeOpacity', opacity === theme.cornerBadgeOpacity ? undefined : opacity)}/>
          {#if visual?.style?.cornerBadgeOpacity !== undefined}
            <Button size="sm" onclick={() => workshop.setCopyStyle(card.id, copy, 'cornerBadgeOpacity', undefined)}>Use shared background opacity</Button>
          {/if}
          <div class="colour" role="group" aria-label="Corner badge content colour"><span>Content colour</span>
            <ColorInput value={visual?.style?.cornerBadgeInk} inherited={theme.cornerBadgeInk} origin="shared card"
              onchange={(ink) => workshop.setCopyStyle(card.id, copy, 'cornerBadgeInk', ink)}/>
          </div>
        {:else}<p class="hint">Enable Corner badge in shared Content to customize it here.</p>{/if}
      </Section>
      <Section title={`Copy ${copy} artwork`} description={visual?.artwork ? 'This copy has artwork overrides.' : 'Currently following the shared artwork.'}>
        {#if visual?.artwork}<Button size="sm" onclick={() => workshop.resetCopyVisual(card.id, copy, 'artwork')}>Use shared artwork</Button>{/if}
        <ArtworkPanel target={{entity:'cardCopy',id:card.id,copy}}
          aspect={owner?.role === 'hero' ? ART_WINDOW.width / HERO_ART_WINDOW_HEIGHT : ART_WINDOW.width / ART_WINDOW.height}/>
      </Section>
      {#if visual}<Button size="sm" onclick={() => workshop.resetCopyVisual(card.id, copy)}>Reset this copy to shared</Button>{/if}
    {/key}
  {/if}
{/if}

<style>
  .copies { display:grid; grid-template-columns:repeat(auto-fill,minmax(90px,1fr)); gap:var(--space-3); margin-top:var(--space-3); }
  .copies button { min-width:0; padding:var(--space-2); display:flex; flex-direction:column; gap:var(--space-1); border:1px solid var(--border-subtle); border-radius:var(--radius-md); background:var(--surface-raised); color:var(--text-primary); cursor:pointer; }
  .copies button.selected { border-color:var(--accent); background:var(--accent-soft); }
  .thumbnail { width:100%; pointer-events:none; }
  .symbol-picker { display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-2); }
  .symbol-picker>span { color:var(--text-muted); font-size:var(--text-xs); }
  .symbol-picker button { display:inline-flex; align-items:center; gap:var(--space-1); padding:var(--space-1) var(--space-2); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); background:var(--surface-inset); color:var(--text-primary); cursor:pointer; }
  .symbol-picker button.active { border-color:var(--accent); background:var(--accent-soft); }
  .symbol-picker img { width:18px; height:18px; object-fit:contain; }
  .colour { display:flex; align-items:center; justify-content:space-between; gap:var(--space-3); font-size:var(--text-xs); }
  small,.hint { color:var(--text-muted); font-size:var(--text-xs); }
</style>
