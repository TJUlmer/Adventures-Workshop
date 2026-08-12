<script lang="ts">
  /**
   * The community gallery.
   *
   * Outside the app shell, like the library and a share link, because browsing
   * is not something you do *inside* a set — and a visitor arriving here may
   * have no sets at all.
   *
   * A tile opens the set the same way a share link does: through
   * `#/shared/<slug>`, which already knows how to fetch, hydrate, preview and
   * adopt one. There is no second path into a published set, so there is no
   * second path to keep correct.
   */
  import { cloudEnabled } from '$lib/cloud/config';
  import { listPublicSets } from '$lib/cloud/sets';
  import type { GallerySet, GalleryQuery } from '$lib/cloud/sets';
  import { navigation } from '$lib/state/navigation.svelte';
  import { Button, Icon, Select } from '$lib/ui';

  const PAGE = 36;

  let sets = $state<GallerySet[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let search = $state('');
  let sort = $state<'newest' | 'popular' | 'name'>('newest');
  let offset = $state(0);
  /** Whether the last page came back full, which is the only "more" signal. */
  let maybeMore = $state(false);

  const SORTS = [
    { value: 'newest' as const, label: 'Newest' },
    { value: 'popular' as const, label: 'Most viewed' },
    { value: 'name' as const, label: 'Name' }
  ];

  async function load(query: GalleryQuery, append = false): Promise<void> {
    loading = true;
    error = null;
    try {
      const page = await listPublicSets({ ...query, limit: PAGE });
      sets = append ? [...sets, ...page] : page;
      /* A full page *might* mean more; a short one definitely means the end.
         Counting exactly would cost a second query for a button's label. */
      maybeMore = page.length === PAGE;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not load the gallery.';
    } finally {
      loading = false;
    }
  }

  /*
   * Debounced, because this runs on every keystroke in the search box and each
   * run is a request. 250ms is below the point a search feels laggy and above
   * the point a fast typist sends one query per letter.
   */
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const query = { search, sort };
    clearTimeout(timer);
    timer = setTimeout(() => {
      offset = 0;
      void load(query);
    }, 250);
    return () => clearTimeout(timer);
  });

  function more(): void {
    offset += PAGE;
    void load({ search, sort, offset }, true);
  }

  /** A stable colour per set, for the tile with no picture. */
  function tint(seed: string): string {
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash = (hash * 31 + seed.charCodeAt(index)) | 0;
    }
    return `hsl(${Math.abs(hash) % 360} 30% 26%)`;
  }

  function initials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    return words
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('');
  }
</script>

<div class="screen">
  <header class="head">
    <div class="titles">
      <span class="eyebrow">Community</span>
      <h1 class="title">Gallery</h1>
      <p class="lede">
        Adventure sets people have published. Open one to read it through, or export it to play
        with.
      </p>
    </div>
    <Button variant="ghost" onclick={() => navigation.openLibrary()}>
      <Icon name="chevronRight" size={13} />
      My library
    </Button>
  </header>

  {#if !cloudEnabled()}
    <p class="message">Sharing is not set up in this build.</p>
  {:else}
    <div class="controls">
      <input
        class="search"
        type="search"
        placeholder="Search by name…"
        bind:value={search}
        aria-label="Search the gallery"
      />
      <label class="sort">
        <span class="field-label">Sort</span>
        <Select bind:value={sort} options={SORTS} />
      </label>
    </div>

    {#if error}
      <p class="message error" role="alert">{error}</p>
    {:else if loading && sets.length === 0}
      <p class="message">Loading…</p>
    {:else if sets.length === 0}
      <p class="message">
        {search.trim() ? `Nothing matches “${search.trim()}”.` : 'No sets have been published yet.'}
      </p>
    {:else}
      <ul class="grid">
        {#each sets as set (set.id)}
          <li>
            <button type="button" class="tile" onclick={() => navigation.openShared(set.slug)}>
              <span class="cover" style:background={tint(set.id)}>
                {#if set.thumbnail_url}
                  <!-- Lazy, because a gallery page is mostly pictures nobody has
                       scrolled to yet. -->
                  <img src={set.thumbnail_url} alt="" loading="lazy" />
                {:else}
                  <span class="initials">{initials(set.name)}</span>
                {/if}
              </span>

              <span class="body">
                <span class="name">{set.name || 'Untitled Adventure'}</span>
                {#if set.subtitle}<span class="subtitle">{set.subtitle}</span>{/if}

                <span class="by">
                  {#if set.author?.avatar_url}
                    <img class="avatar" src={set.author.avatar_url} alt="" loading="lazy" />
                  {/if}
                  <span class="author">{set.author?.display_name || 'Anonymous'}</span>
                </span>

                <!--
                  Lineage, quieter than the author line and deliberately so: the
                  person who made *this* set is its author, and the set it grew
                  from is a credit rather than a second byline. Equal billing
                  would let someone else's set be passed off as a collaboration.
                -->
                {#if set.origin}
                  <span class="stats">
                    Based on {set.origin.name}
                    {#if set.origin.author?.display_name}
                      by {set.origin.author.display_name}
                    {/if}
                  </span>
                {/if}

                <span class="stats numeric">
                  {set.card_count} cards · {set.character_count} characters
                  {#if set.view_count > 0}· {set.view_count} views{/if}
                </span>
                <!--
                  Revision only once there is one. "rev 1" on every tile is
                  noise; "rev 4" is the thing worth noticing.
                -->
                <span class="stats numeric">
                  Updated {new Date(set.updated_at).toLocaleDateString()}
                  {#if set.revision > 1}· rev {set.revision}{/if}
                </span>
              </span>
            </button>
          </li>
        {/each}
      </ul>

      {#if maybeMore}
        <div class="more">
          <Button onclick={more} disabled={loading}>
            {loading ? 'Loading…' : 'Show more'}
          </Button>
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .screen {
    min-height: 100vh;
    padding: var(--space-6);
    background: var(--surface-sunken);
    color: var(--text-default);
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
  }

  .eyebrow {
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .title {
    margin: 0;
    font-size: var(--text-lg);
  }

  .lede,
  .message,
  .field-label {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .error {
    color: var(--danger);
  }

  .controls {
    display: flex;
    align-items: flex-end;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
    flex-wrap: wrap;
  }

  .search {
    flex: 1;
    min-width: 200px;
    height: 32px;
    padding-inline: var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .sort {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /*
   * `auto-fill` rather than `auto-fit`: with one set published, `auto-fit`
   * collapses the empty tracks and stretches that single tile the whole width,
   * which reads as a bug rather than as a gallery with one thing in it.
   */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tile {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .tile:hover {
    border-color: var(--accent);
  }

  .cover {
    display: grid;
    place-items: center;
    aspect-ratio: 4 / 3;
    overflow: hidden;
  }

  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .initials {
    font-family: var(--card-font-name, sans-serif);
    font-size: var(--text-lg);
    letter-spacing: var(--tracking-wide);
    color: rgb(255 255 255 / 0.55);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    min-width: 0;
  }

  .name {
    font-size: var(--text-sm);
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .subtitle,
  .stats {
    font-size: var(--text-xs);
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }

  .by {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  .avatar {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    flex: none;
  }

  .author {
    font-size: var(--text-xs);
    color: var(--text-default);
  }

  .more {
    display: flex;
    justify-content: center;
    margin-top: var(--space-5);
  }
</style>
