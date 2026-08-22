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
  import { openContributionCounts } from '$lib/cloud/contributions';
  import { cloudEnabled } from '$lib/cloud/config';
  import { fetchSetSummaryBySlug, listMyPublishedSets } from '$lib/cloud/sets';
  import { healthSummaryFromCounts } from '$lib/sets/health';
  import type { SetId, SetKind } from '$lib/sets/types';
  import { navigation } from '$lib/state/navigation.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { saveSet } from '$lib/storage/library';
  import type { LibraryEntry } from '$lib/storage/library';
  import { readStorageEstimate } from '$lib/storage/indexeddb';
  import type { StorageEstimate } from '$lib/storage/indexeddb';
  import { Button, EmptyState, Icon, SegmentedControl, Select } from '$lib/ui';
  import NewSetDialog from './NewSetDialog.svelte';

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
   * scope — the split the shelf below groups by. `null` rather than an empty
   * `Set` until the fetch actually answers: signed out, offline, or cloud
   * disabled all mean "unknown," not "nothing is published," and the two
   * must not look the same — an empty answer would put every set in this
   * library under "Unpublished" even for an author who simply is not signed
   * in yet.
   */
  let publishedLocalIds = $state<Set<string> | null>(null);

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
      publishedLocalIds = null;
      return;
    }

    void (async () => {
      const waitingByLocalId = new Map<string, number>();
      try {
        const [published, counts] = await Promise.all([
          listMyPublishedSets(),
          openContributionCounts()
        ]);
        publishedLocalIds = new Set(published.map((row) => row.local_id));
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
        (entry): entry is LibraryEntry & { originSlug: string; originRevision: number } =>
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
   * while that is not yet known (see `publishedLocalIds`), so the shelf below
   * falls back to one flat list rather than a two-way split it cannot
   * actually answer.
   */
  const groupedSets = $derived.by(() => {
    if (publishedLocalIds === null) return null;
    const ids = publishedLocalIds;
    const published: typeof filteredSets = [];
    const unpublished: typeof filteredSets = [];
    for (const entry of filteredSets) {
      (ids.has(entry.id) ? published : unpublished).push(entry);
    }
    return { published, unpublished };
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

  /** A stable colour per character, for the tile with no picture — same
      formula the gallery's own tiles use, so a character reads the same
      shade whether found here or there. */
  function tint(seed: string): string {
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash = (hash * 31 + seed.charCodeAt(index)) | 0;
    }
    return `hsl(${Math.abs(hash) % 360} 30% 26%)`;
  }

  /**
   * Total browser storage this origin is using, against what it could use —
   * not just this library's own byte counts, which is why it is fetched
   * separately from `entries` rather than summed from `entry.bytes`: the
   * quota is shared with whatever else the browser keeps for this origin,
   * and the point of showing it is the ceiling, not the total.
   *
   * `null` while unanswered (the browser has no `navigator.storage.estimate`,
   * or the call failed) means the line is simply not drawn — there is
   * nothing useful to say in that case, and no error worth surfacing over it.
   */
  let storage = $state<StorageEstimate | null>(null);
  void readStorageEstimate().then((value) => (storage = value));

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
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
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
    await saveSet(result.set);
    await workshop.refreshLibrary();
    flash(`Imported “${result.set.name}”.`);
  }
</script>

{#snippet setCard(entry: LibraryEntry)}
  <li class="card">
    <button type="button" class="open" onclick={() => void workshop.openSet(entry.id)}>
      <span class="card-title-row">
        <span class="card-title">{entry.name || 'Untitled Adventure'}</span>
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
        would be worse than saying nothing.
      -->
      {#if entry.blockers !== undefined && entry.gaps !== undefined && entry.issueCount !== undefined}
        <span
          class="health-status"
          data-state={entry.blockers > 0 ? 'blocked' : entry.gaps > 0 ? 'rough' : 'ready'}
        >
          {healthSummaryFromCounts(entry.blockers, entry.gaps, entry.issueCount)}
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

      <span class="stats">
        <span class="stat"><b class="numeric">{entry.characterCount}</b> characters</span>
        <span class="stat"><b class="numeric">{entry.cardCount}</b> cards</span>
      </span>

      <span class="meta">
        <span>{formatDate(entry.updatedAt)}</span>
        <span class="numeric">{formatSize(entry.bytes)}</span>
      </span>
    </button>

    <div class="card-actions">
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

{#snippet deletedRow(entry: LibraryEntry)}
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

<div class="library">
  <header class="head">
    <div class="brand">
      <span class="mark" aria-hidden="true"></span>
      <div class="titles">
        <h1 class="title">Adventures Workshop</h1>
        <p class="subtitle">Everything lives inside a set.</p>
        {#if storage}
          <p class="storage-line">
            {formatSize(storage.usageBytes)} of {formatSize(storage.quotaBytes)} used
          </p>
        {/if}
      </div>
    </div>

    <div class="actions">
      <input
        bind:this={fileInput}
        class="sr-only"
        type="file"
        accept=".json,application/json"
        onchange={importSet}
      />
      <!--
        The way into the gallery. Beside Import rather than promoted above New
        set: someone opening the app usually came to work on their own set, and
        browsing is the occasional errand.
      -->
      {#if cloudEnabled()}
        <Button variant="ghost" onclick={() => navigation.openGallery()}>
          <Icon name="layers" size={14} />
          Browse gallery
        </Button>
      {/if}
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

  {#if entries.length > 0}
    <div class="stat-row">
      <div class="stat-card">
        <span class="stat-card-label">Sets</span>
        <span class="stat-card-value numeric">{libraryStats.sets}</span>
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
      <button type="button" class="continue-card" onclick={() => void workshop.openSet(set.id)}>
        <span class="continue-body">
          <span class="continue-label">Continue where you left off</span>
          <span class="continue-name">{set.name || 'Untitled Adventure'}</span>
        </span>
        <Icon name="chevronRight" size={16} />
      </button>
    {/if}
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

  {#if entries.length > 0}
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

  <div class="body scroll-y">
    {#if entries.length === 0}
      <EmptyState
        icon="book"
        title="No sets yet"
        description="A set is a box: either an adventure — heroes against a villain and its minions — or a box of heroes on their own."
      >
        {#snippet actions()}
          <Button variant="primary" onclick={() => (choosingKind = true)}>
            <Icon name="plus" size={14} />
            Create your first set
          </Button>
        {/snippet}
      </EmptyState>
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

    {#if deletedEntries.length > 0}
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
</div>

<NewSetDialog
  open={choosingKind}
  onchoose={startSet}
  oncancel={() => (choosingKind = false)}
/>

<style>
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
    padding: var(--space-7) var(--space-9) var(--space-6);
    border-bottom: 1px solid var(--border-subtle);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .mark {
    width: 22px;
    height: 22px;
    rotate: 45deg;
    border-radius: 4px;
    background: linear-gradient(140deg, var(--gold-400), var(--gold-600));
    box-shadow: 0 0 20px color-mix(in oklab, var(--brand-gold) 45%, transparent);
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .title {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }

  .subtitle {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .storage-line {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    opacity: 0.75;
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

  .controls {
    display: flex;
    align-items: flex-end;
    gap: var(--space-4);
    flex-wrap: wrap;
    padding: var(--space-5) var(--space-9) 0;
  }

  .stat-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
    padding: var(--space-5) var(--space-9) 0;
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

  .continue-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin: var(--space-3) var(--space-9) 0;
    padding: var(--space-4);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .continue-card:hover {
    border-color: var(--border-strong);
  }

  .continue-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .continue-label {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .continue-name {
    font-family: var(--font-display);
    font-size: var(--text-md);
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
    flex: 1 1 auto;
    min-height: 0;
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
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-5) var(--space-5) var(--space-3);
    text-align: left;
  }

  .card-title-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .card-title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    color: var(--text-primary);
    letter-spacing: var(--tracking-tight);
  }

  .card-subtitle {
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

  /* A credit, not a warning — quiet enough to skip and present enough to find. */
  .lineage {
    align-self: flex-start;
    margin-top: var(--space-2);
    padding: 1px var(--space-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
  }

  .behind {
    color: var(--warning);
  }

  .stats {
    display: flex;
    gap: var(--space-4);
    margin-top: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .stat b {
    color: var(--text-secondary);
    font-weight: var(--weight-semibold);
  }

  .meta {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    opacity: 0.75;
  }

  .card-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
    padding: 0 var(--space-3) var(--space-3);
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
</style>
