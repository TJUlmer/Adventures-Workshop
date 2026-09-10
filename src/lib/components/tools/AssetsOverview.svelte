<script lang="ts">
  /**
   * Every component of the set in one place.
   *
   * This is the review page — the one you scroll before calling a set done, and
   * the source for a future set-overview sheet. Cards render through the same
   * component the editor previews, so what is here is what prints.
   *
   * It is also what a published set looks like to a stranger, which is why it
   * takes the set as a prop rather than only reading the store: a shared set is
   * never in the library, so there is nothing in the store to read. That view
   * passes `interactive={false}` and `inspectable`: those tiles open a reading
   * view instead of an editor. What is *drawn* is identical, which is the point:
   * a viewer sees the set, not a summary of it.
   */
  import { cardLabel } from '$lib/cards/factory';
  import type { Card } from '$lib/cards/types';
  import { CARD_TYPE_META, INITIATIVE_VARIANTS } from '$lib/cards/types';
  import { characterLabel } from '$lib/characters/factory';
  import { CHARACTER_ROLE_META } from '$lib/characters/types';
  import type { Character, CharacterRole, HeroCharacterCard } from '$lib/characters/types';
  import { hasArtwork } from '$lib/core/artwork';
  import type { Deck, DeckKind } from '$lib/decks/types';
  import type { Figure } from '$lib/figures/types';
  import { figureLabel, FIGURE_KIND_LABELS } from '$lib/figures/types';
  import { CardRenderer, MapBoard, ThreatBoard } from '$lib/renderer';
  import { initiativeSubjectForCard, resolveStyleForCard } from '$lib/sets/queries';
  import type { AdventureSet } from '$lib/sets/types';
  import { threatTotal } from '$lib/threat/types';
  import { navigation } from '$lib/state/navigation.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { EmptyState, Icon } from '$lib/ui';
  import { GALLERY_CARD_SIZE } from './gallery-inspection';
  import type { GalleryCardItem, GalleryCardSide } from './gallery-inspection';

  interface Props {
    /** The set to lay out. The open one unless another is handed in. */
    set?: AdventureSet;
    /** Whether a tile is a way in to the editor. Off for someone else's set. */
    interactive?: boolean;
    /** Whether read-only card and component tiles open focused inspection. */
    inspectable?: boolean;
    /**
     * Whether figure assets are safe to pass through canvas/WebGL. Shared
     * views turn this on after their public Storage URLs have been embedded.
     */
    componentPreviewsReady?: boolean;
    /** Off where the screen around it has already named the set. */
    heading?: boolean;
    /** Controlled card width for a parent that owns the review toolbar. */
    cardSize?: number;
    /** The self-contained shared-set view still uses this component's slider. */
    showZoom?: boolean;
    onCardSizeChange?: (value: number) => void;
    /** Stable section targets for a parent-owned gallery navigation bar. */
    anchorPrefix?: string;
  }

  let {
    set: given,
    interactive = true,
    inspectable = false,
    componentPreviewsReady = true,
    heading = true,
    cardSize,
    showZoom = true,
    onCardSizeChange,
    anchorPrefix
  }: Props = $props();

  const set = $derived(given ?? workshop.adventure);

  /*
   * A tile that goes nowhere is not a button.
   *
   * Not a disabled one either: disabled says "this control exists but is
   * unavailable", and reads as `cursor: not-allowed` — which is an accusation
   * rather than a fact. There is simply no control here to press.
   *
   * The `role` alongside every `type` below is not redundant, and the compiler
   * insists: it cannot see what `this` will be, so a click handler on a
   * `<svelte:element>` is a handler on an unknown tag until the role says
   * otherwise. Both are dropped in the same breath as the handler.
   */
  const editorTile = $derived(interactive ? 'button' : 'div');
  const previewTile = $derived(interactive || inspectable ? 'button' : 'div');
  const previewControl = $derived(interactive || inspectable);
  const figurePreviewControl = $derived(interactive || (inspectable && componentPreviewsReady));
  const figurePreviewTile = $derived(figurePreviewControl ? 'button' : 'div');

  /** The villain the track names, for the board's nameplate and burst. */
  const threatVillain = $derived(
    set.characters.find((character) => character.id === set.threat.villainId) ?? null
  );

  /** A figure's assigned character's name, so a dial shows its owner's. */
  function figureOwnerName(figure: (typeof set.figures)[number]): string | null {
    const owner = set.characters.find((character) => character.id === figure.characterId);
    return owner ? characterLabel(owner) : null;
  }

  /**
   * A still 3D render, for a figure whose piece is a model — generated or
   * attached — in place of its flat reference image.
   *
   * A token's texture is built to be wrapped onto a shape, not looked at on
   * its own: it carries a rim-colour band, and a two-sided piece's is both
   * faces side by side. Flat, that reads as noise rather than as the piece;
   * rendered onto the actual mesh it reads as the component it is. A plain
   * `figure` with neither a build nor an attached model keeps its reference
   * image — there is no model here to render instead.
   */
  let modelSnapshots = $state<Record<string, string>>({});
  const snapshotKeys: Record<string, string> = {};
  let figuresNear = $state(false);
  let visibleGalleries = $state<Record<string, boolean>>({});
  let deferredSetId = '';

  type CardLightboxView = (typeof import('./CardLightbox.svelte'))['default'];
  type ComponentModalView = (typeof import('./ComponentModal.svelte'))['default'];
  let CardLightbox = $state.raw<CardLightboxView | null>(null);
  let ComponentModal = $state.raw<ComponentModalView | null>(null);

  $effect(() => {
    if (set.id === deferredSetId) return;
    deferredSetId = set.id;
    visibleGalleries = {};
    figuresNear = false;
  });

  /**
   * Reveal expensive content shortly before it enters the Overview scroller.
   * The placeholder inside `node` gives the observer real geometry, so a long
   * page cannot collapse and accidentally reveal every group at once.
   */
  function revealNear(node: HTMLElement, reveal: () => void) {
    let currentReveal = reveal;
    if (typeof IntersectionObserver === 'undefined') {
      currentReveal();
      return { update: (next: () => void) => (currentReveal = next) };
    }

    const root = node.closest<HTMLElement>('.page');
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        currentReveal();
        observer.disconnect();
      },
      { root, rootMargin: '700px 0px' }
    );
    observer.observe(node);
    return {
      update(next: () => void) {
        currentReveal = next;
      },
      destroy() {
        observer.disconnect();
      }
    };
  }

  function revealGallery(key: string): void {
    if (!visibleGalleries[key]) visibleGalleries[key] = true;
  }

  function galleryVisible(key: string): boolean {
    return visibleGalleries[key] ?? false;
  }

  $effect(() => {
    if (!figuresNear || !componentPreviewsReady) return;
    const figures = set.figures;
    let cancelled = false;

    void (async () => {
      const [{ figurePreviewKey, loadFigurePreview, releaseFigurePreview }, { renderMeshSnapshot }] =
        await Promise.all([import('./figure-preview'), import('$lib/models/snapshot')]);

      for (const figure of figures) {
        if (cancelled) return;
        /*
         * Per figure, inside the loop, so one unreadable component does not
         * stop the others. Sequential snapshots also avoid asking several WebGL
         * contexts to initialise during the same frame.
         */
        let key: string | null;
        try {
          key = figurePreviewKey(figure);
        } catch (error) {
          delete snapshotKeys[figure.id];
          delete modelSnapshots[figure.id];
          report(`The token spec for ${figureLabel(figure, figureOwnerName(figure))}`, error);
          continue;
        }
        if (!key) {
          delete snapshotKeys[figure.id];
          delete modelSnapshots[figure.id];
          continue;
        }
        if (snapshotKeys[figure.id] === key) continue;
        snapshotKeys[figure.id] = key;
        delete modelSnapshots[figure.id];

        try {
          const preview = await loadFigurePreview(figure);
          if (!preview) continue;
          let snapshot: string | null;
          try {
            snapshot = await renderMeshSnapshot(preview.mesh, preview.texture, 160);
          } finally {
            releaseFigurePreview(preview);
          }
          if (!cancelled && snapshot && snapshotKeys[figure.id] === key) {
            modelSnapshots[figure.id] = snapshot;
          }
        } catch (error) {
          report(`A 3D preview of ${figureLabel(figure, figureOwnerName(figure))}`, error);
        }
      }
    })().catch((error: unknown) => report('The component preview tools', error));

    return () => {
      cancelled = true;
    };
  });

  /** Which faces a card contributes to the gallery. Only events have two. */
  const FRONT_ONLY = ['front'] as const;
  const EVENT_SIDES = ['front', 'back'] as const;

  function renderedCardCount(cards: readonly Card[]): number {
    return cards.reduce((total, card) => total + (card.type === 'event' ? 2 : 1), 0);
  }

  /** Figures in the order a set is read: who it is played as, then against. */
  const ROLE_ORDER: readonly CharacterRole[] = ['hero', 'villain', 'minion', 'sidekick'];

  /** A figure's own decks, action first, then whatever else it deals from. */
  const OWNED_DECK_ORDER: readonly DeckKind[] = ['action', 'special', 'rules', 'event', 'initiative'];

  interface Group {
    key: string;
    title: string;
    owner: Character | null;
    cards: Card[];
  }

  /**
   * Every card in the set, in the order the set is assembled: heroes, villains,
   * and minions with each of their own decks, followed by the shared set decks.
   * Deck order in the document is an authoring accident; this is the order
   * someone reviewing the set expects to walk it in.
   */
  const groups = $derived.by(() => {
    const out: Group[] = [];
    const placed = new Set<string>();
    const cardsIn = (deckId: string) => set.cards.filter((card) => card.deckId === deckId);

    const take = (deck: Deck, title: string, owner: Character | null): void => {
      placed.add(deck.id);
      const cards = cardsIn(deck.id);
      if (cards.length > 0) out.push({ key: deck.id, title, owner, cards });
    };

    for (const role of ROLE_ORDER) {
      for (const character of set.characters.filter((entry) => entry.role === role)) {
        const owned = set.decks
          .filter((deck) => deck.ownerId === character.id)
          .sort(
            (a, b) => OWNED_DECK_ORDER.indexOf(a.kind) - OWNED_DECK_ORDER.indexOf(b.kind)
          );
        for (const deck of owned) take(deck, deck.name, character);
      }
    }

    // Initiative reads as two things, not one deck — acting, then resolving.
    const initiative: Card[] = [];
    for (const deck of set.decks.filter((deck) => deck.kind === 'initiative')) {
      if (placed.has(deck.id)) continue;
      placed.add(deck.id);
      initiative.push(...cardsIn(deck.id));
    }
    for (const variant of INITIATIVE_VARIANTS) {
      const cards = initiative.filter(
        (card) => card.type === 'initiative' && card.variant === variant
      );
      if (cards.length > 0) {
        out.push({
          key: `initiative-${variant}`,
          title: `Initiative — ${variant === 'card' ? 'Character' : 'Effect'}`,
          owner: null,
          cards
        });
      }
    }

    for (const kind of ['rules', 'event'] as const) {
      for (const deck of set.decks.filter((deck) => deck.kind === kind)) {
        /*
         * A rules/event deck owned by a character was already taken above,
         * in the per-character `owned` pass — that filters by `ownerId`
         * alone, no kind restriction, so it already claims one of these the
         * moment a card is assigned to a character (see `workshop.
         * setCardOwner`). Skipping an already-placed deck here is what the
         * orphan sweep two passes down already does; this loop was missing
         * the same guard, so an owned rules/event deck was pushed twice —
         * two `Group`s sharing one `key: deck.id`, which Svelte's `#each`
         * (keyed by `group.key`) throws `each_key_duplicate` on rather than
         * silently rendering.
         */
        if (placed.has(deck.id)) continue;
        take(deck, deck.name, null);
      }
    }

    // Anything the passes above did not claim — an orphaned deck, say.
    for (const deck of set.decks) {
      if (placed.has(deck.id)) continue;
      take(deck, deck.name, set.characters.find((entry) => entry.id === deck.ownerId) ?? null);
    }

    return out;
  });

  interface CharacterCardTile {
    key: string;
    character: Character;
    /** `null` draws the primary identity; set, one of `additionalCards`. */
    entry: HeroCharacterCard | null;
    name: string;
  }

  /**
   * One tile per printed character-card sheet — the primary identity, plus
   * one per "+1 character card" — heroes only, since the sheet is a hero-only
   * feature (see `HeroCharacterCardFace`). Character cards render through
   * `CardRenderer`'s own `statCard`/`statCardEntry`, not through `set.cards`,
   * so `groups` above never sees them; this is the same gap `Deck backs`
   * already existed to fill for cardbacks.
   */
  const characterCardTiles = $derived.by(() => {
    const out: CharacterCardTile[] = [];
    for (const character of set.characters) {
      if (character.role !== 'hero') continue;
      out.push({ key: character.id, character, entry: null, name: characterLabel(character) });
      for (const extra of character.additionalCards) {
        out.push({
          key: extra.id,
          character,
          entry: extra,
          name: extra.name.trim() || 'Untitled'
        });
      }
    }
    return out;
  });

  /*
   * The old maximum is now the neutral starting point: cards open large
   * enough to read, with equal room to shrink the gallery or inspect a card
   * more closely. Keeping one range here also means the editable and shared
   * Overviews never disagree about what the same slider position means.
   */
  let localSize = $state<number>(GALLERY_CARD_SIZE.start);
  const size = $derived(cardSize ?? localSize);

  function anchorId(section: string): string | undefined {
    return anchorPrefix ? `${anchorPrefix}-${section}` : undefined;
  }

  function changeSize(value: number): void {
    localSize = value;
    onCardSizeChange?.(value);
  }

  const setGroups = $derived(groups.filter((group) => group.owner === null));
  const orderedCharacters = $derived(
    ROLE_ORDER.flatMap((role) => set.characters.filter((character) => character.role === role))
  );

  function groupsFor(character: Character): Group[] {
    return groups.filter((group) => group.owner?.id === character.id);
  }

  function characterCardsFor(character: Character): CharacterCardTile[] {
    return characterCardTiles.filter((entry) => entry.character.id === character.id);
  }

  const hasContent = $derived(
    set.characters.length > 0 ||
      set.cards.length > 0 ||
      set.figures.length > 0 ||
      set.threat.enabled ||
      set.map.enabled
  );

  let lightboxItems = $state<GalleryCardItem[]>([]);
  let lightboxIndex = $state(0);
  let lightboxSide = $state<GalleryCardSide>('front');
  let lightboxCollection = $state('');
  const lightboxOpen = $derived(inspectable && lightboxItems.length > 0);

  let viewingFigureId = $state<string | null>(null);
  const viewingFigure = $derived(
    set.figures.find((figure) => figure.id === viewingFigureId) ?? null
  );

  function cardItem(group: Group, card: Card): GalleryCardItem {
    return {
      kind: 'card',
      key: card.id,
      label: cardLabel(card),
      meta: CARD_TYPE_META[card.type].label,
      card,
      character: group.owner
    };
  }

  function identityItems(character: Character): GalleryCardItem[] {
    return [
      {
        kind: 'deck-back',
        key: `deck-back:${character.id}`,
        label: characterLabel(character),
        meta: 'Deck back',
        character
      },
      ...characterCardsFor(character).map((entry) => ({
        kind: 'character-card' as const,
        key: `character-card:${entry.key}`,
        label: entry.name,
        meta: 'Character card',
        character,
        entry: entry.entry
      }))
    ];
  }

  function openCards(
    items: GalleryCardItem[],
    key: string,
    collection: string,
    side: GalleryCardSide = 'front'
  ): void {
    if (!inspectable) return;
    const activeIndex = items.findIndex((item) => item.key === key);
    if (activeIndex < 0) return;
    lightboxItems = items;
    lightboxIndex = activeIndex;
    lightboxCollection = collection;
    lightboxSide = side;
    if (!CardLightbox) {
      void import('./CardLightbox.svelte')
        .then((module) => (CardLightbox = module.default))
        .catch((error: unknown) => report('The card lightbox', error));
    }
  }

  function openGroupCard(group: Group, card: Card, side: GalleryCardSide): void {
    openCards(group.cards.map((entry) => cardItem(group, entry)), card.id, group.title, side);
  }

  function openIdentity(character: Character, key: string): void {
    openCards(identityItems(character), key, `${characterLabel(character)} · Identity`);
  }

  function moveLightbox(delta: number): void {
    const next = Math.min(lightboxItems.length - 1, Math.max(0, lightboxIndex + delta));
    if (next === lightboxIndex) return;
    lightboxIndex = next;
    const nextItem = lightboxItems[next];
    if (nextItem?.kind !== 'card' || nextItem.card.type !== 'event') lightboxSide = 'front';
  }

  function closeLightbox(): void {
    lightboxItems = [];
    lightboxIndex = 0;
    lightboxSide = 'front';
    lightboxCollection = '';
  }

  function openFigure(figure: Figure): void {
    if (!inspectable) return;
    viewingFigureId = figure.id;
    if (!ComponentModal) {
      void import('./ComponentModal.svelte')
        .then((module) => (ComponentModal = module.default))
        .catch((error: unknown) => report('The component viewer', error));
    }
  }

  /**
   * One tile failing must not take the page with it.
   *
   * This is the only screen that draws *every* card, cardback, character card
   * and board in the set at once — everywhere else renders one at a time. So it
   * is the only screen where a single malformed entity blanks the lot, and the
   * page went blank with no clue as to which entity or why. Worse, per the note
   * in `InitiativeCardFace`: a render that throws does not merely lose that
   * subtree, it leaves the effect graph broken, so later updates stop painting
   * too.
   *
   * A `<svelte:boundary>` per tile turns "the Overview does not load" into "this
   * card is broken, here is the message" — the rest of the set still renders,
   * and the thing to fix names itself. The same argument
   * `InitiativeCardFace`'s own fallback makes: a review page that is partly
   * wrong is far more use than one that is dead.
   */
  function report(label: string, error: unknown): void {
    console.error(`[overview] ${label} failed to render:`, error);
  }

  function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
</script>

<!--
  What a tile shows in place of a component that threw. Deliberately loud: this
  is a review page, and something that cannot be drawn is exactly what an author
  is here to find out about.
-->
{#snippet broken(label: string, error: unknown)}
  <div class="broken" role="alert">
    <Icon name="skull" size={16} />
    <span class="broken-title">{label} could not be drawn</span>
    <span class="broken-why">{message(error)}</span>
  </div>
{/snippet}

{#snippet galleryPlaceholders(count: number)}
  {#each Array.from({ length: count }) as _, index (index)}
    <figure class="tile placeholder" aria-hidden="true">
      <span class="placeholder-card"></span>
      <figcaption class="tile-caption">
        <span class="placeholder-line"></span>
        <span class="placeholder-line short"></span>
      </figcaption>
    </figure>
  {/each}
{/snippet}

{#snippet deckBack(character: Character)}
  <figure class="tile identity-tile">
    <svelte:element
      this={previewTile}
      class="tile-card"
      type={previewControl ? 'button' : undefined}
      role={previewControl ? 'button' : undefined}
      aria-haspopup={inspectable && !interactive ? 'dialog' : undefined}
      aria-label={previewControl
        ? `${interactive ? 'Edit' : 'View'} ${characterLabel(character)} deck back`
        : undefined}
      onclick={interactive
        ? () => workshop.selectCharacter(character.id)
        : inspectable
          ? () => openIdentity(character, `deck-back:${character.id}`)
          : undefined}
    >
      <svelte:boundary onerror={(error) => report(`${characterLabel(character)}'s deck back`, error)}>
        <CardRenderer card={null} cardback={character} />
        {#snippet failed(error)}
          {@render broken(`${characterLabel(character)}'s deck back`, error)}
        {/snippet}
      </svelte:boundary>
      {#if inspectable && !interactive}
        <span class="inspect-cue" aria-hidden="true"><Icon name="search" size={13} /></span>
      {/if}
    </svelte:element>
    <figcaption class="tile-caption">
      <span class="tile-name">{characterLabel(character)}</span>
      <span class="tile-meta">Deck back</span>
    </figcaption>
  </figure>
{/snippet}

{#snippet characterCard(tileEntry: CharacterCardTile)}
  <figure class="tile identity-tile">
    <svelte:element
      this={previewTile}
      class="tile-card"
      type={previewControl ? 'button' : undefined}
      role={previewControl ? 'button' : undefined}
      aria-haspopup={inspectable && !interactive ? 'dialog' : undefined}
      aria-label={previewControl
        ? `${interactive ? 'Edit' : 'View'} ${tileEntry.name} character card`
        : undefined}
      onclick={interactive
        ? () => workshop.selectCharacter(tileEntry.character.id)
        : inspectable
          ? () => openIdentity(tileEntry.character, `character-card:${tileEntry.key}`)
          : undefined}
    >
      <svelte:boundary onerror={(error) => report(`${tileEntry.name}'s character card`, error)}>
        <CardRenderer
          card={null}
          statCard={tileEntry.character}
          statCardEntry={tileEntry.entry}
          customSymbols={set.customSymbols}
        />
        {#snippet failed(error)}
          {@render broken(`${tileEntry.name}'s character card`, error)}
        {/snippet}
      </svelte:boundary>
      {#if inspectable && !interactive}
        <span class="inspect-cue" aria-hidden="true"><Icon name="search" size={13} /></span>
      {/if}
    </svelte:element>
    <figcaption class="tile-caption">
      <span class="tile-name">{tileEntry.name}</span>
      <span class="tile-meta">Character card</span>
    </figcaption>
  </figure>
{/snippet}

{#snippet deckGroup(group: Group)}
  {@const galleryKey = `${set.id}:deck:${group.key}`}
  {@const isVisible = galleryVisible(galleryKey)}
  <div class="deck-group">
    <h3 class="deck-title">
      {group.title}
      <span class="group-count numeric">{group.cards.length}</span>
    </h3>
    <div
      class="gallery"
      style:--tile="{size}px"
      aria-busy={!isVisible}
      use:revealNear={() => revealGallery(galleryKey)}
    >
      {#if isVisible}
        {#each group.cards as card (card.id)}
          {@const sides = card.type === 'event' ? EVENT_SIDES : FRONT_ONLY}
          {#each sides as side (side)}
            <figure class="tile">
              <svelte:element
                this={previewTile}
                class="tile-card"
                type={previewControl ? 'button' : undefined}
                role={previewControl ? 'button' : undefined}
                aria-haspopup={inspectable && !interactive ? 'dialog' : undefined}
                aria-label={previewControl
                  ? `${interactive ? 'Edit' : 'View'} ${cardLabel(card)}${side === 'back' ? ', reverse' : ''}`
                  : undefined}
                onclick={interactive
                  ? () => workshop.selectCard(card.id)
                  : inspectable
                    ? () => openGroupCard(group, card, side)
                    : undefined}
              >
                <svelte:boundary onerror={(error) => report(`Card “${cardLabel(card)}”`, error)}>
                  <CardRenderer
                    {card}
                    character={group.owner}
                    theme={resolveStyleForCard(set, card)}
                    customSymbols={set.customSymbols}
                    initiativeSubject={initiativeSubjectForCard(set, card)}
                    {side}
                  />
                  {#snippet failed(error)}
                    {@render broken(`Card “${cardLabel(card)}”`, error)}
                  {/snippet}
                </svelte:boundary>
                {#if inspectable && !interactive}
                  <span class="inspect-cue" aria-hidden="true"><Icon name="search" size={13} /></span>
                {/if}
              </svelte:element>
              <figcaption class="tile-caption">
                <span class="tile-name">{cardLabel(card)}</span>
                <span class="tile-meta">
                  {side === 'back' ? 'Reverse' : CARD_TYPE_META[card.type].label}
                  {#if card.quantity > 1}<span class="numeric">×{card.quantity}</span>{/if}
                </span>
              </figcaption>
            </figure>
          {/each}
        {/each}
      {:else}
        {@render galleryPlaceholders(renderedCardCount(group.cards))}
      {/if}
    </div>
  </div>
{/snippet}

<div class="page scroll-y" id={anchorId('top')}>
  {#if heading || showZoom}
    <header class="head">
      {#if heading}
        <div>
          <span class="eyebrow">Set tool</span>
          <h1 class="title">Overview</h1>
          <p class="lede">Every card, board, and physical component in the set.</p>
        </div>
      {/if}

      {#if showZoom}
        <label class="zoom">
          <Icon name="search" size={12} />
          <input
            type="range"
            min={GALLERY_CARD_SIZE.min}
            max={GALLERY_CARD_SIZE.max}
            step={GALLERY_CARD_SIZE.step}
            value={size}
            aria-label="Card size"
            oninput={(event) => changeSize(event.currentTarget.valueAsNumber)}
          />
        </label>
      {/if}
    </header>
  {/if}

  {#if !hasContent}
    <EmptyState
      icon="layers"
      title="Nothing to review yet"
      description="Cards, boards, and components all appear here once the set has some."
    />
  {/if}

  {#if set.threat.enabled || set.map.enabled}
    <section class="showcase battlefield" id={anchorId('battlefield')}>
      <header class="section-heading">
        <div>
          <span class="section-kicker">On the table</span>
          <h2>Battlefield</h2>
        </div>
        <p>The threat tracker and map in their physical playing order.</p>
      </header>

      <div class="board-stack">
        {#if set.threat.enabled}
          <article class="board-card">
            <header class="board-heading">
              <h3>Threat tracker</h3>
              <span class="numeric">{threatTotal(set.threat)} total</span>
            </header>
            <svelte:element
              this={editorTile}
              class="track-open"
              type={interactive ? 'button' : undefined}
              role={interactive ? 'button' : undefined}
              onclick={interactive ? () => navigation.go('threat') : undefined}
            >
              <svelte:boundary onerror={(error) => report('The threat tracker', error)}>
                <ThreatBoard
                  track={set.threat}
                  villainName={threatVillain ? characterLabel(threatVillain) : ''}
                  editable={false}
                />
                {#snippet failed(error)}
                  {@render broken('The threat tracker', error)}
                {/snippet}
              </svelte:boundary>
            </svelte:element>
          </article>
        {/if}

        {#if set.map.enabled}
          <article class="board-card">
            <header class="board-heading">
              <h3>Map</h3>
              <span class="numeric">
                {set.map.spaces.length} {set.map.spaces.length === 1 ? 'space' : 'spaces'} ·
                {set.map.paths.length} {set.map.paths.length === 1 ? 'path' : 'paths'}
              </span>
            </header>
            <svelte:element
              this={editorTile}
              class="track-open"
              type={interactive ? 'button' : undefined}
              role={interactive ? 'button' : undefined}
              onclick={interactive ? () => navigation.go('map') : undefined}
            >
              <svelte:boundary onerror={(error) => report('The map', error)}>
                <MapBoard
                  map={set.map}
                  customSymbols={set.customSymbols}
                  setName={set.name}
                  authorName={set.meta.author}
                />
                {#snippet failed(error)}
                  {@render broken('The map', error)}
                {/snippet}
              </svelte:boundary>
            </svelte:element>
          </article>
        {/if}
      </div>
    </section>
  {/if}

  {#if set.figures.length > 0}
    <section class="showcase" id={anchorId('components')}>
      <header class="section-heading">
        <div>
          <span class="section-kicker">Physical pieces</span>
          <h2>Components</h2>
        </div>
        <span class="section-count numeric">{set.figures.length}</span>
      </header>

      <div class="figures" use:revealNear={() => (figuresNear = true)}>
        {#each set.figures as figure (figure.id)}
          <svelte:element
            this={figurePreviewTile}
            class="figure"
            type={figurePreviewControl ? 'button' : undefined}
            role={figurePreviewControl ? 'button' : undefined}
            aria-haspopup={inspectable && !interactive && componentPreviewsReady ? 'dialog' : undefined}
            aria-label={figurePreviewControl
              ? `${interactive ? 'Edit' : 'View'} ${figureLabel(figure, figureOwnerName(figure))}`
              : undefined}
            onclick={interactive
              ? () => navigation.go('figures')
              : inspectable && componentPreviewsReady
                ? () => openFigure(figure)
                : undefined}
          >
            <span
              class="figure-thumb"
              class:empty={!modelSnapshots[figure.id] && !hasArtwork(figure.reference)}
            >
              {#if modelSnapshots[figure.id]}
                <img src={modelSnapshots[figure.id]} alt="" />
              {:else if hasArtwork(figure.reference) && figure.reference.source}
                <img src={figure.reference.source} alt="" />
              {:else}
                <Icon name="image" size={16} />
              {/if}
              {#if inspectable && !interactive && componentPreviewsReady}
                <span class="inspect-cue" aria-hidden="true"><Icon name="rotate" size={14} /></span>
              {/if}
            </span>
            <span class="figure-name">{figureLabel(figure, figureOwnerName(figure))}</span>
            <span class="figure-meta">
              {FIGURE_KIND_LABELS[figure.kind]}
              {#if figure.quantity > 1}<span class="numeric">×{figure.quantity}</span>{/if}
            </span>
          </svelte:element>
        {/each}
      </div>
    </section>
  {/if}

  {#if set.characters.length > 0}
    <section class="collections">
      <header class="section-heading collection-heading">
        <div>
          <span class="section-kicker">Characters and decks</span>
          <h2>The roster</h2>
        </div>
        <span class="section-count numeric">{set.characters.length}</span>
      </header>

      <div class="collection-list">
        {#each orderedCharacters as character (character.id)}
          {@const ownedGroups = groupsFor(character)}
          {@const statCards = characterCardsFor(character)}
          {@const ownedCardCount = ownedGroups.reduce((total, group) => total + group.cards.length, 0)}
          {@const identityKey = `${set.id}:identity:${character.id}`}
          {@const identityVisible = galleryVisible(identityKey)}
          <article class="character-collection" id={anchorId(`character-${character.id}`)}>
            <header class="character-heading">
              <div>
                <span class="role-badge">{CHARACTER_ROLE_META[character.role].label}</span>
                <h3>{characterLabel(character)}</h3>
              </div>
              <span class="character-count numeric">{ownedCardCount} card designs</span>
            </header>

            <div class="identity-block">
              <h4>Identity</h4>
              <div
                class="gallery identity-gallery"
                style:--tile="{size}px"
                aria-busy={!identityVisible}
                use:revealNear={() => revealGallery(identityKey)}
              >
                {#if identityVisible}
                  {@render deckBack(character)}
                  {#each statCards as tileEntry (tileEntry.key)}
                    {@render characterCard(tileEntry)}
                  {/each}
                {:else}
                  {@render galleryPlaceholders(1 + statCards.length)}
                {/if}
              </div>
            </div>

            {#each ownedGroups as group (group.key)}
              {@render deckGroup(group)}
            {/each}
          </article>
        {/each}
      </div>
    </section>
  {/if}

  {#if setGroups.length > 0}
    <section class="showcase set-decks" id={anchorId('set-decks')}>
      <header class="section-heading">
        <div>
          <span class="section-kicker">Shared material</span>
          <h2>Set decks</h2>
        </div>
        <span class="section-count numeric">{setGroups.length}</span>
      </header>

      {#each setGroups as group (group.key)}
        {@render deckGroup(group)}
      {/each}
    </section>
  {/if}
</div>

{#if inspectable && CardLightbox}
  <CardLightbox
    open={lightboxOpen}
    {set}
    collection={lightboxCollection}
    items={lightboxItems}
    index={lightboxIndex}
    side={lightboxSide}
    onclose={closeLightbox}
    onprevious={() => moveLightbox(-1)}
    onnext={() => moveLightbox(1)}
    onsidechange={(side) => (lightboxSide = side)}
  />
{/if}
{#if inspectable && ComponentModal}
  <ComponentModal
    open={viewingFigure !== null}
    figure={viewingFigure}
    ownerName={viewingFigure ? figureOwnerName(viewingFigure) : null}
    onclose={() => (viewingFigureId = null)}
  />
{/if}

<style>
  .page {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
    padding: var(--space-2) var(--space-8) var(--space-10);
  }

  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-5);
    padding-block: var(--space-4);
  }

  .eyebrow {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .title {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }

  .lede {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .zoom {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    /* Stays right when there is no heading beside it to be spaced against. */
    margin-left: auto;
    color: var(--text-muted);
  }

  .zoom input {
    width: 120px;
  }

  /*
   * A tile whose component threw. Sized to fill whatever the tile would have
   * been, so the grid keeps its shape and the failure reads as one item rather
   * than as the page having collapsed.
   */
  .broken {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: 100%;
    aspect-ratio: 63 / 88;
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    box-shadow: inset 0 0 0 1px var(--danger);
    color: var(--danger);
    text-align: center;
  }

  .broken-title {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
  }

  .broken-why {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }

  .showcase,
  .character-collection {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-5);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    background: var(--surface-base);
    box-shadow: var(--shadow-sm);
    scroll-margin-block-start: var(--space-3);
  }

  .section-heading,
  .character-heading,
  .board-heading,
  .deck-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .section-heading h2,
  .character-heading h3,
  .board-heading h3,
  .deck-title {
    margin: 0;
    color: var(--text-primary);
  }

  .section-heading h2 {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  .section-heading > p {
    max-width: 42ch;
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-align: right;
  }

  .section-kicker {
    display: block;
    margin-bottom: 2px;
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .section-count,
  .character-count,
  .board-heading span,
  .group-count {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .battlefield {
    background:
      linear-gradient(145deg, color-mix(in oklab, var(--accent) 5%, transparent), transparent 45%),
      var(--surface-base);
  }

  .board-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .board-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
    box-shadow: inset 0 1px 0 color-mix(in oklab, var(--text-primary) 4%, transparent);
  }

  .board-heading h3 {
    font-size: var(--text-sm);
  }

  .collections {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .collection-heading {
    padding-inline: var(--space-1);
  }

  .collection-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .character-collection {
    background:
      linear-gradient(150deg, color-mix(in oklab, var(--accent) 4%, transparent), transparent 42%),
      var(--surface-base);
  }

  .character-heading {
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
  }

  .character-heading h3 {
    margin-top: var(--space-1);
    font-family: var(--font-display);
    font-size: var(--text-md);
  }

  .role-badge {
    display: inline-flex;
    padding: 2px var(--space-2);
    border-radius: var(--radius-full);
    background: var(--surface-active);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  .identity-block,
  .deck-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .identity-block h4,
  .deck-title {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-wide);
    color: var(--text-tertiary);
  }

  .deck-group + .deck-group {
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-subtle);
  }

  .set-decks .deck-group {
    padding: var(--space-4);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
  }

  .set-decks .deck-group + .deck-group {
    padding-top: var(--space-4);
  }

  .gallery {
    display: grid;
    /* A preferred size cannot make the review surface wider than a phone. */
    grid-template-columns: repeat(auto-fill, minmax(min(var(--tile), 100%), 1fr));
    gap: var(--space-4);
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
  }

  /* Same geometry as a real card tile, without mounting any renderer. Keeping
     the grid's height stable is what makes both the scrollbar and jump links
     truthful while a below-the-fold deck is deferred. */
  .placeholder-card {
    display: block;
    width: 100%;
    aspect-ratio: 63 / 88;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background:
      linear-gradient(
        145deg,
        color-mix(in oklab, var(--surface-active) 70%, transparent),
        transparent 60%
      ),
      var(--surface-inset);
    box-shadow: var(--shadow-xs);
  }

  .placeholder-line {
    display: block;
    width: 68%;
    height: 0.65em;
    border-radius: var(--radius-full);
    background: var(--surface-active);
  }

  .placeholder-line.short {
    width: 42%;
    opacity: 0.65;
  }

  .tile-card {
    position: relative;
    display: block;
    padding: 0;
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-md);
    /*
     * A native `<button>` defaults to `text-align: center`, and it is a
     * button here whenever the tile is clickable (`interactive`). Card faces
     * like `ActionCardFace` never set their own `text-align` — nothing else
     * ever renders them inside a button, `PreviewPanel`'s `.card-slot` is a
     * plain div — so without this the browser default cascades straight into
     * the card and every line of body text centres, which is not what the
     * card actually prints.
     */
    text-align: left;
    transition:
      translate var(--duration-fast) var(--ease-out),
      box-shadow var(--duration-fast) var(--ease-out);
  }

  /*
   * The lift is a promise that something happens on click, so it is qualified
   * on the tag rather than the class: in a read-only overview these are divs.
   */
  button.tile-card:hover {
    translate: 0 -2px;
    box-shadow: var(--shadow-lg);
  }

  .inspect-cue {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid color-mix(in oklab, var(--text-primary) 22%, transparent);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--grey-1000) 72%, transparent);
    color: var(--text-inverse);
    opacity: 0;
    translate: 0 2px;
    transition:
      opacity var(--duration-fast) var(--ease-out),
      translate var(--duration-fast) var(--ease-out);
    pointer-events: none;
  }

  button:hover .inspect-cue,
  button:focus-visible .inspect-cue {
    opacity: 1;
    translate: 0;
  }

  @media (pointer: coarse) {
    .inspect-cue {
      opacity: 1;
      translate: 0;
    }
  }

  .tile-caption {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .tile-name {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tile-meta {
    display: flex;
    gap: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  /* -- threat track ------------------------------------------------------ */
  /*
   * A button wrapping the real board, so the whole strip is the click target
   * that opens the editor. `display: block` and full width let the board size
   * itself; the board owns its own layout and proportions.
   */
  .track-open {
    display: block;
    width: 100%;
    padding: 0;
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow: var(--shadow-md);
    /* Same reasoning as `.tile-card` above — a free-floating threat-track
       note has no `text-align` of its own to fall back on either. */
    text-align: left;
    transition:
      translate var(--duration-fast) var(--ease-out),
      box-shadow var(--duration-fast) var(--ease-out);
  }

  button.track-open:hover {
    translate: 0 -2px;
    box-shadow: var(--shadow-lg);
  }

  /* -- figures ----------------------------------------------------------- */
  .figures {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: var(--space-4);
  }

  .figure {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    box-shadow: var(--shadow-xs);
    text-align: left;
    transition:
      border-color var(--duration-fast) var(--ease-out),
      translate var(--duration-fast) var(--ease-out),
      box-shadow var(--duration-fast) var(--ease-out);
  }

  button.figure:hover {
    border-color: var(--border-strong);
    translate: 0 -2px;
    box-shadow: var(--shadow-md);
  }

  .figure-thumb {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 1;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-sunken);
    color: var(--text-muted);
  }

  .figure-thumb.empty {
    border: 1px dashed var(--border-default);
  }

  .figure-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .figure-name {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .figure-meta {
    display: flex;
    gap: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  @media (max-width: 760px) {
    .page {
      padding-inline: var(--space-5);
    }

    .section-heading {
      align-items: flex-start;
      flex-direction: column;
    }

    .section-heading > p {
      text-align: left;
    }

    .showcase,
    .character-collection {
      padding: var(--space-4);
    }
  }
</style>
