<script lang="ts">
  /**
   * Villain / minion card content.
   *
   * Ordered by how often it is touched: name and copies first, then the combat
   * values as three tap-to-toggle controls, then the ability. Timed blocks are
   * added on demand and always print in the fixed Immediately → During Combat →
   * After Combat order, so the editor never shows a field the card will not use.
   */
  import type { CardTheme } from '$lib/cards/style';
  import type { StyleOrigin } from '$lib/cards/theme';
  import { STYLE_ORIGIN_LABELS } from '$lib/cards/theme';
  import { COMBAT_SYMBOLS } from '$lib/cards/types';
  import type { ActionCard, CardOwner, CombatSymbol } from '$lib/cards/types';
  import { characterLabel, primaryCardName } from '$lib/characters/factory';
  import { deckLabel } from '$lib/decks/factory';
  import type { DeckId } from '$lib/decks/types';
  import { asId } from '$lib/core/id';
  import { CARD_SYMBOL_LABELS, CARD_SYMBOLS } from '$lib/renderer/assets';
  import { characterForCard, deckOwner, resolveStyleForCard, styleOriginForCard } from '$lib/sets/queries';
  import { workshop } from '$lib/state/workshop.svelte';
  import {
    Field,
    NumberInput,
    Section,
    SegmentedControl,
    Select,
    Switch,
    TextArea,
    TextInput
  } from '$lib/ui';
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

  /**
   * The character whose deck this card is in — a hero's card prints a ribbon
   * no other role has, and the only place that is decided is who owns the
   * deck it sits in.
   */
  const owner = $derived(characterForCard(workshop.adventure, card));
  const isHero = $derived(owner?.role === 'hero');

  /**
   * For the Bonus ability colour and the ability text size, both edited from
   * inside `AbilityStack` alongside the fields they affect rather than
   * tucked away in Design — see that component.
   */
  const styleTarget = $derived({ entity: 'card' as const, id: card.id });
  const resolvedTheme = $derived(resolveStyleForCard(workshop.adventure, card));
  function originFor(key: keyof CardTheme): string {
    const origin: StyleOrigin = styleOriginForCard(workshop.adventure, card, key);
    return STYLE_ORIGIN_LABELS[origin];
  }

  /**
   * The four combat symbols, as a toggle rather than a menu.
   *
   * Four short fixed choices with a visible effect on the card, exactly like
   * "who may play this card" below it — a menu hides three of them behind a
   * click and gives nothing back for it.
   */
  const symbolOptions = COMBAT_SYMBOLS.map((symbol) => ({
    value: symbol,
    label: CARD_SYMBOL_LABELS[symbol]
  }));

  const isScheme = $derived(card.symbol === 'scheme');

  /**
   * "Who may play this card" pulls from the hero's own named identities: the
   * primary one, then each additional character card, then the sidekick —
   * only when it's a swarm, since a single tracked companion is now itself
   * an additional card, not a separate slot — then "Any," always last.
   */
  const ownerOptions = $derived.by(() => {
    const options: { value: CardOwner; label: string }[] = [
      { value: 'hero', label: (owner ? primaryCardName(owner) : '').trim() || 'Hero' }
    ];
    for (const extra of owner?.additionalCards ?? []) {
      options.push({ value: extra.id, label: extra.name.trim() || 'Character card' });
    }
    if (owner?.sidekick.enabled && owner.sidekick.multiple) {
      options.push({ value: 'sidekick', label: owner.sidekick.name.trim() || 'Sidekick' });
    }
    options.push({ value: 'any', label: 'Any' });
    return options;
  });

  function edit(mutate: (target: ActionCard) => void): void {
    workshop.editCard(card.id, (target) => {
      if (target.type === 'action') mutate(target);
    });
  }

</script>

<!-- What the card is called and where it lives: four short fields, two by two. -->
<Section title="Card" columns={2}>
  {#if isHero}
    <!--
      Card title first and prominent, ahead of Name override — the title is
      what prints and what an author actually fills in; the override is the
      edge case, blank on nearly every card (see its own placeholder).
    -->
    <Field label="Card title">
      <TextInput bind:value={card.title} placeholder="Card title" prominent />
    </Field>

    <Field label="Name override">
      <TextInput bind:value={card.name} placeholder="Leave blank to use the hero’s own name" />
    </Field>
  {:else}
    <Field label="Name on the ribbon">
      <TextInput bind:value={card.name} placeholder="Villain name" prominent />
    </Field>

    <Field label="Card title">
      <TextInput bind:value={card.title} placeholder="Card title" />
    </Field>
  {/if}

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

{#if isHero}
  <!--
    A hero's card prints one symbol and one value in the ribbon, and who may
    play it — never the attack/defense pair or the split layout a villain or
    minion card can carry, so those controls do not appear here at all rather
    than sitting disabled.
  -->
  <Section title="Combat" description="What prints in the ribbon, and who may play the card.">
    <Field label="Card type">
      <SegmentedControl
        label="Card type"
        value={card.symbol ?? 'attack'}
        segments={symbolOptions}
        onchange={(value) => edit((target) => (target.symbol = value as CombatSymbol))}
      />
    </Field>

    <!--
      Keyed on the card for the same reason the villain block below is: a
      control that remembers the number it carried before it was switched off
      remembers it for *that* card, not for the panel.
    -->
    {#key card.id}
      <div class="hero-combat">
        <!--
          A scheme card has no value at all — that is what the symbol means —
          so the control goes rather than sitting at nought or disabled. The
          card keeps whatever it last held, so switching back restores it.
          Boost keeps its own explicit column so losing Value doesn't shift
          it left — an unplaced lone item would otherwise auto-flow into the
          first track.
        -->
        {#if !isScheme}
          <div class="value-slot">
            <ValueControl
              label="Value"
              symbol={CARD_SYMBOLS[card.symbol ?? 'attack']}
              value={card.symbolValue}
              defaultValue={2}
              max={9}
              onchange={(value) => edit((target) => (target.symbolValue = value))}
            />
          </div>
        {/if}

        <div class="boost-slot">
          <ValueControl
            label="Boost"
            value={card.boost}
            defaultValue={1}
            min={1}
            max={9}
            onchange={(boost) => edit((target) => (target.boost = boost))}
          />
        </div>
      </div>
    {/key}

    <Field label="Who may play this card">
      <SegmentedControl
        label="Card owner"
        value={card.owner}
        segments={ownerOptions}
        onchange={(value) => edit((target) => (target.owner = value as CardOwner))}
      />
    </Field>

    <AbilityStack
      title="Ability"
      ability={card.ability}
      onchange={(patch) => edit((target) => Object.assign(target.ability, patch))}
      target={styleTarget}
      resolved={resolvedTheme}
      {originFor}
      customSymbols={workshop.adventure.customSymbols}
    />
  </Section>
{:else}
  <!--
    Everything the card does, in one block: what it is worth, then what it
    says. Split puts the defense side under the attack side, which is how it
    prints.
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
        target={styleTarget}
        resolved={resolvedTheme}
        {originFor}
        customSymbols={workshop.adventure.customSymbols}
      />
      <AbilityStack
        title="Defense side"
        symbol={CARD_SYMBOLS.defense}
        hint="Printed below it. The separator moves up as this side fills."
        ability={card.defenseAbility}
        onchange={(patch) => edit((target) => Object.assign(target.defenseAbility, patch))}
        target={styleTarget}
        resolved={resolvedTheme}
        {originFor}
        textStyle={false}
        customSymbols={workshop.adventure.customSymbols}
      />
    {:else}
      <AbilityStack
        title="Ability"
        ability={card.ability}
        onchange={(patch) => edit((target) => Object.assign(target.ability, patch))}
        target={styleTarget}
        resolved={resolvedTheme}
        {originFor}
        customSymbols={workshop.adventure.customSymbols}
      />
    {/if}
  </Section>
{/if}

<Section title="Notes" description="Working notes. Never printed.">
  <TextArea bind:value={card.notes} rows={2} placeholder="Balance thoughts, references…" />
</Section>

<style>
  .values {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .hero-combat {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  /* Boost keeps this column even when Value isn't rendered (a scheme card),
     so it never shifts left into Value's spot. */
  .value-slot {
    grid-column: 1;
  }

  .boost-slot {
    grid-column: 2;
  }

  @container workspace (max-width: 480px) {
    .values,
    .hero-combat {
      grid-template-columns: minmax(0, 1fr);
    }

    .value-slot,
    .boost-slot {
      grid-column: auto;
    }
  }
</style>
