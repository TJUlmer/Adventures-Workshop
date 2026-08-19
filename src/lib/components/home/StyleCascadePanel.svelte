<script lang="ts">
  /**
   * A high-level map of the three style layers — set, character, card — with
   * something to click for two of them. Every page in the cascade already
   * explains itself well *locally* ("Defaults for every card in the set…",
   * "How every card in this figure's decks looks before a card overrides
   * it…"), but nothing showed the three levels together before this: a set
   * with a few characters and dozens of cards makes each explanation read as
   * its own separate feature rather than one system with three stops.
   *
   * Always shown, not gated on an empty set the way `SetEditor`'s "Start
   * here" is — this is reference material for the life of the set, the same
   * footing the Home page's own "Set health" panel already stands on.
   */
  import { characterLabel } from '$lib/characters/factory';
  import { characterEditorView } from '$lib/state/character-editor-view.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import type { CharacterEntry, SetOutline } from '$lib/sets/types';
  import { Icon } from '$lib/ui';

  interface Props {
    outline: SetOutline;
  }

  let { outline }: Props = $props();

  /**
   * The same order the Roster panel below already lists them in, so "the
   * first character" here is never a different one from what's visibly
   * first on the same page.
   */
  const firstCharacter = $derived.by((): CharacterEntry | null => {
    const roster = [...outline.heroes, ...outline.villains, ...outline.minions, ...outline.others];
    return roster[0] ?? null;
  });

  /**
   * Requested *before* selecting — `selectCharacter` triggers
   * `CharacterEditor`'s own reset-to-identity effect, and this is what that
   * effect consumes instead of always landing on Identity. See
   * `characterEditorView`'s `#pendingTab` doc comment.
   */
  function openCharacterDefaults(entry: CharacterEntry): void {
    characterEditorView.requestTab('defaults');
    workshop.selectCharacter(entry.character.id);
  }
</script>

<section class="panel cascade">
  <h2 class="panel-title">How card styles cascade</h2>
  <p class="panel-hint">Three levels, each overriding the one above it only where it says something different.</p>

  <ol class="steps">
    <li class="step">
      <span class="step-index numeric">1</span>
      <div class="step-body">
        <span class="step-title">Set style</span>
        <p class="step-text">The base look, shared by every card in the set until something below overrides it.</p>
        <button type="button" class="step-action" onclick={() => workshop.selectSet()}>
          Edit set style
          <Icon name="chevronRight" size={12} />
        </button>
      </div>
    </li>

    <li class="step">
      <span class="step-index numeric">2</span>
      <div class="step-body">
        <span class="step-title">Character defaults</span>
        <p class="step-text">
          Each hero, villain or minion can override it for every card of their own — set once on
          their sheet's "Action card defaults" tab.
        </p>
        {#if firstCharacter}
          <button type="button" class="step-action" onclick={() => openCharacterDefaults(firstCharacter)}>
            Open {characterLabel(firstCharacter.character)}’s defaults
            <Icon name="chevronRight" size={12} />
          </button>
        {:else}
          <p class="step-disabled-hint">Add a hero, villain or minion first — see Roster, below.</p>
        {/if}
      </div>
    </li>

    <li class="step">
      <span class="step-index numeric">3</span>
      <div class="step-body">
        <span class="step-title">Card overrides</span>
        <p class="step-text">
          Any single card can still go its own way. Open it from the sidebar, then its Design tab,
          to change just that one.
        </p>
      </div>
    </li>
  </ol>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    box-shadow: inset 0 1px 0 var(--edge-highlight);
  }

  .panel-title {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  .panel-hint {
    margin-top: calc(var(--space-2) * -1);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  /*
   * A vertical stack, not the three-across grid this started as — it moved
   * into the same narrower column "Set health" already lives in, where three
   * side by side would have had barely any width each. One column matches
   * the column it's in.
   */
  .steps {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    list-style: none;
  }

  .step {
    display: flex;
    gap: var(--space-3);
  }

  .step-index {
    flex: none;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-full);
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .step-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .step-title {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text-primary);
  }

  .step-text {
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: pretty;
  }

  .step-action {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-accent);
    text-align: left;
  }

  .step-action:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .step-disabled-hint {
    margin-top: var(--space-1);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    font-style: italic;
  }
</style>
