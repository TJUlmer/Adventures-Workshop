<script lang="ts">
  import { deckSize } from '$lib/cards/factory';
  import type { CardTheme } from '$lib/cards/style';
  import { ACTION_SURFACES, resolveCardTheme } from '$lib/cards/theme';
  import { characterLabel } from '$lib/characters/factory';
  import { ATTACK_TYPE_LABELS, ATTACK_TYPES } from '$lib/characters/types';
  import type { CharacterRole } from '$lib/characters/types';
  import { CHARACTER_ROLE_META, SELECTABLE_ROLES } from '$lib/characters/types';
  import type { DeckId, DeckKind } from '$lib/decks/types';
  import { DECK_KIND_META, DECK_KINDS } from '$lib/decks/types';
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
    TextArea,
    TextInput
  } from '$lib/ui';
  import CardbackPanel from './CardbackPanel.svelte';
  import CharacterCardPanel from './CharacterCardPanel.svelte';
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

  function addAbility(): void {
    if (!character) return;
    character.abilities.push({ name: '', text: '', kind: 'passive' });
  }

  function removeAbility(index: number): void {
    if (!character) return;
    character.abilities.splice(index, 1);
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

  function setDeckKind(deckId: DeckId, kind: string): void {
    const deck = decks.find((candidate) => candidate.id === deckId);
    if (deck) deck.kind = kind as DeckKind;
  }
</script>

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
    <!--
      Identity and Decks are both short, so they sit side by side rather than
      each taking a full width of the workspace to say very little. A hero's
      stats go under Decks in that same right-hand column: Identity is the
      taller of the two, and the block that fills the gap beside it is the one
      that describes the same figure rather than its cards.
    -->
    <div class="tiles">
    <Section title="Identity" description="How the figure is presented on its sheet.">
      <Field label="Name">
        <TextInput bind:value={character.name} placeholder="Name this character" prominent />
      </Field>

      <!--
        A shorter form for where the full name will not fit. The action cards'
        ribbon takes it when it is set; the character card and the line beside
        the copies count always print the full name.
      -->
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

      <!--
        Health, move and attack type are fixed by the Adventures format, so they
        are not offered. Figure count is: one entry can put several identical
        figures on the board.
      -->
      <Field label="Figures" inline note="on board" hint="Identical figures this entry places.">
        <NumberInput bind:value={character.figureCount} min={1} max={12} />
      </Field>
    </Section>

    <div class="column">
      <Section title="Decks" description="Every deck this figure deals from.">
      {#snippet actions()}
        <Button size="sm" variant="ghost" onclick={() => workshop.addDeck('special', character.id)}>
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

    {#if character.role === 'hero'}
      <!--
        Health, move and attack type stay fixed for a villain or a minion — see
        the note on the Figures field above — but a hero's character card
        prints all three, so a hero is the one role that gets to set them.
      -->
      <Section
        title="Hero stats"
        description="Printed on the character card: attack type, starting health and move."
      >
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
      </Section>
    {/if}
    </div>
    </div>

    {#if character.role === 'hero'}
      <Section
        title="Special ability"
        description="Printed as its own block on the character card, name and text both."
      >
        {#snippet actions()}
          <Button size="sm" variant="ghost" onclick={addAbility}>
            <Icon name="plus" size={13} />
            Add ability
          </Button>
        {/snippet}

        {#if character.abilities.length === 0}
          <p class="hint">No abilities yet. The card prints a placeholder until one is added.</p>
        {:else}
          <ul class="abilities">
            {#each character.abilities as ability, index (index)}
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
                    onclick={() => removeAbility(index)}
                  >
                    <Icon name="trash" size={13} />
                  </Button>
                </div>
                <TextArea bind:value={ability.text} rows={2} placeholder="Ability text goes here." />
              </li>
            {/each}
          </ul>
        {/if}
      </Section>

      <Section
        title="Sidekick"
        description="The lower block on the character card — a companion figure, or a quote when there is none."
      >
        <Switch
          checked={character.sidekick.enabled}
          label="This hero has a sidekick"
          hint="Off prints a flavour quote in this space instead."
          onchange={(value) => (character.sidekick.enabled = value)}
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

            <Field label="Figure" inline hint="One tracked individual, or identical copies with no health of their own.">
              <SegmentedControl
                label="Sidekick figure"
                value={character.sidekick.multiple ? 'multiple' : 'single'}
                segments={[
                  { value: 'single', label: 'Single' },
                  { value: 'multiple', label: 'Multiple' }
                ]}
                onchange={(value) => (character.sidekick.multiple = value === 'multiple')}
              />
            </Field>

            {#if character.sidekick.multiple}
              <Field label="Copies" inline>
                <NumberInput bind:value={character.sidekick.count} min={2} max={12} />
              </Field>
            {:else}
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

      <Section
        title="Character card"
        description="The printed sheet’s border, and what fills each of its three bands."
      >
        <CharacterCardPanel {character} />
      </Section>
    {/if}

    <Section
      title="Deck back"
      description="Printed on the back of every card in this figure’s decks."
    >
      <CardbackPanel {character} />
    </Section>

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
        target={{ entity: 'character', id: character.id }}
        resolved={resolvedTheme}
        {originFor}
        surfaces={ACTION_SURFACES}
      />
    </Section>

    <Section title="Notes" description="Working notes. Never printed.">
      <Field label="Private notes">
        <TextArea bind:value={character.notes} rows={3} placeholder="Design intent, references…" />
      </Field>
    </Section>
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

  .sidekick-fields {
    margin-top: var(--space-3);
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
