<script lang="ts">
  /**
   * A hero's printed character card: its border, and each of its three bands.
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
   */
  import type { Fill } from '$lib/cards/style';
  import type { Character, CharacterBandName } from '$lib/characters/types';
  import { CHARACTER_BAND_NAMES } from '$lib/characters/types';
  import { workshop } from '$lib/state/workshop.svelte';
  import { FillEditor } from '$lib/ui';
  import ArtworkPanel from './ArtworkPanel.svelte';
  import EditorSection from './EditorSection.svelte';

  interface Props {
    character: Character;
  }

  let { character }: Props = $props();

  const BANDS: Readonly<Record<CharacterBandName, { title: string; hint: string }>> = {
    hero: { title: 'Name band', hint: 'The hero’s name and its attack row.' },
    ability: { title: 'Special ability', hint: 'The panel between them.' },
    sidekick: { title: 'Sidekick band', hint: 'Or the quote panel, when there is no sidekick.' }
  };

  const design = $derived(character.characterCard);
</script>

<FillEditor
  label="Border"
  value={design.border}
  onchange={(border: Fill) =>
    workshop.editCharacterCard(character.id, (card) => (card.border = border))}
/>

{#each CHARACTER_BAND_NAMES as band (band)}
  <EditorSection title={BANDS[band].title} hint={BANDS[band].hint}>
    <FillEditor
      label="Background"
      value={design[band].fill}
      onchange={(fill: Fill) =>
        workshop.editCharacterCard(character.id, (card) => (card[band].fill = fill))}
    />

    <ArtworkPanel target={{ entity: 'characterBand', id: character.id, band }} />
  </EditorSection>
{/each}
