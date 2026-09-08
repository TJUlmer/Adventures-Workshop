<script lang="ts">
  /**
   * A collection-wide character checklist, parallel to `ExportSelector`.
   *
   * Collection documents stay separate: their entity ids may collide across
   * forks, and each document owns its own styling and custom symbols. The
   * nested map is therefore keyed by the published set id first, then by the
   * character id that only has meaning inside that member.
   */
  import { characterLabel } from '$lib/characters/factory';
  import type { CharacterId } from '$lib/characters/types';
  import type { CollectionDeck } from '$lib/cloud/collections';
  import { Button, Switch } from '$lib/ui';

  interface Props {
    open: boolean;
    members: readonly CollectionDeck[];
    excludedBySet: ReadonlyMap<string, ReadonlySet<CharacterId>>;
    onchange: (next: Map<string, ReadonlySet<CharacterId>>) => void;
    onclose: () => void;
  }

  let { open, members, excludedBySet, onchange, onclose }: Props = $props();
  let dialog = $state<HTMLDialogElement | null>(null);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  const groups = $derived(
    members
      .map((member) => ({
        member,
        characters: member.set.characters.filter((character) => character.role === 'hero')
      }))
      .filter((group) => group.characters.length > 0)
  );

  const total = $derived(groups.reduce((count, group) => count + group.characters.length, 0));
  const selected = $derived(
    groups.reduce(
      (count, group) =>
        count +
        group.characters.filter(
          (character) => !excludedBySet.get(group.member.tile.set_id)?.has(character.id)
        ).length,
      0
    )
  );

  function toggle(setId: string, characterId: CharacterId, checked: boolean): void {
    const next = new Map(excludedBySet);
    const excluded = new Set(next.get(setId) ?? []);
    if (checked) excluded.delete(characterId);
    else excluded.add(characterId);
    if (excluded.size > 0) next.set(setId, excluded);
    else next.delete(setId);
    onchange(next);
  }

  function cardCount(member: CollectionDeck, characterId: CharacterId): number {
    const deckIds = new Set(
      member.set.decks.filter((deck) => deck.ownerId === characterId).map((deck) => deck.id)
    );
    return member.set.cards
      .filter((card) => deckIds.has(card.deckId))
      .reduce((count, card) => count + card.quantity, 0);
  }
</script>

<dialog
  bind:this={dialog}
  class="selector"
  aria-labelledby="collection-export-selector-title"
  onclose={() => onclose()}
>
  <div class="inner">
    <header class="head">
      <h2 class="title" id="collection-export-selector-title">Customize what's included</h2>
      <p class="lede">
        Choose any combination of characters. This applies to print sheets, card images and
        Tabletop Simulator, and changes nothing in the collection.
      </p>
    </header>

    <div class="body scroll-y">
      {#each groups as group (group.member.tile.set_id)}
        <section class="group">
          <header class="group-head">
            <h3 class="group-title">{group.member.tile.name || 'Untitled'}</h3>
            <span>{group.member.tile.author_name || 'Anonymous'}</span>
          </header>
          {#each group.characters as character (character.id)}
            {@const cards = cardCount(group.member, character.id)}
            <Switch
              label={characterLabel(character)}
              hint="{cards} {cards === 1 ? 'card' : 'cards'}"
              checked={!excludedBySet.get(group.member.tile.set_id)?.has(character.id)}
              onchange={(checked) => toggle(group.member.tile.set_id, character.id, checked)}
            />
          {/each}
        </section>
      {/each}
    </div>

    <footer class="foot">
      <p aria-live="polite">{selected} of {total} characters selected</p>
      <div class="actions">
        <Button variant="ghost" onclick={() => onchange(new Map())}>Reset</Button>
        <Button variant="primary" onclick={() => onclose()}>Done</Button>
      </div>
    </footer>
  </div>
</dialog>

<style>
  .selector {
    width: min(520px, calc(100vw - var(--space-6) * 2));
    max-height: min(720px, calc(100vh - var(--space-6) * 2));
    padding: 0;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
    color: var(--text-default);
  }

  .selector::backdrop {
    background: rgb(0 0 0 / 0.55);
  }

  .inner {
    display: flex;
    max-height: min(720px, calc(100vh - var(--space-6) * 2));
    min-height: 0;
    flex-direction: column;
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-6) var(--space-6) var(--space-4);
  }

  .title,
  .lede,
  .foot p {
    margin: 0;
  }

  .title {
    color: var(--text-primary);
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  .lede {
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
  }

  .body {
    display: flex;
    min-height: 0;
    flex-direction: column;
    gap: var(--space-5);
    padding: 0 var(--space-6) var(--space-5);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .group-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .group-title {
    margin: 0;
    color: var(--text-tertiary);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
  }

  .group-head span {
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-6);
    border-top: 1px solid var(--border-subtle);
  }

  .foot p {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
  }

  @media (max-width: 520px) {
    .selector {
      width: calc(100vw - var(--space-4) * 2);
      max-height: calc(100vh - var(--space-4) * 2);
    }

    .head,
    .foot {
      padding-right: var(--space-4);
      padding-left: var(--space-4);
    }

    .body {
      padding-right: var(--space-4);
      padding-left: var(--space-4);
    }

    .foot {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
