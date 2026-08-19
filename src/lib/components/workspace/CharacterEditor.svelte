<script lang="ts">
  import { deckSize } from '$lib/cards/factory';
  import type { CardTheme } from '$lib/cards/style';
  import { ACTION_SURFACES, resolveCardTheme } from '$lib/cards/theme';
  import {
    characterLabel,
    createCharacterAbility,
    createHeroCharacterCard,
    primaryCardName,
    suggestedGroupName
  } from '$lib/characters/factory';
  import { ATTACK_TYPE_LABELS, ATTACK_TYPES } from '$lib/characters/types';
  import type {
    CharacterAbility,
    CharacterCardDesign,
    CharacterRole,
    HeroCharacterCardId
  } from '$lib/characters/types';
  import { CHARACTER_ROLE_META, SELECTABLE_ROLES } from '$lib/characters/types';
  import type { DeckId, DeckKind } from '$lib/decks/types';
  import { DECK_KIND_META, DECK_KINDS } from '$lib/decks/types';
  import { hasArtwork } from '$lib/core/artwork';
  import { characterEditorView } from '$lib/state/character-editor-view.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import {
    Button,
    Field,
    Icon,
    NumberInput,
    Section,
    SegmentedControl,
    Select,
    Switch,
    Tabs,
    TextArea,
    TextInput
  } from '$lib/ui';
  import AbilityField from './AbilityField.svelte';
  import CardbackPanel from './CardbackPanel.svelte';
  import CharacterCardPanel from './CharacterCardPanel.svelte';
  import ReplacementPanel from './ReplacementPanel.svelte';
  import StylePanel from './StylePanel.svelte';
  import WorkspaceHeader from './WorkspaceHeader.svelte';

  const ATTACK_TYPE_OPTIONS = ATTACK_TYPES.map((type) => ({
    value: type,
    label: ATTACK_TYPE_LABELS[type]
  }));

  const ABILITY_KIND_OPTIONS = [
    { value: 'passive' as const, label: 'Passive' },
    { value: 'triggered' as const, label: 'Triggered' }
  ];

  function addAbilityTo(abilities: CharacterAbility[]): void {
    abilities.push(createCharacterAbility());
  }

  /**
   * The printed sheet shows a placeholder-styled block whether the list is
   * empty or holds one blank entry (see `HeroCharacterCardFace`) — so the
   * list never actually goes to zero: removing the only ability just clears
   * it back to blank, keeping one editable row on screen at all times rather
   * than swapping in an "Add ability" prompt.
   */
  function removeAbilityFrom(abilities: CharacterAbility[], index: number): void {
    if (abilities.length <= 1) {
      abilities[index] = createCharacterAbility();
      return;
    }
    abilities.splice(index, 1);
  }

  /** Read from the store rather than taken as a prop — see Workspace.svelte. */
  const character = $derived(workshop.selectedCharacter);
  const decks = $derived(character ? workshop.decksFor(character.id) : []);

  const roleSegments = SELECTABLE_ROLES.map((role) => ({
    value: role,
    label: CHARACTER_ROLE_META[role].label,
    colorVar: CHARACTER_ROLE_META[role].colorVar
  }));

  const deckKindOptions = DECK_KINDS.map((kind) => ({
    value: kind,
    label: DECK_KIND_META[kind].label
  }));

  /** What this character's cards look like before any per-card override. */
  const resolvedTheme: CardTheme | null = $derived(
    character
      ? resolveCardTheme(workshop.adventure.style, character.style, null, 'action', character.role)
      : null
  );

  function originFor(key: keyof CardTheme): string {
    return workshop.adventure.style[key] !== undefined ? 'set' : 'template';
  }

  function setRole(role: CharacterRole): void {
    if (character) character.role = role;
  }

  /**
   * Whether a finished image stands in for this sheet, so there is nothing
   * left to compose. `CharacterCardPanel` hides its own contents on the same
   * condition; this is for the heading around it, which lives out here.
   * Named as `CardEditor`'s `replacedEntirely` is, for the same state.
   */
  function sheetReplaced(design: CharacterCardDesign): boolean {
    return design.useReplacement && hasArtwork(design.replacement);
  }

  function setDeckKind(deckId: DeckId, kind: string): void {
    const deck = decks.find((candidate) => candidate.id === deckId);
    if (deck) deck.kind = kind as DeckKind;
  }

  /**
   * The moment a second identity exists, `name` stops meaning "this one
   * character's own name" and starts meaning the whole hero's — so whatever
   * was already typed there (e.g. "Cloak") moves to `printedName`, which is
   * what takes over that job from here, rather than being silently orphaned.
   */
  function addCharacterCard(): void {
    if (!character) return;
    if (character.additionalCards.length === 0) {
      character.printedName = character.name;
      character.name = '';
    }
    const created = createHeroCharacterCard();
    character.additionalCards.push(created);
    characterEditorView.tab = `card:${created.id}`;
  }

  /** The reverse transfer, back to solo, when the last additional card goes. */
  function removeCharacterCard(index: number): void {
    if (!character) return;
    character.additionalCards.splice(index, 1);
    if (character.additionalCards.length === 0) {
      character.name = character.printedName || character.name;
      character.printedName = '';
    }
    characterEditorView.tab = 'identity';
  }

  /**
   * The editor's tabs — one per printable thing, so the preview beside it can
   * show exactly one at a time instead of stacking them together.
   *
   * Every role gets these now. They were a hero-only affordance at first, on
   * the reasoning that only a hero has more than one printable identity — but
   * that counted character cards and overlooked the two things every figure
   * has regardless: a deck back and an action-card-defaults sample. A villain
   * was rendering both at once in the preview, which is the exact stacking
   * these were introduced to stop.
   *
   * What is genuinely hero-only is the character card, so a villain or minion
   * gets three tabs rather than four-plus: no `primary`, no `card:` entries,
   * because there is no such sheet to print.
   */
  const characterTabs = $derived.by(() => {
    if (!character) return [];
    if (character.role !== 'hero') {
      return [
        { value: 'identity', label: 'Identity' },
        { value: 'cardback', label: 'Deck back' },
        { value: 'defaults', label: 'Action card defaults' }
      ];
    }

    const tabs = [
      { value: 'identity', label: 'Identity' },
      { value: 'primary', label: primaryCardName(character) || 'Character card' }
    ];
    for (const extra of character.additionalCards) {
      tabs.push({ value: `card:${extra.id}`, label: extra.name.trim() || 'Character card' });
    }
    tabs.push(
      { value: 'cardback', label: 'Deck back' },
      { value: 'defaults', label: 'Action card defaults' }
    );
    return tabs;
  });

  const activeExtra = $derived.by(() => {
    if (!character) return null;
    const index = character.additionalCards.findIndex(
      (entry) => `card:${entry.id}` === characterEditorView.tab
    );
    return index >= 0 ? { entry: character.additionalCards[index]!, index } : null;
  });

  /**
   * Resets to the first tab on every character switch — a stale tab from a
   * previously-open hero would otherwise persist across an unrelated one.
   *
   * Unless something asked for a specific tab *on this switch* — see
   * `characterEditorView`'s own `#pendingTab` doc comment for why that is a
   * plain field consumed through a method, not a second `$state` read
   * directly here.
   */
  $effect(() => {
    void character?.id;
    characterEditorView.tab = characterEditorView.consumePendingTab() ?? 'identity';
  });
</script>

{#snippet abilityList(
  abilities: CharacterAbility[],
  onAdd: () => void,
  onRemove: (index: number) => void
)}
  <div class="ability-block">
    <div class="ability-block-head">
      <span class="ability-block-label">Special ability</span>
      <Button size="sm" variant="ghost" onclick={onAdd}>
        <Icon name="plus" size={13} />
        Add ability
      </Button>
    </div>

    {#if abilities.length === 0}
      <p class="hint">No abilities yet. The card prints a placeholder until one is added.</p>
    {:else}
      <ul class="abilities">
        {#each abilities as ability, index (index)}
          <li class="ability">
            <div class="ability-row">
              <TextInput bind:value={ability.name} placeholder="Ability name" prominent />
              <div class="ability-kind">
                <Select
                  value={ability.kind}
                  options={ABILITY_KIND_OPTIONS}
                  onchange={(value) => (ability.kind = value)}
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                aria-label="Remove ability"
                onclick={() => onRemove(index)}
              >
                <Icon name="trash" size={13} />
              </Button>
            </div>
            <AbilityField
              label="Ability text"
              value={ability.text}
              rows={2}
              placeholder="Ability text goes here."
              onchange={(value) => (ability.text = value)}
              customSymbols={workshop.adventure.customSymbols}
            />
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/snippet}

{#snippet decksSection()}
  <Section title="Decks" description="Every deck this figure deals from.">
    {#snippet actions()}
      <Button size="sm" variant="ghost" onclick={() => workshop.addDeck('special', character!.id)}>
        <Icon name="plus" size={13} />
        Add deck
      </Button>
    {/snippet}

    {#if decks.length === 0}
      <p class="hint">This character has no decks. Add one to start writing cards.</p>
    {:else}
      <ul class="decks">
        {#each decks as deck (deck.id)}
          {@const cards = workshop.cardsIn(deck.id)}
          <li class="deck">
            <TextInput bind:value={deck.name} placeholder="Deck name" />

            <div class="deck-controls">
              <div class="deck-kind">
                <Select
                  value={deck.kind}
                  options={deckKindOptions}
                  onchange={(kind) => setDeckKind(deck.id, kind)}
                />
              </div>
              <span class="deck-count numeric" title="Cards to print">{deckSize(cards)}</span>
              <Button size="sm" onclick={() => workshop.addCard(deck.id)}>
                <Icon name="plus" size={13} />
                Card
              </Button>
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                aria-label="Delete deck"
                title="Delete deck and its {cards.length} cards"
                onclick={() => workshop.removeDeck(deck.id)}
              >
                <Icon name="trash" size={13} />
              </Button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </Section>
{/snippet}

{#snippet characterCardReplacement(design: CharacterCardDesign, cardId?: HeroCharacterCardId)}
  <!--
    First on the tab, above the name and stats, for the reason it is first
    everywhere: it decides whether any of them print. `CharacterCardPanel`
    below hides itself entirely while this is on.
  -->
  <ReplacementPanel
    artwork={design.replacement}
    enabled={design.useReplacement}
    hint="A finished character card, used instead of composing one."
    replaces="Replaces the whole printed sheet, template included."
    onpick={(source, label) =>
      workshop.editCharacterCard(
        character!.id,
        (card) => {
          card.replacement.source = source;
          card.replacement.label = label;
          card.useReplacement = true;
        },
        cardId
      )}
    ontoggle={(use) =>
      workshop.editCharacterCard(character!.id, (card) => (card.useReplacement = use), cardId)}
    onclear={() =>
      workshop.editCharacterCard(
        character!.id,
        (card) => {
          card.replacement.source = null;
          card.replacement.label = '';
          card.useReplacement = false;
        },
        cardId
      )}
  />
{/snippet}

{#snippet cardbackSection()}
  <!--
    No Section around this. The replacement image is the first question on
    every design surface — it decides whether anything below it applies — so
    it is the first block everywhere, never nested one level in. The tab is
    already called "Deck back", which is all the subject heading a wrapper
    was supplying. See `CardEditor`, which sets the pattern.
  -->
  <p class="lede">Printed on the back of every card in this figure’s decks.</p>
  <CardbackPanel character={character!} />
{/snippet}

{#snippet defaultsSection()}
  <!--
    These style the figure's *cards*, not the figure. Naming the block is what
    stops it reading as more character fields; the preview alongside shows
    exactly what the controls are moving.
  -->
  <Section
    title="Action card defaults"
    description="How every card in this figure’s decks looks before a card overrides it. The preview beside this panel shows it."
  >
    <StylePanel
      target={{ entity: 'character', id: character!.id }}
      resolved={resolvedTheme!}
      {originFor}
      surfaces={ACTION_SURFACES}
    />
  </Section>
{/snippet}

{#snippet notesSection()}
  <Section title="Notes" description="Working notes. Never printed.">
    <Field label="Private notes">
      <TextArea bind:value={character!.notes} rows={3} placeholder="Design intent, references…" />
    </Field>
  </Section>
{/snippet}

{#if character && resolvedTheme}
  {@const meta = CHARACTER_ROLE_META[character.role]}

  <WorkspaceHeader
    eyebrow={meta.label}
    title={characterLabel(character)}
    subtitle={meta.description}
    colorVar={meta.colorVar}
  >
    {#snippet actions()}
      <Button variant="danger" size="sm" onclick={() => workshop.removeCharacter(character.id)}>
        <Icon name="trash" size={13} />
        Delete
      </Button>
    {/snippet}
  </WorkspaceHeader>

  <div class="body scroll-y">
    <Tabs
      bind:value={characterEditorView.tab}
      tabs={characterTabs}
      label="Character editor sections"
    />

    {#if character.role === 'hero'}
      {#if characterEditorView.tab === 'identity'}
        <div class="tiles">
          <Section title="Identity" description="How the figure is presented on its sheet.">
            {#snippet actions()}
              <Button size="sm" variant="ghost" onclick={addCharacterCard}>
                <Icon name="plus" size={13} />
                +1 character card
              </Button>
            {/snippet}

            <Field
              label="Name"
              hint={character.additionalCards.length > 0
                ? 'The whole hero, printed on the roster, the deck back and every action card.'
                : undefined}
            >
              <TextInput
                bind:value={character.name}
                placeholder={character.additionalCards.length > 0
                  ? suggestedGroupName(character) || 'Name this hero'
                  : 'Name this character'}
                prominent
              />
            </Field>

            <Field label="Role">
              <SegmentedControl
                label="Character role"
                value={character.role}
                segments={roleSegments}
                onchange={setRole}
              />
            </Field>

            <Field label="Figures" inline note="on board" hint="Identical figures this entry places.">
              <NumberInput bind:value={character.figureCount} min={1} max={12} />
            </Field>
          </Section>

          <div class="column">
            {@render decksSection()}
          </div>
        </div>

        {@render notesSection()}
      {:else if characterEditorView.tab === 'primary'}
        {@render characterCardReplacement(character.characterCard)}

        <div class="tiles">
          <Field label="Name" hint="Printed on this character's own sheet, and in “who may play this card.”">
            <TextInput
              bind:value={character.printedName}
              placeholder={character.name.trim() || 'Name this character'}
              prominent
            />
          </Field>

          <Field label="Shortened name" hint="Used on the action card ribbon. Blank uses the full name.">
            <TextInput bind:value={character.subtitle} placeholder="e.g. Geralt" />
          </Field>
        </div>

        <Field label="Attack type">
          <SegmentedControl
            label="Attack type"
            value={character.attackType}
            segments={ATTACK_TYPE_OPTIONS}
            onchange={(value) => (character.attackType = value)}
          />
        </Field>

        <div class="stat-pair">
          <Field label="Move" inline>
            <NumberInput bind:value={character.move} min={0} max={12} />
          </Field>

          <Field label="Starting health" inline>
            <NumberInput
              value={character.health ?? 0}
              min={1}
              max={40}
              onchange={(value) => (character.health = value)}
            />
          </Field>
        </div>

        {@render abilityList(
          character.abilities,
          () => addAbilityTo(character.abilities),
          (index) => removeAbilityFrom(character.abilities, index)
        )}

        <Section
          title="Sidekick"
          description="The lower block on this sheet — a tracked companion, a swarm of identical copies, or a quote when there is none."
        >
          <Switch
            checked={character.sidekick.enabled}
            label="This hero has a sidekick"
            hint="A minimal companion — a name and a stat line, not a card of its own. One with abilities and a sheet of its own is a character card instead — see +1 character card on Identity."
            onchange={(value) => {
              character.sidekick.enabled = value;
              // `multiple` tracks `count` rather than being asked for
              // directly — keep it in sync the moment the fields appear.
              if (value) character.sidekick.multiple = character.sidekick.count > 1;
            }}
          />

          {#if character.sidekick.enabled}
            <div class="tiles sidekick-fields">
              <Field label="Sidekick name" hint="Not printed on the character card. Used to label its own action cards.">
                <TextInput bind:value={character.sidekick.name} placeholder="Name this sidekick" />
              </Field>

              <Field label="Attack type">
                <SegmentedControl
                  label="Sidekick attack type"
                  value={character.sidekick.attackType}
                  segments={ATTACK_TYPE_OPTIONS}
                  onchange={(value) => (character.sidekick.attackType = value)}
                />
              </Field>

              <!--
                Copies drives which layout prints, not a separate toggle: one
                copy is a single tracked figure — the health badge — and more
                than one is an unnamed swarm — the token stack. `multiple` is
                derived here rather than asked for directly.
              -->
              <Field label="Copies" inline hint="One tracked figure, or several identical copies.">
                <NumberInput
                  value={character.sidekick.count}
                  min={1}
                  max={12}
                  onchange={(value) => {
                    character.sidekick.count = value;
                    character.sidekick.multiple = value > 1;
                  }}
                />
              </Field>

              {#if !character.sidekick.multiple}
                <Field label="Starting health" inline>
                  <NumberInput
                    value={character.sidekick.health ?? 0}
                    min={1}
                    max={40}
                    onchange={(value) => (character.sidekick.health = value)}
                  />
                </Field>
              {/if}
            </div>
          {:else}
            <div class="tiles sidekick-fields">
              <Field label="Quote">
                <TextArea
                  bind:value={character.quote.text}
                  rows={2}
                  placeholder="A memorable line goes here."
                />
              </Field>
              <Field label="Attribution">
                <TextInput bind:value={character.quote.attribution} placeholder="Who said it" />
              </Field>
            </div>
          {/if}
        </Section>

        <!--
          The whole block goes, not just its contents, while a replacement is
          on — an empty titled section reads as something that failed to load.
          The guard sits here rather than inside the panel because the heading
          is out here too.
        -->
        {#if !sheetReplaced(character.characterCard)}
          <Section
            title="Character card design"
            description="This sheet’s border, and what fills each of its three bands — its own, independent of any other card this hero has."
          >
            <CharacterCardPanel characterId={character.id} design={character.characterCard} />
          </Section>
        {/if}
      {:else if characterEditorView.tab === 'cardback'}
        {@render cardbackSection()}
      {:else if characterEditorView.tab === 'defaults'}
        {@render defaultsSection()}
      {:else if activeExtra}
        {@const extra = activeExtra.entry}
        {@const index = activeExtra.index}
        <div class="extra-head">
          <Button
            size="sm"
            variant="danger"
            onclick={() => removeCharacterCard(index)}
          >
            <Icon name="trash" size={13} />
            Delete this character card
          </Button>
        </div>

        {@render characterCardReplacement(extra.characterCard, extra.id)}

        <div class="tiles">
          <Field label="Name">
            <TextInput bind:value={extra.name} placeholder="Name this character" prominent />
          </Field>

          <Field label="Shortened name" hint="Used on the action card ribbon. Blank uses the full name.">
            <TextInput bind:value={extra.subtitle} placeholder="e.g. Geralt" />
          </Field>
        </div>

        <Field label="Attack type">
          <SegmentedControl
            label="Attack type"
            value={extra.attackType}
            segments={ATTACK_TYPE_OPTIONS}
            onchange={(value) => (extra.attackType = value)}
          />
        </Field>

        <div class="stat-pair">
          <Field label="Move" inline>
            <NumberInput bind:value={extra.move} min={0} max={12} />
          </Field>

          <Field label="Starting health" inline>
            <NumberInput
              value={extra.health ?? 0}
              min={1}
              max={40}
              onchange={(value) => (extra.health = value)}
            />
          </Field>
        </div>

        {@render abilityList(
          extra.abilities,
          () => addAbilityTo(extra.abilities),
          (abilityIndex) => removeAbilityFrom(extra.abilities, abilityIndex)
        )}

        <Field label="Quote">
          <TextArea bind:value={extra.quote.text} rows={2} placeholder="A memorable line goes here." />
        </Field>
        <Field label="Attribution">
          <TextInput bind:value={extra.quote.attribution} placeholder="Who said it" />
        </Field>

        {#if !sheetReplaced(extra.characterCard)}
          <Section
            title="Character card design"
            description="This sheet’s border, and what fills each of its three bands — its own, independent of any other card this hero has."
          >
            <CharacterCardPanel characterId={character.id} design={extra.characterCard} cardId={extra.id} />
          </Section>
        {/if}
      {/if}
    {:else if characterEditorView.tab === 'cardback'}
      {@render cardbackSection()}
    {:else if characterEditorView.tab === 'defaults'}
      {@render defaultsSection()}
    {:else}
      <!--
        Identity and Decks are both short, so they sit side by side rather than
        each taking a full width of the workspace to say very little. A villain
        or minion has no character card, no sidekick and no further identities,
        so this tab carries the whole figure rather than one sheet of it.
      -->
      <div class="tiles">
        <Section title="Identity" description="How the figure is presented on its sheet.">
          <Field label="Name">
            <TextInput bind:value={character.name} placeholder="Name this character" prominent />
          </Field>

          <Field label="Shortened name" hint="Used on the action card ribbon. Blank uses the full name.">
            <TextInput bind:value={character.subtitle} placeholder="e.g. Geralt" />
          </Field>

          <Field label="Role">
            <SegmentedControl
              label="Character role"
              value={character.role}
              segments={roleSegments}
              onchange={setRole}
            />
          </Field>

          <Field label="Figures" inline note="on board" hint="Identical figures this entry places.">
            <NumberInput bind:value={character.figureCount} min={1} max={12} />
          </Field>
        </Section>

        <div class="column">
          {@render decksSection()}
        </div>
      </div>

      {@render notesSection()}
    {/if}
  </div>
{/if}

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    flex: 1 1 auto;
    min-height: 0;
    padding: var(--space-5) var(--space-7) var(--space-9);
  }

  .hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  /* Carries what a Section's `description` used to say, now that the blocks
     these sat in have been unwrapped so the replacement panel can be first. */
  .lede {
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }

  .decks {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /*
   * The name gets its own line and the controls sit under it, so a deck row
   * still reads in a half-width column instead of squeezing five things onto
   * one line.
   */
  .deck {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .deck-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .deck-kind {
    flex: 1 1 130px;
    min-width: 0;
  }

  .deck-count {
    min-width: 2ch;
    text-align: right;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .abilities {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .ability {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .ability-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .ability-row :global(> :first-child) {
    flex: 1 1 auto;
    min-width: 0;
  }

  .ability-kind {
    flex: 0 0 140px;
  }

  /* A card's own ability list sits inline rather than in a Section of its
     own, so its "Add ability" action needs a header of its own to hang off. */
  .ability-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .ability-block-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .ability-block-label {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-default);
  }

  .sidekick-fields {
    margin-top: var(--space-3);
  }

  .extra-head {
    display: flex;
    justify-content: flex-end;
  }

  /*
   * The right-hand tile is two blocks rather than one. Identity is the taller
   * of the pair, so a hero's stats fill what would otherwise be white space
   * beside it rather than taking a full width of their own further down.
   */
  .column {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }

  .stat-pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--space-3);
    margin-top: var(--space-3);
  }

  /*
   * Two short blocks abreast. They fall back to a single column when the
   * workspace is too narrow to give each a usable measure.
   */
  .tiles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
    gap: var(--space-4);
  }

  /*
   * Only fall back when a column would be too narrow to type into. The
   * workspace is around 580px at a normal window, which is why the threshold
   * sits below that rather than at a round number.
   */
  @container workspace (max-width: 480px) {
    .tiles {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
