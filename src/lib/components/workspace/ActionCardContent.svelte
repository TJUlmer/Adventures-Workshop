<script lang="ts">
  /**
   * Villain / minion card content.
   *
   * Ordered by how often it is touched: name and copies first, then the combat
   * values as three tap-to-toggle controls, then the ability. Timed blocks are
   * added on demand and always print in the fixed Immediately → During Combat →
   * After Combat order, so the editor never shows a field the card will not use.
   */
  import type { ActionCard } from '$lib/cards/types';
  import { characterLabel } from '$lib/characters/factory';
  import { deckLabel } from '$lib/decks/factory';
  import type { DeckId } from '$lib/decks/types';
  import { asId } from '$lib/core/id';
  import { CARD_SYMBOLS } from '$lib/renderer/assets';
  import { deckOwner } from '$lib/sets/queries';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Field, NumberInput, Section, Select, Switch, TextArea, TextInput } from '$lib/ui';
  import AbilityStack from './AbilityStack.svelte';
  import ValueControl from './ValueControl.svelte';

  interface Props {
    card: ActionCard;
  }

  let { card }: Props = $props();

  const deckOptions = $derived(
    workshop.adventure.decks.map((deck) => {
      const owner = deckOwner(workshop.adventure, deck);
      return {
        value: deck.id as string,
        label: owner ? `${deckLabel(deck)} · ${characterLabel(owner)}` : deckLabel(deck)
      };
    })
  );

  function edit(mutate: (target: ActionCard) => void): void {
    workshop.editCard(card.id, (target) => {
      if (target.type === 'action') mutate(target);
    });
  }

</script>

<!-- What the card is called and where it lives: four short fields, two by two. -->
<Section title="Card" columns={2}>
  <Field label="Name on the ribbon">
    <TextInput bind:value={card.name} placeholder="Villain name" prominent />
  </Field>

  <Field label="Card title">
    <TextInput bind:value={card.title} placeholder="Card title" />
  </Field>

  <Field label="Copies in deck">
    <NumberInput bind:value={card.quantity} min={1} max={20} />
  </Field>

  <Field label="Deck">
    <Select
      value={card.deckId as string}
      options={deckOptions}
      onchange={(next) => workshop.moveCard(card.id, asId<DeckId>(next))}
    />
  </Field>
</Section>

<!--
  Everything the card does, in one block: what it is worth, then what it says.
  Split puts the defense side under the attack side, which is how it prints.
-->
<Section title="Combat" description="Click a value to put it on the card or take it off.">
  {#snippet actions()}
    <Switch
      label="Split effect"
      checked={card.split}
      onchange={(split) => edit((target) => (target.split = split))}
    />
  {/snippet}

  <!--
    Keyed on the card: each control remembers the number it carried before it
    was switched off, and that memory belongs to one card, not to the panel.
  -->
  {#key card.id}
    <div class="values">
      <ValueControl
        label="Attack"
        symbol={CARD_SYMBOLS.attack}
        value={card.attack}
        defaultValue={2}
        onchange={(attack) => edit((target) => (target.attack = attack))}
      />
      <ValueControl
        label="Defense"
        symbol={CARD_SYMBOLS.defense}
        value={card.defense}
        defaultValue={2}
        onchange={(defense) => edit((target) => (target.defense = defense))}
      />
      <ValueControl
        label="Boost"
        value={card.boost}
        defaultValue={1}
        min={1}
        max={9}
        onchange={(boost) => edit((target) => (target.boost = boost))}
      />
    </div>
  {/key}

  {#if card.split}
    <!--
      Split cards carry two independent abilities, each with its own timings,
      so they get a stack apiece rather than one shared list.
    -->
    <AbilityStack
      title="Attack side"
      symbol={CARD_SYMBOLS.attack}
      hint="Printed above the floating separator."
      ability={card.ability}
      onchange={(patch) => edit((target) => Object.assign(target.ability, patch))}
    />
    <AbilityStack
      title="Defense side"
      symbol={CARD_SYMBOLS.defense}
      hint="Printed below it. The separator moves up as this side fills."
      ability={card.defenseAbility}
      onchange={(patch) => edit((target) => Object.assign(target.defenseAbility, patch))}
    />
  {:else}
    <AbilityStack
      title="Ability"
      ability={card.ability}
      onchange={(patch) => edit((target) => Object.assign(target.ability, patch))}
    />
  {/if}
</Section>

<Section title="Notes" description="Working notes. Never printed.">
  <TextArea bind:value={card.notes} rows={2} placeholder="Balance thoughts, references…" />
</Section>

<style>
  .values {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: var(--space-2);
  }

</style>
