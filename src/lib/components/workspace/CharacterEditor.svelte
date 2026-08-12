<script lang="ts">
  import { deckSize } from '$lib/cards/factory';
  import type { CardTheme } from '$lib/cards/style';
  import { ACTION_SURFACES, resolveCardTheme } from '$lib/cards/theme';
  import { characterLabel } from '$lib/characters/factory';
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
    TextArea,
    TextInput
  } from '$lib/ui';
  import CardbackPanel from './CardbackPanel.svelte';
  import StylePanel from './StylePanel.svelte';
  import WorkspaceHeader from './WorkspaceHeader.svelte';

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
    character ? resolveCardTheme(workshop.adventure.style, character.style, null) : null
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
      each taking a full width of the workspace to say very little.
    -->
    <div class="tiles">
    <Section title="Identity" description="How the figure is presented on its sheet.">
      <Field label="Name">
        <TextInput bind:value={character.name} placeholder="Name this character" prominent />
      </Field>

      <Field label="Subtitle" hint="A short epithet under the name.">
        <TextInput bind:value={character.subtitle} placeholder="e.g. Warden of the Deep" />
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
    </div>

    <!--
      Character abilities are filed away rather than deleted: `abilities` stays
      on the model so nothing an author already wrote is lost, and the editor
      comes back with the hero/sidekick side when there is one.
    -->

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
