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
   *
   * The finished-image escape hatch is *not* here. It belongs at the top of
   * the tab, above the name and stats, because it decides whether any of them
   * print at all — and it is the first block on every other design surface in
   * the app. `CharacterEditor` renders it; this panel is only what composing
   * a sheet involves, and hides itself entirely while a replacement is on.
   */
  import type { Fill } from '$lib/cards/style';
  import type { CharacterBandName, CharacterCardDesign, CharacterId, HeroCharacterCardId } from '$lib/characters/types';
  import { CHARACTER_BAND_NAMES } from '$lib/characters/types';
  import { hasArtwork } from '$lib/core/artwork';
  import { CHARACTER_BAND_RUNS, CHARACTER_CARD } from '$lib/renderer/geometry';
  import { workshop } from '$lib/state/workshop.svelte';
  import { FillEditor } from '$lib/ui';
  import ArtworkPanel from './ArtworkPanel.svelte';
  import EditorSection from './EditorSection.svelte';

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

{#if !design.useReplacement || !hasArtwork(design.replacement)}
  <FillEditor
    label="Border"
    value={design.border}
    onchange={(border: Fill) => edit((card) => (card.border = border))}
  />

  <FillEditor
    label="Health badge"
    value={design.healthBadge}
    onchange={(healthBadge: Fill) => edit((card) => (card.healthBadge = healthBadge))}
  />

  <FillEditor
    label="Health badge accent"
    value={design.healthBadgeAccent}
    onchange={(healthBadgeAccent: Fill) => edit((card) => (card.healthBadgeAccent = healthBadgeAccent))}
  />

  {#each CHARACTER_BAND_NAMES as band (band)}
    <EditorSection title={BANDS[band].title} hint={BANDS[band].hint}>
      <FillEditor
        label="Background"
        value={design[band].fill}
        onchange={(fill: Fill) => edit((card) => (card[band].fill = fill))}
      />

      <ArtworkPanel
        target={{ entity: 'characterBand', id: characterId, band, cardId }}
        aspect={CHARACTER_CARD.width / (CHARACTER_BAND_RUNS[band].bottom - CHARACTER_BAND_RUNS[band].top)}
      />
    </EditorSection>
  {/each}
{/if}
