<script lang="ts">
  /**
   * A collection's own page — the one link a project is announced with.
   *
   * **Deliberately minimal at this step.** Step 3 of `COLLECTIONS.md`'s build
   * order is the routing and the real path; this exists so that plumbing can
   * be driven end to end — paste a link, land here, see the right collection,
   * leave without stranding the URL — before step 4 gives it a tile grid and
   * step 5 the authoring controls. What is here is the frame those hang off,
   * not a sketch to be thrown away.
   *
   * Rendered outside `AppShell`, beside `GalleryScreen` and
   * `SharedSetScreen`, and for the same reason: this is very often somebody's
   * first sight of the app, and chrome for a set they do not have would answer
   * a question they have not asked. That also means it owns its own scrolling
   * — `base.css` gives `body { overflow: hidden }` because the shell normally
   * owns it, so a screen outside the shell has its own or has none.
   */
  import { fetchCollectionBySlug, fetchCollectionTiles } from '$lib/cloud/collections';
  import type { Collection, CollectionTile } from '$lib/cloud/collections';
  import { cloudEnabled } from '$lib/cloud/config';
  import { navigation } from '$lib/state/navigation.svelte';
  import { ThemeToggle } from '$lib/ui';
  import AccountMenu from './AccountMenu.svelte';

  interface Props {
    slug: string;
  }

  let { slug }: Props = $props();

  let collection = $state<Collection | null>(null);
  let tiles = $state<CollectionTile[]>([]);
  let loading = $state(true);
  let failed = $state(false);

  $effect(() => {
    const wanted = slug;
    loading = true;
    failed = false;

    void (async () => {
      try {
        const found = await fetchCollectionBySlug(wanted);
        /* The slug can change under an in-flight fetch — one collection page
           linking to another — so a late answer for the previous one must not
           overwrite the current. Same guard `SharedSetScreen` keeps. */
        if (wanted !== slug) return;
        collection = found;
        tiles = found ? await fetchCollectionTiles(wanted) : [];
        if (wanted !== slug) return;
      } catch {
        if (wanted === slug) failed = true;
      } finally {
        if (wanted === slug) loading = false;
      }
    })();
  });
</script>

<div class="screen">
  <header class="head">
    <div class="head-left">
      <button type="button" class="link" onclick={() => navigation.leaveCollection({ kind: 'home' })}>
        Home
      </button>
      {#if cloudEnabled()}
        <button
          type="button"
          class="link"
          onclick={() => navigation.leaveCollection({ kind: 'gallery' })}
        >
          Gallery
        </button>
      {/if}
    </div>
    <div class="head-right">
      <ThemeToggle />
      <AccountMenu />
    </div>
  </header>

  <main class="body">
    {#if loading}
      <p class="note">Loading…</p>
    {:else if failed}
      <p class="note">That collection could not be loaded. Check the link, or try again.</p>
    {:else if !collection}
      <!--
        One message for "no such collection" and for "made private since the
        link was shared", because `collection_by_slug` deliberately cannot
        tell them apart — saying which would confirm a private collection
        exists, which is the thing turning it private was meant to stop.
      -->
      <p class="note">No collection here. The link may be wrong, or no longer shared.</p>
    {:else}
      <h1>{collection.name || 'Untitled collection'}</h1>
      {#if collection.subtitle}<p class="subtitle">{collection.subtitle}</p>{/if}
      {#if collection.blurb}<p class="blurb">{collection.blurb}</p>{/if}
      <p class="count">
        {tiles.length}
        {tiles.length === 1 ? 'deck' : 'decks'}
      </p>
    {/if}
  </main>
</div>

<style>
  /* Owns its own scrolling — see the note at the top of this file. */
  .screen {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow-y: auto;
    background: var(--surface-canvas);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-6);
    border-bottom: 1px solid var(--border-subtle);
    background: var(--surface-base);
  }

  .head-left,
  .head-right {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .link {
    border: 0;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    cursor: pointer;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
  }
  .link:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .link:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .body {
    width: min(72rem, 100%);
    margin: 0 auto;
    padding: var(--space-8) var(--space-6) var(--space-10);
  }

  h1 {
    margin: 0 0 var(--space-2);
    color: var(--text-primary);
  }

  .subtitle {
    margin: 0 0 var(--space-3);
    color: var(--text-secondary);
  }

  .blurb {
    margin: 0 0 var(--space-4);
    max-width: 60ch;
    color: var(--text-secondary);
  }

  .count,
  .note {
    color: var(--text-tertiary);
  }
</style>
