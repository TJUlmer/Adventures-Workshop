<script lang="ts">
  /**
   * Someone's public profile: what they have published, and what they have
   * helped build.
   *
   * Reached from a credit line — a gallery tile's author, a shared set's "By
   * …", a "With contributions from …" name — never typed in directly: there
   * is no username or slug here, only the profile id those credit lines
   * already carry. See `state/navigation.svelte.ts`'s `openAuthor` for why
   * this is plain browse state rather than a URL, unlike a shared set.
   *
   * Renders outside the set shell, like the gallery and a share link, for the
   * same reason: a visitor who followed a credit line may have no sets of
   * their own and no business being shown a workshop nav. The application
   * banner remains above it.
   */
  import { cloudEnabled } from '$lib/cloud/config';
  import {
    fetchProfile,
    fetchSetsContributedTo,
    listPublicSetsByOwner
  } from '$lib/cloud/sets';
  import type { ContributedSet, GallerySet, PublicProfile } from '$lib/cloud/sets';
  import { CARD_FORMATS, trimBox } from '$lib/renderer/geometry';
  import { navigation } from '$lib/state/navigation.svelte';
  import { Button, Icon } from '$lib/ui';

  interface Props {
    id: string;
  }

  let { id }: Props = $props();

  let profile = $state<PublicProfile | null>(null);
  let sets = $state<GallerySet[]>([]);
  let contributed = $state<ContributedSet[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  $effect(() => {
    const wanted = id;
    loading = true;
    error = null;
    profile = null;
    sets = [];
    contributed = [];

    void (async () => {
      try {
        const [foundProfile, ownSets, helped] = await Promise.all([
          fetchProfile(wanted),
          listPublicSetsByOwner(wanted),
          fetchSetsContributedTo(wanted)
        ]);
        profile = foundProfile;
        sets = ownSets;
        contributed = helped;
      } catch (cause) {
        error = cause instanceof Error ? cause.message : 'Could not open that profile.';
      } finally {
        loading = false;
      }
    })();
  });

  // Same crop as the gallery's own set grid — see `GalleryScreen.svelte`'s
  // `TRIM_SCALE_WIDE` for why this is derived rather than a typed-in number.
  const CARD_BLEED = CARD_FORMATS.action.bleed;
  const CARD_TRIM = trimBox(CARD_FORMATS.action);
  const TRIM_SCALE_WIDE = CARD_BLEED.width / CARD_TRIM.width;

  function image(row: { thumbnail_url: string; cover_url: string }): string {
    return row.thumbnail_url || row.cover_url;
  }

  // Same hash as `GalleryScreen.svelte`'s own `tint`/`initials` — a set or a
  // person reads the same colour wherever it is shown.
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

{#snippet tile(row: GallerySet | ContributedSet, badge: string | null)}
  <li>
    <button type="button" class="tile" onclick={() => navigation.openShared(row.slug)}>
      <span class="cover" style:--trim-scale={TRIM_SCALE_WIDE} style:background={tint(row.id)}>
        {#if image(row)}
          <img src={image(row)} class:trimmed={row.cover_bleeds} alt="" loading="lazy" />
        {:else}
          <span class="initials">{initials(row.name)}</span>
        {/if}
      </span>

      <span class="body">
        <span class="name-row">
          <span class="name">{row.name || 'Untitled Adventure'}</span>
          {#if badge}<span class="scope-badge">{badge}</span>{/if}
        </span>
        {#if row.subtitle}<span class="subtitle">{row.subtitle}</span>{/if}
        <span class="stats numeric">
          {row.card_count} cards · {row.character_count} characters
          {#if row.view_count > 0}· {row.view_count} views{/if}
        </span>
        <span class="stats numeric">
          Updated {new Date(row.updated_at).toLocaleDateString()}
          {#if row.revision > 1}· rev {row.revision}{/if}
        </span>
      </span>
    </button>
  </li>
{/snippet}

<div class="screen">
  <header class="head">
    <span class="who">
      {#if profile?.avatar_url}
        <img class="portrait" src={profile.avatar_url} alt="" />
      {:else}
        <span class="portrait initials" style:background={tint(id)}>
          {initials(profile?.display_name || '?')}
        </span>
      {/if}

      <span class="titles">
        <span class="eyebrow">Creator</span>
        <h1 class="title">{profile?.display_name || (loading ? 'Opening…' : 'Someone')}</h1>
      </span>
    </span>

    <Button variant="ghost" onclick={() => navigation.leaveShared({ kind: 'gallery' })}>
      <Icon name="chevronRight" size={13} />
      Back to Gallery
    </Button>
  </header>

  {#if !cloudEnabled()}
    <p class="message">Sharing is not set up in this build.</p>
  {:else if loading}
    <p class="message">Opening their profile…</p>
  {:else if error}
    <p class="message error" role="alert">{error}</p>
  {:else}
    <section class="section">
      <h2 class="section-title">Published</h2>
      {#if sets.length === 0}
        <p class="message">Nothing public yet.</p>
      {:else}
        <ul class="grid">
          {#each sets as set (set.id)}
            {@render tile(set, set.scope !== 'full' ? (set.scope === 'hero' ? 'Hero' : 'Villain') : null)}
          {/each}
        </ul>
      {/if}
    </section>

    {#if contributed.length > 0}
      <section class="section">
        <!--
          "Contributed to", not "changes made" — `sets_contributed_by` only
          ever says a set took something from this person, never what. See
          `supabase/migrations/0008_author_profiles.sql`.
        -->
        <h2 class="section-title">Contributed to</h2>
        <ul class="grid">
          {#each contributed as set (set.id)}
            {@render tile(set, null)}
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>

<style>
  /* Owns its own scrolling — see the identical note in `GalleryScreen.svelte`. */
  .screen {
    height: 100%;
    overflow-y: auto;
    padding: var(--space-6);
    background: var(--surface-sunken);
    color: var(--text-default);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-6);
  }

  .who {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .portrait {
    width: 48px;
    height: 48px;
    flex: none;
    border-radius: 50%;
    object-fit: cover;
  }

  .portrait.initials {
    display: grid;
    place-items: center;
    color: var(--text-inverse, #fff);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
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
    overflow-wrap: anywhere;
  }

  .message {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .error {
    color: var(--danger);
  }

  .section {
    margin-bottom: var(--space-6);
  }

  .section-title {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }

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
    position: relative;
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

  /* Same bleed crop as `GalleryScreen.svelte`'s set grid — see its own note
     on `.cover img.trimmed` for why this is a scale and not a clip. */
  .cover img.trimmed {
    transform: scale(var(--trim-scale));
  }

  .initials {
    font-size: var(--text-lg);
    font-weight: 600;
    color: rgb(255 255 255 / 0.85);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    min-width: 0;
  }

  .name-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .name {
    font-size: var(--text-sm);
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .scope-badge {
    flex: none;
    padding: 1px var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid var(--border-default);
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .subtitle,
  .stats {
    font-size: var(--text-xs);
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
</style>
