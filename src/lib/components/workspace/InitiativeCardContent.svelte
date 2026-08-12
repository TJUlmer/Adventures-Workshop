<script lang="ts">
  /**
   * Initiative card content.
   *
   * The variant toggle comes first because it changes what the card *is*: a
   * figure acting, or an effect resolving. Assigning a character fills the
   * card type line and the move value from that figure, which is the common
   * case; both stay editable for the ones that are not.
   */
  import type { InitiativeCard } from '$lib/cards/types';
  import {
    INITIATIVE_SUBJECT_LABELS,
    INITIATIVE_VARIANTS,
    initiativeHeading
  } from '$lib/cards/types';
  import { characterLabel } from '$lib/characters/factory';
  import type { CharacterId } from '$lib/characters/types';
  import { asId } from '$lib/core/id';
  import { workshop } from '$lib/state/workshop.svelte';
  import {
    Field,
    NumberInput,
    Section,
    Select,
    SegmentedControl,
    Switch,
    TextArea,
    TextInput
  } from '$lib/ui';
  import AbilityField from './AbilityField.svelte';

  interface Props {
    card: InitiativeCard;
  }

  let { card }: Props = $props();

  const variantSegments = $derived(
    INITIATIVE_VARIANTS.map((variant) => ({
      value: variant,
      label:
        variant === 'card'
          ? `${INITIATIVE_SUBJECT_LABELS[card.subject]} card`
          : `${INITIATIVE_SUBJECT_LABELS[card.subject]} effect`
    }))
  );

  /** Only figures that can act on an initiative card. */
  const assignable = $derived(
    workshop.adventure.characters.filter(
      (character) => character.role === 'villain' || character.role === 'minion'
    )
  );

  const characterOptions = $derived([
    { value: '', label: 'Not assigned' },
    ...assignable.map((character) => ({
      value: character.id as string,
      label: characterLabel(character)
    }))
  ]);

  function edit(mutate: (target: InitiativeCard) => void): void {
    workshop.editCard(card.id, (target) => {
      if (target.type === 'initiative') mutate(target);
    });
  }

  /** Assigning pulls the name and the move value across from the figure. */
  function assign(next: string): void {
    if (next === '') {
      edit((target) => (target.characterId = null));
      return;
    }

    const id = asId<CharacterId>(next);
    const character = assignable.find((candidate) => candidate.id === id);
    edit((target) => {
      target.characterId = id;
      if (character) {
        target.subjectText = characterLabel(character);
        target.moveValue = character.move;
        target.subject = character.role === 'minion' ? 'minion' : 'villain';
      }
    });
  }
</script>

<!--
  What the card is. Subject is not asked for: assigning a figure sets it from
  that figure's role, which is the only way it can be right.
-->
<Section title="Card type" description="The band label prints as “{initiativeHeading(card)}”.">
  <Field label="Initiative card type">
    <SegmentedControl
      label="Initiative card type"
      value={card.variant}
      segments={variantSegments}
      onchange={(variant) => edit((target) => (target.variant = variant))}
    />
  </Field>

  <Field label="Assigned character">
    <Select value={card.characterId ?? ''} options={characterOptions} onchange={assign} />
  </Field>

  <Field label="Card type text">
    <TextInput
      value={card.subjectText}
      placeholder="Villain name, or the effect text"
      oninput={(event) => edit((target) => (target.subjectText = event.currentTarget.value))}
      prominent
    />
  </Field>
</Section>

<Section title="Right now" description="What happens the moment this card is revealed.">
  {#snippet actions()}
    <Switch
      label="Move badge"
      checked={card.showMove}
      onchange={(showMove) => edit((target) => (target.showMove = showMove))}
    />
  {/snippet}

  <AbilityField
    label="Right now"
    value={card.rightNow}
    rows={3}
    placeholder="What happens as soon as this card is revealed…"
    onchange={(value) => edit((target) => (target.rightNow = value))}
  />

  {#if card.showMove}
    <Field label="Move value" inline note="spaces">
      <NumberInput
        value={card.moveValue}
        min={0}
        max={12}
        onchange={(moveValue) => edit((target) => (target.moveValue = moveValue))}
      />
    </Field>
  {/if}
</Section>

<Section title="End of round" description="Resolved when the round finishes.">
  <AbilityField
    label="End of round"
    value={card.endOfRound}
    rows={4}
    placeholder="What happens when the round ends…"
    onchange={(value) => edit((target) => (target.endOfRound = value))}
  />
</Section>

<!-- No copies field: an initiative deck holds one of each card. -->
<Section title="Notes" description="Working notes. Never printed.">
  <TextArea bind:value={card.notes} rows={2} placeholder="Sequencing, references…" />
</Section>
