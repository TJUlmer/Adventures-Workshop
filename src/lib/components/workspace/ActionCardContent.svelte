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
  import { abilityIsEmpty, COMBAT_SYMBOLS } from '$lib/cards/types';
  import type {
    ActionCard,
    CardOwner,
    CombatSymbol,
    TuckEffectOrientation
  } from '$lib/cards/types';
  import { characterLabel, primaryCardName } from '$lib/characters/factory';
  import { deckLabel } from '$lib/decks/factory';
  import type { DeckId } from '$lib/decks/types';
  import { asId } from '$lib/core/id';
  import { CARD_SYMBOL_LABELS, CARD_SYMBOLS } from '$lib/renderer/assets';
  import { characterForCard, deckOwner, resolveStyleForCard, styleOriginForCard } from '$lib/sets/queries';
  import { customSymbolLabel } from '$lib/symbols/types';
  import { customSymbolToken, symbolToken } from '$lib/text/tokens';
  import { workshop } from '$lib/state/workshop.svelte';
  import {
    Field,
    FillEditor,
    ColorInput,
    NumberInput,
    Section,
    SegmentedControl,
    Select,
    Slider,
    Switch,
    TextArea,
    TextInput
  } from '$lib/ui';
  import AbilityField from './AbilityField.svelte';
  import AbilityStack from './AbilityStack.svelte';
  import FormattedTextField from './FormattedTextField.svelte';
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
  /** This card's own layer, for `FillEditor`'s override/inherit distinction — see `StylePanel`. */
  const styleLayer = $derived(workshop.styleFor(styleTarget) ?? {});
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

  const tuckEffectOrientations = [
    { value: 'bottom', label: 'Bottom' },
    { value: 'right', label: 'Right side' }
  ] as const;

  const isScheme = $derived(card.symbol === 'scheme');
  const hasSeparateDefenseAbility = $derived(!abilityIsEmpty(card.defenseAbility));
  const availableCustomSymbols = $derived(
    workshop.adventure.customSymbols.filter((symbol) => symbol.source)
  );

  /**
   * "Who may play this card" pulls from the hero's own named identities: the
   * primary one, then each additional character card, then the sidekick when
   * enabled, then "Any," always last. `multiple` only chooses the sidekick's
   * printed layout; a single tracked companion is still a playable identity.
   */
  const ownerOptions = $derived.by(() => {
    const options: { value: CardOwner; label: string }[] = [
      { value: 'hero', label: (owner ? primaryCardName(owner) : '').trim() || 'Hero' }
    ];
    for (const extra of owner?.additionalCards ?? []) {
      options.push({ value: extra.id, label: extra.name.trim() || 'Character card' });
    }
    if (owner?.sidekick.enabled) {
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

{#snippet boostSymbolPicker()}
  <!-- The symbol is only a printed override. Keeping the number control below
       means None can reveal the previous boost value without resetting it. -->
  <div class="boost-symbol-picker" role="group" aria-label="Boost symbol">
    <span class="boost-symbol-label">Boost symbol</span>
    <button
      type="button"
      class="icon-choice"
      class:active={!card.boostSymbol}
      onclick={() => edit((target) => (target.boostSymbol = ''))}
    >
      None
    </button>
    {#each availableCustomSymbols as symbol (symbol.id)}
      <button
        type="button"
        class="icon-choice"
        class:active={card.boostSymbol === customSymbolToken(symbol.id)}
        onclick={() => edit((target) => (target.boostSymbol = customSymbolToken(symbol.id)))}
      >
        <img src={symbol.source} alt="" />
        {customSymbolLabel(symbol)}
      </button>
    {/each}
  </div>
{/snippet}

<!-- What the card is called and where it lives: four short fields, two by two. -->
<Section title="Card" columns={2} prominentHeading>
  {#if isHero}
    <!--
      Card title first and prominent, ahead of Name override — the title is
      what prints and what an author actually fills in; the override is the
      edge case, blank on nearly every card (see its own placeholder).
    -->
    <FormattedTextField
      label="Card title"
      value={card.title}
      placeholder="Card title"
      prominent
      multiline={false}
      onchange={(title) => edit((target) => (target.title = title))}
      customSymbols={workshop.adventure.customSymbols}
    />

    <Field label="Name override">
      <TextInput
        value={card.name}
        placeholder="Leave blank to use the selected character’s name"
        oninput={(event) => edit((target) => (target.name = event.currentTarget.value))}
      />
    </Field>
  {:else}
    <Field label="Name on the ribbon">
      <TextInput
        value={card.name}
        placeholder="Villain name"
        prominent
        oninput={(event) => edit((target) => (target.name = event.currentTarget.value))}
      />
    </Field>

    <FormattedTextField
      label="Card title"
      value={card.title}
      placeholder="Card title"
      multiline={false}
      onchange={(title) => edit((target) => (target.title = title))}
      customSymbols={workshop.adventure.customSymbols}
    />
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
    An ordinary hero card prints one symbol and one value in the ribbon. Split
    combat replaces that display with a fixed versatile glyph and moves both
    values into the body; its extra fields live beside that effect's toggle.
  -->
  <Section
    title="Combat"
    prominentHeading
    description="Card text and values, and who may play this card."
  >
    {#if !card.split}
      <Field label="Card type">
        <SegmentedControl
          label="Card type"
          value={card.symbol ?? 'attack'}
          segments={symbolOptions}
          onchange={(value) => edit((target) => (target.symbol = value as CombatSymbol))}
        />
      </Field>
    {/if}

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
        {#if !card.split && !isScheme}
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
          {@render boostSymbolPicker()}
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

    {#if !card.split}
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
{:else}
  <!--
    Everything the card does, in one block: what it is worth, then what it
    says. Split puts the defense side under the attack side, which is how it
    prints.
  -->
  <Section
    title="Combat"
    description="Card text and values, and who may play this card."
    prominentHeading
  >
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
        <div class="boost-slot">
          {@render boostSymbolPicker()}
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

<Section
  title="Special card effects"
  description="Optional official and unofficial card effect augmentations."
  prominentHeading
>
  {#if isHero}
    <div class="effect-option">
      <Switch
        label="Split combat"
        hint="Replaces the ribbon value with separate attack and defense values and abilities in the body panel."
        checked={card.split}
        onchange={(split) =>
          edit((target) => {
            target.split = split;
            if (!split) return;
            target.attack ??= target.symbolValue ?? 2;
            target.defense ??= target.symbolValue ?? 2;
          })}
      />

      {#if card.split}
        {#key card.id}
          <div class="split-values">
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
          </div>
        {/key}

        <AbilityStack
          title="Attack side"
          symbol={CARD_SYMBOLS.attack}
          hint={hasSeparateDefenseAbility
            ? 'Printed above the floating separator.'
            : 'Applies to both attack and defense until the Defense side contains text.'}
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
          hint={hasSeparateDefenseAbility
            ? 'Printed below the floating separator.'
            : 'Add text here to give defense its own effect and show the separator.'}
          ability={card.defenseAbility}
          onchange={(patch) => edit((target) => Object.assign(target.defenseAbility, patch))}
          target={styleTarget}
          resolved={resolvedTheme}
          {originFor}
          textStyle={false}
          customSymbols={workshop.adventure.customSymbols}
        />
      {/if}
    </div>
  {/if}

  <div class="effect-option">
    <Switch
      label="Ribbon symbol"
      hint="Places an optional symbol in the strip between the ribbon and divider."
      checked={card.showRibbonSymbol}
      onchange={(show) => edit((target) => (target.showRibbonSymbol = show))}
    />

    {#if card.showRibbonSymbol}
      <div class="icon-picker" role="group" aria-label="Ribbon symbol">
        <button
          type="button"
          class="icon-choice"
          class:active={!card.ribbonSymbol}
          onclick={() => edit((target) => (target.ribbonSymbol = ''))}
        >
          None
        </button>
        {#each COMBAT_SYMBOLS as name (name)}
          <button
            type="button"
            class="icon-choice"
            class:active={card.ribbonSymbol === symbolToken(name)}
            onclick={() => edit((target) => (target.ribbonSymbol = symbolToken(name)))}
          >
            <img src={CARD_SYMBOLS[name]} alt="" />
            {CARD_SYMBOL_LABELS[name]}
          </button>
        {/each}
        {#each workshop.adventure.customSymbols.filter((s) => s.source) as symbol (symbol.id)}
          <button
            type="button"
            class="icon-choice"
            class:active={card.ribbonSymbol === customSymbolToken(symbol.id)}
            onclick={() => edit((target) => (target.ribbonSymbol = customSymbolToken(symbol.id)))}
          >
            <img src={symbol.source} alt="" />
            {customSymbolLabel(symbol)}
          </button>
        {/each}
      </div>

      <!-- Bleed pixels, not a multiple of the ability text — this symbol stands
           alone rather than sitting in a run of copy. See `ribbonSymbolSize`. -->
      <Slider
        label="Symbol size"
        value={resolvedTheme.ribbonSymbolSize}
        min={40}
        max={220}
        step={2}
        neutral={110}
        format={(value) => `${Math.round(value)}`}
        onchange={(size) => workshop.setStyle(styleTarget, 'ribbonSymbolSize', size)}
      />

      <!--
        The strip's own fill, not the symbol's: `ribbonFoot` already exists as
        one of `StylePanel`'s "Surfaces", but a change here is exactly what
        this section is for, so it gets a shortcut to the same field rather
        than sending an author to Design for one colour. A per-symbol colour
        was tried instead and reverted — the four combat symbols (and any
        custom upload) are small multi-colour illustrations with no
        transparency of their own, so masking one to a single colour just
        filled a rectangle and hid the art.
      -->
      <FillEditor
        label="Fill colour"
        value={resolvedTheme.ribbonFoot}
        origin={originFor('ribbonFoot')}
        overridden={styleLayer.ribbonFoot !== undefined}
        onchange={(fill) => workshop.setStyle(styleTarget, 'ribbonFoot', fill)}
        onreset={() => workshop.setStyle(styleTarget, 'ribbonFoot', undefined)}
      />
    {/if}
  </div>

  <div class="effect-option">
    <Switch
      label="Boost effect"
      hint="Adds a short rules reminder to the left of the boost value."
      checked={card.showBoostEffect}
      onchange={(show) => edit((target) => (target.showBoostEffect = show))}
    />

    {#if card.showBoostEffect}
      <Field label="Effect text" hint="The attachment lengthens to fit longer text.">
        <TextInput
          value={card.boostEffect}
          placeholder="Draw 2 cards"
          oninput={(event) =>
            edit((target) => (target.boostEffect = event.currentTarget.value))}
        />
      </Field>
    {/if}
  </div>

  <div class="effect-option">
    <Switch
      label="Bonus attack"
      hint="Adds a second attack in a divided, lighter section at the bottom of the card."
      checked={card.showBonusAttack}
      onchange={(show) => edit((target) => (target.showBonusAttack = show))}
    />

    {#if card.showBonusAttack}
      <div class="bonus-attack-head">
        <FormattedTextField
          label="Bonus attack title"
          value={card.bonusAttackTitle}
          placeholder="Bonus attack title"
          prominent
          multiline={false}
          onchange={(title) => edit((target) => (target.bonusAttackTitle = title))}
          customSymbols={workshop.adventure.customSymbols}
        />

        <Field label="Combat value">
          <NumberInput
            value={card.bonusAttackValue}
            min={0}
            max={9}
            onchange={(value) => edit((target) => (target.bonusAttackValue = value))}
          />
        </Field>
      </div>

      <AbilityField
        label="Bonus attack ability"
        value={card.bonusAttackAbility}
        rows={3}
        formatted
        placeholder="Ability text…"
        onchange={(value) => edit((target) => (target.bonusAttackAbility = value))}
        customSymbols={workshop.adventure.customSymbols}
      />
    {/if}
  </div>

  <div class="effect-option">
    <Switch
      label="Tuck effect"
      hint="Adds reminder text on an exposed edge while this card is tucked behind another card."
      checked={card.showTuckEffect}
      onchange={(show) => edit((target) => (target.showTuckEffect = show))}
    />

    {#if card.showTuckEffect}
      <Field label="Effect text">
        <TextInput
          value={card.tuckEffect}
          placeholder="When you play a scheme, gain 1 action."
          oninput={(event) => edit((target) => (target.tuckEffect = event.currentTarget.value))}
        />
      </Field>

      <Field label="Orientation">
        <SegmentedControl
          label="Tuck effect orientation"
          value={card.tuckEffectOrientation}
          segments={tuckEffectOrientations}
          onchange={(orientation) =>
            edit((target) => {
              target.tuckEffectOrientation = orientation as TuckEffectOrientation;
            })}
        />
      </Field>

      <div class="effect-colours">
        <FillEditor
          label="Bar fill"
          value={resolvedTheme.tuckEffect}
          origin={originFor('tuckEffect')}
          overridden={styleLayer.tuckEffect !== undefined}
          onchange={(fill) => workshop.setStyle(styleTarget, 'tuckEffect', fill)}
          onreset={() => workshop.setStyle(styleTarget, 'tuckEffect', undefined)}
        />

        <label class="effect-ink">
          <span>Text</span>
          <ColorInput
            value={styleLayer.tuckEffectInk as string | undefined}
            inherited={resolvedTheme.tuckEffectInk}
            origin={originFor('tuckEffectInk')}
            onchange={(ink) => workshop.setStyle(styleTarget, 'tuckEffectInk', ink)}
          />
        </label>
      </div>
    {/if}
  </div>

  <div class="effect-option">
    <Switch
      label="Corner badge"
      hint="Adds a square badge for a symbol or short value in the upper-right corner."
      checked={card.showCornerBadge}
      onchange={(show) => edit((target) => (target.showCornerBadge = show))}
    />

    {#if card.showCornerBadge}
      <AbilityField
        label="Badge content"
        value={card.cornerBadge}
        placeholder="Symbol or value"
        rows={1}
        onchange={(content) => edit((target) => (target.cornerBadge = content))}
        customSymbols={workshop.adventure.customSymbols}
      />

      <FillEditor
        label="Background colour"
        value={resolvedTheme.cornerBadge}
        origin={originFor('cornerBadge')}
        overridden={styleLayer.cornerBadge !== undefined}
        onchange={(fill) => workshop.setStyle(styleTarget, 'cornerBadge', fill)}
        onreset={() => workshop.setStyle(styleTarget, 'cornerBadge', undefined)}
      />

      <Slider
        label="Background opacity"
        value={resolvedTheme.cornerBadgeOpacity}
        min={0}
        max={1}
        step={0.01}
        neutral={1}
        format={(value) => `${Math.round(value * 100)}%`}
        onchange={(opacity) => workshop.setStyle(styleTarget, 'cornerBadgeOpacity', opacity)}
      />

      <label class="effect-ink">
        <span>Content colour</span>
        <ColorInput
          value={styleLayer.cornerBadgeInk as string | undefined}
          inherited={resolvedTheme.cornerBadgeInk}
          origin={originFor('cornerBadgeInk')}
          onchange={(ink) => workshop.setStyle(styleTarget, 'cornerBadgeInk', ink)}
        />
      </label>
    {/if}
  </div>
</Section>

<Section title="Notes" description="Working notes. Never printed." prominentHeading>
  <TextArea bind:value={card.notes} rows={2} placeholder="Balance thoughts, references…" />
</Section>

<style>
  /*
   * The same chip row `AbilityStack` uses for the Bonus icon, repeated rather
   * than shared: component styles are scoped, and the two rows are four
   * declarations, not a component's worth of behaviour.
   */
  .icon-picker {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .boost-symbol-picker {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .boost-symbol-label {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .effect-option {
    display: grid;
    gap: var(--space-4);
  }

  .effect-option + .effect-option {
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-subtle);
  }

  .bonus-attack-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 112px;
    align-items: end;
    gap: var(--space-3);
  }

  .effect-colours {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: end;
    gap: var(--space-3);
  }

  .effect-ink {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  @container workspace (max-width: 520px) {
    .bonus-attack-head,
    .effect-colours {
      grid-template-columns: 1fr;
    }
  }

  .icon-choice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 28px;
    padding-inline: var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
    font-size: var(--text-xs);
    color: var(--text-muted);
    transition:
      color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out);
  }

  .icon-choice:hover {
    color: var(--text-secondary);
    border-color: var(--border-strong);
  }

  .icon-choice.active {
    color: var(--text-primary);
    border-color: var(--border-accent);
    background: var(--accent-soft);
  }

  .icon-choice img {
    width: 14px;
    height: 14px;
    object-fit: contain;
  }

  .values {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: end;
    gap: var(--space-2);
  }

  .split-values {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .hero-combat {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: end;
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
    display: grid;
    gap: var(--space-2);
  }

  .values .boost-slot {
    grid-column: 3;
  }

  @container workspace (max-width: 480px) {
    .values,
    .split-values,
    .hero-combat {
      grid-template-columns: minmax(0, 1fr);
    }

    .value-slot,
    .boost-slot {
      grid-column: auto;
    }
  }
</style>
