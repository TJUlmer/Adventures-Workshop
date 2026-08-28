<script lang="ts">
  /**
   * A collection's own page — the one link a project is announced with.
   *
   * Read-only at this step: it draws what is there and links onward, and the
   * authoring controls (creating, inviting, accepting, readiness) come in
   * steps 5–7 of `COLLECTIONS.md`'s build order. Nothing here writes.
   *
   * Rendered outside `AppShell`, beside `GalleryScreen` and
   * `SharedSetScreen`, and for the same reason: this is very often somebody's
   * first sight of the app, and chrome for a set they do not have would
   * answer a question they have not asked. That also means it owns its own
   * scrolling — `base.css` sets `body { overflow: hidden }` because the shell
   * normally owns it, so a screen outside the shell has its own or has none.
   *
   * **Both reads are anonymous**, through `cloud/collections.ts`. RLS answers
   * a public read the same either way, but PostgREST refuses a *stale* token
   * outright — and a collection link is exactly the kind opened weeks after
   * it was pasted, by somebody who signed in once and forgot.
   */
  import {
    amOrganiser,
    collectionUrl,
    fetchCollectionBySlug,
    fetchCollectionTiles,
    updateCollection,
    uploadCollectionBanner
  } from '$lib/cloud/collections';
  import type {
    Collection,
    CollectionTile,
    CollectionVisibility
  } from '$lib/cloud/collections';
  import { cloudEnabled } from '$lib/cloud/config';
  import { initials, tint } from '$lib/core/swatch';
  import { CARD_FORMATS, trimBox } from '$lib/renderer/geometry';
  import { auth } from '$lib/cloud/auth.svelte';
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

  /*
   * How much of a bleed-canvas picture to scale away to reach the trim.
   * Derived rather than typed in, the same as `GalleryScreen`'s — a cover
   * that says `cover_bleeds` is a full print plate, and showing its margin
   * would put a band of frame round a tile that is already a frame.
   */
  const TRIM_SCALE_WIDE = CARD_FORMATS.action.bleed.width / trimBox(CARD_FORMATS.action).width;

  /** The same fallback order the gallery uses: a real thumbnail, then the
      database-derived cover, then nothing and let the tint show. */
  function tileImage(tile: CollectionTile): string {
    return tile.thumbnail_url || tile.cover_url;
  }

  $effect(() => {
    const wanted = slug;
    loading = true;
    failed = false;

    void (async () => {
      try {
        const found = await fetchCollectionBySlug(wanted);
        /* The slug can change under an in-flight fetch — one collection page
           linking to another — so a late answer for a previous slug must not
           overwrite the current one. */
        if (wanted !== slug) return;
        collection = found;
        const rows = found ? await fetchCollectionTiles(wanted) : [];
        if (wanted !== slug) return;
        tiles = rows;
      } catch {
        if (wanted === slug) failed = true;
      } finally {
        if (wanted === slug) loading = false;
      }
    })();
  });

  const heading = $derived(collection?.name.trim() || 'Untitled collection');

  // -- Organiser editing --------------------------------------------------

  let organiser = $state(false);
  let editing = $state(false);
  let saving = $state(false);
  let notice = $state<string | null>(null);
  let bannerInput = $state<HTMLInputElement | null>(null);

  /* Draft fields, held apart from `collection` so an abandoned edit changes
     nothing and Cancel needs no undo. */
  let draftName = $state('');
  let draftSubtitle = $state('');
  let draftBlurb = $state('');

  $effect(() => {
    const id = collection?.id;
    if (!id) {
      organiser = false;
      return;
    }
    /* Read `auth.signedIn` synchronously so signing in *while this page is
       open* is a tracked dependency — inside the async closure it would not
       be, and the edit controls would never appear without a reload. Same
       reason `HomeScreen`'s published-sets effect reads it at the top. */
    void auth.signedIn;
    void (async () => {
      const yes = await amOrganiser(id).catch(() => false);
      if (collection?.id === id) organiser = yes;
    })();
  });

  function startEditing(): void {
    if (!collection) return;
    draftName = collection.name;
    draftSubtitle = collection.subtitle;
    draftBlurb = collection.blurb;
    editing = true;
    notice = null;
  }

  async function saveEdits(): Promise<void> {
    if (!collection || saving) return;
    saving = true;
    notice = null;
    try {
      await updateCollection(collection.id, {
        name: draftName,
        subtitle: draftSubtitle,
        blurb: draftBlurb
      });
      /* Written back locally rather than re-fetched: the server has accepted
         these exact values, and a re-read would cost a round trip to be told
         what we just sent. A failure throws before reaching here. */
      collection = {
        ...collection,
        name: draftName.trim(),
        subtitle: draftSubtitle.trim(),
        blurb: draftBlurb.trim()
      };
      editing = false;
    } catch (error) {
      notice = error instanceof Error ? error.message : 'Could not save those changes.';
    } finally {
      saving = false;
    }
  }

  async function setVisibility(next: CollectionVisibility): Promise<void> {
    if (!collection || collection.visibility === next) return;
    const previous = collection.visibility;
    collection = { ...collection, visibility: next };
    try {
      await updateCollection(collection.id, { visibility: next });
    } catch (error) {
      collection = { ...collection, visibility: previous };
      notice = error instanceof Error ? error.message : 'Could not change who can see this.';
    }
  }

  async function setOpenSubmissions(next: boolean): Promise<void> {
    if (!collection) return;
    const previous = collection.open_submissions;
    collection = { ...collection, open_submissions: next };
    try {
      await updateCollection(collection.id, { open_submissions: next });
    } catch (error) {
      collection = { ...collection, open_submissions: previous };
      notice = error instanceof Error ? error.message : 'Could not change submissions.';
    }
  }

  async function pickBanner(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !collection) return;
    saving = true;
    notice = null;
    try {
      const url = await uploadCollectionBanner(collection.id, file);
      await updateCollection(collection.id, { banner_url: url });
      collection = { ...collection, banner_url: url };
    } catch (error) {
      notice = error instanceof Error ? error.message : 'Could not upload that picture.';
    } finally {
      saving = false;
    }
  }

  async function copyLink(): Promise<void> {
    if (!collection) return;
    try {
      await navigator.clipboard.writeText(collectionUrl(collection.slug));
      notice = 'Link copied.';
    } catch {
      notice = collectionUrl(collection.slug);
    }
  }

  const VISIBILITIES: { value: CollectionVisibility; label: string; hint: string }[] = [
    { value: 'private', label: 'Private', hint: 'Only organisers. The link stops working.' },
    { value: 'unlisted', label: 'Unlisted', hint: 'Anyone with the link. Not in the gallery.' },
    { value: 'public', label: 'Public', hint: 'Listed for everyone to find.' }
  ];
</script>

<div class="screen">
  <header class="head">
    <div class="head-left">
      <button
        type="button"
        class="link"
        onclick={() => navigation.leaveCollection({ kind: 'home' })}
      >
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
      <p class="message">Loading…</p>
    {:else if failed}
      <p class="message">That collection could not be loaded. Check the link, or try again.</p>
    {:else if !collection}
      <!--
        One message for "no such collection" and for "made private since the
        link was shared", because `collection_by_slug` deliberately cannot
        tell them apart — saying which would confirm that a private
        collection exists, which is what turning it private was meant to stop.
      -->
      <p class="message">No collection here. The link may be wrong, or no longer shared.</p>
    {:else}
      <div class="banner" style:background={tint(collection.id)}>
        {#if collection.banner_url}
          <img src={collection.banner_url} alt="" />
        {/if}
        {#if organiser}
          <input
            bind:this={bannerInput}
            class="sr-only"
            type="file"
            accept="image/*"
            onchange={pickBanner}
          />
          <button type="button" class="banner-edit" onclick={() => bannerInput?.click()}>
            {collection.banner_url ? 'Change banner' : 'Add a banner'}
          </button>
        {/if}
      </div>

      {#if editing}
        <div class="editor">
          <label class="field">
            <span class="field-label">Name</span>
            <input type="text" bind:value={draftName} placeholder="Winter Extravaganza" />
          </label>
          <label class="field">
            <span class="field-label">Subtitle</span>
            <input type="text" bind:value={draftSubtitle} placeholder="Six winter-themed decks" />
          </label>
          <label class="field">
            <span class="field-label">About</span>
            <textarea rows="3" bind:value={draftBlurb} placeholder="What this project is."></textarea>
          </label>
          <div class="editor-actions">
            <button type="button" class="btn primary" onclick={saveEdits} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button type="button" class="btn" onclick={() => (editing = false)}>Cancel</button>
          </div>
        </div>
      {:else}
        <div class="title-row">
          <h1>{heading}</h1>
          {#if organiser}
            <button type="button" class="btn" onclick={startEditing}>Edit details</button>
          {/if}
        </div>
        {#if collection.subtitle}<p class="subtitle">{collection.subtitle}</p>{/if}
        {#if collection.blurb}<p class="blurb">{collection.blurb}</p>{/if}
      {/if}

      {#if organiser}
        <!--
          Organiser-only, and each control says what the setting *does* rather
          than naming it: "unlisted" means nothing to somebody who has not read
          the schema, while "anyone with the link" is the actual promise being
          made about their collaborators' work.
        -->
        <section class="admin">
          <div class="admin-row">
            <span class="field-label">Who can see this</span>
            <div class="choices">
              {#each VISIBILITIES as option (option.value)}
                <button
                  type="button"
                  class="choice"
                  class:on={collection.visibility === option.value}
                  title={option.hint}
                  onclick={() => setVisibility(option.value)}
                >
                  {option.label}
                </button>
              {/each}
            </div>
            <span class="hint">
              {VISIBILITIES.find((entry) => entry.value === collection?.visibility)?.hint}
            </span>
          </div>

          <div class="admin-row">
            <span class="field-label">Submissions</span>
            <label class="toggle">
              <input
                type="checkbox"
                checked={collection.open_submissions}
                onchange={(event) => setOpenSubmissions(event.currentTarget.checked)}
              />
              <span>Let creators offer their own decks without an invitation</span>
            </label>
          </div>

          <div class="admin-row">
            <span class="field-label">Link</span>
            <button type="button" class="btn" onclick={copyLink}>Copy link</button>
            <span class="hint">
              {collection.visibility === 'private'
                ? 'The link is off while this is private.'
                : 'Anyone you send this to can open the collection.'}
            </span>
          </div>
        </section>
      {/if}

      {#if notice}<p class="notice">{notice}</p>{/if}

      <p class="count">
        {tiles.length}
        {tiles.length === 1 ? 'deck' : 'decks'}
      </p>

      {#if tiles.length === 0}
        <!--
          Not an error. A collection with no accepted decks is the ordinary
          state of a project on the day it is created, and the page has to
          read as "not started yet" rather than "broken".
        -->
        <p class="message">
          No decks yet. Whoever is organising this can invite them, or open it for submissions.
        </p>
      {:else}
        <ul class="grid">
          {#each tiles as tile (tile.set_id)}
            <li>
              <!--
                Opens the member's own shared page rather than anything
                collection-shaped: the deck belongs to its author, and its
                page is where they publish, export and are credited. A
                collection links to its members; it does not contain them.
              -->
              <button type="button" class="tile" onclick={() => navigation.openShared(tile.slug)}>
                <span
                  class="cover"
                  style:--trim-scale={TRIM_SCALE_WIDE}
                  style:background={tint(tile.set_id)}
                >
                  {#if tileImage(tile)}
                    <img
                      src={tileImage(tile)}
                      class:trimmed={tile.cover_bleeds}
                      alt=""
                      loading="lazy"
                    />
                  {:else}
                    <span class="initials">{initials(tile.name)}</span>
                  {/if}
                </span>

                <span class="card-body">
                  <span class="name">{tile.name || 'Untitled'}</span>
                  {#if tile.subtitle}<span class="subtitle-line">{tile.subtitle}</span>{/if}

                  <!--
                    The author line is the whole point of a collection page:
                    every tile is somebody else's, and saying whose is what
                    makes this a project rather than one person's box.
                  -->
                  <span class="by">
                    {#if tile.author_avatar}
                      <img class="avatar" src={tile.author_avatar} alt="" loading="lazy" />
                    {/if}
                    <span class="author">{tile.author_name || 'Anonymous'}</span>
                  </span>

                  <span class="meta">
                    <span>revision {tile.revision}</span>
                    {#if tile.hero_count > 0}
                      <span>{tile.hero_count} {tile.hero_count === 1 ? 'hero' : 'heroes'}</span>
                    {/if}
                    <span>{tile.card_count} {tile.card_count === 1 ? 'card' : 'cards'}</span>
                  </span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
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
    position: sticky;
    top: 0;
    z-index: 1;
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
    width: min(76rem, 100%);
    margin: 0 auto;
    padding: var(--space-6) var(--space-6) var(--space-10);
  }

  .banner {
    height: clamp(7rem, 18vw, 12rem);
    border-radius: var(--radius-md);
    overflow: hidden;
    margin-bottom: var(--space-5);
  }
  .banner img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  h1 {
    margin: 0 0 var(--space-2);
    color: var(--text-primary);
  }

  .subtitle {
    margin: 0 0 var(--space-3);
    color: var(--text-secondary);
    font-size: var(--text-lg);
  }

  .blurb {
    margin: 0 0 var(--space-4);
    max-width: 62ch;
    color: var(--text-secondary);
  }

  .count {
    margin: 0 0 var(--space-5);
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .message {
    color: var(--text-tertiary);
  }

  .notice {
    color: var(--text-secondary);
    background: var(--surface-inset);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    margin: 0 0 var(--space-4);
  }

  .banner {
    position: relative;
  }
  .banner-edit {
    position: absolute;
    right: var(--space-3);
    bottom: var(--space-3);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
  }
  .banner-edit:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    max-width: 40rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .field-label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
  }
  .editor input,
  .editor textarea {
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    resize: vertical;
  }
  .editor input:focus-visible,
  .editor textarea:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .editor-actions {
    display: flex;
    gap: var(--space-2);
  }

  .btn {
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
    flex: none;
  }
  .btn:hover {
    border-color: var(--border-strong);
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--text-on-accent);
  }
  .btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .admin {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    margin-bottom: var(--space-5);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-base);
  }
  .admin-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
  }
  .admin-row .field-label {
    width: 9rem;
    flex: none;
  }
  .choices {
    display: flex;
    gap: var(--space-1);
  }
  .choice {
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
  }
  .choice.on {
    background: var(--accent-soft);
    border-color: var(--border-accent);
    color: var(--text-accent);
  }
  .choice:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: var(--space-4);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .tile {
    display: flex;
    flex-direction: column;
    width: 100%;
    text-align: left;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    cursor: pointer;
    font: inherit;
    color: inherit;
    transition: border-color var(--duration-fast) var(--ease-out);
  }
  .tile:hover {
    border-color: var(--border-strong);
  }
  .tile:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .cover {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 4 / 3;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /*
   * A cover drawn from a full print plate is scaled up and re-centred so the
   * bleed margin falls outside the box, rather than printing a band of empty
   * frame inside a tile that is already framed. `--trim-scale` carries the
   * ratio; see its derivation above.
   */
  .cover img.trimmed {
    transform: scale(var(--trim-scale));
  }

  .initials {
    font-size: var(--text-2xl);
    font-weight: 600;
    color: var(--text-on-accent);
    opacity: 0.7;
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .name {
    color: var(--text-primary);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .subtitle-line {
    color: var(--text-tertiary);
    font-size: var(--text-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .by {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-1);
    min-width: 0;
  }
  .avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex: none;
  }
  .author {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
</style>
