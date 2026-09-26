<script lang="ts">
  /**
   * The public face of a collection.
   *
   * Membership, invitations, readiness and collection mutation are
   * intentionally absent from this component's props. An organizer sees this
   * same exhibition first and chooses to leave it for their workspace, rather
   * than visitors receiving a diluted version of an admin screen.
   */
  import type {
    Collection,
    CollectionCharacterSummary,
    CollectionTile
  } from '$lib/cloud/collections';
  import { CHARACTER_ROLE_META } from '$lib/characters/types';
  import type { CharacterRole } from '$lib/characters/types';
  import { initials, tint } from '$lib/core/swatch';
  import { CARD_FORMATS, trimBox } from '$lib/renderer/geometry';
  import { Button, Icon } from '$lib/ui';
  import CollectionMemberExplorer from './CollectionMemberExplorer.svelte';

  type ExploreMode = 'characters' | 'sets' | 'components';
  type ExplorerFocus = 'full' | 'components';

  interface Props {
    collection: Collection;
    tiles: readonly CollectionTile[];
    characters: readonly CollectionCharacterSummary[];
    tilesLoading?: boolean;
    tilesFailed?: boolean;
    charactersLoading?: boolean;
    charactersFailed?: boolean;
    canManage?: boolean;
    canUseMemberTools?: boolean;
    /** The member workspace currently offers a path to another contribution. */
    canAddDeck?: boolean;
    workspaceAttention?: number;
    announcement?: string | null;
    onmanage: () => void;
    onmember: () => void;
    onopenset: (slug: string, characterId?: string) => void;
    onopenauthor: (ownerId: string) => void;
    onplay: () => void;
  }

  let {
    collection,
    tiles,
    characters,
    tilesLoading = false,
    tilesFailed = false,
    charactersLoading = false,
    charactersFailed = false,
    canManage = false,
    canUseMemberTools = false,
    canAddDeck = false,
    workspaceAttention = 0,
    announcement = null,
    onmanage,
    onmember,
    onopenset,
    onopenauthor,
    onplay
  }: Props = $props();

  const CARD_BLEED = CARD_FORMATS.action.bleed;
  const CARD_TRIM = trimBox(CARD_FORMATS.action);
  const TRIM_SCALE_TALL = CARD_BLEED.height / CARD_TRIM.height;
  const TRIM_SCALE_WIDE = CARD_BLEED.width / CARD_TRIM.width;
  const CARD_ASPECT = `${CARD_FORMATS.action.mm.width} / ${CARD_FORMATS.action.mm.height}`;

  interface CreatorCredit {
    id: string;
    name: string;
    avatar: string;
    setNames: string[];
    characterCount: number;
  }

  let mode = $state<ExploreMode>('characters');
  let setFilter = $state('');
  let selectedTile = $state.raw<CollectionTile | null>(null);
  let selectedCharacterId = $state<string | undefined>();
  let explorerFocus = $state<ExplorerFocus>('full');
  let returnFocusKey = '';
  let exploreNode = $state<HTMLElement | null>(null);
  let showcaseNode = $state<HTMLDivElement | null>(null);
  let choseMode = false;
  /**
   * Character cards are full published previews, so fetch one only after its
   * roster tile has actually been hovered or focused. Keep it mounted after
   * that first look so returning to the tile swaps immediately.
   */
  let peekedCharacters = $state(new Set<string>());

  const title = $derived(collection.name.trim() || 'Untitled collection');
  const tileById = $derived.by(() => new Map(tiles.map((tile) => [tile.set_id, tile])));
  const totalCards = $derived(tiles.reduce((total, tile) => total + tile.card_count, 0));
  const totalCharacters = $derived(
    characters.length > 0
      ? characters.length
      : tiles.reduce((total, tile) => total + tile.character_count, 0)
  );
  const representedSetCount = $derived.by(
    () =>
      new Set([
        ...tiles.map((tile) => tile.set_id),
        ...characters.map((character) => character.set_id)
      ]).size
  );

  const creators = $derived.by(() => {
    const grouped = new Map<string, CreatorCredit>();
    for (const tile of tiles) {
      const existing = grouped.get(tile.owner_id);
      if (existing) {
        existing.setNames.push(tile.name || 'Untitled set');
        continue;
      }
      grouped.set(tile.owner_id, {
        id: tile.owner_id,
        name: tile.author_name || 'Anonymous',
        avatar: tile.author_avatar,
        setNames: [tile.name || 'Untitled set'],
        characterCount: 0
      });
    }

    if (characters.length > 0) {
      for (const character of characters) {
        let creator = grouped.get(character.owner_id);
        if (!creator) {
          creator = {
            id: character.owner_id,
            name: character.author_name || 'Anonymous',
            avatar: character.author_avatar,
            setNames: [],
            characterCount: 0
          };
          grouped.set(character.owner_id, creator);
        }
        const setName = character.set_name || 'Untitled set';
        if (!creator.setNames.includes(setName)) creator.setNames.push(setName);
        creator.characterCount += 1;
      }
    } else {
      for (const tile of tiles) {
        const creator = grouped.get(tile.owner_id);
        if (creator) creator.characterCount += tile.character_count;
      }
    }
    return [...grouped.values()];
  });

  const filteredCharacters = $derived(
    setFilter ? characters.filter((character) => character.set_id === setFilter) : characters
  );

  const heroImages = $derived.by(() => {
    const candidates = [
      ...characters.map((character) => character.card_url || character.image_url),
      ...tiles.map((tile) => tile.preview_card_url || tile.thumbnail_url || tile.cover_url)
    ].filter(Boolean);
    return [...new Set(candidates)].slice(0, 4);
  });

  $effect(() => {
    if (setFilter && !tiles.some((tile) => tile.set_id === setFilter)) setFilter = '';
    if (selectedTile && !tiles.some((tile) => tile.set_id === selectedTile?.set_id)) {
      selectedTile = null;
      selectedCharacterId = undefined;
    }
    if (
      !choseMode &&
      !charactersLoading &&
      characters.length === 0 &&
      !tilesLoading
    ) {
      mode = 'sets';
    }
  });

  function characterKey(character: CollectionCharacterSummary): string {
    /* Forks preserve entity ids, so the set id is part of every public roster
       identity even when the character name and local id are also identical. */
    return `${character.set_id}:${character.character_id}`;
  }

  function peekCharacter(key: string): void {
    if (peekedCharacters.has(key)) return;
    peekedCharacters = new Set(peekedCharacters).add(key);
  }

  function tileImage(tile: CollectionTile): string {
    return tile.thumbnail_url || tile.cover_url;
  }

  function roleLabel(value: string): string {
    return value in CHARACTER_ROLE_META
      ? CHARACTER_ROLE_META[value as CharacterRole].label
      : value || 'Character';
  }

  function setTypeLabel(tile: CollectionTile): string {
    if (tile.scope === 'hero') return 'Hero deck';
    if (tile.scope === 'villain') return 'Villain side';
    if (tile.kind === 'adventure') return 'Adventure set';
    return tile.hero_count > 1 ? 'Heroes set' : 'Hero deck';
  }

  function scrollBehavior(): ScrollBehavior {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  }

  function scrollToExplore(): void {
    exploreNode?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }

  function showMode(next: ExploreMode): void {
    choseMode = true;
    selectedTile = null;
    selectedCharacterId = undefined;
    mode = next;
    requestAnimationFrame(scrollToExplore);
  }

  function openMember(
    selected: CollectionTile,
    characterId: string | undefined,
    focus: ExplorerFocus,
    triggerKey: string
  ): void {
    returnFocusKey = triggerKey;
    selectedTile = selected;
    selectedCharacterId = characterId;
    explorerFocus = focus;
    requestAnimationFrame(() => {
      showcaseNode
        ?.querySelector<HTMLElement>('#member-explorer-title')
        ?.focus({ preventScroll: true });
      scrollToExplore();
    });
  }

  function openCharacter(character: CollectionCharacterSummary): void {
    const member = tileById.get(character.set_id);
    if (!member && tilesLoading) return;
    if (!member) {
      onopenset(character.set_slug, character.character_id);
      return;
    }
    openMember(member, character.character_id, 'full', `character:${characterKey(character)}`);
  }

  function closeMember(): void {
    selectedTile = null;
    selectedCharacterId = undefined;
    requestAnimationFrame(() => {
      const controls = showcaseNode?.querySelectorAll<HTMLButtonElement>('[data-member-trigger]') ?? [];
      const target = [...controls].find((control) => control.dataset.memberTrigger === returnFocusKey);
      target?.focus();
      target?.scrollIntoView({ block: 'center' });
    });
  }

  function jumpToPlay(): void {
    onplay();
  }
</script>

<div class="collection-showcase" bind:this={showcaseNode}>
  <section
    class="showcase-hero"
    style:background={tint(collection.id)}
    aria-labelledby="collection-showcase-heading"
  >
    <div class="hero-art" aria-hidden="true">
      {#if collection.banner_url}
        <img class="banner-image" src={collection.banner_url} alt="" />
      {:else if heroImages.length > 0}
        <div class="hero-collage">
          {#each heroImages as image, index (image)}
            <img src={image} alt="" class:wide={index > 1} />
          {/each}
        </div>
      {:else}
        <span class="hero-initials">{initials(title)}</span>
      {/if}
      <span class="hero-lines"></span>
      <span class="hero-scrim"></span>
    </div>

    {#if canManage || canUseMemberTools}
      <div class="hero-tools">
        <span class="preview-copy">
          <strong>{collection.visibility === 'public' ? 'Public page' : 'Page preview'}</strong>
          <small>
            {collection.visibility === 'private'
              ? 'Everybody outside the project sees nothing.'
              : collection.visibility === 'unlisted'
                ? 'This is exactly what anyone with the link sees.'
                : 'This is exactly what everybody sees.'}
          </small>
        </span>
        <Button variant="secondary" onclick={canManage ? onmanage : onmember}>
          {canManage ? 'Project workspace' : canAddDeck ? 'Add a deck' : 'Your contribution'}{workspaceAttention > 0 ? ` · ${workspaceAttention}` : ''}
        </Button>
      </div>
    {/if}

    <div class="hero-copy">
      <p class="eyebrow inverse">Community collection</p>
      <h1 id="collection-showcase-heading">{title}</h1>
      {#if collection.subtitle}<p class="hero-subtitle">{collection.subtitle}</p>{/if}
      {#if collection.blurb}<p class="hero-blurb">{collection.blurb}</p>{/if}

      <div class="hero-facts" aria-label="Collection totals">
        {#if tilesLoading && charactersLoading}
          <span>Gathering the collection…</span>
        {:else}
          <span>{totalCharacters} {totalCharacters === 1 ? 'character' : 'characters'}</span>
          <span>{representedSetCount} {representedSetCount === 1 ? 'set' : 'sets'}</span>
          <span>{creators.length} {creators.length === 1 ? 'creator' : 'creators'}</span>
          {#if totalCards > 0}<span>{totalCards} card designs</span>{/if}
        {/if}
      </div>

      <div class="hero-actions">
        <Button
          variant="primary"
          onclick={() => showMode(characters.length > 0 || charactersLoading ? 'characters' : 'sets')}
        >
          {characters.length > 0
            ? 'Meet the roster'
            : charactersLoading
              ? 'Explore the collection'
              : 'Explore the sets'}
        </Button>
        {#if tiles.length > 0}
          <Button variant="secondary" onclick={() => showMode('sets')}>See every set</Button>
        {/if}
      </div>

      {#if creators.length > 0}
        <div class="hero-creators">
          <span>Featuring work by</span>
          <div class="creator-chips">
            {#each creators.slice(0, 8) as creator (creator.id)}
              <button type="button" onclick={() => onopenauthor(creator.id)}>
                {#if creator.avatar}
                  <img src={creator.avatar} alt="" />
                {:else}
                  <span aria-hidden="true">{initials(creator.name)}</span>
                {/if}
                {creator.name}
              </button>
            {/each}
            {#if creators.length > 8}
              <span class="creator-overflow">+{creators.length - 8} more below</span>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </section>

  {#if announcement}<p class="announcement" role="status">{announcement}</p>{/if}

  <nav class="explore-nav" bind:this={exploreNode} aria-label="Explore this collection">
    <div class="explore-name">
      <span>Explore the collection</span>
      <strong>{selectedTile?.name || title}</strong>
    </div>
    <div class="mode-switch" aria-label="Collection view">
      <button
        type="button"
        class:active={mode === 'characters' && !selectedTile}
        aria-pressed={mode === 'characters' && !selectedTile}
        onclick={() => showMode('characters')}
      >Characters</button>
      <button
        type="button"
        class:active={mode === 'sets' && !selectedTile}
        aria-pressed={mode === 'sets' && !selectedTile}
        onclick={() => showMode('sets')}
      >Sets</button>
      <button
        type="button"
        class:active={mode === 'components' && !selectedTile}
        aria-pressed={mode === 'components' && !selectedTile}
        onclick={() => showMode('components')}
      >Components</button>
    </div>
    {#if !selectedTile && mode === 'characters' && tiles.length > 1}
      <label class="set-filter">
        <span>Showing</span>
        <select bind:value={setFilter}>
          <option value="">All sets</option>
          {#each tiles as tile (tile.set_id)}
            <option value={tile.set_id}>{tile.name || 'Untitled set'}</option>
          {/each}
        </select>
      </label>
    {/if}
    {#if tiles.length > 0}
      <Button variant="ghost" onclick={jumpToPlay}>
        Play or print
        <Icon name="chevronRight" size={13} />
      </Button>
    {/if}
  </nav>

  <div class="explore-body">
    <CollectionMemberExplorer
      tile={selectedTile}
      collectionName={title}
      characterId={selectedCharacterId}
      focus={explorerFocus}
      onback={closeMember}
    />

    {#if !selectedTile && mode === 'characters'}
      <section class="showcase-section" aria-labelledby="collection-characters-heading">
        <header class="section-heading">
          <div>
            <p class="eyebrow">Meet the roster</p>
            <h2 id="collection-characters-heading">Characters worth gathering around</h2>
          </div>
          {#if filteredCharacters.length > 0}
            <span>{filteredCharacters.length} shown</span>
          {/if}
        </header>

        {#if charactersLoading}
          <p class="section-message" aria-live="polite">Gathering the roster…</p>
        {:else if charactersFailed}
          <p class="section-message">
            {tilesFailed
              ? 'This collection could not be opened completely right now.'
              : 'The sets are ready to explore, but their character index is unavailable right now.'}
          </p>
        {:else if filteredCharacters.length === 0}
          <p class="section-message">No characters are published in this view yet.</p>
        {:else}
          <ul class="character-grid">
            {#each filteredCharacters as character (characterKey(character))}
              {@const key = characterKey(character)}
              {@const member = tileById.get(character.set_id)}
              <li>
                <article class="character-tile">
                  <button
                    type="button"
                    class="character-visual"
                    class:has-card={!!character.image_url && !!character.card_url}
                    style:aspect-ratio={CARD_ASPECT}
                    style:--trim-scale={TRIM_SCALE_TALL}
                    style:background={tint(key)}
                    data-member-trigger={`character:${key}`}
                    disabled={tilesLoading && !tileById.has(character.set_id)}
                    aria-label={`Explore ${character.character_name || 'this character'} in ${character.set_name || 'their set'}`}
                    onpointerenter={() => peekCharacter(key)}
                    onfocusin={() => peekCharacter(key)}
                    onclick={() => openCharacter(character)}
                  >
                    {#if character.image_url}
                      <img
                        class="character-art"
                        class:trimmed={character.image_bleeds}
                        src={character.image_url}
                        alt=""
                        loading="lazy"
                      />
                    {:else if character.card_url}
                      <img class="character-card" src={character.card_url} alt="" loading="lazy" />
                    {:else}
                      <span class="character-initials">{initials(character.character_name)}</span>
                    {/if}
                    {#if character.image_url && character.card_url && peekedCharacters.has(key)}
                      <img class="character-card card-peek" src={character.card_url} alt="" />
                    {/if}
                    {#if character.image_url && character.card_url}
                      <span class="peek-hint">
                        <Icon name="card" size={11} />
                        Character card
                      </span>
                    {/if}
                    <span class="inspect-cue">
                      {tilesLoading && !tileById.has(character.set_id)
                        ? 'Preparing set…'
                        : 'Explore cards & components'}
                    </span>
                  </button>
                  <div class="character-copy">
                    <div class="character-name-row">
                      <h3>{character.character_name || 'Untitled character'}</h3>
                      <span
                        class="role"
                        style:--role-tint={`var(--role-${character.character_role}, var(--text-muted))`}
                      >{roleLabel(character.character_role)}</span>
                    </div>
                    {#if member?.difficulty_rating}
                      <div
                        class="character-difficulty"
                        class:easy={member.difficulty_rating === 1}
                        class:moderate={member.difficulty_rating === 2 || member.difficulty_rating === 3}
                        class:demanding={member.difficulty_rating === 4 || member.difficulty_rating === 5}
                        aria-label={`Difficulty ${member.difficulty_rating} out of 5`}
                      >
                        <span>Difficulty</span>
                        <span class="difficulty-scale" aria-hidden="true">
                          {#each [1, 2, 3, 4, 5] as rating}
                            <i class:filled={rating <= member.difficulty_rating}></i>
                          {/each}
                        </span>
                        <strong>{member.difficulty_rating}/5</strong>
                      </div>
                    {/if}
                    {#if member?.description}
                      <p class="character-description">{member.description}</p>
                    {/if}
                    <p class="character-set">{character.set_name || 'Untitled set'}</p>
                    <button class="creator-link" type="button" onclick={() => onopenauthor(character.owner_id)}>
                      By {character.author_name || 'Anonymous'}
                    </button>
                  </div>
                </article>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {:else if !selectedTile && mode === 'sets'}
      <section class="showcase-section" aria-labelledby="collection-sets-heading">
        <header class="section-heading">
          <div>
            <p class="eyebrow">Explore the sets</p>
            <h2 id="collection-sets-heading">Every creator’s contribution</h2>
          </div>
          {#if tiles.length > 0}<span>{tiles.length} in collection order</span>{/if}
        </header>

        {#if tilesLoading}
          <p class="section-message" aria-live="polite">Opening the collection…</p>
        {:else if tilesFailed}
          <p class="section-message">The collection is here, but its sets could not be loaded.</p>
        {:else if tiles.length === 0}
          <p class="section-message">
            No published sets have joined this collection yet.
          </p>
        {:else}
          <ul class="set-grid">
            {#each tiles as tile (tile.set_id)}
              <li>
                <article class="set-tile">
                  <button
                    type="button"
                    class="set-art"
                    style:--trim-scale={TRIM_SCALE_WIDE}
                    style:background={tint(tile.set_id)}
                    data-member-trigger={`set-art:${tile.set_id}`}
                    aria-label={`Explore ${tile.name || 'this set'} here`}
                    onclick={() => openMember(tile, undefined, 'full', `set-art:${tile.set_id}`)}
                  >
                    {#if tileImage(tile)}
                      <img
                        class="set-cover"
                        class:trimmed={tile.cover_bleeds}
                        src={tileImage(tile)}
                        alt=""
                        loading="lazy"
                      />
                    {:else}
                      <span class="set-initials">{initials(tile.name)}</span>
                    {/if}
                    {#if tile.preview_card_url}
                      <img class="set-card" src={tile.preview_card_url} alt="" loading="lazy" />
                    {/if}
                    <span class="set-kind">{setTypeLabel(tile)}</span>
                  </button>
                  <div class="set-copy">
                    <h3>{tile.name || 'Untitled set'}</h3>
                    {#if tile.subtitle}<p class="set-subtitle">{tile.subtitle}</p>{/if}
                    <button class="creator-link" type="button" onclick={() => onopenauthor(tile.owner_id)}>
                      {#if tile.author_avatar}<img src={tile.author_avatar} alt="" loading="lazy" />{/if}
                      By {tile.author_name || 'Anonymous'}
                    </button>
                    <p class="set-meta">
                      {tile.character_count} {tile.character_count === 1 ? 'character' : 'characters'}
                      <span aria-hidden="true">·</span>
                      {tile.card_count} card designs
                    </p>
                    <div class="set-actions">
                      <Button
                        variant="primary"
                        data-member-trigger={`set:${tile.set_id}`}
                        onclick={() => openMember(tile, undefined, 'full', `set:${tile.set_id}`)}
                      >Explore here</Button>
                      <Button variant="ghost" onclick={() => onopenset(tile.slug)}>Open on its own</Button>
                    </div>
                  </div>
                </article>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {:else if !selectedTile}
      <section class="showcase-section" aria-labelledby="collection-components-heading">
        <header class="section-heading">
          <div>
            <p class="eyebrow">On the table</p>
            <h2 id="collection-components-heading">Inspect the physical pieces</h2>
          </div>
        </header>
        <p class="section-intro">
          Choose a set to open its published components. Miniatures and tokens, when included,
          use the same interactive 3D viewer as the gallery.
        </p>

        {#if tilesLoading}
          <p class="section-message" aria-live="polite">Finding the components…</p>
        {:else if tilesFailed}
          <p class="section-message">The collection is here, but its sets could not be loaded.</p>
        {:else if tiles.length === 0}
          <p class="section-message">There are no published sets to inspect yet.</p>
        {:else}
          <ul class="component-set-grid">
            {#each tiles as tile (tile.set_id)}
              <li>
                <button
                  type="button"
                  class="component-set"
                  data-member-trigger={`components:${tile.set_id}`}
                  onclick={() => openMember(tile, undefined, 'components', `components:${tile.set_id}`)}
                >
                  <span class="component-set-art" style:background={tint(tile.set_id)}>
                    {#if tile.preview_card_url}
                      <img src={tile.preview_card_url} alt="" loading="lazy" />
                    {:else if tileImage(tile)}
                      <img src={tileImage(tile)} alt="" loading="lazy" />
                    {:else}
                      {initials(tile.name)}
                    {/if}
                  </span>
                  <span>
                    <strong>{tile.name || 'Untitled set'}</strong>
                    <small>Check its published components</small>
                  </span>
                  <Icon name="chevronRight" size={15} />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    {#if !selectedTile && creators.length > 0}
      <section class="showcase-section creator-section" aria-labelledby="collection-creators-heading">
        <header class="section-heading">
          <div>
            <p class="eyebrow">The people behind the collection</p>
            <h2 id="collection-creators-heading">Meet the creators</h2>
          </div>
        </header>
        <ul class="creator-grid">
          {#each creators as creator (creator.id)}
            <li>
              <button type="button" onclick={() => onopenauthor(creator.id)}>
                {#if creator.avatar}
                  <img src={creator.avatar} alt="" loading="lazy" />
                {:else}
                  <span class="creator-avatar" aria-hidden="true">{initials(creator.name)}</span>
                {/if}
                <strong>{creator.name}</strong>
                <small>
                  {creator.setNames.length} {creator.setNames.length === 1 ? 'set' : 'sets'}
                  <span aria-hidden="true">·</span>
                  {creator.characterCount} {creator.characterCount === 1 ? 'character' : 'characters'}
                </small>
                <span class="creator-work">{creator.setNames.join(', ')}</span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
</div>

<style>
  .collection-showcase {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .showcase-hero {
    position: relative;
    isolation: isolate;
    min-height: clamp(24rem, 48vw, 36rem);
    display: flex;
    align-items: flex-end;
    overflow: hidden;
    border-radius: var(--radius-xl);
    color: var(--grey-50);
    box-shadow: var(--shadow-lg);
  }

  .hero-art,
  .banner-image,
  .hero-lines,
  .hero-scrim {
    position: absolute;
    inset: 0;
  }

  .hero-art {
    z-index: -1;
    overflow: hidden;
  }

  .banner-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: saturate(1.08) contrast(1.04);
  }

  .hero-lines {
    opacity: 0.32;
    background: repeating-linear-gradient(
      112deg,
      transparent 0 44px,
      color-mix(in oklab, var(--grey-50) 9%, transparent) 44px 45px
    );
  }

  .hero-scrim {
    background:
      linear-gradient(
        90deg,
        color-mix(in oklab, var(--grey-1000) 94%, transparent) 0%,
        color-mix(in oklab, var(--grey-1000) 82%, transparent) 48%,
        color-mix(in oklab, var(--grey-1000) 35%, transparent) 100%
      ),
      linear-gradient(0deg, color-mix(in oklab, var(--grey-1000) 80%, transparent), transparent 65%);
  }

  .hero-collage {
    position: absolute;
    inset: -9% -2% -9% 48%;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
    transform: rotate(5deg);
  }

  .hero-collage img {
    width: 100%;
    height: 100%;
    min-height: 0;
    object-fit: cover;
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-card);
  }

  .hero-collage img.wide {
    transform: translateX(var(--space-5));
  }

  .hero-initials {
    position: absolute;
    right: 8%;
    bottom: -0.12em;
    color: var(--grey-50);
    font-family: var(--font-display);
    font-size: clamp(8rem, 24vw, 19rem);
    font-weight: var(--weight-semibold);
    line-height: 0.72;
    opacity: 0.16;
  }

  .hero-tools {
    position: absolute;
    z-index: 2;
    top: var(--space-4);
    right: var(--space-4);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1);
    border-radius: var(--radius-md);
    background: color-mix(in oklab, var(--grey-1000) 55%, transparent);
    backdrop-filter: blur(8px);
  }

  .hero-tools :global(.btn) {
    color: var(--grey-100);
    white-space: nowrap;
  }

  .preview-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1px;
    color: var(--grey-100);
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
  }

  .preview-copy small {
    color: var(--grey-300);
    font: inherit;
  }

  .hero-copy {
    width: min(47rem, 78%);
    padding: clamp(var(--space-6), 5vw, var(--space-10));
  }

  .eyebrow {
    margin: 0 0 var(--space-2);
    color: var(--text-accent);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
  }

  .eyebrow.inverse {
    color: var(--grey-200);
  }

  .showcase-hero h1 {
    max-width: 12ch;
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(2.8rem, 7vw, 5.4rem);
    font-weight: var(--weight-semibold);
    letter-spacing: -0.045em;
    line-height: 0.92;
    text-wrap: balance;
  }

  .hero-subtitle {
    margin: var(--space-4) 0 0;
    color: var(--grey-100);
    font-size: clamp(var(--text-lg), 2vw, var(--text-xl));
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
    text-wrap: balance;
  }

  .hero-blurb {
    max-width: 62ch;
    margin: var(--space-3) 0 0;
    color: var(--grey-200);
    font-size: var(--text-md);
    line-height: var(--leading-relaxed);
  }

  .hero-facts,
  .hero-actions,
  .hero-creators,
  .creator-chips {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
  }

  .hero-facts {
    gap: var(--space-2) var(--space-5);
    margin-top: var(--space-5);
    color: var(--grey-200);
    font-size: var(--text-sm);
  }

  .hero-facts span + span::before {
    content: '·';
    margin-right: var(--space-5);
    color: var(--grey-500);
  }

  .hero-actions {
    gap: var(--space-2);
    margin-top: var(--space-5);
  }

  .hero-creators {
    gap: var(--space-2) var(--space-3);
    margin-top: var(--space-5);
    color: var(--grey-300);
    font-size: var(--text-xs);
  }

  .creator-chips {
    gap: var(--space-1);
  }

  .creator-overflow {
    padding-inline: var(--space-2);
    color: var(--grey-300);
    white-space: nowrap;
  }

  .creator-chips button {
    display: inline-flex;
    min-height: 30px;
    align-items: center;
    gap: var(--space-1);
    padding: 2px var(--space-2) 2px 3px;
    border: 1px solid color-mix(in oklab, var(--grey-50) 20%, transparent);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--grey-1000) 34%, transparent);
    color: var(--grey-100);
    font: inherit;
    cursor: pointer;
  }

  .creator-chips img,
  .creator-chips button > span {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border-radius: var(--radius-full);
    background: var(--surface-selected);
    object-fit: cover;
  }

  .announcement {
    margin: var(--space-4) 0 0;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border-accent);
    border-radius: var(--radius-md);
    background: var(--accent-soft);
    color: var(--text-secondary);
  }

  .explore-nav {
    position: sticky;
    z-index: var(--z-sticky);
    top: 0;
    display: grid;
    grid-template-columns: minmax(10rem, 1fr) auto minmax(10rem, auto) auto;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-6);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    background: color-mix(in oklab, var(--surface-raised) 94%, transparent);
    box-shadow: var(--shadow-sm);
    backdrop-filter: blur(12px);
    scroll-margin-top: var(--space-2);
  }

  .explore-name {
    min-width: 0;
  }

  .explore-name span,
  .set-filter > span {
    display: block;
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
  }

  .explore-name strong {
    display: block;
    overflow: hidden;
    color: var(--text-primary);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mode-switch {
    display: flex;
    padding: 3px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-inset);
  }

  .mode-switch button {
    min-height: 32px;
    padding: 0 var(--space-3);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .mode-switch button.active {
    background: var(--surface-raised);
    color: var(--text-primary);
    box-shadow: var(--shadow-xs);
  }

  .set-filter {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .set-filter select {
    min-width: 10rem;
    height: 32px;
    padding: 0 var(--space-7) 0 var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-xs);
  }

  .explore-body {
    min-width: 0;
    padding-top: var(--space-8);
  }

  .showcase-section {
    scroll-margin-top: 5rem;
  }

  .section-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-5);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
  }

  .section-heading h2 {
    margin: 0;
    color: var(--text-primary);
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    letter-spacing: var(--tracking-tight);
    text-wrap: balance;
  }

  .section-heading > span {
    flex: none;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .section-message {
    display: grid;
    min-height: 12rem;
    place-items: center;
    margin: 0;
    color: var(--text-secondary);
    text-align: center;
  }

  .section-intro {
    max-width: 66ch;
    margin: var(--space-4) 0 0;
    color: var(--text-secondary);
    line-height: var(--leading-relaxed);
  }

  .character-grid,
  .set-grid,
  .component-set-grid,
  .creator-grid {
    display: grid;
    margin: 0;
    padding: var(--space-5) 0 0;
    list-style: none;
  }

  .character-grid {
    grid-template-columns: repeat(auto-fill, minmax(14.5rem, 1fr));
    gap: var(--space-5);
  }

  .character-tile {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
    box-shadow: var(--shadow-sm);
    transition:
      border-color var(--duration-fast) var(--ease-out),
      transform var(--duration-fast) var(--ease-out),
      box-shadow var(--duration-fast) var(--ease-out);
  }

  .character-tile:hover {
    border-color: var(--border-accent);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  .character-tile:focus-within,
  .set-tile:focus-within {
    border-color: var(--border-accent);
    box-shadow: var(--focus-ring);
  }

  .character-visual {
    position: relative;
    display: grid;
    width: 100%;
    place-items: center;
    overflow: hidden;
    padding: 0;
    border: 0;
    color: var(--text-on-accent);
    cursor: pointer;
  }

  .character-visual:disabled {
    cursor: progress;
  }

  .character-visual img {
    width: 100%;
    height: 100%;
  }

  .character-card {
    object-fit: contain;
    background: var(--surface-sunken);
  }

  .character-visual img.card-peek {
    position: absolute;
    inset: 0;
    object-fit: contain;
    opacity: 0;
    transition: opacity var(--duration-normal) var(--ease-out);
  }

  .character-visual:hover img.card-peek,
  .character-visual:focus-visible img.card-peek {
    opacity: 1;
  }

  .character-art {
    object-fit: cover;
  }

  .character-art.trimmed {
    transform: scale(var(--trim-scale));
  }

  .character-initials {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    opacity: 0.72;
  }

  .peek-hint {
    position: absolute;
    top: var(--space-2);
    left: var(--space-2);
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--grey-1000) 70%, transparent);
    color: var(--grey-100);
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-wide);
    transition: opacity var(--duration-fast) var(--ease-out);
  }

  .character-visual:hover .peek-hint,
  .character-visual:focus-visible .peek-hint {
    opacity: 0;
  }

  .inspect-cue {
    position: absolute;
    right: var(--space-2);
    bottom: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--grey-1000) 70%, transparent);
    color: var(--grey-100);
    font-size: var(--text-2xs);
  }

  @media (prefers-reduced-motion: reduce) {
    .character-visual img.card-peek,
    .peek-hint {
      transition: none;
    }
  }

  .character-copy {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
  }

  .character-name-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .character-name-row h3,
  .set-copy h3 {
    margin: 0;
    color: var(--text-primary);
    font-family: var(--font-display);
  }

  .character-name-row h3 {
    font-size: var(--text-md);
  }

  .role,
  .set-kind {
    flex: none;
    border-radius: var(--radius-full);
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }

  .role {
    padding: 1px var(--space-2);
    border: 1px solid var(--role-tint);
    color: var(--role-tint);
  }

  .character-copy p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .character-difficulty {
    --difficulty-colour: var(--warning);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }

  .character-difficulty strong {
    color: var(--difficulty-colour);
    font-size: var(--text-xs);
  }

  .character-difficulty.easy {
    --difficulty-colour: var(--success);
  }

  .character-difficulty.moderate {
    --difficulty-colour: var(--warning);
  }

  .character-difficulty.demanding {
    --difficulty-colour: var(--danger);
  }

  .difficulty-scale {
    display: flex;
    gap: 3px;
  }

  .difficulty-scale i {
    width: var(--space-3);
    height: 4px;
    border-radius: var(--radius-full);
    background: var(--border-default);
  }

  .difficulty-scale i.filled {
    background: var(--difficulty-colour);
  }

  .character-copy p.character-description {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }

  .character-copy p.character-set {
    margin-top: auto;
    padding-top: var(--space-2);
  }

  .creator-link {
    display: inline-flex;
    min-height: 30px;
    align-items: center;
    align-self: flex-start;
    gap: var(--space-2);
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-accent);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .creator-link:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .creator-link img {
    width: 22px;
    height: 22px;
    border-radius: var(--radius-full);
    object-fit: cover;
  }

  .set-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-5);
  }

  .set-tile {
    display: grid;
    grid-template-columns: minmax(12rem, 0.9fr) minmax(0, 1.1fr);
    height: 100%;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
    box-shadow: var(--shadow-sm);
  }

  .set-art {
    position: relative;
    min-height: 18rem;
    display: grid;
    width: 100%;
    place-items: center;
    overflow: hidden;
    padding: 0;
    border: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .set-cover {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: saturate(0.88) brightness(0.68);
  }

  .set-cover.trimmed {
    transform: scale(var(--trim-scale));
  }

  .set-card {
    position: relative;
    width: 46%;
    max-height: 82%;
    object-fit: contain;
    filter: drop-shadow(var(--shadow-lg));
    transform: rotate(3deg);
  }

  .set-initials {
    color: var(--text-on-accent);
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
  }

  .set-kind {
    position: absolute;
    top: var(--space-3);
    left: var(--space-3);
    padding: var(--space-1) var(--space-2);
    background: color-mix(in oklab, var(--grey-1000) 68%, transparent);
    color: var(--grey-100);
  }

  .set-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    padding: var(--space-5);
  }

  .set-copy h3 {
    font-size: var(--text-xl);
  }

  .set-subtitle {
    margin: var(--space-2) 0 var(--space-3);
    color: var(--text-secondary);
    line-height: var(--leading-normal);
  }

  .set-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
    margin: var(--space-3) 0 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .set-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: auto;
    padding-top: var(--space-5);
  }

  .component-set-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .component-set-grid li {
    display: flex;
  }

  .component-set {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr) auto;
    width: 100%;
    min-height: 84px;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    color: var(--text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .component-set:hover {
    border-color: var(--border-accent);
    background: var(--surface-hover);
  }

  .component-set-art {
    display: grid;
    width: 64px;
    height: 64px;
    place-items: center;
    overflow: hidden;
    border-radius: var(--radius-sm);
    color: var(--text-on-accent);
    font-weight: var(--weight-semibold);
  }

  .component-set-art img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .component-set > span:nth-child(2) {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }

  .component-set strong,
  .component-set small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .component-set small {
    color: var(--text-muted);
  }

  .creator-section {
    margin-top: var(--space-10);
    padding-top: var(--space-8);
    border-top: 1px solid var(--border-subtle);
  }

  .creator-grid {
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: var(--space-3);
  }

  .creator-grid li {
    display: flex;
  }

  .creator-grid button {
    display: flex;
    width: 100%;
    min-height: 10rem;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4);
    border: 1px solid transparent;
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
  }

  .creator-grid button:hover {
    border-color: var(--border-accent);
    background: var(--surface-hover);
  }

  .creator-grid img,
  .creator-avatar {
    display: grid;
    width: var(--space-9);
    height: var(--space-9);
    place-items: center;
    margin-bottom: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--surface-selected);
    color: var(--text-accent);
    font-weight: var(--weight-semibold);
    object-fit: cover;
  }

  .creator-grid small,
  .creator-work {
    color: var(--text-muted);
    font-size: var(--text-2xs);
    text-align: center;
  }

  .creator-work {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .character-tile,
    .set-card {
      transition: none;
      transform: none;
    }
  }

  @media (max-width: 920px) {
    .explore-nav {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .set-filter {
      grid-column: 1 / -1;
    }

    .explore-nav > :global(.btn) {
      grid-column: 2;
      grid-row: 1;
    }

    .set-grid {
      grid-template-columns: 1fr;
    }

    .component-set-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .set-filter select {
      font-size: var(--text-md);
    }
  }

  @media (max-width: 700px) {
    .showcase-hero {
      min-height: 34rem;
      align-items: stretch;
    }

    .hero-copy {
      width: 100%;
      align-self: flex-end;
      padding: calc(var(--space-10) + var(--space-4)) var(--space-4) var(--space-6);
    }

    .hero-tools {
      top: var(--space-3);
      right: var(--space-3);
      left: var(--space-3);
      justify-content: space-between;
    }

    .hero-collage {
      inset: 4% -28% 30% 34%;
      opacity: 0.56;
    }

    .hero-scrim {
      background:
        linear-gradient(0deg, color-mix(in oklab, var(--grey-1000) 96%, transparent) 0%, transparent 82%),
        linear-gradient(90deg, color-mix(in oklab, var(--grey-1000) 78%, transparent), transparent);
    }

    .showcase-hero h1 {
      font-size: clamp(2.45rem, 13vw, 4rem);
    }

    .hero-facts span + span::before {
      display: none;
    }

    .hero-creators {
      align-items: flex-start;
      flex-direction: column;
    }

    .creator-chips {
      width: 100%;
      flex-wrap: nowrap;
      overflow-x: auto;
      padding-bottom: var(--space-1);
    }

    .creator-chips button {
      flex: none;
      min-height: 44px;
    }

    .explore-nav {
      grid-template-columns: 1fr auto;
      gap: var(--space-2);
      margin-top: var(--space-4);
      padding: var(--space-2);
    }

    .explore-name {
      grid-column: 1;
    }

    .mode-switch {
      grid-column: 1 / -1;
      grid-row: 2;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
    }

    .mode-switch button {
      min-height: 44px;
      padding-inline: var(--space-1);
    }

    .explore-nav > :global(.btn) {
      grid-column: 2;
      grid-row: 1;
    }

    .set-filter {
      grid-column: 1 / -1;
      grid-row: 3;
      justify-content: space-between;
    }

    .set-filter select {
      min-width: 0;
      max-width: 70%;
    }

    .explore-body {
      padding-top: var(--space-5);
    }

    .section-heading {
      align-items: flex-start;
      flex-direction: column;
      gap: var(--space-2);
    }

    .section-heading h2 {
      font-size: var(--text-xl);
    }

    .character-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-3);
    }

    .character-name-row {
      align-items: flex-start;
      flex-direction: column;
    }

    .role {
      order: -1;
    }

    .inspect-cue {
      right: var(--space-1);
      bottom: var(--space-1);
      max-width: calc(100% - var(--space-2));
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .set-tile {
      grid-template-columns: 1fr;
    }

    .set-art {
      min-height: 16rem;
    }

    .component-set-grid {
      grid-template-columns: 1fr;
    }

    .creator-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 430px) {
    .character-grid {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-3);
    }

    .character-copy {
      padding: var(--space-2);
    }

    .character-copy .creator-link {
      min-height: 44px;
    }

    .creator-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
