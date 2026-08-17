<script lang="ts">
  /**
   * One printed character-card sheet's border, its three bands, and the
   * finished-image escape hatch that skips composing it at all.
   *
   * Three bands, not five. The card rules a line between the hero's name and
   * its attack row, and between the sidekick's, but nobody wants to match two
   * colours across a bar — so the hero block is the name band *and* its attack
   * row, and the sidekick block is its two bands or the quote panel that
   * stands in for them.
   *
   * Everything else on this card is fixed art: the tab labels, the START
   * HEALTH captions, the health badge, the move arrow and the word MOVE are
   * printed in the colours they print in, and are nobody's choice.
   *
   * Shared between the primary identity's own sheet and every additional
   * card's — `cardId` says which. Each is independent: pairing two heroes on
   * one deck does not mean pairing their two sheets' colours.
   */
  import type { Fill } from '$lib/cards/style';
  import type { CharacterBandName, CharacterCardDesign, CharacterId, HeroCharacterCardId } from '$lib/characters/types';
  import { CHARACTER_BAND_NAMES } from '$lib/characters/types';
  import { hasArtwork } from '$lib/core/artwork';
  import { workshop } from '$lib/state/workshop.svelte';
  import { FillEditor } from '$lib/ui';
  import ArtworkPanel from './ArtworkPanel.svelte';
  import EditorSection from './EditorSection.svelte';
  import ReplacementPanel from './ReplacementPanel.svelte';

  interface Props {
    characterId: CharacterId;
    design: CharacterCardDesign;
    /** Absent edits the primary's own sheet; present, that additional card's. */
    cardId?: HeroCharacterCardId;
  }

  let { characterId, design, cardId }: Props = $props();

  const BANDS: Readonly<Record<CharacterBandName, { title: string; hint: string }>> = {
    hero: { title: 'Name band', hint: 'The hero’s name and its attack row.' },
    ability: { title: 'Special ability', hint: 'The panel between them.' },
    sidekick: { title: 'Sidekick band', hint: 'Or the quote panel, when there is no sidekick.' }
  };

  function edit(mutate: (design: CharacterCardDesign) => void): void {
    workshop.editCharacterCard(characterId, mutate, cardId);
  }
</script>

<ReplacementPanel
  artwork={design.replacement}
  enabled={design.useReplacement}
  title="Character card"
  hint="A finished character card, used instead of composing one."
  replaces="Replaces the whole printed sheet, template included."
  onpick={(source, label) =>
    edit((card) => {
      card.replacement.source = source;
      card.replacement.label = label;
      card.useReplacement = true;
    })}
  ontoggle={(useReplacement) => edit((card) => (card.useReplacement = useReplacement))}
  onclear={() =>
    edit((card) => {
      card.replacement.source = null;
      card.replacement.label = '';
      card.useReplacement = false;
    })}
/>

{#if !design.useReplacement || !hasArtwork(design.replacement)}
  <FillEditor
    label="Border"
    value={design.border}
    onchange={(border: Fill) => edit((card) => (card.border = border))}
  />

  {#each CHARACTER_BAND_NAMES as band (band)}
    <EditorSection title={BANDS[band].title} hint={BANDS[band].hint}>
      <FillEditor
        label="Background"
        value={design[band].fill}
        onchange={(fill: Fill) => edit((card) => (card[band].fill = fill))}
      />

      <ArtworkPanel target={{ entity: 'characterBand', id: characterId, band, cardId }} />
    </EditorSection>
  {/each}
{/if}
