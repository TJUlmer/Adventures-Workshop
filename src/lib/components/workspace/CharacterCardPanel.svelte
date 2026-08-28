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
   * Each band carries its own labels' colour beside its fill, because that is
   * what they have to be read against — "HERO", "ATTACK" and "START HEALTH"
   * on the name band, "SPECIAL ABILITY" on the ability panel, and the
   * sidekick's own three. One picker per band rather than per word: they sit
   * on one flat field, and nobody wants to match three colours across it.
   *
   * What is left as fixed art is only what is not a word — the decorative
   * arcs framing a badge, and the sidekick's own health badge.
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
  import { sameFill } from '$lib/cards/style';
  import type { CharacterBandName, CharacterCardDesign, CharacterId, HeroCharacterCardId } from '$lib/characters/types';
  import { CHARACTER_BAND_NAMES } from '$lib/characters/types';
  import { createCharacterCard } from '$lib/characters/factory';
  import { hasArtwork } from '$lib/core/artwork';
  import { CHARACTER_BAND_RUNS, CHARACTER_CARD } from '$lib/renderer/geometry';
  import { workshop } from '$lib/state/workshop.svelte';
  import { FillEditor, Section } from '$lib/ui';
  import ArtworkPanel from './ArtworkPanel.svelte';

  interface Props {
    characterId: CharacterId;
    design: CharacterCardDesign;
    /** Absent edits the primary's own sheet; present, that additional card's. */
    cardId?: HeroCharacterCardId;
  }

  let { characterId, design, cardId }: Props = $props();

  /*
   * `labels` names the words each picker actually reaches, rather than saying
   * "Labels" three times — they differ per band, and a hero's band carries
   * three of them where the ability panel carries one.
   */
  const BANDS: Readonly<
    Record<CharacterBandName, { title: string; hint: string; labels: string }>
  > = {
    hero: {
      title: 'Name band',
      hint: 'The hero’s name and its attack row.',
      labels: '“Hero”, “Attack” and “Start Health”'
    },
    ability: {
      title: 'Special ability band',
      hint: 'The panel between the name band and the sidekick band.',
      labels: '“Special ability”'
    },
    sidekick: {
      title: 'Sidekick band',
      hint: 'Or the quote panel, when there is no sidekick.',
      labels: '“Sidekick”, “Attack” and “Start Health”'
    }
  };

  function edit(mutate: (design: CharacterCardDesign) => void): void {
    workshop.editCharacterCard(characterId, mutate, cardId);
  }

  /*
   * This sheet sits outside the style cascade (see `CharacterCardDesign`), so
   * every colour here is stored outright and inherits from nothing. What a
   * reset goes back to is therefore the factory's own value — the printed
   * template's colours, sampled — rather than a parent layer, which is why
   * these pass `resetTitle` instead of taking `FillEditor`'s cascade wording.
   *
   * Rebuilt per call rather than held as a module constant: `createCharacterCard`
   * mints fresh nested objects each time, and handing the same one to `edit`
   * twice would alias the default into two designs at once — the exact hazard
   * `cloneCharacterCard` exists for.
   */
  const RESET_TITLE = 'Back to the template’s own colour';

  /** Every simple, top-level colour on this sheet, and its printed default. */
  type InkKey = 'border' | 'healthBadge' | 'healthBadgeAccent' | 'healthInk' | 'abilityInk' | 'moveInk';

  const defaults = createCharacterCard();

  const isDefault = (key: InkKey) => sameFill(design[key], defaults[key]);
  const reset = (key: InkKey) => () => edit((card) => (card[key] = { ...createCharacterCard()[key] }));

  const bandIsDefault = (band: CharacterBandName, part: 'fill' | 'labelInk') =>
    sameFill(design[band][part], defaults[band][part]);
  const resetBand = (band: CharacterBandName, part: 'fill' | 'labelInk') => () =>
    edit((card) => (card[band][part] = { ...createCharacterCard()[band][part] }));
</script>

{#if !design.useReplacement || !hasArtwork(design.replacement)}
  <!--
    Four blocks, not one — this sheet's colours, then each band on its own,
    so the tab is something to scroll past rather than one long wall.
  -->
  <Section
    title="Character card design"
    description="This sheet’s border and the health badge, wherever this sheet uses them."
  >
    <div class="colours">
      <FillEditor
        label="Border"
        value={design.border}
        origin="the template"
        overridden={!isDefault('border')}
        resetTitle={RESET_TITLE}
        onchange={(border: Fill) => edit((card) => (card.border = border))}
        onreset={reset('border')}
      />

      <FillEditor
        label="Health badge"
        value={design.healthBadge}
        origin="the template"
        overridden={!isDefault('healthBadge')}
        resetTitle={RESET_TITLE}
        onchange={(healthBadge: Fill) => edit((card) => (card.healthBadge = healthBadge))}
        onreset={reset('healthBadge')}
      />

      <FillEditor
        label="Health badge accent"
        value={design.healthBadgeAccent}
        origin="the template"
        overridden={!isDefault('healthBadgeAccent')}
        resetTitle={RESET_TITLE}
        onchange={(healthBadgeAccent: Fill) => edit((card) => (card.healthBadgeAccent = healthBadgeAccent))}
        onreset={reset('healthBadgeAccent')}
      />

      <FillEditor
        label="Start Health value"
        value={design.healthInk}
        origin="the template"
        overridden={!isDefault('healthInk')}
        resetTitle={RESET_TITLE}
        onchange={(healthInk: Fill) => edit((card) => (card.healthInk = healthInk))}
        onreset={reset('healthInk')}
      />

      <FillEditor
        label="Special ability text"
        value={design.abilityInk}
        origin="the template"
        overridden={!isDefault('abilityInk')}
        resetTitle={RESET_TITLE}
        onchange={(abilityInk: Fill) => edit((card) => (card.abilityInk = abilityInk))}
        onreset={reset('abilityInk')}
      />

      <FillEditor
        label="Move value"
        value={design.moveInk}
        origin="the template"
        overridden={!isDefault('moveInk')}
        resetTitle={RESET_TITLE}
        onchange={(moveInk: Fill) => edit((card) => (card.moveInk = moveInk))}
        onreset={reset('moveInk')}
      />
    </div>
  </Section>

  {#each CHARACTER_BAND_NAMES as band (band)}
    <Section title={BANDS[band].title} description={BANDS[band].hint}>
      <div class="colours band-colours">
        <FillEditor
          label="Background"
          value={design[band].fill}
          origin="the template"
          overridden={!bandIsDefault(band, 'fill')}
          resetTitle={RESET_TITLE}
          onchange={(fill: Fill) => edit((card) => (card[band].fill = fill))}
          onreset={resetBand(band, 'fill')}
        />

        <FillEditor
          label={BANDS[band].labels}
          value={design[band].labelInk}
          origin="the template"
          overridden={!bandIsDefault(band, 'labelInk')}
          resetTitle={RESET_TITLE}
          onchange={(labelInk: Fill) => edit((card) => (card[band].labelInk = labelInk))}
          onreset={resetBand(band, 'labelInk')}
        />
      </div>

      <ArtworkPanel
        target={{ entity: 'characterBand', id: characterId, band, cardId }}
        aspect={CHARACTER_CARD.width / (CHARACTER_BAND_RUNS[band].bottom - CHARACTER_BAND_RUNS[band].top)}
      />
    </Section>
  {/each}
{/if}

<style>
  .colours {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-4);
  }

  /*
   * A band has two, not three, and they are a pair to judge against one
   * another — a fill and the words standing on it — so they share a row.
   * Its own class rather than a descendant selector: both blocks sit inside a
   * `Section`, so there is nothing in the markup above them to tell the two
   * apart by.
   */
  .band-colours {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @container workspace (max-width: 560px) {
    .colours,
    .band-colours {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
