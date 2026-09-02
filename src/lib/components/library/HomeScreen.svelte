<script lang="ts">
  /**
   * Home: every set you have, what needs your attention, and the way into a
   * new one.
   *
   * This is the only screen that exists outside a set, which is what makes
   * the rest of the app able to assume a set is always open — and, now that
   * it is also the first thing anyone sees, the reason for the attention
   * strip and the published/unpublished split below: this is the page that
   * has to say what is worth doing next, not just list what exists.
   *
   * The set-level page still called "Home" until this replaced it is now
   * `SetHome.svelte`, labelled "Edit" (`SET_PAGE_META.home`) — two different
   * screens with unrelated jobs cannot both be called Home.
   */
  import { parseSetFile } from '$lib/export/json';
  import { CHARACTER_ROLE_META, SELECTABLE_ROLES } from '$lib/characters/types';
  import type { CharacterId, CharacterRole } from '$lib/characters/types';
  import { auth } from '$lib/cloud/auth.svelte';
  import { renderCharacterCards } from '$lib/cloud/character-cards';
  import { openContributionCounts } from '$lib/cloud/contributions';
  import { cloudEnabled } from '$lib/cloud/config';
  import { fetchSetSummaryBySlug, listMyPublishedSets, listPublicSets } from '$lib/cloud/sets';
  import type { GallerySet } from '$lib/cloud/sets';
  import { coverArtwork } from '$lib/cloud/thumbnail';
  import { asId } from '$lib/core/id';
  import { GUIDES } from '$lib/guides/content';
  import { draftRollout } from '$lib/persistence/rollout.svelte';
  import type { DraftLibraryEntry, LibraryAvailability } from '$lib/persistence/types';
  import { CARD_FORMATS, trimBox } from '$lib/renderer/geometry';
  import { healthSummaryFromCounts } from '$lib/sets/health';
  import type { SetId, SetKind } from '$lib/sets/types';
  import { guides } from '$lib/state/guides.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { loadSet } from '$lib/storage/library';
  import { Button, Icon, SegmentedControl, Select } from '$lib/ui';
  import NewSetDialog from './NewSetDialog.svelte';

  interface Props {
    /** Keep the full introduction visible even after the library has sets. */
    welcome?: boolean;
  }

  let { welcome = false }: Props = $props();

  let fileInput = $state<HTMLInputElement | null>(null);
  let message = $state<string | null>(null);
  let confirmingDelete = $state<string | null>(null);
  /** Collapsed by default — an empty-feeling section nobody asked to see. */
  let showDeleted = $state(false);
  let confirmingPurge = $state<string | null>(null);

  /**
   * Whether the "what are you making?" chooser is up.
   *
   * New sets go through it rather than straight to `createSet`, so the kind is
   * a decision made once and up front instead of a default discovered later —
   * see `NewSetDialog`.
   */
  let choosingKind = $state(false);

  function startSet(kind: SetKind): void {
    choosingKind = false;
    void workshop.createSet(undefined, kind);
  }

  const entries = $derived(workshop.library);
  const deletedEntries = $derived(workshop.deletedLibrary);
  const welcomeMode = $derived(welcome || entries.length === 0);

  /**
   * Each set's own cover picture, mirroring the gallery's tile — see
   * `coverArtwork`. `LibraryEntry` carries no picture on purpose (see
   * `storage/library.ts`), so this loads the full document once per set,
   * off to the side, rather than putting one on the index. Keyed by id and
   * built up as loads resolve; a set still loading, or with no picture at
   * all, keeps showing `tint(entry.id)` underneath.
   */
  let covers = $state<Map<SetId, string>>(new Map());
  const coversRequested = new Set<SetId>();

  async function ensureCover(entry: DraftLibraryEntry): Promise<void> {
    if (!entry.cached || coversRequested.has(entry.id)) return;
    coversRequested.add(entry.id);
    const set = await loadSet(entry.id);
    const source = set ? coverArtwork(set)?.source : null;
    if (source) covers = new Map(covers).set(entry.id, source);
  }

  /** Every visible set gets its cover requested once, as the shelf renders. */
  $effect(() => {
    for (const entry of entries) void ensureCover(entry);
  });

  /**
   * A hero's own printed character card, photographed the first time its
   * tile is hovered or focused — same gate as `GalleryScreen`'s own `peek`,
   * for the same reason: rendering every set's card stage the moment the
   * shelf appears would cost far more than the rest of the page, for
   * previews most of which nobody will ever hover. Stays cached afterwards,
   * so a second hover is instant. A blob is read to a data URL rather than
   * kept as an object URL, so nothing here has to revoke one on unmount —
   * `renderCharacterCards`' own WebP is small enough (tens of KB) that the
   * base64 overhead costs nothing worth avoiding it for.
   */
  let cardPeeks = $state<Map<SetId, string>>(new Map());
  const peeksRequested = new Set<SetId>();

  function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error as Error);
      reader.readAsDataURL(blob);
    });
  }

  async function peekCard(entry: DraftLibraryEntry): Promise<void> {
    if (!entry.cached || peeksRequested.has(entry.id)) return;
    peeksRequested.add(entry.id);
    const set = await loadSet(entry.id);
    if (!set) return;
    // First hero only, matching `coverArtwork`'s own "first hero" step — a
    // glance at who this set is, not a card per hero it happens to have.
    const rendered = await renderCharacterCards(set);
    const first = rendered.values().next().value;
    if (first) cardPeeks = new Map(cardPeeks).set(entry.id, await blobToDataUrl(first));
  }

  /**
   * The stat row: quick counts, not detail — the attention strip and the
   * shelf below already carry the specifics. `blockers` only counts entries
   * that actually know their own health (`entry.blockers !== undefined`); an
   * index row written before that field existed is "status unknown," not
   * "no blockers," and must not read as either a pass or a fail until it has
   * backfilled — see `storage/library.ts`'s `LibraryEntry.blockers`.
   */
  const libraryStats = $derived.by(() => {
    let characters = 0;
    let blocked = 0;
    for (const entry of entries) {
      characters += entry.characterCount;
      if ((entry.blockers ?? 0) > 0) blocked += 1;
    }
    return { sets: entries.length, characters, blocked };
  });

  /**
   * The set to offer as "continue where you left off" — deliberately *not*
   * `readLastOpen()`, which sounds like the same question and is not:
   * `rememberLastOpen(null)` is what `workshop.closeSet()` calls on the way
   * to Home, because that field's actual job is "what to silently reopen if
   * the browser closed without warning," and a deliberate trip back to Home
   * is the opposite of that — it must *not* reopen anything next time. Reading
   * it here would mean this card went blank the moment the button that leads
   * to it was used, which is the one path an author takes to reach it.
   *
   * `entries[0]` instead: `readIndex()` already orders most-recently-saved
   * first (`storage/library.ts`), so this is "what I was just working on"
   * without a second field to keep in sync with reality.
   */
  const lastOpened = $derived(entries[0] ?? null);

  /**
   * Two questions worth answering before opening any one set, not after:
   * contributions waiting on a decision, and a fork whose original has moved
   * on since it was copied. `SetHome` already answers both for whichever set
   * happens to be open — this generalises the same two calls across every
   * set here at once, rather than opening each one to find out.
   *
   * `waiting` comes from `listMyPublishedSets`/`openContributionCounts`,
   * which already answer for everything this author owns in two calls total;
   * `behindBy` is genuinely per-set (one `fetchSetSummaryBySlug` per forked
   * entry), so those go out in parallel rather than one after another.
   */
  interface SetAttention {
    waiting: number;
    behindBy: number;
  }

  let attention = $state<Map<SetId, SetAttention>>(new Map());

  /**
   * Which local sets this author has published at least once, under any
   * scope — the split the shelf below groups by, keyed to the slug that
   * publish produced. `null` rather than an empty `Map` until the fetch
   * actually answers: signed out, offline, or cloud disabled all mean
   * "unknown," not "nothing is published," and the two must not look the
   * same — an empty answer would put every set in this library under
   * "Unpublished" even for an author who simply is not signed in yet.
   *
   * Carries the slug, not just membership, because the promoted "Continue
   * where you left off" card wants to link straight to the gallery listing —
   * `listMyPublishedSets()` already returns it on every row, so keeping it
   * here is free.
   */
  let publishedSlugByLocalId = $state<Map<SetId, string> | null>(null);

  $effect(() => {
    const current = entries;
    const signedIn = auth.signedIn;
    if (!cloudEnabled()) return;
    /*
     * Read before the guard below returns, not inside it — `auth.signedIn`
     * has to be tracked whether or not this author happens to be signed in
     * right now, or signing in while this screen is open would never
     * re-trigger the fetch that turns "unknown" into a real split.
     */
    if (!signedIn) {
      publishedSlugByLocalId = null;
      return;
    }

    void (async () => {
      const waitingByLocalId = new Map<string, number>();
      try {
        const [published, counts] = await Promise.all([
          listMyPublishedSets(),
          openContributionCounts()
        ]);
        publishedSlugByLocalId = new Map(
          published.map((row) => [asId<SetId>(row.local_id), row.slug])
        );
        for (const row of published) {
          const open = counts.get(row.id) ?? 0;
          if (open > 0) {
            waitingByLocalId.set(row.local_id, (waitingByLocalId.get(row.local_id) ?? 0) + open);
          }
        }
      } catch {
        // A badge is never worth an error message — see `SetHome`'s own
        // silent fallback for the identical fetch. `publishedLocalIds` is
        // simply left at whatever it already was — `null` on a first
        // failure, so the shelf still falls back to one flat list rather
        // than guessing.
      }

      const forked = current.filter(
        (entry): entry is DraftLibraryEntry & { originSlug: string; originRevision: number } =>
          entry.originSlug !== undefined && entry.originRevision !== undefined
      );
      const behindByLocalId = new Map<SetId, number>();
      await Promise.all(
        forked.map(async (entry) => {
          try {
            const summary = await fetchSetSummaryBySlug(entry.originSlug);
            if (!summary) return;
            const behindBy = Math.max(0, summary.revision - entry.originRevision);
            if (behindBy > 0) behindByLocalId.set(entry.id, behindBy);
          } catch {
            // Same reasoning — an unreachable original is not an error here.
          }
        })
      );

      const next = new Map<SetId, SetAttention>();
      for (const entry of current) {
        const waiting = waitingByLocalId.get(entry.id) ?? 0;
        const behindBy = behindByLocalId.get(entry.id) ?? 0;
        if (waiting > 0 || behindBy > 0) next.set(entry.id, { waiting, behindBy });
      }
      attention = next;
    })();
  });

  interface AttentionRow {
    id: SetId;
    name: string;
  }

  const waitingSets = $derived.by(() => {
    const rows: (AttentionRow & { count: number })[] = [];
    for (const entry of entries) {
      const waiting = attention.get(entry.id)?.waiting ?? 0;
      if (waiting > 0) rows.push({ id: entry.id, name: entry.name || 'Untitled Adventure', count: waiting });
    }
    return rows;
  });

  const behindSets = $derived.by(() => {
    const rows: (AttentionRow & { behindBy: number })[] = [];
    for (const entry of entries) {
      const behindBy = attention.get(entry.id)?.behindBy ?? 0;
      if (behindBy > 0) rows.push({ id: entry.id, name: entry.name || 'Untitled Adventure', behindBy });
    }
    return rows;
  });

  /**
   * Sets or characters — the same toggle the gallery offers, for the same
   * reason: a hero published inside a box is invisible to "what sets do I
   * have", and here it is the author's *own* memory the toggle is standing
   * in for, not a stranger's — "I know I made a hero named Maui, which set
   * did I put him in?" has no answer at all in a list of boxes.
   *
   * Defaults to Sets, unlike the gallery's own default: someone opening
   * their own library came to work on a set they already have in mind far
   * more often than to hunt for a character across all of them, where a
   * stranger browsing the public gallery is doing exactly the reverse —
   * looking for someone to play before caring which box they came in.
   */
  type Mode = 'sets' | 'characters';
  let mode = $state<Mode>('sets');
  let search = $state('');
  /** `''` for every role. A `CharacterRole` otherwise — Characters mode only. */
  let role = $state<'' | CharacterRole>('');

  const MODES = [
    { value: 'sets' as const, label: 'Sets' },
    { value: 'characters' as const, label: 'Characters' }
  ];

  const ROLES = [
    { value: '' as const, label: 'Every role' },
    ...SELECTABLE_ROLES.map((value) => ({ value, label: CHARACTER_ROLE_META[value].plural }))
  ];

  /*
   * Matched against the set's own name and subtitle, but also every
   * character inside it — same as the gallery's own search, which is built
   * against `search_document` there for exactly this reason (see
   * `cloud/sets.ts`'s `searchQuery`): a hero inside a box has to find the
   * box, or "Maui" only turns up something once you already remember he is
   * in Forgotten Pantheons, which defeats the point of searching at all.
   */
  const filteredSets = $derived.by(() => {
    const term = search.trim().toLowerCase();
    if (!term) return entries;
    return entries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(term) ||
        entry.subtitle.toLowerCase().includes(term) ||
        (entry.characters ?? []).some((character) => character.name.toLowerCase().includes(term))
    );
  });

  /**
   * `filteredSets`, split by whether this author has published it — `null`
   * while that is not yet known (see `publishedSlugByLocalId`), so the shelf
   * below falls back to one flat list rather than a two-way split it cannot
   * actually answer.
   */
  const groupedSets = $derived.by(() => {
    if (publishedSlugByLocalId === null) return null;
    const slugs = publishedSlugByLocalId;
    const published: typeof filteredSets = [];
    const unpublished: typeof filteredSets = [];
    for (const entry of filteredSets) {
      (slugs.has(entry.id) ? published : unpublished).push(entry);
    }
    return { published, unpublished };
  });

  /**
   * The same three states the per-tile `.health-status` pill already reads
   * off `entry.blockers`/`.gaps` — collected once here rather than three
   * separate boolean checks per reader, so the donut and the pill can never
   * disagree about which bucket a set falls in.
   */
  type HealthState = 'blocked' | 'rough' | 'ready';

  function healthStateOf(blockers: number, gaps: number): HealthState {
    if (blockers > 0) return 'blocked';
    if (gaps > 0) return 'rough';
    return 'ready';
  }

  /**
   * "Library health" for the stat row's donut. `known` is entries whose
   * health has actually been computed — an index row written before
   * `blockers` existed is left out rather than guessed at, same reasoning as
   * `libraryStats.blocked` above.
   */
  const libraryHealth = $derived.by(() => {
    let blocked = 0;
    let rough = 0;
    let ready = 0;
    for (const entry of entries) {
      if (entry.blockers === undefined || entry.gaps === undefined) continue;
      const state = healthStateOf(entry.blockers, entry.gaps);
      if (state === 'blocked') blocked += 1;
      else if (state === 'rough') rough += 1;
      else ready += 1;
    }
    return { blocked, rough, ready, known: blocked + rough + ready };
  });

  const DONUT_R = 15.5;
  const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_R;

  interface DonutSegment {
    state: HealthState;
    color: string;
    dash: string;
    offset: number;
  }

  /**
   * One `<circle>` per non-empty bucket, each a full ring dashed down to its
   * own share and rotated (via `stroke-dashoffset`) to start where the
   * previous one ended — the standard percentage-ring trick, done against the
   * circle's *actual* circumference rather than an illustrative round number,
   * so the three lengths always sum to the full ring exactly.
   */
  const donutSegments = $derived.by((): DonutSegment[] => {
    const { blocked, rough, ready, known } = libraryHealth;
    if (known === 0) return [];
    const buckets: { state: HealthState; count: number; color: string }[] = [
      { state: 'ready', count: ready, color: 'var(--success)' },
      { state: 'rough', count: rough, color: 'var(--warning)' },
      { state: 'blocked', count: blocked, color: 'var(--danger)' }
    ];
    let cumulative = 0;
    const segments: DonutSegment[] = [];
    for (const bucket of buckets) {
      if (bucket.count === 0) continue;
      const length = (bucket.count / known) * DONUT_CIRCUMFERENCE;
      segments.push({
        state: bucket.state,
        color: bucket.color,
        dash: `${length} ${DONUT_CIRCUMFERENCE - length}`,
        offset: -cumulative
      });
      cumulative += length;
    }
    return segments;
  });

  /**
   * Four permanent, labeled slots for gallery inspiration — Adventures set,
   * Heroes set, and two Single hero spots — rather than a flat list of
   * whatever came back. Not pinned to specific sets by name or slug: that
   * breaks the moment an author unpublishes or renames one. Each slot pulls
   * from an 8-wide pool of its own category and `pickRandom` below chooses
   * within it once per fetch, so the labels stay meaningful with only one
   * candidate published today and the picks genuinely rotate once there are
   * more.
   *
   * **The three categories split on `kind` and `hero_count`, not `scope`.**
   * `scope` says how much of a set was published (a whole box, one hero, the
   * villain side); it cannot tell an adventure from a box of heroes, and the
   * first version of this asked it to — `scope: 'hero'` for the two Single
   * hero slots, which meant only a hero *sliced out and published on its own*
   * ever qualified, while a set whose entire content is one hero did not.
   * The taxonomy is the author's own: an adventure is `kind: 'adventure'`; a
   * box of heroes with more than one hero is a "Heroes set"; a box of heroes
   * with exactly one is a "Single hero" — which a sliced-out hero also
   * satisfies on its own terms, since `heroSlice` forces `kind: 'heroes'` and
   * the slice holds one hero. See `0010_hero_count_and_kind_backfill.sql`.
   *
   * Fetched regardless of library size — the zero-state welcome panel promotes
   * one as its community spotlight and shows the other three underneath, while
   * the "Design your own adventure" card in the middle of the top row shows
   * the same four condensed for a returning author too.
   */
  interface GallerySlots {
    adventure: GallerySet | null;
    heroes: GallerySet | null;
    singleHeroes: GallerySet[];
  }

  let gallerySlots = $state<GallerySlots>({ adventure: null, heroes: null, singleHeroes: [] });
  /** Chosen once with the slots, so unrelated reactive updates never reshuffle the spotlight. */
  let galleryFeature = $state<GallerySet | null>(null);

  /**
   * Fisher-Yates, then take the front — picked once when a fetch resolves
   * and stored in state, never recomputed in a `$derived`. A derived would
   * re-roll `Math.random()` on every unrelated reactive tick (autosave
   * touching `entries`, for instance), which would make the slots visibly
   * reshuffle on their own.
   */
  function pickRandom<T>(pool: readonly T[], count: number): T[] {
    const copy = [...pool];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      const moved = copy[index];
      if (moved === undefined) continue;
      copy[index] = copy[swap] as T;
      copy[swap] = moved;
    }
    return copy.slice(0, count);
  }

  $effect(() => {
    if (!cloudEnabled()) {
      gallerySlots = { adventure: null, heroes: null, singleHeroes: [] };
      galleryFeature = null;
      return;
    }
    void (async () => {
      const POOL = 8;
      try {
        const [adventures, heroBoxes, singleHeroes] = await Promise.all([
          listPublicSets({ scope: 'full', kind: 'adventure', sort: 'popular', limit: POOL }),
          listPublicSets({
            scope: 'full',
            kind: 'heroes',
            heroes: 'multi',
            sort: 'popular',
            limit: POOL
          }),
          /* No `scope` filter, unlike the two above: a whole box holding one
             hero and a hero published on its own are both "a single hero" to
             a reader, and pinning `scope` here is what made this slot only
             ever find the latter. */
          listPublicSets({ kind: 'heroes', heroes: 'single', sort: 'popular', limit: POOL })
        ]);
        const nextSlots: GallerySlots = {
          adventure: pickRandom(adventures, 1)[0] ?? null,
          heroes: pickRandom(heroBoxes, 1)[0] ?? null,
          singleHeroes: pickRandom(singleHeroes, 2)
        };
        gallerySlots = nextSlots;
        galleryFeature =
          pickRandom(
            [nextSlots.adventure, nextSlots.heroes, ...nextSlots.singleHeroes].filter(
              (set): set is GallerySet => set !== null
            ),
            1
          )[0] ?? null;
      } catch {
        // Same silent fallback as the attention effect above — a missing
        // sample is not worth an error message.
      }
    })();
  });

  /**
   * Every character in every local set, each carrying which set it came
   * from — flattened once here rather than read from `LibraryEntry.characters`
   * separately wherever it is needed, since every reader wants the parent
   * set's own id and name alongside it and would otherwise have to look the
   * owning entry back up to get them.
   */
  interface LibraryCharacterRow {
    id: CharacterId;
    name: string;
    role: CharacterRole;
    setId: SetId;
    setName: string;
  }

  const allCharacters = $derived.by(() => {
    const rows: LibraryCharacterRow[] = [];
    for (const entry of entries) {
      for (const character of entry.characters ?? []) {
        rows.push({
          id: character.id,
          name: character.name,
          role: character.role,
          setId: entry.id,
          setName: entry.name || 'Untitled Adventure'
        });
      }
    }
    return rows;
  });

  const filteredCharacters = $derived.by(() => {
    const term = search.trim().toLowerCase();
    return allCharacters.filter((character) => {
      if (role && character.role !== role) return false;
      if (!term) return true;
      return (
        character.name.toLowerCase().includes(term) ||
        character.setName.toLowerCase().includes(term)
      );
    });
  });

  function roleTint(value: CharacterRole): string {
    return `var(--role-${value}, var(--text-muted))`;
  }

  function initials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    return words
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('');
  }

  /** A stable colour per character or set, for a tile with no picture — same
      formula the gallery's own tiles use, so something reads the same shade
      whether found here or there. Doubles as the set-grid thumbnail swatch:
      `LibraryEntry` deliberately carries no picture of its own (see
      `storage/library.ts` — the index is kept light on purpose), so a
      generated tint is the set grid's only affordable "picture" today. */
  function tint(seed: string): string {
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash = (hash * 31 + seed.charCodeAt(index)) | 0;
    }
    return `hsl(${Math.abs(hash) % 360} 30% 26%)`;
  }

  /** The picture for a gallery-slot tile — same fallback `GalleryScreen`'s
      own `setImage` uses. */
  function galleryImage(set: GallerySet): string {
    return set.thumbnail_url || set.cover_url;
  }

  interface GalleryPick {
    label: string;
    set: GallerySet;
  }

  /** The three samples that did not receive the larger community spotlight. */
  const supportingGallery = $derived.by((): GalleryPick[] => {
    const picks: { label: string; set: GallerySet | null }[] = [
      { label: 'Adventure set', set: gallerySlots.adventure },
      { label: 'Heroes set', set: gallerySlots.heroes },
      { label: 'Single hero', set: gallerySlots.singleHeroes[0] ?? null },
      { label: 'Single hero', set: gallerySlots.singleHeroes[1] ?? null }
    ];
    return picks
      .filter((pick): pick is GalleryPick => pick.set !== null && pick.set.id !== galleryFeature?.id)
      .slice(0, 3);
  });

  function galleryKindLabel(set: GallerySet): string {
    if (set.kind === 'adventure') return 'Adventure set';
    return set.hero_count === 1 ? 'Single hero' : 'Heroes set';
  }

  /**
   * A slot tile's picture box is the printed card's own shape, and the two
   * constants below are what let a bleeding cover fill it *at trim*.
   *
   * Most of these pictures are a deck back, and a hero's replacement back is
   * supplied on the action card's full bleed canvas — so showing the file as
   * it stands shows 3.28mm of printer's margin all the way round, the part
   * that exists to be guillotined off. Scaling about the centre pushes that
   * margin outside the tile's own `overflow: hidden`, cropping it away
   * without resampling anything, and it works because the bleed is symmetric.
   * `TALL` rather than `WIDE` because the box is the card's *own* aspect, so
   * `object-fit: cover` fits by height — see `GalleryScreen`, which does the
   * same thing for the same reason and is where both numbers come from.
   */
  const CARD_ASPECT = `${CARD_FORMATS.action.mm.width} / ${CARD_FORMATS.action.mm.height}`;
  const TRIM_SCALE_TALL =
    CARD_FORMATS.action.bleed.height / trimBox(CARD_FORMATS.action).height;

  function flash(text: string): void {
    message = text;
    setTimeout(() => (message = null), 3000);
  }

  function formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Never';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  const migrationBytes = $derived(
    workshop.migrationCandidates.reduce((total, entry) => total + (entry.bytes ?? 0), 0)
  );

  function availabilityLabel(availability: LibraryAvailability): string {
    switch (availability) {
      case 'online':
        return 'Online';
      case 'pending':
        return 'Waiting to upload';
      case 'conflict':
        return 'Conflict';
      default:
        return 'On this device';
    }
  }

  async function openEntry(entry: DraftLibraryEntry): Promise<void> {
    if (!(await workshop.openSet(entry.id))) {
      flash(
        entry.cached
          ? 'Could not open this set.'
          : 'Connect to the internet to download this set on this device.'
      );
    }
  }

  async function importSet(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    const result = parseSetFile(await file.text());
    if (!result.ok) {
      flash(result.error);
      return;
    }
    if (await workshop.addSet(result.set)) flash(`Imported “${result.set.name}”.`);
    else flash(workshop.libraryActionError ?? 'Could not import that set.');
  }
</script>

{#snippet setCard(entry: DraftLibraryEntry)}
  <li class="card">
    <button
      type="button"
      class="open"
      onclick={() => void openEntry(entry)}
      onpointerenter={() => void peekCard(entry)}
      onfocusin={() => void peekCard(entry)}
    >
      <span class="thumb" style:background={tint(entry.id)} aria-hidden="true">
        {#if covers.get(entry.id)}
          <img src={covers.get(entry.id)} alt="" loading="lazy" />
        {/if}

        <!--
          A hero's character card, cross-faded over the cover on hover — same
          technique as the gallery's own character tiles (`GalleryScreen`),
          and the same reason: two pictures of the same set at the same size,
          so swapping them in place reads as turning it over rather than a
          popup appearing somewhere else.
        -->
        {#if cardPeeks.get(entry.id)}
          <img class="card-peek" src={cardPeeks.get(entry.id)} alt="" />
        {/if}
      </span>

      <span class="card-body">
        <span class="card-title-row">
          <span class="card-title">{entry.name || 'Untitled Adventure'}</span>
          <span class="pill availability" data-availability={entry.availability}>
            {availabilityLabel(entry.availability)}
          </span>
          {#if (attention.get(entry.id)?.waiting ?? 0) > 0}
            <span class="pill waiting">{attention.get(entry.id)?.waiting} pending</span>
          {/if}
        </span>
        {#if entry.subtitle}<span class="card-subtitle">{entry.subtitle}</span>{/if}

        <!--
          The same status `SetHome` shows once the set is open, from the same
          counts and the same three colours (`data-state`, matching its own
          blocked/rough/ready) — a status that reads as a plain grey label here
          and a coloured one once you open the set is the same fact told two
          different ways. Absent rather than "Complete" on an index row written
          before `blockers` existed: it has not backfilled yet, and a guess
          would be worse than saying nothing. The gap-count mini-badge rides
          beside it — same numbers, just broken out so "how many things need
          attention" doesn't require reading the pill's own sentence.
        -->
        {#if entry.blockers !== undefined && entry.gaps !== undefined && entry.issueCount !== undefined}
          <span class="health-row">
            <span
              class="health-status"
              data-state={healthStateOf(entry.blockers, entry.gaps)}
            >
              {healthSummaryFromCounts(entry.blockers, entry.gaps, entry.issueCount)}
            </span>
            {#if entry.gaps > 0}
              <span class="gap-badge">{entry.gaps} {entry.gaps === 1 ? 'gap' : 'gaps'}</span>
            {/if}
          </span>
        {/if}

        <!--
          A copy says so before it is opened. `originAuthor` is absent rather
          than empty on a set authored here, and empty on one copied from a
          published set whose author had no display name — so the badge
          distinguishes the two. The revision rides beside it for the same
          reason `SetHome`'s own lineage line carries one: it is what tells two
          forks of the same set apart on a shelf that otherwise shows the same
          name twice. The "now at" clause is the same out-of-sync fact
          `SetHome`'s own lineage line shows once a set is open — surfaced here
          so it does not take opening the set to notice.
        -->
        {#if entry.originAuthor !== undefined}
          <span class="lineage">
            {entry.originAuthor ? `Based on ${entry.originAuthor}’s set` : 'Based on a published set'}
            {#if entry.originRevision !== undefined}
              <span class="numeric">· revision {entry.originRevision}</span>
            {/if}
            {#if (attention.get(entry.id)?.behindBy ?? 0) > 0}
              <span class="behind">
                — the original is now
                {attention.get(entry.id)?.behindBy}
                {(attention.get(entry.id)?.behindBy ?? 0) === 1 ? 'revision' : 'revisions'} ahead
              </span>
            {/if}
          </span>
        {/if}

        <!-- One compact line rather than a stats row plus a meta row — the
             byte size still shows in the header's overall storage line, so
             it isn't repeated per card here. -->
        <span class="meta">
          <span class="numeric">{entry.characterCount}</span>
          {entry.characterCount === 1 ? 'character' : 'characters'} ·
          <span class="numeric">{entry.cardCount}</span> cards · {formatDate(entry.updatedAt)}
        </span>
      </span>
    </button>

    <!--
      Overlaid on the card's own top-right corner rather than a dedicated
      footer row — a duplicate/delete control on every one of a dozen cards
      does not need permanent floor space, only a way to reach it. Stays
      visible while a delete is armed (`confirmingDelete`), or the Cancel
      button would vanish the moment the pointer left the card.
    -->
    <div class="card-actions" class:armed={confirmingDelete === entry.id}>
      <button
        type="button"
        class="ghost"
        title="Duplicate"
        aria-label="Duplicate set"
        onclick={() => void workshop.duplicateSet(entry.id)}
      >
        <Icon name="copy" size={13} />
      </button>

      {#if confirmingDelete === entry.id}
        <button type="button" class="ghost danger" onclick={() => void workshop.removeSet(entry.id)}>
          Delete
        </button>
        <button type="button" class="ghost" onclick={() => (confirmingDelete = null)}>
          Cancel
        </button>
      {:else}
        <button
          type="button"
          class="ghost"
          title="Delete"
          aria-label="Delete set"
          onclick={() => (confirmingDelete = entry.id)}
        >
          <Icon name="trash" size={13} />
        </button>
      {/if}
    </div>
  </li>
{/snippet}

{#snippet deletedRow(entry: DraftLibraryEntry)}
  <li class="deleted-row">
    <div class="deleted-info">
      <span class="deleted-name">{entry.name || 'Untitled Adventure'}</span>
      <span class="deleted-meta">Deleted {formatDate(entry.deletedAt ?? entry.updatedAt)}</span>
    </div>
    <div class="deleted-actions">
      <button
        type="button"
        class="ghost"
        onclick={() => void workshop.restoreSet(entry.id)}
      >
        <Icon name="rotate" size={13} />
        Restore
      </button>

      {#if confirmingPurge === entry.id}
        <button
          type="button"
          class="ghost danger"
          onclick={() => void workshop.purgeSet(entry.id)}
        >
          Delete forever
        </button>
        <button type="button" class="ghost" onclick={() => (confirmingPurge = null)}>
          Cancel
        </button>
      {:else}
        <button
          type="button"
          class="ghost"
          title="Delete forever"
          aria-label="Delete forever"
          onclick={() => (confirmingPurge = entry.id)}
        >
          <Icon name="trash" size={13} />
        </button>
      {/if}
    </div>
  </li>
{/snippet}

<!--
  One slot in the gallery sample — a fixed category label plus whatever set
  (if any) `gallerySlots` picked for it. Reused for all eight renders (four
  full-size in the zero-state welcome panel, four condensed in the
  returning-author "Design your own adventure" card) — sizing comes from
  each context's own `.gallery-slots` CSS, not a prop, so this stays one
  snippet rather than growing a `compact` flag.
-->
{#snippet gallerySlot(label: string, set: GallerySet | null)}
  <li class="slot">
    {#if set}
      <button type="button" class="slot-tile" onclick={() => navigation.openShared(set.slug)}>
        <span
          class="slot-thumb"
          style:aspect-ratio={CARD_ASPECT}
          style:--trim-scale={TRIM_SCALE_TALL}
          style:background={tint(set.id)}
        >
          {#if galleryImage(set)}
            <!-- `cover_bleeds` governs the thumbnail as well as the cover:
                 both are the same artwork, and a plain downscale keeps the
                 bleed the same proportion of the frame. -->
            <img src={galleryImage(set)} class:trimmed={set.cover_bleeds} alt="" loading="lazy" />
          {:else}
            <span class="initials">{initials(set.name)}</span>
          {/if}
        </span>
        <span class="slot-label">{label}</span>
        <span class="slot-name">{set.name || 'Untitled Adventure'}</span>
        <span class="slot-author">by {set.author?.display_name || 'Anonymous'}</span>
      </button>
    {:else}
      <div class="slot-tile">
        <span class="slot-thumb slot-empty" style:aspect-ratio={CARD_ASPECT}>
          <span class="slot-empty-note">None published yet</span>
        </span>
        <span class="slot-label">{label}</span>
      </div>
    {/if}
  </li>
{/snippet}

<!-- A live gallery cover makes the value proposition visible before any copy is read. -->
{#snippet montageCard(set: GallerySet | null, label: string, position: string)}
  <span
    class="montage-card {position}"
    style:aspect-ratio={CARD_ASPECT}
    style:--trim-scale={TRIM_SCALE_TALL}
    style:background={set ? tint(set.id) : 'var(--surface-raised)'}
  >
    {#if set && galleryImage(set)}
      <img src={galleryImage(set)} class:trimmed={set.cover_bleeds} alt="" />
    {:else}
      <span class="montage-mark">{set ? initials(set.name) : '+'}</span>
    {/if}
    <span class="montage-label">{label}</span>
  </span>
{/snippet}

<div class="library scroll-y">
  <header class="head">
    <div class="context-title">
      <span class="context-eyebrow">{welcomeMode ? 'Unmatched Labs' : 'Workshop'}</span>
      <h1>{welcomeMode ? 'Welcome' : 'Your sets'}</h1>
    </div>

    <div class="actions">
      <input
        bind:this={fileInput}
        class="sr-only"
        type="file"
        accept=".json,application/json"
        onchange={importSet}
      />
      <Button variant="ghost" onclick={() => fileInput?.click()}>
        <Icon name="upload" size={14} />
        Import
      </Button>
      <Button variant="primary" onclick={() => (choosingKind = true)}>
        <Icon name="plus" size={14} />
        New set
      </Button>
    </div>
  </header>

  {#if message}
    <p class="message">{message}</p>
  {/if}

  {#if workshop.libraryLoading}
    <div class="library-notice" data-tone="neutral" role="status">
      <Icon name="hourglass" size={15} />
      <span>Refreshing your library…</span>
    </div>
  {/if}

  {#if workshop.libraryError}
    <div class="library-notice" data-tone="warning" role="alert">
      <Icon name="rotate" size={15} />
      <span>
        Could not reach your online library. These are the copies available on this device.
        <button type="button" onclick={() => void workshop.refreshLibrary()}>Try again</button>
      </span>
    </div>
  {/if}

  {#if workshop.libraryActionError}
    <div class="library-notice" data-tone="warning" role="alert">
      <Icon name="hourglass" size={15} />
      <span>{workshop.libraryActionError}</span>
    </div>
  {/if}

  {#if !auth.signedIn}
    <div class="library-notice" data-tone="local">
      <Icon name="save" size={15} />
      <span>
        Sets are saved only on this device while signed out. Sign in to publish;
        {draftRollout.mode === 'off'
          ? 'private cloud drafts are not enabled in this build.'
          : 'private cloud drafts are still a limited preview.'}
      </span>
    </div>
  {:else if auth.isAnonymous}
    <div class="library-notice" data-tone="local">
      <Icon name="save" size={15} />
      <span>
        This anonymous sharing session belongs to this browser. Drafts remain device-only, and an
        ownership-preserving account upgrade is not available yet.
      </span>
    </div>
  {:else if !draftRollout.enabled}
    <div class="library-notice" data-tone="local">
      <Icon name="save" size={15} />
      <span>
        {draftRollout.canOptIn
          ? 'Cloud drafts are off on this browser. Turn on the preview from Account when you are ready; until then, this library uses device copies.'
          : 'This account is outside the private cloud-draft preview. Sets continue to use device storage, and publishing remains available.'}
      </span>
    </div>
  {/if}

  {#if
    auth.signedIn &&
    !auth.isAnonymous &&
    workshop.libraryAuthority === 'cloud' &&
    workshop.migrationCandidates.length > 0 &&
    !workshop.migrationDismissed
  }
    <section class="migration" aria-labelledby="migration-title">
      <div class="migration-copy">
        <span class="migration-icon"><Icon name="upload" size={18} /></span>
        <div>
          <h2 id="migration-title">Move your sets online</h2>
          <p>
            {workshop.migrationCandidates.length}
            {workshop.migrationCandidates.length === 1 ? 'set is' : 'sets are'} saved only on this
            device ({formatSize(migrationBytes)}). Each set is copied safely; its local copy stays
            here.
          </p>
          {#if workshop.migrationRunning}
            <p class="migration-progress" role="status">
              Uploading {Math.min(workshop.migrationDone + 1, workshop.migrationTotal)} of
              {workshop.migrationTotal}…
            </p>
          {/if}
        </div>
      </div>

      <div class="migration-actions">
        <Button
          variant="primary"
          size="sm"
          disabled={workshop.migrationRunning}
          onclick={() => void workshop.migrateAll()}
        >
          {workshop.migrationRunning ? 'Uploading…' : 'Upload all'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={workshop.migrationRunning}
          onclick={() => workshop.dismissMigration()}
        >Not now</Button>
      </div>

      <ul class="migration-list">
        {#each workshop.migrationCandidates as entry (entry.id)}
          {@const status = workshop.migrationStatus.get(entry.id)}
          <li>
            <span>
              <strong>{entry.name || 'Untitled Adventure'}</strong>
              <small>
                {entry.bytes === null ? 'Size unavailable' : formatSize(entry.bytes)}
                {#if status?.message} · {status.message}{/if}
              </small>
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={workshop.migrationRunning || status?.kind === 'uploading'}
              onclick={() => void workshop.migrateSet(entry.id)}
            >
              {status?.kind === 'uploading' ? 'Uploading…' : status?.kind === 'error' ? 'Retry' : 'Upload'}
            </Button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if entries.length > 0 && !welcome}
    <div class="top-row">
      <div class="top-main">
        <div class="stat-row">
          <div class="stat-card donut-card">
            <span class="stat-card-label">Library health <span class="numeric">· {libraryStats.sets} sets</span></span>
            <div class="donut-row">
              <svg width="54" height="54" viewBox="0 0 36 36" aria-hidden="true">
                <circle cx="18" cy="18" r={DONUT_R} fill="none" stroke="var(--border-default)" stroke-width="4" />
                {#each donutSegments as segment (segment.state)}
                  <circle
                    cx="18"
                    cy="18"
                    r={DONUT_R}
                    fill="none"
                    stroke={segment.color}
                    stroke-width="4"
                    stroke-dasharray={segment.dash}
                    stroke-dashoffset={segment.offset}
                    transform="rotate(-90 18 18)"
                  />
                {/each}
              </svg>
              <ul class="donut-legend">
                <li><span class="dot" style:background="var(--success)"></span>{libraryHealth.ready} ready</li>
                <li><span class="dot" style:background="var(--warning)"></span>{libraryHealth.rough} rough</li>
                <li><span class="dot" style:background="var(--danger)"></span>{libraryHealth.blocked} blocked</li>
              </ul>
            </div>
          </div>
          <div class="stat-card">
            <span class="stat-card-label">Characters</span>
            <span class="stat-card-value numeric">{libraryStats.characters}</span>
          </div>
          <div class="stat-card" class:has-issue={libraryStats.blocked > 0}>
            <span class="stat-card-label">Have blockers</span>
            <span class="stat-card-value numeric">{libraryStats.blocked}</span>
          </div>
        </div>

        {#if lastOpened}
          {@const set = lastOpened}
          {@const slug = publishedSlugByLocalId?.get(set.id) ?? null}
          <div class="continue-card">
            <span class="continue-header">
              <span class="continue-thumb" style:background={tint(set.id)} aria-hidden="true"></span>
              <span class="continue-body">
                <span class="continue-label">Continue where you left off</span>
                <span class="continue-name">{set.name || 'Untitled Adventure'}</span>
                {#if set.blockers !== undefined && set.gaps !== undefined && set.issueCount !== undefined}
                  <span class="health-status" data-state={healthStateOf(set.blockers, set.gaps)}>
                    {healthSummaryFromCounts(set.blockers, set.gaps, set.issueCount)}
                  </span>
                {/if}
              </span>
            </span>

            <span class="continue-meta">
              <span class="numeric">{set.characterCount}</span>
              {set.characterCount === 1 ? 'character' : 'characters'} ·
              <span class="numeric">{set.cardCount}</span> cards · edited {formatDate(set.updatedAt)}
            </span>

            <span class="continue-actions">
              {#if slug}
                <Button variant="ghost" size="sm" onclick={() => navigation.openShared(slug)}>
                  View gallery listing
                </Button>
              {/if}
              <Button variant="primary" size="sm" onclick={() => void workshop.openSet(set.id)}>
                Continue editing
                <Icon name="chevronRight" size={14} />
              </Button>
            </span>
          </div>
        {/if}
      </div>

      <!--
        The same "Design your own Unmatched adventure" pitch the zero-state
        panel opens with, condensed to fit a third of the row rather than
        dropped for a returning author — it was previously shown once, on the
        very first visit, and never again. Steps lose their description text
        here (one line each, not a paragraph) and the gallery slots shrink to
        match; both panels read from the same `gallerySlots` fetch, so this
        costs no extra request.
      -->
      <div class="about-card">
        <h2 class="about-title">Design your own Unmatched adventure</h2>
        <!-- Two, two, then one — the fifth spans both columns rather than
             sitting in a half-empty third row. -->
        <ol class="about-steps">
          <li class="about-step"><span class="step-index numeric">1</span> Start a set</li>
          <li class="about-step"><span class="step-index numeric">2</span> Add your characters</li>
          <li class="about-step"><span class="step-index numeric">3</span> Design the cards</li>
          <li class="about-step"><span class="step-index numeric">4</span> Design the components</li>
          <li class="about-step wide">
            <span class="step-index numeric">5</span> Publish your set
          </li>
        </ol>

        {#if cloudEnabled()}
          <h3 class="about-gallery-title">
            Looking for inspiration? Here are a few sets from the gallery
          </h3>
          <ul class="gallery-slots">
            {@render gallerySlot('Adventures set', gallerySlots.adventure)}
            {@render gallerySlot('Heroes set', gallerySlots.heroes)}
            {@render gallerySlot('Single hero', gallerySlots.singleHeroes[0] ?? null)}
            {@render gallerySlot('Single hero', gallerySlots.singleHeroes[1] ?? null)}
          </ul>
          <!-- "more", because four examples are sitting right above it. -->
          <Button variant="ghost" size="sm" onclick={() => navigation.openGallery()}>
            Browse the gallery for more examples
          </Button>
        {/if}
      </div>

      <!--
        Whatever is in `guides/content.ts`, in the order it is written there.
        No list of its own: a guide that exists is a guide that is offered,
        so adding one is editing that file and nothing else.

        The card opens the guide at step 1 — `guides.open` always starts from
        the top; see `state/guides.svelte.ts` for why resuming would be worse.
      -->
      <div class="guides">
        <h2 class="about-title">Guides</h2>
        {#if GUIDES.length === 0}
          <p class="guides-empty">More walkthroughs are on the way.</p>
        {:else}
          <ul class="guides-list">
            {#each GUIDES as guide (guide.id)}
              <li>
                <button type="button" class="guides-row" onclick={() => guides.open(guide.id)}>
                  <Icon name={guide.icon} size={14} />
                  <span class="guides-text">
                    <span class="guides-title">{guide.title}</span>
                    <span class="guides-summary">{guide.summary}</span>
                  </span>
                  <span class="guides-steps numeric">{guide.steps.length} steps</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}

  {#if waitingSets.length > 0 || behindSets.length > 0}
    <div class="attention">
      {#if waitingSets.length > 0}
        {@const total = waitingSets.reduce((sum, row) => sum + row.count, 0)}
        <div class="attention-card waiting">
          <Icon name="hourglass" size={15} />
          <div class="attention-body">
            <span class="attention-title">
              {total} {total === 1 ? 'contribution' : 'contributions'} waiting
            </span>
            <span class="attention-detail">
              {#each waitingSets as row, index (row.id)}
                {#if index > 0}<span aria-hidden="true"> · </span>{/if}
                <button
                  type="button"
                  class="attention-link"
                  onclick={() => void workshop.openSetPage(row.id, 'contributions')}
                >
                  {row.name} ({row.count})
                </button>
              {/each}
            </span>
          </div>
        </div>
      {/if}

      {#if behindSets.length > 0}
        <div class="attention-card behind">
          <Icon name="rotate" size={15} />
          <div class="attention-body">
            <span class="attention-title">
              {behindSets.length} {behindSets.length === 1 ? 'set is' : 'sets are'} out of sync
            </span>
            <span class="attention-detail">
              {#each behindSets as row, index (row.id)}
                {#if index > 0}<span aria-hidden="true"> · </span>{/if}
                <button
                  type="button"
                  class="attention-link"
                  onclick={() => void workshop.openSetPage(row.id, 'home')}
                >
                  {row.name}
                </button>
              {/each}
            </span>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#if entries.length > 0 && !welcome}
    <div class="controls">
      <SegmentedControl bind:value={mode} segments={MODES} label="Browse" />

      <input
        class="search"
        type="search"
        placeholder={mode === 'sets' ? 'Search your sets…' : 'Search your characters…'}
        bind:value={search}
        aria-label="Search your library"
      />

      {#if mode === 'characters'}
        <label class="filter">
          <span class="field-label">Role</span>
          <Select bind:value={role} options={ROLES} />
        </label>
      {/if}
    </div>
  {/if}

  <div class="body">
    {#if welcomeMode}
      <div class="first-run">
        <main class="welcome-main">
          <section class="welcome">
            <div class="welcome-copy">
              <span class="welcome-kicker">Build it. Play it. Share it.</span>
              <h2 class="welcome-title">Design your own Unmatched adventure</h2>
              <p class="welcome-lede">
                Create heroes, villains, decks, maps, and every component your set needs — with a
                live preview from the first idea through print or Tabletop Simulator.
              </p>
              <div class="welcome-ctas">
                <Button variant="primary" onclick={() => startSet('adventure')}>
                  <Icon name="plus" size={14} />
                  Create an Adventure
                </Button>
                <Button variant="ghost" onclick={() => startSet('heroes')}>Create Heroes</Button>
                <button type="button" class="welcome-import" onclick={() => fileInput?.click()}>
                  Import a set
                </button>
              </div>
              <ul class="welcome-promises" aria-label="How Unmatched Labs works">
                <li>Works offline</li>
                <li>Private cloud drafts with sign-in</li>
                <li>Print and TTS exports</li>
              </ul>
            </div>

            <div class="welcome-montage" aria-hidden="true">
              {@render montageCard(gallerySlots.heroes, 'Heroes', 'left')}
              {@render montageCard(gallerySlots.adventure, 'Adventures', 'centre')}
              {@render montageCard(gallerySlots.singleHeroes[0] ?? null, 'Cards', 'right')}
            </div>
          </section>

          <section class="capabilities">
            <header class="capabilities-head">
              <div>
                <span class="capabilities-kicker">Cards, boards, and components</span>
                <h2 class="capabilities-title">Build the whole set</h2>
              </div>
              <p>
                Cards are one part of an Unmatched project. Keep the board, tracks, pieces, and
                collaborative history in the same set.
              </p>
            </header>

            <div class="capability-grid">
              <article class="capability-card major">
                <div class="capability-visual editor-visual">
                  <img
                    src="/assets/guides/custom-symbols/04-bonus.webp"
                    alt="The card editor beside its live card preview"
                    loading="lazy"
                  />
                </div>
                <div class="capability-copy">
                  <h3>Card editor</h3>
                  <p>
                    Design action, initiative, rules, and event cards with live previews, layered
                    styling, split effects, and custom symbols.
                  </p>
                </div>
              </article>

              <article class="capability-card major">
                <div class="capability-visual map-image-visual">
                  <img
                    src="/assets/home/lucy-piper-map.png"
                    alt="A finished custom map showing zones, textured spaces, one-way paths, a large fighter marker, a secret passage, and layered environment artwork"
                    loading="lazy"
                  />
                </div>
                <div class="capability-copy">
                  <h3>Map builder</h3>
                  <p>
                    Arrange spaces, paths, zones, secret passages, labels, and environment artwork
                    on a board of any supported size.
                  </p>
                </div>
              </article>

              <article class="capability-card compact">
                <div class="capability-visual component-visual">
                  <img
                    src="/assets/guides/how-components-work/05-dial.webp"
                    alt="A health dial being prepared in the component builder"
                    loading="lazy"
                  />
                </div>
                <div class="capability-copy">
                  <h3>Health dials</h3>
                  <p>Set each character’s health range and prepare one- or two-sided dial artwork.</p>
                </div>
              </article>

              <article class="capability-card compact">
                <div class="capability-visual threat-visual">
                  <img
                    src="/assets/templates/adventure_threat_track_template.png"
                    alt="An Unmatched Adventures threat-track template"
                    loading="lazy"
                  />
                </div>
                <div class="capability-copy">
                  <h3>Threat tracks</h3>
                  <p>Build the complete track with styled slots, notes, artwork, and end conditions.</p>
                </div>
              </article>

              <article class="capability-card compact">
                <div class="capability-visual component-visual token-visual">
                  <img
                    src="/assets/home/custom-shaped-token.png"
                    alt="A custom-shaped token model prepared for export"
                    loading="lazy"
                  />
                </div>
                <div class="capability-copy">
                  <h3>Tokens and figures</h3>
                  <p>Create custom token shapes or bring in model files for figures and game pieces.</p>
                </div>
              </article>

              <article class="capability-card collaboration-card">
                <div class="capability-copy">
                  <span class="collaboration-label">Collaboration</span>
                  <h3>Build on each other’s work</h3>
                  <p>
                    Publish a set, make a copy, propose individual changes, and keep its origin and
                    creator credits attached.
                  </p>
                </div>
                <div class="capability-visual collaboration-visual">
                  <img
                    src="/assets/guides/collaborate-on-a-project/03-offer.webp"
                    alt="A contribution being prepared and offered back to the original set"
                    loading="lazy"
                  />
                </div>
              </article>
            </div>
          </section>

          <section class="principles">
            <header class="principles-head">
              <div>
                <span class="principles-kicker">A few deliberate choices</span>
                <h2 class="principles-title">What sets this tool apart</h2>
              </div>
              <p>
                Unmatched Labs is organised around the practical needs of finishing and sharing a
                complete fan-made set, not around a collection of disconnected generators.
              </p>
            </header>

            <div class="principle-grid">
              <article class="principle">
                <span class="principle-index numeric">01</span>
                <div>
                  <h3>All components in one place</h3>
                  <p>
                    Cards, decks, maps, threat tracks, dials, tokens, figures, and export settings
                    remain part of the same project.
                  </p>
                </div>
              </article>
              <article class="principle">
                <span class="principle-index numeric">02</span>
                <div>
                  <h3>A comprehensive card editor</h3>
                  <p>
                    Build action, initiative, rules, event, and character cards with layered styles,
                    custom symbols, and print-faithful live previews.
                  </p>
                </div>
              </article>
              <article class="principle">
                <span class="principle-index numeric">03</span>
                <div>
                  <h3>Built-in collaboration</h3>
                  <p>
                    Fork a published set, offer specific changes back, and keep its origin and creator
                    credits attached throughout the process.
                  </p>
                </div>
              </article>
              <article class="principle">
                <span class="principle-index numeric">04</span>
                <div>
                  <h3>Private by default</h3>
                  <p>
                    Author locally without an account, or sign in to keep private drafts available
                    across browsers. Publishing remains a separate choice.
                  </p>
                </div>
              </article>
              <article class="principle wide">
                <span class="principle-index numeric">05</span>
                <div>
                  <h3>The preview is the export</h3>
                  <p>
                    The same renderer used while editing produces card images and print output, so
                    there is no second approximation to discover at the end.
                  </p>
                </div>
              </article>
            </div>
          </section>

          {#if cloudEnabled()}
            <section class="community">
              <header class="community-head">
                <div>
                  <span class="community-kicker">Made by the community</span>
                  <h2 class="community-title">Community spotlight</h2>
                </div>
                <p>Discover the creators building new worlds for Unmatched.</p>
              </header>

              {#if galleryFeature}
                {@const featured = galleryFeature}
                <article class="spotlight">
                  <button
                    type="button"
                    class="spotlight-art"
                    style:aspect-ratio={CARD_ASPECT}
                    style:--trim-scale={TRIM_SCALE_TALL}
                    style:background={tint(featured.id)}
                    onclick={() => navigation.openShared(featured.slug)}
                    aria-label="View {featured.name || 'Untitled Adventure'}"
                  >
                    {#if galleryImage(featured)}
                      <img
                        src={galleryImage(featured)}
                        class:trimmed={featured.cover_bleeds}
                        alt=""
                      />
                    {:else}
                      <span class="spotlight-initials">{initials(featured.name)}</span>
                    {/if}
                  </button>

                  <div class="spotlight-body">
                    <span class="spotlight-kind">{galleryKindLabel(featured)}</span>
                    <button
                      type="button"
                      class="spotlight-name"
                      onclick={() => navigation.openShared(featured.slug)}
                    >
                      {featured.name || 'Untitled Adventure'}
                    </button>
                    {#if featured.subtitle}
                      <p class="spotlight-subtitle">{featured.subtitle}</p>
                    {/if}

                    <button
                      type="button"
                      class="spotlight-creator"
                      onclick={() => navigation.openAuthor(featured.owner_id)}
                    >
                      <span class="creator-avatar" style:background={tint(featured.owner_id)}>
                        {#if featured.author?.avatar_url}
                          <img src={featured.author.avatar_url} alt="" loading="lazy" />
                        {:else}
                          {initials(featured.author?.display_name || 'Anonymous')}
                        {/if}
                      </span>
                      <span class="creator-copy">
                        <span>Created by</span>
                        <strong>{featured.author?.display_name || 'Anonymous'}</strong>
                      </span>
                      <span class="creator-profile">View creator profile</span>
                    </button>

                    <p class="spotlight-stats numeric">
                      {featured.card_count} cards · {featured.character_count}
                      {featured.character_count === 1 ? ' character' : ' characters'}
                      {#if featured.view_count > 0} · {featured.view_count} views{/if}
                    </p>
                    {#if featured.origin}
                      <p class="spotlight-lineage">
                        Based on {featured.origin.name}{#if featured.origin.author?.display_name}
                          by {featured.origin.author.display_name}{/if}
                      </p>
                    {/if}

                    <div class="spotlight-actions">
                      <Button variant="primary" onclick={() => navigation.openShared(featured.slug)}>
                        Explore this set
                      </Button>
                      <Button variant="ghost" onclick={() => navigation.openAuthor(featured.owner_id)}>
                        More by this creator
                      </Button>
                    </div>
                  </div>
                </article>

                {#if supportingGallery.length > 0}
                  <div class="more-gallery-head">
                    <h3>More from the gallery</h3>
                    <button type="button" onclick={() => navigation.openGallery()}>Browse all sets</button>
                  </div>
                  <ul class="gallery-slots welcome-gallery-slots">
                    {#each supportingGallery as pick (pick.set.id)}
                      {@render gallerySlot(pick.label, pick.set)}
                    {/each}
                  </ul>
                {/if}
              {:else}
                <div class="spotlight-empty">
                  <span>Community creations will appear here when the gallery is available.</span>
                  <Button variant="ghost" onclick={() => navigation.openGallery()}>Browse the gallery</Button>
                </div>
              {/if}
            </section>
          {/if}
        </main>

        <aside class="welcome-journey">
          <span class="journey-kicker">From idea to table</span>
          <h2 class="journey-title">How it works</h2>
          <ol class="welcome-steps">
            <li class="welcome-step">
              <span class="step-index numeric">1</span>
              <div class="step-body">
                <span class="step-title">Start a set</span>
                <p class="step-text">
                  Choose a full Adventure or a Heroes set focused on characters and their decks.
                </p>
              </div>
            </li>
            <li class="welcome-step">
              <span class="step-index numeric">2</span>
              <div class="step-body">
                <span class="step-title">Add your characters</span>
                <p class="step-text">Give every hero, villain, and minion an identity, stats, and decks.</p>
              </div>
            </li>
            <li class="welcome-step">
              <span class="step-index numeric">3</span>
              <div class="step-body">
                <span class="step-title">Design the cards</span>
                <p class="step-text">Set the shared look once, then customise any character or card.</p>
              </div>
            </li>
            <li class="welcome-step">
              <span class="step-index numeric">4</span>
              <div class="step-body">
                <span class="step-title">Build the components</span>
                <p class="step-text">Create figures, tokens, health dials, the threat track, and your map.</p>
              </div>
            </li>
            <li class="welcome-step wide">
              <span class="step-index numeric">5</span>
              <div class="step-body">
                <span class="step-title">Publish your set</span>
                <p class="step-text">Print it, play online, share a link, or join the community gallery.</p>
              </div>
            </li>
          </ol>
          <div class="journey-foot">
            <span>
              {auth.signedIn && !auth.isAnonymous
                ? 'Private drafts save online and remain cached on this device.'
                : 'Without a permanent sign-in, drafts stay on this device.'}
            </span>
            <Button variant="primary" onclick={() => (choosingKind = true)}>
              {entries.length > 0 ? 'Create another set' : 'Create your first set'}
            </Button>
          </div>
        </aside>
      </div>
    {:else if mode === 'sets' && filteredSets.length === 0}
      <p class="message">Nothing matches “{search.trim()}”.</p>
    {:else if mode === 'characters' && filteredCharacters.length === 0}
      <p class="message">
        {search.trim() || role
          ? `Nothing matches “${search.trim()}”.`
          : 'No characters in any set yet.'}
      </p>
    {:else if mode === 'sets'}
      {#if groupedSets}
        {#if groupedSets.published.length > 0}
          <h2 class="section-title">Published <span class="numeric">· {groupedSets.published.length}</span></h2>
          <ul class="grid">
            {#each groupedSets.published as entry (entry.id)}
              {@render setCard(entry)}
            {/each}
          </ul>
        {/if}
        {#if groupedSets.unpublished.length > 0}
          <h2 class="section-title">Unpublished <span class="numeric">· {groupedSets.unpublished.length}</span></h2>
          <ul class="grid">
            {#each groupedSets.unpublished as entry (entry.id)}
              {@render setCard(entry)}
            {/each}
          </ul>
        {/if}
      {:else}
        <ul class="grid">
          {#each filteredSets as entry (entry.id)}
            {@render setCard(entry)}
          {/each}
        </ul>
      {/if}
    {:else}
      <ul class="grid characters">
        {#each filteredCharacters as character (character.setId + character.id)}
          <li class="card character">
            <button
              type="button"
              class="open"
              onclick={() => void workshop.openCharacter(character.setId, character.id)}
            >
              <span class="avatar" style:background={tint(character.id)}>
                {initials(character.name)}
              </span>

              <span class="character-body">
                <span class="name-row">
                  <span class="card-title character-title">{character.name}</span>
                  <span class="role-badge" style:--role-tint={roleTint(character.role)}>
                    {CHARACTER_ROLE_META[character.role].label}
                  </span>
                </span>
                <span class="card-subtitle">In {character.setName}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if !welcome && deletedEntries.length > 0}
      <div class="deleted-section">
        <button type="button" class="deleted-toggle" onclick={() => (showDeleted = !showDeleted)}>
          <Icon name={showDeleted ? 'chevronDown' : 'chevronRight'} size={13} />
          Recently deleted <span class="numeric">· {deletedEntries.length}</span>
        </button>
        {#if showDeleted}
          <ul class="deleted-list">
            {#each deletedEntries as entry (entry.id)}
              {@render deletedRow(entry)}
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>

  <p class="disclaimer">
    Unmatched Labs is a fan-made tool, not affiliated with Restoration Games.
  </p>
  <p class="support-note">
    Enjoying Unmatched Labs? You can leave a one-time tip to help support its continued development.
    <a href="https://ko-fi.com/tombadilbombadil" target="_blank" rel="noreferrer">Visit Ko-fi</a>
  </p>
</div>

<NewSetDialog
  open={choosingKind}
  onchoose={startSet}
  oncancel={() => (choosingKind = false)}
/>

<style>
  /*
   * The whole page scrolls as one region — `.scroll-y` lives here, not on
   * `.body` below. It used to sit only on `.body`, which left the header,
   * the top row and the attention strip pinned above an independently
   * scrolling lower half; growing the top row to three columns of real
   * content made that split read as broken rather than intentional.
   */
  .library {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--surface-canvas);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-5);
    padding: var(--space-5) var(--space-9);
    border-bottom: 1px solid var(--border-subtle);
  }

  .context-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .context-title h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }

  .context-eyebrow {
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
  }

  .message {
    padding: var(--space-2) var(--space-9);
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    background: var(--surface-sunken);
  }

  .library-notice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-3) var(--space-9) 0;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .library-notice[data-tone='warning'] {
    border-color: color-mix(in oklab, var(--warning) 45%, var(--border-subtle));
    color: var(--warning);
  }

  .library-notice[data-tone='local'] {
    background: color-mix(in oklab, var(--accent) 7%, var(--surface-raised));
  }

  .library-notice button {
    margin-left: var(--space-2);
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .migration {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-4);
    margin: var(--space-4) var(--space-9) 0;
    padding: var(--space-5);
    border: 1px solid color-mix(in oklab, var(--accent) 45%, var(--border-subtle));
    border-radius: var(--radius-lg);
    background: color-mix(in oklab, var(--accent) 8%, var(--surface-raised));
  }

  .migration-copy {
    display: flex;
    gap: var(--space-3);
    min-width: 0;
  }

  .migration-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--accent) 16%, transparent);
    color: var(--accent);
  }

  .migration h2,
  .migration p {
    margin: 0;
  }

  .migration h2 {
    font-family: var(--font-display);
    font-size: var(--text-md);
    color: var(--text-primary);
  }

  .migration p {
    margin-top: var(--space-1);
    max-width: 72ch;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--text-tertiary);
  }

  .migration .migration-progress {
    color: var(--accent);
  }

  .migration-actions {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .migration-list {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-2);
  }

  .migration-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-base);
  }

  .migration-list li > span {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .migration-list strong,
  .migration-list small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .migration-list strong {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .migration-list small {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .controls {
    display: flex;
    align-items: flex-end;
    gap: var(--space-4);
    flex-wrap: wrap;
    padding: var(--space-5) var(--space-9) 0;
  }

  /* Horizontal padding lives on `.top-row` now, not here — this sits inside
     `.top-main`, which shares that padding with the "Design your own
     adventure" card beside it rather than each spacing itself. */
  /*
   * Two columns, not three — the left column of `.top-row` is now a third
   * of the page rather than two thirds, so three stat cards across no
   * longer fit. The donut spans both (`.donut-card`) on its own row instead
   * of squeezing beside the other two.
   */
  .stat-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  .donut-card {
    grid-column: 1 / -1;
  }

  .stat-card {
    padding: var(--space-4);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
  }

  .stat-card.has-issue {
    border-color: color-mix(in oklab, var(--warning) 45%, transparent);
  }

  .stat-card-label {
    display: block;
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin-bottom: var(--space-1);
  }

  .stat-card-value {
    display: block;
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .stat-card.has-issue .stat-card-value {
    color: var(--warning);
  }

  .donut-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .donut-legend {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: var(--space-1);
    border-radius: var(--radius-xs);
  }

  /*
   * A vertical stack, not the one-row thumb/body/actions layout this had
   * when it spanned two thirds of the page — at a third, "View gallery
   * listing" and "Continue editing" side by side would either wrap badly or
   * force the card wider than its column.
   */
  .continue-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
  }

  .continue-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .continue-thumb {
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-md);
  }

  .continue-body {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    min-width: 0;
  }

  .continue-meta {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  /* Flex column's default `align-items: stretch` is what gives these
     buttons the card's full width — no dedicated "full width" prop needed. */
  .continue-actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .continue-label {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .continue-name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-display);
    font-size: var(--text-md);
  }

  /* Three equal columns — health/continue, the adventure pitch, Guides. */
  .top-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: start;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-9) 0;
  }

  .top-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .about-card,
  .guides {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    box-shadow: inset 0 1px 0 var(--edge-highlight);
  }

  .about-title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }

  /* Staggered two-up: 1 & 2, then 3 & 4, then 5 across the full width. Five
     in a single column made this card far taller than the two beside it. */
  .about-steps {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
    list-style: none;
  }

  .about-step {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .about-step.wide {
    grid-column: 1 / -1;
  }

  .about-gallery-title {
    margin: 0;
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    color: var(--text-tertiary);
  }

  /*
   * The slot grid is shared between the returning-author `.about-card` and the
   * three smaller recommendations beneath the zero-state spotlight. The same
   * set and creator therefore read consistently in both contexts.
   *
   * Fixed 110px columns, not `1fr`: these are a glance at four sets, not a
   * gallery, and stretching them to fill their container made each one wider
   * than a card tile on the Overview page. 110px is that page's own smallest
   * zoom (`AssetsOverview`'s `--tile` at `ZOOM.min`), so "small" here means
   * the same size "small" already means elsewhere in the app.
   */
  /*
   * All four on one row. `minmax(0, 110px)` rather than a flat `110px`: 110
   * is the ceiling, and the columns give way below it when the panel is
   * narrower than 4 × 110 + gaps — which the middle column of `.top-row` is
   * at ordinary window widths. One row that tightens is better than a 2×2
   * that doubles the height of a card-shaped tile, and `aspect-ratio` keeps
   * the shape right at whatever width the column settles on.
   */
  .gallery-slots {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 110px));
    gap: var(--space-2);
    list-style: none;
  }

  .slot-tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    text-align: left;
  }

  /* The printed card's own shape — `aspect-ratio` is set inline from
     `CARD_ASPECT` so the mm figures stay the single source. `overflow` is
     what crops a bleeding cover back to trim; see `.slot-thumb img.trimmed`. */
  .slot-thumb {
    display: grid;
    place-items: center;
    width: 100%;
    border-radius: var(--radius-sm);
    overflow: hidden;
    outline: 1px solid transparent;
    outline-offset: -1px;
    transition: outline-color var(--duration-fast) var(--ease-out);
  }

  /* Pushes the printer's margin outside the box above. Nothing is resampled;
     the only number is `--trim-scale`, which comes from `trimBox`. */
  .slot-thumb img.trimmed {
    transform: scale(var(--trim-scale));
  }

  .slot-tile:hover .slot-thumb {
    outline-color: var(--border-strong);
  }

  .slot-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .slot-label {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  .slot-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .slot-author {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    opacity: 0.8;
  }

  /* A category with nothing published yet still holds its place in the
     grid, at the same footprint a real tile would take. */
  /* Holds a real tile's footprint exactly — same box, same aspect — so an
     empty category keeps its place in the row instead of collapsing it. */
  .slot-empty {
    padding: var(--space-2);
    border: 1px dashed var(--border-subtle);
    text-align: center;
  }

  .slot-empty-note {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    opacity: 0.75;
  }

  .welcome-gallery-slots {
    grid-template-columns: repeat(3, minmax(110px, 150px));
    gap: var(--space-4);
  }

  .welcome-gallery-slots .slot-name {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-primary);
  }

  .welcome-gallery-slots .slot-author {
    color: var(--text-secondary);
  }

  .health-status {
    align-self: flex-start;
    padding: 2px var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid var(--border-default);
    font-size: var(--text-2xs);
  }

  .health-status[data-state='blocked'] {
    color: var(--danger);
    border-color: color-mix(in oklab, var(--danger) 40%, transparent);
  }

  .health-status[data-state='rough'] {
    color: var(--warning);
    border-color: color-mix(in oklab, var(--warning) 40%, transparent);
  }

  .health-status[data-state='ready'] {
    color: var(--success);
    border-color: color-mix(in oklab, var(--success) 40%, transparent);
  }

  .health-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .gap-badge {
    padding: 2px var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid color-mix(in oklab, var(--warning) 40%, transparent);
    color: var(--warning);
    font-size: var(--text-2xs);
  }

  .attention {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-9) 0;
  }

  .attention-card {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius-sm);
  }

  /* Amber for something waiting on you, gold for something behind — the same
     "question, not a fault" tone `SharePanel`'s own `.caution` uses. */
  .attention-card.waiting {
    border: 1px solid color-mix(in oklab, var(--warning) 45%, transparent);
    background: color-mix(in oklab, var(--warning) 7%, transparent);
    color: var(--warning);
  }

  .attention-card.behind {
    border: 1px solid color-mix(in oklab, var(--accent) 45%, transparent);
    background: color-mix(in oklab, var(--accent) 7%, transparent);
    color: var(--text-accent);
  }

  .attention-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .attention-title {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }

  .attention-detail {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .attention-link {
    color: inherit;
    text-decoration: underline;
    text-decoration-color: transparent;
    cursor: pointer;
    transition: text-decoration-color var(--duration-fast) var(--ease-out);
  }

  .attention-link:hover {
    text-decoration-color: currentcolor;
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
    min-width: 140px;
  }

  .field-label {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .body {
    padding: var(--space-7) var(--space-9) var(--space-10);
  }

  .section-title {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-secondary);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--space-4);
    margin-bottom: var(--space-6);
  }

  .grid:last-child {
    margin-bottom: 0;
  }

  /* Character tiles are a plain row, so they need less width to read well
     than a set tile's stacked name/subtitle/stats does. */
  .grid.characters {
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-lg);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    box-shadow: inset 0 1px 0 var(--edge-highlight);
    transition:
      border-color var(--duration-fast) var(--ease-out),
      translate var(--duration-fast) var(--ease-out);
  }

  .card:hover {
    border-color: var(--border-strong);
    translate: 0 -2px;
  }

  .open {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4);
    text-align: left;
  }

  /*
   * The set grid's own "picture". `LibraryEntry` deliberately carries no
   * thumbnail (see `tint`'s own doc comment) — a generated colour swatch is
   * the fallback, same as a character with no portrait already gets, shown
   * underneath until `ensureCover` resolves a real one (or forever, for a
   * set with no picture anywhere in it).
   *
   * Card-proportioned (63:88) rather than the small square icon this used to
   * be, because a picture this small is not recognisable as one — and sized
   * to actually show the hover-swapped character card (`.card-peek`)
   * legibly rather than as a postage stamp.
   */
  .thumb {
    position: relative;
    flex: none;
    width: 64px;
    height: 89px;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .thumb img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /*
   * `contain`, not `cover` like the cover picture underneath it: a cover is
   * decoration and may be cropped to fill the tile, but a character card is
   * a *document* — cropping it would cut off the stat block that is the
   * entire reason for showing it. Written as `.thumb img.card-peek`, not a
   * bare `.card-peek` — `.thumb img` above is a class-and-element selector
   * (specificity 0,1,1) that would otherwise outrank a lone class (0,1,0)
   * regardless of source order, the same trap `GalleryScreen`'s own
   * `.cover img.card-peek` documents.
   */
  .thumb img.card-peek {
    object-fit: contain;
    background: inherit;
    opacity: 0;
    transition: opacity var(--duration-normal, 200ms) var(--ease-out);
  }

  .open:hover .thumb img.card-peek,
  .open:focus-visible .thumb img.card-peek {
    opacity: 1;
  }

  /*
   * NOT named `.body` — that class already belongs to the page's own
   * content container (`<div class="body">` below, inside the scrollable
   * `.library`).
   * Svelte scopes styles per component, not per element, so a second `.body`
   * here would have merged both rules onto both elements — which is exactly
   * what happened the first time: every card silently inherited the page
   * container's own padding (`--space-7`/`--space-9`/`--space-10`) on top of
   * `.open`'s own, which was the real source of the wasted space this was
   * built to fix, not `.card-title` wrapping or the old two-row stats/meta
   * split (those made it worse, but this was the dominant cost).
   */
  .card-body {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .card-title-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  /* Single line, ellipsised rather than left to wrap — a wrapped title makes
     its own card taller, and a CSS grid stretches every other card in the
     same row to match by default, turning one long name into wasted space
     under every shorter card beside it. */
  .card-title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-display);
    font-size: var(--text-md);
    color: var(--text-primary);
    letter-spacing: var(--tracking-tight);
  }

  .card-subtitle {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .pill {
    flex: none;
    padding: 1px var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
  }

  .pill.waiting {
    background: color-mix(in oklab, var(--warning) 16%, transparent);
    color: var(--warning);
  }

  .pill.availability {
    border: 1px solid var(--border-subtle);
    background: var(--surface-sunken);
    color: var(--text-muted);
  }

  .pill.availability[data-availability='online'] {
    border-color: color-mix(in oklab, var(--success) 45%, var(--border-subtle));
    color: var(--success);
  }

  .pill.availability[data-availability='pending'] {
    border-color: color-mix(in oklab, var(--accent) 45%, var(--border-subtle));
    color: var(--accent);
  }

  .pill.availability[data-availability='conflict'] {
    border-color: color-mix(in oklab, var(--warning) 45%, var(--border-subtle));
    color: var(--warning);
  }

  /* A credit, not a warning — quiet enough to skip and present enough to find. */
  .lineage {
    align-self: flex-start;
    padding: 1px var(--space-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
  }

  .behind {
    color: var(--warning);
  }

  /* One compact line — characters, cards, edited date — replacing what used
     to be two separate rows (a bold stats row plus a byte-size meta row). */
  .meta {
    margin-top: 2px;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  /*
   * Overlaid on the card rather than a dedicated footer row, which used to
   * cost every card its own fixed strip of height for a control most visits
   * never touch. `opacity` rather than `display: none`, so focus can still
   * reach the buttons by keyboard even before hover reveals them, and
   * `.armed` keeps a delete's Cancel button reachable after the pointer
   * leaves the card mid-confirmation.
   */
  .card-actions {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 2px;
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--surface-base) 85%, transparent);
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-out);
  }

  .card:hover .card-actions,
  .card-actions:focus-within,
  .card-actions.armed {
    opacity: 1;
  }

  .ghost {
    display: inline-grid;
    grid-auto-flow: column;
    place-items: center;
    gap: var(--space-1);
    height: 24px;
    padding-inline: var(--space-2);
    border-radius: var(--radius-xs);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .ghost:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .ghost.danger:hover {
    color: var(--danger);
  }

  /* A character tile: a row rather than the set tile's stack, since there is
     no subtitle/stats block here wanting the full width to itself — a
     picture-sized avatar beside the name reads faster than either stacked. */
  .character .open {
    flex-direction: row;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  .avatar {
    display: grid;
    place-items: center;
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-full);
    font-family: var(--card-font-name, sans-serif);
    font-size: var(--text-sm);
    letter-spacing: var(--tracking-wide);
    color: rgb(255 255 255 / 0.75);
  }

  .character-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .name-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .character-title {
    font-size: var(--text-sm);
  }

  .first-run {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
    align-items: start;
    gap: var(--space-5);
    max-width: 1180px;
    margin-inline: auto;
  }

  .welcome-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    min-width: 0;
  }

  .welcome {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(250px, 0.85fr);
    gap: var(--space-5);
    min-height: 340px;
    padding: var(--space-8);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background:
      radial-gradient(circle at 88% 16%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 34%),
      linear-gradient(135deg, var(--surface-base), var(--surface-raised));
    border: 1px solid color-mix(in oklab, var(--accent) 24%, var(--border-subtle));
    box-shadow: inset 0 1px 0 var(--edge-highlight), var(--shadow-md);
  }

  .welcome-copy {
    position: relative;
    z-index: 2;
    align-self: center;
    min-width: 0;
  }

  .welcome-kicker,
  .capabilities-kicker,
  .principles-kicker,
  .community-kicker,
  .journey-kicker {
    display: block;
    margin-bottom: var(--space-2);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--accent);
  }

  .welcome-title {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
    margin: 0 0 var(--space-3);
    text-wrap: balance;
  }

  .welcome-lede {
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--text-secondary);
    max-width: 52ch;
    margin: 0 0 var(--space-6);
  }

  .welcome-ctas {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-5);
  }

  .welcome-import {
    padding: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-decoration: underline;
    text-decoration-color: transparent;
    text-underline-offset: 3px;
  }

  .welcome-import:hover {
    color: var(--text-secondary);
    text-decoration-color: currentColor;
  }

  .welcome-promises {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    list-style: none;
  }

  .welcome-promises li {
    padding: 3px var(--space-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--surface-sunken) 76%, transparent);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .welcome-montage {
    position: relative;
    align-self: stretch;
    min-height: 270px;
    z-index: 1;
  }

  .montage-card {
    position: absolute;
    bottom: 8px;
    display: grid;
    place-items: center;
    width: 145px;
    max-height: 230px;
    border-radius: var(--radius-md);
    overflow: hidden;
    border: 1px solid color-mix(in oklab, var(--border-strong) 72%, transparent);
    box-shadow: var(--shadow-lg);
    transform-origin: 50% 100%;
  }

  .montage-card.left {
    left: 0;
    transform: rotate(-9deg) translateY(8px);
  }

  .montage-card.centre {
    left: 50%;
    z-index: 2;
    width: 162px;
    transform: translateX(-50%) translateY(-10px);
  }

  .montage-card.right {
    right: 0;
    transform: rotate(9deg) translateY(8px);
  }

  .montage-card img,
  .spotlight-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .montage-card img.trimmed,
  .spotlight-art img.trimmed {
    transform: scale(var(--trim-scale));
  }

  .montage-mark,
  .spotlight-initials {
    font-family: var(--card-font-name, sans-serif);
    font-size: var(--text-xl);
    letter-spacing: var(--tracking-wide);
    color: var(--text-secondary);
  }

  .montage-label {
    position: absolute;
    inset: auto var(--space-2) var(--space-2);
    padding: 3px var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--surface-canvas) 88%, transparent);
    backdrop-filter: blur(5px);
    text-align: center;
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .capabilities {
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    box-shadow: inset 0 1px 0 var(--edge-highlight);
  }

  .capabilities-head {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-5);
    margin-bottom: var(--space-5);
  }

  .capabilities-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-xl);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }

  .capabilities-head > p {
    max-width: 43ch;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-align: right;
  }

  .capability-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .principles {
    padding: var(--space-6);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    background: var(--surface-sunken);
  }

  .principles-head {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-5);
    margin-bottom: var(--space-5);
  }

  .principles-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-xl);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }

  .principles-head > p {
    max-width: 46ch;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    text-align: right;
    color: var(--text-muted);
  }

  .principle-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--border-subtle);
  }

  .principle {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-4);
    min-width: 0;
    padding: var(--space-5);
    background: var(--surface-base);
  }

  .principle.wide {
    grid-column: 1 / -1;
  }

  .principle-index {
    padding-top: 2px;
    font-size: var(--text-2xs);
    color: var(--accent);
  }

  .principle h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .principle p {
    margin: 0;
    max-width: 58ch;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  .capability-card {
    min-width: 0;
    overflow: hidden;
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
  }

  .capability-card.major {
    grid-column: span 3;
  }

  .capability-card.compact {
    grid-column: span 2;
  }

  .capability-visual {
    position: relative;
    overflow: hidden;
    background: var(--surface-sunken);
    border-bottom: 1px solid var(--border-subtle);
  }

  .major .capability-visual {
    height: 176px;
  }

  .compact .capability-visual {
    height: 126px;
  }

  .editor-visual img,
  .map-image-visual img,
  .component-visual img,
  .collaboration-visual img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .editor-visual img {
    object-position: center;
  }

  .component-visual img {
    object-position: center 82%;
  }

  .token-visual img {
    object-position: center 86%;
  }

  .capability-copy {
    padding: var(--space-4);
  }

  .capability-copy h3 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .capability-copy p {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: pretty;
  }

  .threat-visual {
    display: grid;
    place-items: center;
    padding: var(--space-3);
    background: color-mix(in oklab, var(--danger) 12%, var(--surface-sunken));
  }

  .threat-visual img {
    width: 112%;
    max-width: none;
    object-fit: contain;
    filter: drop-shadow(0 5px 9px color-mix(in oklab, var(--text-primary) 24%, transparent));
  }

  .collaboration-card {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: minmax(240px, 0.8fr) minmax(0, 1.2fr);
    align-items: center;
    background:
      linear-gradient(100deg, color-mix(in oklab, var(--accent) 9%, var(--surface-raised)), var(--surface-raised));
  }

  .collaboration-card .capability-copy {
    padding: var(--space-5);
  }

  .collaboration-label {
    display: block;
    margin-bottom: var(--space-2);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--accent);
  }

  .collaboration-card .capability-copy h3 {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    letter-spacing: var(--tracking-tight);
  }

  .collaboration-visual {
    height: 136px;
    margin: var(--space-3);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
  }

  .collaboration-visual img {
    object-position: center;
  }

  .community {
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    box-shadow: inset 0 1px 0 var(--edge-highlight);
  }

  .community-head {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-5);
    margin-bottom: var(--space-5);
  }

  .community-title,
  .journey-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-xl);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }

  .community-head p {
    max-width: 34ch;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-align: right;
  }

  .spotlight {
    display: grid;
    grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
    gap: var(--space-6);
    align-items: center;
    padding: var(--space-5);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    border: 1px solid color-mix(in oklab, var(--accent) 20%, var(--border-subtle));
  }

  .spotlight-art {
    display: grid;
    place-items: center;
    width: 100%;
    overflow: hidden;
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    outline: 1px solid transparent;
    outline-offset: 3px;
    transition: outline-color var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
  }

  .spotlight-art:hover {
    outline-color: var(--border-strong);
    transform: translateY(-2px);
  }

  .spotlight-body {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
  }

  .spotlight-kind {
    margin-bottom: var(--space-2);
    padding: 2px var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--accent) 12%, transparent);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--accent);
  }

  .spotlight-name {
    max-width: 100%;
    margin-bottom: var(--space-1);
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
    text-align: left;
  }

  .spotlight-name:hover {
    color: var(--accent);
  }

  .spotlight-subtitle {
    margin-bottom: var(--space-4);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--text-secondary);
  }

  .spotlight-creator {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    margin-bottom: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    text-align: left;
  }

  .spotlight-creator:hover {
    border-color: var(--border-strong);
    background: var(--surface-hover);
  }

  .creator-avatar {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    overflow: hidden;
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    color: var(--text-primary);
  }

  .creator-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .creator-copy {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .creator-copy strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .creator-profile {
    font-size: var(--text-2xs);
    color: var(--accent);
  }

  .spotlight-stats,
  .spotlight-lineage {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .spotlight-lineage {
    margin-top: var(--space-1);
  }

  .spotlight-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-5);
  }

  .more-gallery-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    margin-block: var(--space-6) var(--space-3);
  }

  .more-gallery-head h3 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-secondary);
  }

  .more-gallery-head button {
    font-size: var(--text-xs);
    color: var(--accent);
  }

  .more-gallery-head button:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .spotlight-empty {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    min-height: 180px;
    padding: var(--space-6);
    border-radius: var(--radius-md);
    border: 1px dashed var(--border-subtle);
    color: var(--text-muted);
  }

  .welcome-journey {
    position: sticky;
    top: var(--space-5);
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    box-shadow: inset 0 1px 0 var(--edge-highlight);
  }

  /* Same journey language as `StyleCascadePanel`, now vertical so it can sit
     beside the visual story without making the hero itself text-heavy. */
  .welcome-steps {
    display: flex;
    flex-direction: column;
    gap: 0;
    list-style: none;
    margin-top: var(--space-5);
  }

  .welcome-step {
    position: relative;
    display: flex;
    gap: var(--space-4);
    padding-bottom: var(--space-5);
    min-width: 0;
  }

  .welcome-step:not(:last-child)::before {
    content: '';
    position: absolute;
    left: 11px;
    top: 24px;
    bottom: 1px;
    width: 1px;
    background: var(--border-subtle);
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
    color: var(--accent);
    z-index: 1;
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

  .journey-foot {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
    padding-top: var(--space-5);
    border-top: 1px dashed var(--border-subtle);
  }

  .journey-foot > span {
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  @media (max-width: 1050px) {
    .first-run {
      grid-template-columns: 1fr;
    }

    .welcome-journey {
      position: static;
    }

    .welcome-steps {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-4) var(--space-5);
    }

    .welcome-step {
      padding-bottom: 0;
    }

    .welcome-step:not(:last-child)::before {
      display: none;
    }

    .welcome-step.wide {
      grid-column: 1 / -1;
    }
  }

  @media (max-width: 760px) {
    .head,
    .capabilities-head,
    .principles-head,
    .community-head {
      align-items: flex-start;
      flex-direction: column;
    }

    .actions {
      flex-wrap: wrap;
    }

    .body,
    .head {
      padding-inline: var(--space-5);
    }

    .welcome {
      grid-template-columns: 1fr;
      padding: var(--space-6);
    }

    .welcome-montage {
      min-height: 245px;
    }

    .community-head p {
      text-align: left;
    }

    .capabilities-head > p {
      text-align: left;
    }

    .principles-head > p {
      text-align: left;
    }

    .capability-grid {
      grid-template-columns: 1fr 1fr;
    }

    .capability-card.major,
    .capability-card.compact {
      grid-column: span 1;
    }

    .collaboration-card {
      grid-column: 1 / -1;
    }

    .spotlight {
      grid-template-columns: minmax(150px, 210px) minmax(0, 1fr);
      gap: var(--space-4);
    }

    .creator-profile {
      display: none;
    }

    .spotlight-creator {
      grid-template-columns: auto minmax(0, 1fr);
    }
  }

  @media (max-width: 560px) {
    .capabilities,
    .principles,
    .community,
    .welcome-journey {
      padding: var(--space-5);
    }

    .capability-grid {
      grid-template-columns: 1fr;
    }

    .principle-grid {
      grid-template-columns: 1fr;
    }

    .principle.wide {
      grid-column: 1;
    }

    .capability-card.major,
    .capability-card.compact,
    .collaboration-card {
      grid-column: 1;
    }

    .collaboration-card {
      grid-template-columns: 1fr;
    }

    .collaboration-visual {
      order: -1;
      height: 118px;
    }

    .spotlight {
      grid-template-columns: 1fr;
    }

    .spotlight-art {
      width: min(220px, 72%);
      justify-self: center;
    }

    .welcome-gallery-slots {
      grid-template-columns: repeat(2, minmax(100px, 1fr));
    }

    .welcome-steps {
      display: flex;
    }

    .welcome-step {
      padding-bottom: var(--space-5);
    }

    .welcome-step:not(:last-child)::before {
      display: block;
    }
  }

  .initials {
    font-family: var(--card-font-name, sans-serif);
    font-size: var(--text-md);
    letter-spacing: var(--tracking-wide);
    color: rgb(255 255 255 / 0.75);
  }


  .guides-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    list-style: none;
  }

  .guides-row {
    display: flex;
    width: 100%;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    color: var(--text-muted);
    text-align: left;
  }

  .guides-row:hover {
    background: var(--surface-hover);
    color: var(--text-secondary);
  }

  .guides-text {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .guides-title {
    color: var(--text-secondary);
    font-weight: var(--weight-medium);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .guides-row:hover .guides-title {
    color: var(--text-primary);
  }

  /* Two lines at most: the summary is one line of copy, and a third row of
     text per guide would make this column taller than the two beside it. */
  .guides-summary {
    font-size: var(--text-xs);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .guides-steps {
    flex: none;
    font-size: var(--text-xs);
    color: var(--text-muted);
    opacity: 0.7;
  }

  .guides-empty {
    padding-inline: var(--space-3);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .deleted-section {
    margin-top: var(--space-7);
    padding-top: var(--space-5);
    border-top: 1px solid var(--border-subtle);
  }

  .deleted-toggle {
    display: inline-grid;
    grid-auto-flow: column;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .deleted-toggle:hover {
    color: var(--text-secondary);
  }

  .deleted-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .deleted-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
  }

  .deleted-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .deleted-name {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .deleted-meta {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .deleted-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex: none;
  }

  .role-badge {
    flex: none;
    padding: 1px var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid var(--border-subtle);
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    color: var(--role-tint);
    border-color: var(--role-tint);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .disclaimer {
    padding: var(--space-6) var(--space-5) var(--space-2);
    text-align: center;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .support-note {
    margin: 0;
    padding: 0 var(--space-5) var(--space-6);
    text-align: center;
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  .support-note a {
    margin-left: var(--space-1);
    font-weight: var(--weight-medium);
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
