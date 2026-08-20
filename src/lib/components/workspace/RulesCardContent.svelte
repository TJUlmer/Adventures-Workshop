<script lang="ts">
  /** Rules card content: a heading and rich body copy. */
  import type { EventCard, RulesCard } from '$lib/cards/types';
  import { createHeadingPlacement, isProseCard } from '$lib/cards/types';
  import { characterLabel } from '$lib/characters/factory';
  import { deckLabel } from '$lib/decks/factory';
  import type { DeckId } from '$lib/decks/types';
  import { asId } from '$lib/core/id';
  import { deckOwner } from '$lib/sets/queries';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, NumberInput, RichTextEditor, Select, Slider, TextArea, TextInput } from '$lib/ui';
  import EditorSection from './EditorSection.svelte';

  interface Props {
    /** Rules and event cards are authored the same way. */
    card: RulesCard | EventCard;
  }

  let { card }: Props = $props();

  function edit(mutate: (target: RulesCard | EventCard) => void): void {
    workshop.editCard(card.id, (target) => {
      if (isProseCard(target)) mutate(target);
    });
  }

  /**
   * Every deck of this card's own kind — a rules card can only move to
   * another rules deck, an event card to another event deck — so this
   * doesn't offer the mismatched-kind moves `ActionCardContent`'s own
   * unfiltered list technically allows. With one character's rules deck the
   * lone option, there was nothing to pick from and no reason to show a
   * picker at all; the moment a second exists, an author had no way through
   * this editor to say which one a given card belongs to.
   */
  const deckOptions = $derived(
    workshop.adventure.decks
      .filter((deck) => deck.kind === card.type)
      .map((deck) => {
        const owner = deckOwner(workshop.adventure, deck);
        return {
          value: deck.id as string,
          label: owner ? `${deckLabel(deck)} · ${characterLabel(owner)}` : deckLabel(deck)
        };
      })
  );

  /** Only an event card prints a designed reverse, so only it can place one. */
  const backHeading = $derived(card.type === 'event' ? card.backHeading : null);

  function placeBack(mutate: (place: NonNullable<typeof backHeading>) => void): void {
    edit((target) => {
      if (target.type === 'event') mutate(target.backHeading);
    });
  }

  const placed = $derived(
    backHeading !== null &&
      (backHeading.offsetX !== 0 || backHeading.offsetY !== 0 || backHeading.rotation !== 0)
  );
</script>

<EditorSection title="Heading">
  <TextInput bind:value={card.heading} placeholder="Section heading" prominent />
</EditorSection>

{#if backHeading}
  <!--
    The reverse's title only. The front's sits in a panel that is centred on
    both axes, so there is nothing there to place; the printed reverse sets its
    title on a slant, which is what these are for.
  -->
  <EditorSection
    title="Heading on the reverse"
    hint="Moves and turns the title on the card’s back. Offsets are a share of the card, so a placement holds at any size."
  >
    {#snippet actions()}
      {#if placed}
        <Button
          size="sm"
          variant="ghost"
          onclick={() =>
            placeBack((place) => Object.assign(place, createHeadingPlacement()))}
        >
          Reset
        </Button>
      {/if}
    {/snippet}

    <Slider
      label="Across"
      value={backHeading.offsetX}
      min={-40}
      max={40}
      step={0.5}
      neutral={0}
      format={(at) => `${at.toFixed(1)}%`}
      onchange={(at) => placeBack((place) => (place.offsetX = at))}
    />

    <Slider
      label="Down"
      value={backHeading.offsetY}
      min={-40}
      max={40}
      step={0.5}
      neutral={0}
      format={(at) => `${at.toFixed(1)}%`}
      onchange={(at) => placeBack((place) => (place.offsetY = at))}
    />

    <Slider
      label="Rotation"
      value={backHeading.rotation}
      min={-45}
      max={45}
      step={1}
      neutral={0}
      format={(deg) => `${deg}°`}
      onchange={(deg) => placeBack((place) => (place.rotation = deg))}
    />
  </EditorSection>
{/if}

<EditorSection
  title="Body"
  hint="Bold, italic, underline, lists and text size are printed as written."
>
  <RichTextEditor
    value={card.body}
    minHeight={220}
    placeholder="Write the rules for this card…"
    onchange={(body) => edit((target) => (target.body = body))}
    customSymbols={workshop.adventure.customSymbols}
  />
</EditorSection>

<EditorSection title="Deck" columns={2}>
  <label class="stack">
    <span class="field-label">Copies in deck</span>
    <NumberInput bind:value={card.quantity} min={1} max={20} />
  </label>

  {#if deckOptions.length > 1}
    <label class="stack">
      <span class="field-label">Deck</span>
      <Select
        value={card.deckId as string}
        options={deckOptions}
        onchange={(next) => workshop.moveCard(card.id, asId<DeckId>(next))}
      />
    </label>
  {/if}
</EditorSection>

<EditorSection title="Notes" hint="Working notes. Never printed.">
  <TextArea bind:value={card.notes} rows={2} placeholder="Sources, open questions…" />
</EditorSection>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .field-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
</style>
