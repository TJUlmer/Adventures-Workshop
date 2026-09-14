<script lang="ts">
  /**
   * One published collection member, explored without leaving the collection.
   *
   * This deliberately owns exactly one `AssetsOverview`. That component is the
   * published gallery's card and component viewer, including its lazy card
   * lightbox, model snapshots and `ComponentModal`; reproducing any of those
   * here would create a second export/viewing path and make collection pages
   * behave differently from ordinary shared sets.
   */
  import AssetsOverview from '$lib/components/tools/AssetsOverview.svelte';
  import { CARD_PREVIEW_RENDERER_VERSION } from '$lib/cloud/card-previews';
  import type { CollectionTile } from '$lib/cloud/collections';
  import {
    fetchSetBySlug,
    hydratePublishedSet,
    readPublishedSet
  } from '$lib/cloud/sets';
  import type { PublishedSetWithDocument } from '$lib/cloud/sets';
  import type { CharacterId } from '$lib/characters/types';
  import { charactersByRole } from '$lib/sets/queries';
  import { computeScopedSet, parseScopeKey, scopeKeyOf, scopeOptionsFor } from '$lib/sets/scope';
  import type { PublishScope } from '$lib/sets/scope';
  import type { AdventureSet } from '$lib/sets/types';
  import { navigation } from '$lib/state/navigation.svelte';
  import { Button, Icon } from '$lib/ui';

  type CollectionExplorerFocus = 'full' | 'components';

  interface Props {
    tile: CollectionTile | null;
    collectionName: string;
    characterId?: string;
    focus?: CollectionExplorerFocus;
    onback: () => void;
  }

  let {
    tile,
    collectionName,
    characterId,
    focus = 'full',
    onback
  }: Props = $props();

  let row = $state.raw<PublishedSetWithDocument | null>(null);
  let displaySet = $state.raw<AdventureSet | null>(null);
  let portableSet = $state.raw<AdventureSet | null>(null);
  let viewScope = $state.raw<PublishScope>({ kind: 'full' });
  let opening = $state(false);
  let preparing = $state(false);
  let progress = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let preparationError = $state<string | null>(null);
  let retryVersion = $state(0);
  let loadGeneration = 0;

  /* Kept for this component's lifetime, so returning to a member during the
     same collection visit is instant. Revision is part of the key: a newly
     published deck must never inherit an older document or embedded assets. */
  const rowCache = new Map<string, PublishedSetWithDocument>();
  const readableCache = new Map<string, AdventureSet>();
  const portableCache = new Map<string, AdventureSet>();

  function remember<T>(cache: Map<string, T>, key: string, value: T, limit: number): void {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > limit) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  function waitForPreparationWindow(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }

      const idleWindow = window as unknown as {
        requestIdleCallback?: Window['requestIdleCallback'];
        cancelIdleCallback?: Window['cancelIdleCallback'];
      };
      let settled = false;
      let cancel = (): void => {};
      const finish = (): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        resolve();
      };
      const abort = (): void => {
        cancel();
        finish();
      };

      if (idleWindow.requestIdleCallback) {
        const idleId = idleWindow.requestIdleCallback(finish, { timeout: 1200 });
        cancel = () => idleWindow.cancelIdleCallback?.(idleId);
      } else {
        const timeoutId = window.setTimeout(finish, 250);
        cancel = () => window.clearTimeout(timeoutId);
      }
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  function cacheKey(selected: CollectionTile): string {
    return `${selected.set_id}:${selected.revision}`;
  }

  function initialScope(
    published: PublishedSetWithDocument,
    set: AdventureSet,
    hint?: string
  ): PublishScope {
    if (published.scope === 'villain') return { kind: 'villain' };
    if (published.scope === 'hero') {
      const characterId = published.character_id || hint;
      return characterId
        ? { kind: 'hero', characterId: characterId as CharacterId }
        : { kind: 'full' };
    }
    if (!hint) return { kind: 'full' };
    const character = set.characters.find((candidate) => candidate.id === hint);
    if (!character) return { kind: 'full' };
    if (character.role === 'hero') {
      /* A one-hero heroes set is already the complete product. Its unassigned
         sidekick pieces disappear if it is sliced down to that hero. */
      if (set.kind === 'heroes' && charactersByRole(set, 'hero').length === 1) {
        return { kind: 'full' };
      }
      return { kind: 'hero', characterId: character.id as CharacterId };
    }
    return character.role === 'villain' || character.role === 'minion'
      ? { kind: 'villain' }
      : { kind: 'full' };
  }

  function resetPresentation(): void {
    row = null;
    displaySet = null;
    portableSet = null;
    viewScope = { kind: 'full' };
    opening = false;
    preparing = false;
    progress = null;
    loadError = null;
    preparationError = null;
  }

  async function loadMember(
    selected: CollectionTile,
    hint: string | undefined,
    generation: number,
    signal: AbortSignal
  ): Promise<void> {
    const key = cacheKey(selected);
    opening = true;
    loadError = null;
    preparationError = null;
    progress = `Opening ${selected.name || 'this set'}…`;

    let published = rowCache.get(key) ?? null;
    let readable = readableCache.get(key) ?? null;

    try {
      published ??= await fetchSetBySlug(selected.slug, signal);
      if (!published) throw new Error('This set is no longer shared.');
      if (published.id !== selected.set_id) {
        throw new Error('This collection entry no longer points to the same published set.');
      }
      remember(rowCache, key, published, 3);

      readable ??= readPublishedSet(published);
      remember(readableCache, key, readable, 3);
    } catch (cause) {
      if (signal.aborted || generation !== loadGeneration) return;
      loadError = cause instanceof Error ? cause.message : 'This set could not be opened.';
      opening = false;
      progress = null;
      return;
    }

    if (signal.aborted || generation !== loadGeneration) return;
    const cachedPortable = portableCache.get(key) ?? null;
    row = published;
    displaySet = cachedPortable ?? readable;
    portableSet = cachedPortable;
    if (cachedPortable) remember(portableCache, key, cachedPortable, 1);
    viewScope = initialScope(published, displaySet, hint);
    opening = false;
    progress = null;

    /* Cards use the publication's immutable PNGs immediately. Canvas/WebGL
       component work waits for a local embedded copy of every remote asset. */
    if (cachedPortable || readable.figures.length === 0) return;

    preparing = true;
    progress = 'Preparing interactive components…';
    await waitForPreparationWindow(signal);
    if (signal.aborted || generation !== loadGeneration) return;

    try {
      const hydrated = await hydratePublishedSet(
        published,
        (done, total) => {
          if (signal.aborted || generation !== loadGeneration) return;
          progress =
            total > 0
              ? `Preparing component artwork ${done} of ${total}…`
              : 'Preparing interactive components…';
        },
        signal
      );
      remember(portableCache, key, hydrated, 1);
      if (signal.aborted || generation !== loadGeneration) return;
      displaySet = hydrated;
      portableSet = hydrated;
      progress = null;
    } catch (cause) {
      if (signal.aborted || generation !== loadGeneration) return;
      preparationError =
        cause instanceof Error
          ? cause.message
          : 'Interactive components could not be prepared.';
      progress = null;
    } finally {
      if (!signal.aborted && generation === loadGeneration) preparing = false;
    }
  }

  $effect(() => {
    const selected = tile;
    const hint = characterId;
    void focus;
    void retryVersion;
    const generation = ++loadGeneration;
    const controller = new AbortController();
    resetPresentation();

    if (selected) void loadMember(selected, hint, generation, controller.signal);

    return () => controller.abort();
  });

  const scopeOptions = $derived(displaySet ? scopeOptionsFor(displaySet) : []);
  const shown = $derived(displaySet ? computeScopedSet(displaySet, viewScope) : null);
  const publishedCardPreviews = $derived(
    row?.card_preview_version === CARD_PREVIEW_RENDERER_VERSION ? row.card_previews : undefined
  );
  const figuresOnly = $derived(focus === 'components');
</script>

{#if tile}
  <section class="member-explorer" aria-labelledby="member-explorer-title">
    <header class="member-context">
      <div class="context-copy">
        <Button variant="ghost" onclick={onback}>
          <Icon name="chevronRight" size={13} />
          Back to {collectionName}
        </Button>
        <p class="eyebrow">{figuresOnly ? 'Physical components' : 'Collection set'}</p>
        <h2 id="member-explorer-title" tabindex="-1">{tile.name || 'Untitled set'}</h2>
        {#if tile.subtitle}<p class="member-subtitle">{tile.subtitle}</p>{/if}
        <p class="member-credit">
          By
          <button type="button" onclick={() => navigation.openAuthor(tile!.owner_id)}>
            {tile.author_name || 'Anonymous'}
          </button>
        </p>
      </div>
      <Button variant="secondary" onclick={() => navigation.openShared(tile!.slug, characterId)}>
        Open full set
        <Icon name="chevronRight" size={13} />
      </Button>
    </header>

    {#if loadError}
      <div class="member-state" role="alert">
        <p>{loadError}</p>
        <Button onclick={() => (retryVersion += 1)}>Try again</Button>
      </div>
    {:else if opening || !shown}
      <div class="member-state" aria-live="polite">
        <p>{progress ?? `Opening ${tile.name || 'this set'}…`}</p>
      </div>
    {:else}
      <div class="viewer-toolbar">
        <label>
          <span>Showing</span>
          {#if scopeOptions.length > 1}
            <select
              value={scopeKeyOf(viewScope)}
              onchange={(event) => (viewScope = parseScopeKey(event.currentTarget.value))}
            >
              {#each scopeOptions as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          {:else}
            <strong>{scopeOptions[0]?.label ?? 'Whole set'}</strong>
          {/if}
        </label>
        <div class="preparation" aria-live="polite">
          {#if progress}
            <span>{progress}</span>
          {:else if preparationError}
            <span class="preparation-error">Interactive components could not be prepared.</span>
            <Button size="sm" variant="ghost" disabled={preparing} onclick={() => (retryVersion += 1)}>
              Retry
            </Button>
          {:else if portableSet}
            <span>Interactive components ready</span>
          {:else if shown.figures.length > 0}
            <span>Component previews are preparing in the background</span>
          {/if}
        </div>
      </div>

      <div class="viewer-frame" class:components-only={figuresOnly}>
        {#key `${tile.set_id}:${tile.revision}`}
          <AssetsOverview
            set={shown}
            interactive={false}
            inspectable
            componentPreviewsReady={portableSet !== null}
            cardPreviews={publishedCardPreviews}
            publishedPngsOnly
            heading={false}
            showZoom={!figuresOnly}
            figuresOnly={figuresOnly}
            anchorPrefix={`collection-member-${tile.set_id}`}
          />
        {/key}
      </div>
    {/if}
  </section>
{/if}

<style>
  .member-explorer {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-xl);
    overflow: hidden;
    background: var(--surface-base);
    box-shadow: var(--shadow-md);
  }

  .member-context {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-5);
    padding: var(--space-5) var(--space-6);
    border-bottom: 1px solid var(--border-subtle);
    background: var(--surface-raised);
  }

  .context-copy {
    min-width: 0;
  }

  .context-copy :global(.btn:first-child) {
    margin: calc(var(--space-2) * -1) 0 var(--space-3) calc(var(--space-3) * -1);
  }

  .context-copy :global(.btn:first-child svg) {
    transform: rotate(180deg);
  }

  .eyebrow {
    margin: 0 0 var(--space-1);
    color: var(--text-accent);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
  }

  h2 {
    margin: 0;
    color: var(--text-primary);
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    letter-spacing: var(--tracking-tight);
  }

  .member-subtitle {
    margin: var(--space-1) 0 0;
    color: var(--text-secondary);
  }

  .member-credit {
    margin: var(--space-2) 0 0;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .member-credit button {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-accent);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .viewer-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3) var(--space-5);
    padding: var(--space-3) var(--space-6);
    border-bottom: 1px solid var(--border-subtle);
    background: var(--surface-base);
  }

  .viewer-toolbar label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-tertiary);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  .viewer-toolbar select {
    min-width: 10rem;
    height: 32px;
    padding: 0 var(--space-7) 0 var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    color: var(--text-primary);
    font: inherit;
  }

  .viewer-toolbar strong {
    color: var(--text-secondary);
  }

  .preparation {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .preparation-error {
    color: var(--danger);
  }

  .viewer-frame {
    display: flex;
    min-height: 34rem;
    height: clamp(34rem, calc(100dvh - 11rem), 64rem);
    overflow: hidden;
    background: var(--surface-canvas);
  }

  .viewer-frame.components-only {
    height: clamp(28rem, calc(100dvh - 14rem), 50rem);
  }

  .viewer-frame :global(.page) {
    width: 100%;
  }

  .member-state {
    display: grid;
    min-height: 22rem;
    place-items: center;
    align-content: center;
    gap: var(--space-3);
    padding: var(--space-8);
    color: var(--text-secondary);
    text-align: center;
  }

  .member-state p {
    max-width: 44ch;
    margin: 0;
  }

  @media (max-width: 700px) {
    .member-context {
      flex-direction: column;
      padding: var(--space-4);
    }

    .member-context > :global(.btn) {
      align-self: stretch;
    }

    .viewer-toolbar {
      align-items: stretch;
      flex-direction: column;
      padding: var(--space-3) var(--space-4);
    }

    .viewer-toolbar label {
      justify-content: space-between;
    }

    .viewer-toolbar select {
      min-width: 0;
      max-width: 65%;
    }

    .viewer-frame,
    .viewer-frame.components-only {
      min-height: 30rem;
      height: calc(100dvh - 9rem);
    }
  }
</style>
