<script lang="ts">
  /**
   * The community gallery.
   *
   * Outside the set shell, like Home and a share link, because browsing is not
   * something you do *inside* a set — and a visitor arriving here may have no
   * sets at all. The application banner still wraps it in `App.svelte`.
   *
   * A tile opens the set the same way a share link does: through
   * `#/shared/<slug>`, which already knows how to fetch, hydrate, preview and
   * adopt one. There is no second path into a published set, so there is no
   * second path to keep correct — and that holds for a character tile too,
   * which opens the *listing* that character can be read in rather than
   * inventing a per-character page with nothing behind it.
   *
   * **Two things are being browsed here, not one.** A set is a box someone
   * published; a character is a person inside one. They are different
   * questions ("what boxes are there" against "who is there to play"), they
   * want different filters, and a hero published inside a box is invisible to
   * the first question — which is exactly what the character mode exists to
   * fix. The toggle is the honest way to say that; folding characters into the
   * set grid would mean a tile that is sometimes a box and sometimes a person.
   */
  import { cloudEnabled } from '$lib/cloud/config';
  import { auth } from '$lib/cloud/auth.svelte';
  import {
    favouriteKey,
    listMyFavourites,
    listMyLikes,
    setFavourite,
    setLiked
  } from '$lib/cloud/engagement';
  import type { FavouriteTarget } from '$lib/cloud/engagement';
  import {
    listMyFavouriteCharacters,
    listMyFavouriteSets,
    listPublicCharacters,
    listPublicSets
  } from '$lib/cloud/sets';
  import type {
    GalleryCharacter,
    GallerySet,
    GallerySort,
    ScopeFilter
  } from '$lib/cloud/sets';
  import { CHARACTER_ROLE_META, SELECTABLE_ROLES } from '$lib/characters/types';
  import type { CharacterRole } from '$lib/characters/types';
  import { CARD_FORMATS, trimBox } from '$lib/renderer/geometry';
  import { navigation } from '$lib/state/navigation.svelte';
  import { Button, Icon, SegmentedControl, Select } from '$lib/ui';

  const PAGE = 36;

  /**
   * How much to enlarge a bleeding plate so its cut line fills the tile.
   *
   * A hero's replacement deck back is supplied on the action card's full
   * 1632×2222 bleed canvas, so showing the file as it stands shows 3.28mm of
   * printer's margin all the way round — the part that exists to be
   * guillotined off. Scaling about the centre pushes that margin outside the
   * tile's own `overflow: hidden`, which crops it away without resampling
   * anything, and it works because the bleed is symmetric on all four edges.
   *
   * **There are two factors, not one, and which applies depends on the tile's
   * shape.** `object-fit: cover` fits whichever axis leaves the image covering
   * the box, so the scale has to undo the bleed on *that* axis:
   *
   *   * A tile at the card's own aspect (the character grid) covers by height,
   *     so the height ratio is the one that matters — and because the box is
   *     the trim's own shape, it comes out exact: the visible region is the
   *     trim box to the pixel, with nothing over-cropped.
   *   * A tile wider than the card (the 4:3 set grid) covers by width instead.
   *     Using the height ratio there leaves the plate 1516px wide against a
   *     1478px trim — bleed still showing down both sides. Measured, not
   *     assumed.
   *
   * Both derived rather than typed in, so a change to `BLEED_MM` or to the
   * format's canvas carries through.
   */
  const CARD_BLEED = CARD_FORMATS.action.bleed;
  const CARD_TRIM = trimBox(CARD_FORMATS.action);
  const TRIM_SCALE_TALL = CARD_BLEED.height / CARD_TRIM.height;
  const TRIM_SCALE_WIDE = CARD_BLEED.width / CARD_TRIM.width;

  /**
   * A character tile's picture box, as the printed card's own shape.
   *
   * Matching the card's aspect is what makes the crop above lossless — a
   * trimmed deck back fills the box with nothing left over. The 3:4 this used
   * to be would have cut a further 5% off the top and bottom of every card.
   */
  const CARD_ASPECT = `${CARD_FORMATS.action.mm.width} / ${CARD_FORMATS.action.mm.height}`;

  type Mode = 'sets' | 'characters';

  /*
   * Characters first. The gallery is browsed to find someone to play, and a
   * roster answers that directly where a shelf of boxes asks you to open one
   * and look — most published rows are single figures anyway.
   */
  let mode = $state<Mode>('characters');
  let sets = $state<GallerySet[]>([]);
  let characters = $state<GalleryCharacter[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let search = $state('');
  let sort = $state<GallerySort>('newest');
  let scope = $state<ScopeFilter>('all');
  /** `''` for every role. A `CharacterRole` otherwise. */
  let role = $state<'' | CharacterRole>('');
  let offset = $state(0);
  /** Whether the last page came back full, which is the only "more" signal. */
  let maybeMore = $state(false);
  let favouritesOnly = $state(false);
  let likedSetIds = $state(new Set<string>());
  let favouriteKeys = $state(new Set<string>());
  let engagementError = $state<string | null>(null);
  let engagementBusy = $state(new Set<string>());

  const canEngage = $derived(auth.signedIn && !auth.isAnonymous);

  /**
   * Characters whose card has been asked for at least once.
   *
   * The gate on fetching character-card previews. Each is a full card at 700px
   * — perhaps 60KB — and a page of thirty heroes eagerly loading thirty of
   * them would cost more than the entire rest of the gallery to show something
   * nobody has looked at. So the `<img>` is not rendered until its tile has
   * been hovered or focused once, and stays rendered afterwards so a second
   * hover is instant rather than re-fetching.
   *
   * Reassigned rather than mutated: `$state` does not proxy a `Set`, so
   * `.add()` on it would change the set without telling anything to re-render.
   */
  let peeked = $state(new Set<string>());

  function peek(characterId: string): void {
    if (peeked.has(characterId)) return;
    peeked = new Set(peeked).add(characterId);
  }

  const MODES = [
    { value: 'sets' as const, label: 'Sets' },
    { value: 'characters' as const, label: 'Characters' }
  ];

  const SORTS = [
    { value: 'newest' as const, label: 'Newest' },
    { value: 'liked' as const, label: 'Most liked' },
    { value: 'popular' as const, label: 'Most viewed' },
    { value: 'name' as const, label: 'Name' }
  ];

  /*
   * Named for what the *row* is, not for what is in it. "Heroes" would be the
   * obvious label and it is the wrong one — in this list it means "rows
   * published as one hero on their own", while the identical word in the role
   * filter beside it means "characters whose role is hero". Two filters, one
   * word, two answers is the kind of thing nobody debugs; they just stop
   * trusting the control.
   */
  const SCOPES = [
    { value: 'all' as const, label: 'Every listing' },
    { value: 'full' as const, label: 'Whole sets' },
    { value: 'hero' as const, label: 'Single heroes' },
    { value: 'villain' as const, label: 'Villain sides' }
  ];

  const ROLES = [
    { value: '' as const, label: 'Every role' },
    ...SELECTABLE_ROLES.map((value) => ({
      value,
      label: CHARACTER_ROLE_META[value].plural
    }))
  ];

  /** Everything the two listings are filtered by, as one value. */
  interface Query {
    mode: Mode;
    search: string;
    sort: GallerySort;
    scope: ScopeFilter;
    role: '' | CharacterRole;
    favouritesOnly: boolean;
    accountId: string;
    offset: number;
  }

  let loadVersion = 0;

  async function load(query: Query, append = false): Promise<void> {
    const version = ++loadVersion;
    loading = true;
    error = null;
    try {
      const { search: term, sort: order, offset: skip } = query;
      if (query.favouritesOnly) {
        if (!query.accountId) {
          sets = [];
          characters = [];
          maybeMore = false;
          return;
        }
      }

      if (query.mode === 'sets') {
        const listSets = query.favouritesOnly ? listMyFavouriteSets : listPublicSets;
        const page = await listSets({
          search: term,
          sort: order,
          scope: query.scope,
          limit: PAGE,
          offset: skip
        });
        if (version !== loadVersion) return;
        sets = append ? [...sets, ...page] : page;
        maybeMore = page.length === PAGE;
      } else {
        const listCharacters = query.favouritesOnly
          ? listMyFavouriteCharacters
          : listPublicCharacters;
        const page = await listCharacters({
          search: term,
          sort: order,
          role: query.role,
          limit: PAGE,
          offset: skip
        });
        if (version !== loadVersion) return;
        characters = append ? [...characters, ...page] : page;
        maybeMore = page.length === PAGE;
      }
    } catch (cause) {
      if (version === loadVersion) {
        error = cause instanceof Error ? cause.message : 'Could not load the gallery.';
      }
    } finally {
      if (version === loadVersion) loading = false;
    }
  }

  /*
   * Debounced, because this runs on every keystroke in the search box and each
   * run is a request. 250ms is below the point a search feels laggy and above
   * the point a fast typist sends one query per letter.
   *
   * The whole query is built *outside* the timeout, which is what makes the
   * effect depend on every control rather than only on whichever ones happened
   * to be read before the first `await`. A filter read inside the callback
   * would not be tracked, and the list would quietly stop responding to it.
   */
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const accountId = canEngage ? (auth.user?.id ?? '') : '';
    const query: Query = { mode, search, sort, scope, role, favouritesOnly, accountId, offset: 0 };
    clearTimeout(timer);
    timer = setTimeout(() => {
      offset = 0;
      void load(query);
    }, 250);
    return () => clearTimeout(timer);
  });

  function more(): void {
    offset += PAGE;
    const accountId = canEngage ? (auth.user?.id ?? '') : '';
    void load({ mode, search, sort, scope, role, favouritesOnly, accountId, offset }, true);
  }

  /*
   * Personal marks arrive separately from the public shelf. A stale token may
   * therefore lose its highlighted buttons, but can never blank the gallery —
   * the public request above remains anonymous by construction.
   */
  $effect(() => {
    const accountId = canEngage ? (auth.user?.id ?? '') : '';
    if (!accountId) {
      likedSetIds = new Set();
      favouriteKeys = new Set();
      return;
    }

    void Promise.all([listMyLikes(), listMyFavourites()])
      .then(([likes, favourites]) => {
        if (auth.user?.id !== accountId || auth.isAnonymous) return;
        likedSetIds = new Set(likes);
        favouriteKeys = new Set(favourites.map(favouriteKey));
      })
      .catch(() => {
        // The account menu owns expired-session messaging. Public browsing is
        // still useful without these private decorations.
      });
  });

  function engagementNotice(): void {
    engagementError = auth.isAnonymous
      ? 'Likes, favourites and comments need a permanent account.'
      : 'Sign in with a permanent account to like or favourite gallery items.';
  }

  function markBusy(key: string, busy: boolean): void {
    const next = new Set(engagementBusy);
    if (busy) next.add(key);
    else next.delete(key);
    engagementBusy = next;
  }

  function adjustLikeCount(setId: string, amount: number): void {
    sets = sets.map((set) =>
      set.id === setId ? { ...set, like_count: Math.max(0, set.like_count + amount) } : set
    );
    characters = characters.map((character) =>
      character.set_id === setId
        ? { ...character, like_count: Math.max(0, character.like_count + amount) }
        : character
    );
  }

  async function toggleLike(setId: string): Promise<void> {
    if (!canEngage) {
      engagementNotice();
      return;
    }
    const busyKey = `like:${setId}`;
    if (engagementBusy.has(busyKey)) return;

    const nextLiked = !likedSetIds.has(setId);
    const next = new Set(likedSetIds);
    if (nextLiked) next.add(setId);
    else next.delete(setId);
    likedSetIds = next;
    adjustLikeCount(setId, nextLiked ? 1 : -1);
    markBusy(busyKey, true);
    engagementError = null;

    try {
      await setLiked(setId, nextLiked);
    } catch (cause) {
      const rollback = new Set(likedSetIds);
      if (nextLiked) rollback.delete(setId);
      else rollback.add(setId);
      likedSetIds = rollback;
      adjustLikeCount(setId, nextLiked ? -1 : 1);
      engagementError = cause instanceof Error ? cause.message : 'Could not update that like.';
    } finally {
      markBusy(busyKey, false);
    }
  }

  async function toggleFavourite(target: FavouriteTarget): Promise<void> {
    if (!canEngage) {
      engagementNotice();
      return;
    }
    const key = favouriteKey(target);
    const busyKey = `favourite:${key}`;
    if (engagementBusy.has(busyKey)) return;

    const nextFavourite = !favouriteKeys.has(key);
    const next = new Set(favouriteKeys);
    if (nextFavourite) next.add(key);
    else next.delete(key);
    favouriteKeys = next;
    markBusy(busyKey, true);
    engagementError = null;

    try {
      await setFavourite(target, nextFavourite);
      if (!nextFavourite && favouritesOnly) {
        if (target.kind === 'character') {
          characters = characters.filter(
            (character) =>
              character.owner_id !== target.owner_id ||
              character.local_id !== target.local_id ||
              character.character_id !== target.character_id
          );
        } else {
          sets = sets.filter((set) => set.id !== target.set_id);
        }
      }
    } catch (cause) {
      const rollback = new Set(favouriteKeys);
      if (nextFavourite) rollback.delete(key);
      else rollback.add(key);
      favouriteKeys = rollback;
      engagementError = cause instanceof Error ? cause.message : 'Could not update that favourite.';
    } finally {
      markBusy(busyKey, false);
    }
  }

  function toggleFavouritesOnly(): void {
    if (!canEngage) {
      engagementNotice();
      return;
    }
    favouritesOnly = !favouritesOnly;
    engagementError = null;
  }

  /**
   * The picture for a set tile.
   *
   * `cover_url` is the fallback the database derives from the document itself
   * — see `0007_gallery_browse.sql`. It is there because most sets published
   * with no thumbnail at all: the thumbnail was only ever looked for on the
   * box or a character's portrait, and authors put their pictures on cards.
   * Both ends are fixed now, but a fixed `renderThumbnail` only reaches sets
   * published after it, and this reaches the ones already up there.
   */
  function setImage(set: GallerySet): string {
    return set.thumbnail_url || set.cover_url;
  }

  function characterImage(character: GalleryCharacter): string {
    return character.image_url || character.thumbnail_url || character.cover_url;
  }

  /**
   * Whether the picture `characterImage` settled on carries bleed.
   *
   * Follows the same fallback in the same order, because the answer belongs to
   * whichever candidate actually won.
   *
   * **A thumbnail follows `cover_bleeds`, and that is not an approximation.**
   * `renderThumbnail` downscales whatever `coverArtwork` picks, and
   * `set_cover_picture` is written to mirror `coverArtwork` step for step — so
   * the two always choose the same artwork, and a plain downscale keeps the
   * bleed as the same proportion of the frame. The tempting reading is that a
   * thumbnail is a finished picture and never bleeds; that was true only while
   * the cover was box art or a portrait, and stopped being true the moment
   * covers started falling through to deck backs.
   */
  function characterImageBleeds(character: GalleryCharacter): boolean {
    if (character.image_url) return character.image_bleeds;
    return character.cover_bleeds;
  }

  function roleLabel(value: string): string {
    return value in CHARACTER_ROLE_META
      ? CHARACTER_ROLE_META[value as CharacterRole].label
      : value;
  }

  /**
   * The box a character belongs to, when that is a *different* listing.
   *
   * The view reports the parent honestly, which for a character reached
   * through their own box means the parent is the listing itself — so the
   * check is here rather than in SQL. Without it every tile would carry a
   * link back to the page it is already on.
   */
  function parentOf(character: GalleryCharacter): { slug: string; name: string } | null {
    if (!character.parent_slug || character.parent_slug === character.slug) return null;
    return { slug: character.parent_slug, name: character.parent_name ?? 'its set' };
  }

  /** A stable colour per tile, for one with no picture. */
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

  const empty = $derived(mode === 'sets' ? sets.length === 0 : characters.length === 0);

  /**
   * Why the grid is empty — and the distinction is the whole point of writing
   * this out. "No sets have been published yet" is *false* when five of them
   * have and the filter is set to villain sides, and a reader who believes it
   * stops looking. An empty result caused by a control has to name the
   * control.
   */
  const emptyMessage = $derived.by(() => {
    if (favouritesOnly && !canEngage) {
      return 'Sign in with a permanent account to see your favourites.';
    }
    if (search.trim()) return `Nothing matches “${search.trim()}”.`;
    if (favouritesOnly) {
      return mode === 'sets'
        ? 'You have not favourited any set listings yet.'
        : 'You have not favourited any characters yet.';
    }
    if (mode === 'characters') {
      if (role) {
        return `Nothing published has a ${CHARACTER_ROLE_META[role].label.toLowerCase()} in it yet.`;
      }
      return 'No characters have been published yet.';
    }
    if (scope === 'hero') return 'Nobody has published a hero on their own yet.';
    if (scope === 'villain') return 'Nobody has published a villain side on its own yet.';
    return 'No sets have been published yet.';
  });
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
  </header>

  {#if !cloudEnabled()}
    <p class="message">Sharing is not set up in this build.</p>
  {:else}
    <div class="controls">
      <SegmentedControl bind:value={mode} segments={MODES} label="Browse" />

      <button
        type="button"
        class="favourites-filter"
        class:active={favouritesOnly}
        aria-pressed={favouritesOnly}
        onclick={toggleFavouritesOnly}
      >
        <Icon name="bookmark" size={14} />
        {favouritesOnly ? 'Showing favourites' : 'My favourites'}
      </button>

      <input
        class="search"
        type="search"
        placeholder={mode === 'sets' ? 'Search sets and characters…' : 'Search characters…'}
        bind:value={search}
        aria-label="Search the gallery"
      />

      {#if mode === 'sets'}
        <label class="filter">
          <span class="field-label">Show</span>
          <Select bind:value={scope} options={SCOPES} />
        </label>
      {:else}
        <label class="filter">
          <span class="field-label">Role</span>
          <Select bind:value={role} options={ROLES} />
        </label>
      {/if}

      <label class="filter">
        <span class="field-label">Sort</span>
        <Select bind:value={sort} options={SORTS} />
      </label>
    </div>

    {#if engagementError}
      <p class="message engagement-error" role="status">{engagementError}</p>
    {/if}

    {#if error}
      <p class="message error" role="alert">{error}</p>
    {:else if loading && empty}
      <p class="message">Loading…</p>
    {:else if empty}
      <p class="message">{emptyMessage}</p>
    {:else if mode === 'sets'}
      <ul class="grid">
        {#each sets as set (set.id)}
          {@const target = { kind: 'set' as const, set_id: set.id }}
          <li>
            <div class="tile-wrap">
              <button type="button" class="tile" onclick={() => navigation.openShared(set.slug)}>
                <span
                  class="cover"
                  style:--trim-scale={TRIM_SCALE_WIDE}
                  style:background={tint(set.id)}
                >
                  {#if setImage(set)}
                    <!-- Lazy, because a gallery page is mostly pictures nobody has
                         scrolled to yet.

                         `cover_bleeds` governs the thumbnail as well as the
                         cover, because both are the same artwork — see
                         `characterImageBleeds` for why a thumbnail is not
                         automatically bleed-free. -->
                    <img src={setImage(set)} class:trimmed={set.cover_bleeds} alt="" loading="lazy" />
                  {:else}
                    <span class="initials">{initials(set.name)}</span>
                  {/if}
                </span>

                <span class="body">
                  <span class="name-row">
                    <span class="name">{set.name || 'Untitled Adventure'}</span>
                    <!--
                      A scoped publish reads as a smaller, related thing next to
                      a box tile, not as another box — the badge is what says so
                      at a glance, before anyone reads down to the "From …" line
                      the subtitle already carries (see `sets/scope.ts`).
                    -->
                    {#if set.scope !== 'full'}
                      <span class="scope-badge">{set.scope === 'hero' ? 'Hero' : 'Villain'}</span>
                    {/if}
                  </span>
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

              <div class="tile-actions">
                <button
                  type="button"
                  class="tile-action"
                  class:active={likedSetIds.has(set.id)}
                  aria-pressed={likedSetIds.has(set.id)}
                  aria-label={likedSetIds.has(set.id) ? `Unlike ${set.name}` : `Like ${set.name}`}
                  disabled={engagementBusy.has(`like:${set.id}`)}
                  onclick={() => void toggleLike(set.id)}
                >
                  <Icon name="thumbUp" size={14} />
                  <span class="numeric">{set.like_count ?? 0}</span>
                </button>
                <span class="comment-count" title="Comments">
                  <Icon name="message" size={14} />
                  <span class="numeric">{set.comment_count ?? 0}</span>
                </span>
                <button
                  type="button"
                  class="tile-action favourite"
                  class:active={favouriteKeys.has(favouriteKey(target))}
                  aria-pressed={favouriteKeys.has(favouriteKey(target))}
                  aria-label={favouriteKeys.has(favouriteKey(target))
                    ? `Remove ${set.name} from favourites`
                    : `Add ${set.name} to favourites`}
                  disabled={engagementBusy.has(`favourite:${favouriteKey(target)}`)}
                  onclick={() => void toggleFavourite(target)}
                >
                  <Icon name="bookmark" size={14} />
                  <span>Favourite</span>
                </button>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <ul class="grid">
        {#each characters as character (character.set_id + character.character_id)}
          {@const parent = parentOf(character)}
          {@const target = {
            kind: 'character' as const,
            owner_id: character.owner_id,
            local_id: character.local_id,
            character_id: character.character_id
          }}
          <li>
            <!--
              The link to the parent set is its own control, so it sits *beside*
              the tile's button rather than inside it — a button nested in a
              button is invalid markup, and browsers resolve it by dropping one
              of them. The wrapper is what lets both be clickable.
            -->
            <div class="tile-wrap">
              <button
                type="button"
                class="tile"
                class:has-card={!!character.card_url}
                onpointerenter={() => peek(character.character_id)}
                onfocusin={() => peek(character.character_id)}
                onclick={() =>
                  navigation.openShared(
                    character.slug,
                    /*
                     * Only when this character has no listing of their own —
                     * `openShared` is about to open the whole box, so the
                     * export panel there should default to just them rather
                     * than to everyone inside it. A character already
                     * published on their own opens a document that already
                     * *is* just them; nothing to default.
                     */
                    character.listing_scope === 'full' ? character.character_id : undefined
                  )}
              >
                <span
                  class="cover"
                  style:aspect-ratio={CARD_ASPECT}
                  style:--trim-scale={TRIM_SCALE_TALL}
                  style:background={tint(character.character_id)}
                >
                  {#if characterImage(character)}
                    <img
                      src={characterImage(character)}
                      class:trimmed={characterImageBleeds(character)}
                      alt=""
                      loading="lazy"
                    />
                  {:else}
                    <span class="initials">{initials(character.name)}</span>
                  {/if}

                  <!--
                    The character card, cross-faded over the deck back on
                    hover. Two pictures of the same thing at the same size, so
                    swapping them in place reads as turning the figure over
                    rather than as a popup appearing somewhere else.

                    Not lazy, unlike the deck back beneath it: a lazily-loaded
                    image starts fetching when it scrolls into view, and this
                    one is *always* in view — it is only transparent. Marking
                    it lazy would mean it loads at the same moment the back
                    does and buys nothing. `preload` on hover is not available
                    for an already-rendered element, so the honest trade is
                    made in `characterCardSrc`: only rendered once the tile has
                    been hovered at least once, which is what keeps a gallery
                    of thirty heroes from fetching thirty full cards nobody
                    asked to see.
                  -->
                  {#if character.card_url && peeked.has(character.character_id)}
                    <img class="card-peek" src={character.card_url} alt="" />
                  {/if}

                  <!--
                    Says the card is there before anyone has hovered to find
                    out. A hover-only affordance nobody knows about is a
                    feature nobody uses, and it also gives touch — which has
                    no hover at all — something to read instead of a swap it
                    will never see.
                  -->
                  {#if character.card_url}
                    <span class="peek-hint">
                      <Icon name="card" size={11} />
                      Character card
                    </span>
                  {/if}
                </span>

                <span class="body">
                  <span class="name-row">
                    <span class="name">{character.name}</span>
                    {#if character.role}
                      <span
                        class="role-badge"
                        style:--role-tint="var(--role-{character.role}, var(--text-muted))"
                      >
                        {roleLabel(character.role)}
                      </span>
                    {/if}
                  </span>

                  <!--
                    What opening this tile actually gets you. A character
                    published on their own opens their own listing; one that
                    only exists inside a box opens the box, and saying which
                    beforehand is the difference between a link and a surprise.
                  -->
                  <span class="subtitle">
                    {#if character.listing_scope === 'full'}
                      In {character.listing_name}
                    {:else}
                      Published on their own
                    {/if}
                  </span>

                  {#if character.view_count > 0}
                    <span class="stats numeric">{character.view_count} views</span>
                  {/if}
                </span>
              </button>

              <div class="tile-actions character-actions">
                <span class="listing-engagement" title="Engagement on the listing this opens">
                  <Icon name="thumbUp" size={13} />
                  <span class="numeric">{character.like_count ?? 0}</span>
                  <Icon name="message" size={13} />
                  <span class="numeric">{character.comment_count ?? 0}</span>
                </span>
                <button
                  type="button"
                  class="tile-action favourite"
                  class:active={favouriteKeys.has(favouriteKey(target))}
                  aria-pressed={favouriteKeys.has(favouriteKey(target))}
                  aria-label={favouriteKeys.has(favouriteKey(target))
                    ? `Remove ${character.name} from favourites`
                    : `Add ${character.name} to favourites`}
                  disabled={engagementBusy.has(`favourite:${favouriteKey(target)}`)}
                  onclick={() => void toggleFavourite(target)}
                >
                  <Icon name="bookmark" size={14} />
                  <span>Favourite</span>
                </button>
              </div>

              {#if parent}
                <button
                  type="button"
                  class="parent-link"
                  onclick={() => navigation.openShared(parent.slug)}
                >
                  <Icon name="layers" size={12} />
                  Part of {parent.name}
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if !error && !empty && maybeMore}
      <div class="more">
        <Button onclick={more} disabled={loading}>
          {loading ? 'Loading…' : 'Show more'}
        </Button>
      </div>
    {/if}
  {/if}
</div>

<style>
  /*
   * Owns its own scrolling, because nothing else will.
   *
   * `base.css` sets `body { overflow: hidden }`, so this screen must own its
   * scrolling. Its height comes from the application frame now; using the
   * viewport directly would add the global banner's height and clip the last
   * part of the grid.
   */
  .screen {
    height: 100%;
    overflow-y: auto;
    padding: var(--space-6);
    background: var(--surface-sunken);
    color: var(--text-default);
  }

  .head {
    display: flex;
    align-items: flex-start;
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

  .favourites-filter {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 32px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--text-muted);
    font-size: var(--text-sm);
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out),
      background var(--duration-fast) var(--ease-out);
  }

  .favourites-filter:hover,
  .favourites-filter.active {
    border-color: var(--accent);
    color: var(--text-default);
  }

  .favourites-filter.active {
    background: var(--surface-selected);
  }

  .favourites-filter.active :global(svg) {
    fill: currentColor;
  }

  .engagement-error {
    margin-top: calc(-1 * var(--space-3));
    margin-bottom: var(--space-4);
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

  .filter {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    /* Wide enough for "Villain sides" without the select clipping it. */
    min-width: 150px;
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

  /*
   * Stretch, so a tile with a parent link is the same height as one without
   * and the grid rows stay level. `height: 100%` on the tile does the rest.
   */
  .tile-wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .tile {
    display: flex;
    flex-direction: column;
    flex: 1;
    width: 100%;
    height: auto;
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

  /*
   * The character card, laid exactly over the deck back.
   *
   * `object-fit: contain` rather than `cover` like the picture underneath it:
   * a deck back is decoration and may be cropped to fill the tile, but a
   * character card is a *document* — cropping it would cut off the stat block
   * that is the entire reason for showing it. The letterboxing that leaves is
   * filled by the tile's own tint, which is already behind it.
   *
   * Written as `.cover img.card-peek` and not as a bare `.card-peek`, which
   * is the version that does not work: `.cover img` above is a class *and* an
   * element (specificity 0,1,1) and outranks a lone class (0,1,0) no matter
   * which is written later, so `contain` lost to `cover` and the card was
   * silently cropped. Measured, not guessed — the computed `object-fit` read
   * back `cover`. Same trap as `.space text` over `.start-number` in
   * `MapBoard.svelte`.
   */
  .cover img.card-peek {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: inherit;
    opacity: 0;
    transition: opacity var(--duration-normal, 200ms) var(--ease-out);
  }

  .tile:hover .cover img.card-peek,
  .tile:focus-visible .cover img.card-peek {
    opacity: 1;
  }

  .peek-hint {
    position: absolute;
    left: var(--space-2);
    bottom: var(--space-2);
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px var(--space-2);
    border-radius: var(--radius-full);
    /* Its own dark chip rather than a theme surface: this sits over whatever
       picture the author uploaded, so it cannot borrow a background that might
       match one. */
    background: rgb(0 0 0 / 0.55);
    color: rgb(255 255 255 / 0.85);
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-wide);
    transition: opacity var(--duration-fast) var(--ease-out);
  }

  /* Out of the way once the card it advertises is actually showing. */
  .tile:hover .peek-hint,
  .tile:focus-visible .peek-hint {
    opacity: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .cover img.card-peek,
    .peek-hint {
      transition: none;
    }
  }

  /* A character tile's own aspect is set inline, from the printed card's `mm`
     — see `CARD_ASPECT`. It is not written here because a number copied out of
     `geometry.ts` is a number that stops agreeing with it. */

  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /*
   * Crop a full print plate down to its cut line.
   *
   * A scale rather than a clip or an inset: `object-fit: cover` has already
   * fitted and centred the plate, and the bleed is a symmetric margin on all
   * four edges, so enlarging about the centre pushes exactly that margin out
   * past the tile's own `overflow: hidden`. Nothing is resampled and no
   * geometry is duplicated — the only number involved is `TRIM_SCALE`, which
   * comes from `trimBox`.
   */
  .cover img.trimmed {
    transform: scale(var(--trim-scale));
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

  .scope-badge,
  .role-badge {
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

  /* The roster's own colours, so a hero reads as a hero here too. */
  .role-badge {
    border-color: var(--role-tint);
    color: var(--role-tint);
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

  .tile-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 34px;
    margin-top: 2px;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--text-muted);
  }

  .tile-action,
  .comment-count,
  .listing-engagement {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--text-xs);
  }

  .tile-action {
    min-height: 26px;
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .tile-action:hover,
  .tile-action.active {
    background: var(--surface-selected);
    color: var(--text-default);
  }

  .tile-action.active :global(svg) {
    fill: currentColor;
  }

  .tile-action:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .comment-count {
    padding-inline: var(--space-2);
  }

  .favourite {
    margin-left: auto;
  }

  .listing-engagement {
    gap: var(--space-1);
    padding-inline: var(--space-2);
  }

  .parent-link {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    margin-top: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-align: left;
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .parent-link:hover {
    border-color: var(--accent);
    color: var(--text-default);
  }

  .more {
    display: flex;
    justify-content: center;
    margin-top: var(--space-5);
  }
</style>
