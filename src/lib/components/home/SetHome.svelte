<script lang="ts">
  /**
   * Set Home: what this set is, and how complete it is.
   *
   * The roster is the page — every component group in one glance, each a way
   * in. Health is a list of concrete gaps rather than a score, because a
   * percentage tells an author nothing they can act on.
   */
  import { CARD_TYPE_META } from '$lib/cards/types';
  import ContributePanel from '$lib/components/cloud/ContributePanel.svelte';
  import SharePanel from '$lib/components/cloud/SharePanel.svelte';
  import ExportPanel from '$lib/components/export/ExportPanel.svelte';
  import { auth } from '$lib/cloud/auth.svelte';
  import { cloudEnabled } from '$lib/cloud/config';
  import { listContributions, openContributionCounts, tallyContributors } from '$lib/cloud/contributions';
  import type { ContributorTally } from '$lib/cloud/contributions';
  import { fetchSetSummaryBySlug, listMyPublishedSets } from '$lib/cloud/sets';
  import type { PublishedSet, SetSummary } from '$lib/cloud/sets';
  import { characterLabel } from '$lib/characters/factory';
  import { CHARACTER_ROLE_META } from '$lib/characters/types';
  import { hasArtwork } from '$lib/core/artwork';
  import { assessSet, healthSummary } from '$lib/sets/health';
  import { setLabel } from '$lib/sets/factory';
  import { threatTotal } from '$lib/threat/types';
  import { navigation } from '$lib/state/navigation.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Icon } from '$lib/ui';

  const set = $derived(workshop.adventure);
  const outline = $derived(workshop.outline);
  const stats = $derived(workshop.stats);
  const health = $derived(assessSet(set));

  const severityLabel = { blocker: 'Blocker', gap: 'Gap', polish: 'Polish' } as const;

  /*
   * Where this set came from, and whether that set has moved on since.
   *
   * The summary is fetched rather than the set, because the whole question is
   * one integer and `set_by_slug` would answer it with several megabytes. It
   * fails silently: an original that has been withdrawn, or a browser with no
   * network, leaves the credit line standing and simply says nothing about
   * revisions — which is true, rather than alarming.
   */
  let upstream = $state<SetSummary | null>(null);

  $effect(() => {
    const origin = set.origin;
    upstream = null;
    if (!origin || !cloudEnabled()) return;

    void fetchSetSummaryBySlug(origin.slug)
      .then((found) => (upstream = found))
      .catch(() => (upstream = null));
  });

  /** How far behind the original this copy started, if it is behind at all. */
  const behindBy = $derived(
    set.origin && upstream ? Math.max(0, upstream.revision - set.origin.revision) : 0
  );

  /*
   * Every row this author has published for this set, whatever scope — the
   * whole set, maybe a villain-side slice, maybe one per hero. Scoped
   * publishing means more than one row can share this set's `local_id`, so
   * this is a filtered list rather than a single `.find`, both for the
   * "published on its own" line below and for the offers/contributors
   * tallies, which now aggregate across every row rather than only the first
   * match — a contribution against a hero-scoped publish would otherwise be
   * invisible here whenever that row was not the one `.find` happened to hit.
   */
  let mine = $state<PublishedSet[]>([]);
  let waiting = $state(0);
  let contributors = $state<ContributorTally[]>([]);

  $effect(() => {
    void set.id;
    void auth.signedIn;
    mine = [];
    waiting = 0;
    contributors = [];
    if (!cloudEnabled() || !auth.signedIn) return;

    void (async () => {
      try {
        const rows = (await listMyPublishedSets()).filter((entry) => entry.local_id === set.id);
        mine = rows;
        if (rows.length === 0) return;

        const [counts, ...accepted] = await Promise.all([
          openContributionCounts(),
          ...rows.map((row) => listContributions(row.id, 'accepted'))
        ]);
        waiting = rows.reduce((total, row) => total + (counts.get(row.id) ?? 0), 0);
        contributors = tallyContributors(accepted.flat());
      } catch {
        // A badge is never worth an error message.
        mine = [];
        waiting = 0;
        contributors = [];
      }
    })();
  });

  /** What a published slice reads as — the villain side, or a hero by name. */
  function scopeLabel(row: PublishedSet): string {
    if (row.scope === 'villain') return 'Villain side';
    const character = set.characters.find((entry) => entry.id === row.character_id);
    return character ? characterLabel(character) : row.name;
  }
</script>

<div class="home scroll-y">
  <!-- Identity ---------------------------------------------------------- -->
  <header class="hero">
    <div class="box-art" class:empty={!hasArtwork(set.boxArt)}>
      {#if hasArtwork(set.boxArt) && set.boxArt.source}
        <img src={set.boxArt.source} alt="" />
      {:else}
        <Icon name="image" size={20} />
        <span class="box-hint">Box art</span>
      {/if}
    </div>

    <div class="identity">
      <span class="eyebrow">Adventure set</span>
      <h1 class="title">{setLabel(set)}</h1>
      {#if set.subtitle}<p class="subtitle">{set.subtitle}</p>{/if}

      <div class="badges">
        <span class="status" data-state={health.blockers > 0 ? 'blocked' : health.gaps > 0 ? 'rough' : 'ready'}>
          {healthSummary(health)}
        </span>
        <span class="version numeric">v{set.meta.version}</span>
        {#if set.meta.author}<span class="author">{set.meta.author}</span>{/if}
      </div>

      <!--
        Lineage, for a set that was copied from a published one. Under the
        badges rather than beside the title: it qualifies the set without being
        part of its name.
      -->
      {#if set.origin}
        <p class="lineage">
          Based on
          <a href="#/shared/{set.origin.slug}">{upstream?.name ?? 'a published set'}</a>
          {#if set.origin.authorName}by {set.origin.authorName}{/if}
          <span class="numeric">· revision {set.origin.revision}</span>
          {#if behindBy > 0}
            <span class="behind">
              — the original is now at revision {upstream?.revision}
            </span>
          {/if}
        </p>
      {/if}

      <!--
        The reverse of the line above: not what this set came from, but what
        has been published *out of* it on its own — a hero someone can try
        without the rest of the box, or the villain side by itself. Only the
        non-`'full'` rows; the whole-set publish is what `SharePanel` already
        manages and has nothing to say for itself here.
      -->
      {#if mine.some((row) => row.scope !== 'full')}
        <p class="lineage">
          Published on its own:
          {#each mine.filter((row) => row.scope !== 'full') as row, index (row.id)}
            {#if index > 0}·{/if}
            <a href="#/shared/{row.slug}">{scopeLabel(row)}</a>
          {/each}
        </p>
      {/if}
    </div>

  </header>

  <div class="columns">
    <div class="column">
      <!-- Roster -------------------------------------------------------- -->
      <section class="panel">
        <h2 class="panel-title">Roster</h2>

        {#each [...outline.heroes, ...outline.villains, ...outline.minions, ...outline.others] as entry (entry.character.id)}
          {@const meta = CHARACTER_ROLE_META[entry.character.role]}
          <button
            type="button"
            class="roster-row"
            onclick={() => workshop.selectCharacter(entry.character.id)}
          >
            <span class="portrait" class:empty={!hasArtwork(entry.character.artwork)}>
              {#if hasArtwork(entry.character.artwork) && entry.character.artwork.source}
                <img src={entry.character.artwork.source} alt="" />
              {:else}
                <Icon name="image" size={14} />
              {/if}
            </span>

            <span class="roster-text">
              <span class="roster-name">{characterLabel(entry.character)}</span>
              <span class="roster-role" style:color="var({meta.colorVar})">{meta.label}</span>
            </span>

            <span class="roster-stats numeric">
              <span title="Health">{entry.character.health ?? '—'} HP</span>
              <span title="Move">{entry.character.move} mv</span>
              <span title="Cards to print">{entry.printCount} cards</span>
            </span>
          </button>
        {:else}
          <p class="empty-line">No characters yet.</p>
        {/each}
      </section>

      <!-- What the set is made of --------------------------------------- -->
      <section class="panel">
        <h2 class="panel-title">Set contents</h2>

        <div class="tiles">
          {#each [{ key: 'rules', decks: outline.rules, label: CARD_TYPE_META.rules.plural }, { key: 'initiative', decks: outline.initiative, label: CARD_TYPE_META.initiative.plural }, { key: 'event', decks: outline.events, label: CARD_TYPE_META.event.plural }] as group (group.key)}
            {@const count = group.decks.reduce((total, deck) => total + deck.printCount, 0)}
            <button type="button" class="tile" onclick={() => navigation.go('assets')}>
              <span class="tile-count numeric">{count}</span>
              <span class="tile-label">{group.label}</span>
            </button>
          {/each}

          <button type="button" class="tile" onclick={() => navigation.go('figures')}>
            <span class="tile-count numeric">{set.figures.length}</span>
            <span class="tile-label">Components</span>
          </button>

          <button type="button" class="tile" onclick={() => navigation.go('threat')}>
            <span class="tile-count numeric">
              {set.threat.enabled ? threatTotal(set.threat) : '—'}
            </span>
            <span class="tile-label">Threat track</span>
          </button>

          <!-- Beside the threat track, because on the table they are one board. -->
          <button type="button" class="tile" onclick={() => navigation.go('map')}>
            <span class="tile-count numeric">
              {set.map.enabled ? set.map.spaces.length : '—'}
            </span>
            <span class="tile-label">Map spaces</span>
          </button>

          <button type="button" class="tile" onclick={() => navigation.go('editor')}>
            <span class="tile-count numeric">{stats.printCount}</span>
            <span class="tile-label">Cards to print</span>
          </button>
        </div>
      </section>
    </div>

    <div class="column">
      <!-- Health -------------------------------------------------------- -->
      <section class="panel">
        <h2 class="panel-title">Set health</h2>

        {#if health.issues.length === 0}
          <p class="all-clear">
            <Icon name="sparkle" size={14} />
            Nothing outstanding.
          </p>
        {:else}
          <ul class="issues">
            {#each health.issues as issue, index (index)}
              <li class="issue" data-severity={issue.severity}>
                <span class="severity">{severityLabel[issue.severity]}</span>
                <span class="issue-text">{issue.message}</span>
                {#if issue.cardId}
                  <button
                    type="button"
                    class="jump"
                    onclick={() => issue.cardId && workshop.selectCard(issue.cardId)}
                  >
                    Fix
                  </button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <!--
        Contributions, all three directions, and above Export on purpose.
        Offering changes back is the thing to do *with* a copied set, and
        burying it under a list of file formats made it read as an
        afterthought. Waiting offers, the tally of who has already helped, and
        the offer panel below can each be present or absent independently — a
        set can be a fork that owes credit to its own contributors, which is
        what a chain of forks looks like.
      -->
      {#if waiting > 0 || contributors.length > 0}
        <section class="panel">
          <h2 class="panel-title">Contributions</h2>

          {#if waiting > 0}
            <button type="button" class="waiting" onclick={() => navigation.go('contributions')}>
              <Icon name="users" size={14} />
              <span class="waiting-text">
                <span class="waiting-count numeric">{waiting}</span>
                {waiting === 1 ? 'change is' : 'changes are'} waiting for you
              </span>
              <Icon name="chevronRight" size={13} />
            </button>
          {/if}

          {#if contributors.length > 0}
            <!--
              Only the owner sees the counts — a public credit line names who
              helped and stops there; this is allowed to say how much,
              because it is read by the one person the number is actually
              useful to.
            -->
            <ul class="contributors">
              {#each contributors as person (person.name)}
                <li class="contributor">
                  {#if person.avatarUrl}
                    <img class="contributor-avatar" src={person.avatarUrl} alt="" loading="lazy" />
                  {/if}
                  <span class="contributor-name">{person.name}</span>
                  <span class="contributor-count numeric">
                    {person.changes} {person.changes === 1 ? 'change' : 'changes'}
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

      <ContributePanel {set} />

      <!-- Export -------------------------------------------------------- -->
      <section class="panel">
        <h2 class="panel-title">Export</h2>
        <p class="panel-hint">Everything here covers the whole set.</p>

        <ExportPanel {set} onprint={() => navigation.go('print')} />
        <SharePanel {set} />
      </section>

      <!-- Notes --------------------------------------------------------- -->
      {#if set.meta.description}
        <section class="panel">
          <h2 class="panel-title">Notes</h2>
          <p class="notes">{set.meta.description}</p>
        </section>
      {/if}
    </div>
  </div>
</div>

<style>
  .home {
    flex: 1 1 auto;
    min-height: 0;
    padding: var(--space-7) var(--space-8) var(--space-10);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  /* -- hero ------------------------------------------------------------- */
  .hero {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-5);
  }

  .box-art {
    display: grid;
    place-items: center;
    gap: var(--space-1);
    width: 96px;
    height: 128px;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    color: var(--text-muted);
  }

  .box-art.empty {
    border-style: dashed;
  }

  .box-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .box-hint {
    font-size: var(--text-2xs);
  }

  .identity {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .eyebrow {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--brand-gold);
  }

  .title {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .subtitle {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .badges {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .status {
    padding: 2px var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid var(--border-default);
  }

  .status[data-state='blocked'] {
    color: var(--danger);
    border-color: color-mix(in oklab, var(--danger) 40%, transparent);
  }

  .status[data-state='rough'] {
    color: var(--warning);
    border-color: color-mix(in oklab, var(--warning) 40%, transparent);
  }

  .status[data-state='ready'] {
    color: var(--success);
    border-color: color-mix(in oklab, var(--success) 40%, transparent);
  }

  .waiting {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in oklab, var(--brand-gold) 40%, transparent);
    text-align: left;
    color: var(--text-secondary);
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  .waiting:hover {
    background: var(--surface-hover);
  }

  .waiting-text {
    flex: 1;
    min-width: 0;
    font-size: var(--text-sm);
  }

  .waiting-count {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    color: var(--brand-gold);
  }

  .contributors {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
  }

  .contributor {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    font-size: var(--text-xs);
  }

  .contributor-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex: none;
  }

  .contributor-name {
    flex: 1;
    min-width: 0;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .contributor-count {
    color: var(--text-muted);
    font-size: var(--text-2xs);
  }

  .lineage {
    margin-top: var(--space-2);
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  .lineage a {
    color: var(--text-secondary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  /* Noticed, not alarming: the copy is not wrong, only older. */
  .behind {
    color: var(--text-tertiary);
  }

  /* -- panels ----------------------------------------------------------- */
  .columns {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
    gap: var(--space-5);
    align-items: start;
  }

  @container home (max-width: 900px) {
    .columns {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    min-width: 0;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    box-shadow: inset 0 1px 0 var(--edge-highlight);
  }

  .panel-title {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  .panel-hint {
    margin-top: calc(var(--space-2) * -1);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  /* -- roster ----------------------------------------------------------- */
  .roster-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    text-align: left;
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  .roster-row:hover {
    background: var(--surface-hover);
  }

  .portrait {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    color: var(--text-muted);
  }

  .portrait.empty {
    border-style: dashed;
  }

  .portrait img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .roster-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .roster-name {
    font-size: var(--text-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .roster-role {
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-wide);
  }

  .roster-stats {
    display: flex;
    gap: var(--space-3);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .empty-line,
  .notes {
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }

  /* -- component tiles -------------------------------------------------- */
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: var(--space-2);
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    text-align: left;
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .tile:hover {
    border-color: var(--border-strong);
  }

  .tile-count {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    line-height: 1;
    color: var(--text-primary);
  }

  .tile-label {
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  /* -- health ----------------------------------------------------------- */
  .issues {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .issue {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .severity {
    width: 52px;
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .issue[data-severity='blocker'] .severity {
    color: var(--danger);
  }

  .issue[data-severity='gap'] .severity {
    color: var(--warning);
  }

  .jump {
    font-size: var(--text-2xs);
    color: var(--text-accent);
    padding-inline: var(--space-2);
    border-radius: var(--radius-xs);
  }

  .jump:hover {
    background: var(--accent-soft);
  }

  .all-clear {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--success);
  }

</style>
