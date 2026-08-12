<script lang="ts">
  import type { CardTheme } from '$lib/cards/style';
  import { resolveCardTheme } from '$lib/cards/theme';
  import { setLabel } from '$lib/sets/factory';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, Field, Icon, Section, TextArea, TextInput } from '$lib/ui';
  import StylePanel from './StylePanel.svelte';
  import WorkspaceHeader from './WorkspaceHeader.svelte';

  /** Read from the store rather than taken as a prop — see Workspace.svelte. */
  const set = $derived(workshop.adventure);

  const stats = $derived(workshop.stats);

  /** What every card in the set looks like before any local override. */
  const resolvedTheme: CardTheme = $derived(resolveCardTheme(set.style, null, null));

  function originFor(): string {
    return 'template';
  }
  const isEmpty = $derived(set.characters.length === 0 && set.cards.length === 0);

  let confirmingReset = $state(false);

  function resetSet(): void {
    workshop.reset();
    confirmingReset = false;
  }
</script>

<WorkspaceHeader
  eyebrow="Adventure set"
  title={setLabel(set)}
  subtitle={set.subtitle || 'Set-level details and export metadata.'}
  colorVar="--brand-gold"
/>

<div class="body scroll-y">
  {#if isEmpty}
    <Section title="Start here" description="Three moves get an adventure off the ground.">
      <div class="starters">
        <button type="button" class="starter" onclick={() => workshop.addCharacter('villain')}>
          <span class="starter-icon" style:color="var(--role-villain)">
            <Icon name="skull" size={17} />
          </span>
          <span class="starter-title">Create the villain</span>
          <span class="starter-text">The antagonist the heroes are up against.</span>
        </button>

        <button type="button" class="starter" onclick={() => workshop.addCharacter('minion')}>
          <span class="starter-icon" style:color="var(--role-minion)">
            <Icon name="users" size={17} />
          </span>
          <span class="starter-title">Add minions</span>
          <span class="starter-text">The rank and file that fill out the board.</span>
        </button>

        <button type="button" class="starter" onclick={() => workshop.addInitiativeCard()}>
          <span class="starter-icon" style:color="var(--kind-initiative)">
            <Icon name="hourglass" size={17} />
          </span>
          <span class="starter-title">Build initiative</span>
          <span class="starter-text">The deck that drives the villain’s turn.</span>
        </button>
      </div>
    </Section>
  {/if}

  <Section title="Set details" description="Shown on the set’s title card and in exports.">
    <Field label="Name">
      <TextInput bind:value={set.name} placeholder="Name this adventure" prominent />
    </Field>

    <Field label="Subtitle">
      <TextInput bind:value={set.subtitle} placeholder="e.g. A three-act descent" />
    </Field>

    <Field label="Description">
      <TextArea
        bind:value={set.meta.description}
        rows={3}
        placeholder="What happens in this adventure?"
      />
    </Field>
  </Section>

  <Section title="Publication" description="Credit and versioning for the exported file." columns={2}>
    <Field label="Author">
      <TextInput bind:value={set.meta.author} placeholder="Your name" />
    </Field>

    <Field label="Version" hint="Your own release number — not the file schema.">
      <TextInput bind:value={set.meta.version} placeholder="0.1.0" />
    </Field>
  </Section>

  <Section title="Contents" description="What this set currently holds.">
    <div class="tally">
      <div class="tally-item">
        <span class="tally-value numeric">{stats.characterCount}</span>
        <span class="tally-label">Characters</span>
      </div>
      <div class="tally-item">
        <span class="tally-value numeric">{stats.deckCount}</span>
        <span class="tally-label">Decks</span>
      </div>
      <div class="tally-item">
        <span class="tally-value numeric">{stats.cardCount}</span>
        <span class="tally-label">Card entries</span>
      </div>
      <div class="tally-item">
        <span class="tally-value numeric">{stats.initiativeCount}</span>
        <span class="tally-label">Initiative</span>
      </div>
      <div class="tally-item">
        <span class="tally-value numeric">{stats.printCount}</span>
        <span class="tally-label">To print</span>
      </div>
    </div>
  </Section>

  <Section
    title="Set style"
    description="Defaults for every card in the set. Characters and individual cards can override any of it."
  >
    <StylePanel target={{ entity: 'set' }} resolved={resolvedTheme} {originFor} />
  </Section>

  <Section
    title="Danger zone"
    description="Everything lives in this browser. Export before you clear."
  >
    <div class="danger">
      {#if confirmingReset}
        <span class="danger-text">Discard this set and start over?</span>
        <Button size="sm" variant="ghost" onclick={() => (confirmingReset = false)}>
          Cancel
        </Button>
        <Button size="sm" variant="danger" onclick={resetSet}>Discard</Button>
      {:else}
        <span class="danger-text">Start a new, empty set.</span>
        <Button size="sm" variant="secondary" onclick={() => (confirmingReset = true)}>
          New set
        </Button>
      {/if}
    </div>
  </Section>
</div>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    flex: 1 1 auto;
    min-height: 0;
    padding: var(--space-5) var(--space-7) var(--space-9);
  }

  .starters {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--space-3);
  }

  .starter {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-4);
    text-align: left;
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    transition:
      background-color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out),
      translate var(--duration-fast) var(--ease-out);
  }

  .starter:hover {
    background: var(--surface-overlay);
    border-color: var(--border-strong);
    translate: 0 -1px;
  }

  .starter-icon {
    margin-bottom: var(--space-2);
  }

  .starter-title {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text-primary);
  }

  .starter-text {
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    color: var(--text-muted);
  }

  .tally {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: var(--space-4);
  }

  .tally-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tally-value {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    line-height: 1;
    color: var(--text-primary);
  }

  .tally-label {
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .danger {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .danger-text {
    flex: 1 1 auto;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
</style>
