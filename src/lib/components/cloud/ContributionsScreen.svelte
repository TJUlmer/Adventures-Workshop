<script lang="ts">
  /**
   * Reviewing what other people have offered for this set.
   *
   * The owner's side of rung 2. Every entry is judged against the document as
   * it stands *now* rather than as it stood when the offer was made — an offer
   * can sit for a month while the set moves on, and the only honest answer is
   * the current one.
   *
   * A card is drawn rather than described. The renderer is already the export
   * and the preview, so showing "before" and "after" as two real cards costs
   * one component and tells an owner more than any diff of field names could.
   * The after-card is rendered from a *preview document* — the set with just
   * that one entry applied — so its style cascade resolves exactly as it would
   * if the entry were taken.
   *
   * Accepting applies entries to the open document and nothing else. The cloud
   * row records the decision; it is never the mechanism of it. The owner then
   * re-publishes when they choose, like any other edit.
   */
  import { auth } from '$lib/cloud/auth.svelte';
  import { cloudEnabled } from '$lib/cloud/config';
  import {
    fetchContribution,
    listContributions,
    resolveContribution
  } from '$lib/cloud/contributions';
  import type { Contribution, ContributionSummary } from '$lib/cloud/contributions';
  import { listMyPublishedSets } from '$lib/cloud/sets';
  import CardRenderer from '$lib/renderer/CardRenderer.svelte';
  import { applyEntries, reviewEntries } from '$lib/sets/contribution';
  import type { ReviewedEntry } from '$lib/sets/contribution';
  import { characterForCard, resolveStyleForCard } from '$lib/sets/queries';
  import type { AdventureSet } from '$lib/sets/types';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, EmptyState, Icon } from '$lib/ui';

  const set = $derived(workshop.adventure);

  /** Every published row for this set, whatever scope — see `load`. */
  let publishedIds = $state<string[]>([]);
  let offers = $state<ContributionSummary[]>([]);
  let open = $state<Contribution | null>(null);
  let reviewed = $state<ReviewedEntry[]>([]);
  let chosen = $state<Set<string>>(new Set());
  let loading = $state(true);
  let busy = $state(false);
  let progress = $state<string | null>(null);
  let error = $state<string | null>(null);
  let done = $state<string | null>(null);

  /*
   * Which published rows this set is. Matched on `local_id`, the set's id in
   * this library — the row id belongs to the server, and it is the row id
   * that a contribution was addressed to. A `.filter`, not a `.find`: scoped
   * publishing means the whole set, a villain-side slice and any number of
   * hero slices can all share this `local_id` as separate rows, and a
   * contribution against any one of them belongs in this same inbox — the
   * owner reviews it here, against whichever set they currently have open,
   * regardless of which published row a contributor actually forked from.
   * `workshop.applyContribution` was never aware of that distinction in the
   * first place; see `sets/contribution.ts`.
   */
  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      if (!auth.signedIn) return;
      const mine = await listMyPublishedSets();
      const rows = mine.filter((row) => row.local_id === set.id);
      publishedIds = rows.map((row) => row.id);
      const lists = await Promise.all(rows.map((row) => listContributions(row.id)));
      offers = lists.flat();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not load contributions.';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void set.id;
    void auth.signedIn;
    void load();
  });

  async function openOffer(id: string): Promise<void> {
    busy = true;
    error = null;
    done = null;
    try {
      const found = await fetchContribution(id, (at, total) => {
        progress = total > 0 ? `Fetching artwork ${at} of ${total}…` : null;
      });
      progress = null;
      if (!found) {
        error = 'That contribution could not be read.';
        return;
      }
      open = found;
      reviewed = reviewEntries(set, found.payload.entries ?? []);
      // Everything clean is pre-selected; a conflict is opted into by hand,
      // because it is the one case the owner has to actually decide about.
      chosen = new Set(reviewed.filter((entry) => !entry.conflict).map((entry) => entry.key));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not open that contribution.';
    } finally {
      busy = false;
    }
  }

  function toggle(key: string): void {
    const next = new Set(chosen);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    chosen = next;
  }

  /**
   * The set as it would be with one entry taken.
   *
   * Built per card so the style cascade resolves against a document that
   * actually contains the proposed card — `resolveStyleForCard` reads the
   * set's and the character's layers, so resolving against the *current* set
   * would show the card under the wrong theme whenever the offer changes one.
   */
  function previewOf(entry: ReviewedEntry): AdventureSet {
    return applyEntries(set, [entry]);
  }

  function cardIn(document: AdventureSet, key: string) {
    return document.cards.find((card) => card.id === key) ?? null;
  }

  /**
   * A hero's own character card is drawn straight off the `Character` —
   * `HeroCharacterCardFace` reads `character.characterCard`, not anything in
   * `set.cards` — so a `character`-kind entry needs its own lookup here
   * rather than falling through `cardIn` and finding nothing. Villain and
   * minion changes stay unprevewed, as they already were: neither role has
   * a printed "character card" for this to draw.
   */
  function heroIn(document: AdventureSet, key: string) {
    const character = document.characters.find((entry) => entry.id === key) ?? null;
    return character?.role === 'hero' ? character : null;
  }

  async function accept(): Promise<void> {
    if (!open) return;
    busy = true;
    error = null;
    try {
      const taking = reviewed.filter((entry) => chosen.has(entry.key));
      if (taking.length > 0) workshop.applyContribution(taking);
      await resolveContribution(open.id, 'accepted', [...chosen]);
      done =
        taking.length > 0
          ? `Took ${taking.length} of ${reviewed.length}. Re-publish when you are ready.`
          : 'Marked as accepted, with nothing taken.';
      open = null;
      await load();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not apply that contribution.';
    } finally {
      busy = false;
    }
  }

  async function decline(): Promise<void> {
    if (!open) return;
    busy = true;
    error = null;
    try {
      await resolveContribution(open.id, 'declined');
      done = 'Declined.';
      open = null;
      await load();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not decline that contribution.';
    } finally {
      busy = false;
    }
  }

  const waiting = $derived(offers.filter((offer) => offer.status === 'open'));
  const settled = $derived(offers.filter((offer) => offer.status !== 'open'));
  const conflicts = $derived(reviewed.filter((entry) => entry.conflict).length);
</script>

<div class="page scroll-y">
  <header class="head">
    <div>
      <span class="eyebrow">Set tool</span>
      <h1 class="title">Contributions</h1>
      <p class="lede">Changes other people have offered for this set.</p>
    </div>
    {#if open}
      <Button variant="ghost" onclick={() => (open = null)}>
        <Icon name="chevronRight" size={13} />
        Back to the list
      </Button>
    {/if}
  </header>

  {#if !cloudEnabled()}
    <p class="message">Sharing is not set up in this build.</p>
  {:else if !auth.signedIn}
    <p class="message">Sign in to see what has been offered for your sets.</p>
  {:else if loading}
    <p class="message">Loading…</p>
  {:else if error}
    <p class="message error" role="alert">{error}</p>
  {:else if publishedIds.length === 0}
    <EmptyState
      icon="upload"
      title="This set is not published"
      description="Publish it and hand out the link, and anyone who copies it can offer their changes back here."
    />
  {:else if open}
    <!-- One offer, entry by entry ---------------------------------------- -->
    <section class="offer-head">
      <h2 class="offer-title">{open.title || `${open.entry_count} changes`}</h2>
      <p class="byline">
        from {open.contributor?.display_name || 'someone'} · built against revision
        {open.base_revision}
        {#if open.message}<span class="offer-message">“{open.message}”</span>{/if}
      </p>
      {#if conflicts > 0}
        <p class="warn">
          {conflicts}
          {conflicts === 1 ? 'change touches something' : 'changes touch things'} you have edited since.
          Those are left unticked — taking one replaces your version.
        </p>
      {/if}
    </section>

    <ul class="entries">
      {#each reviewed as entry (entry.key)}
        {@const preview = entry.change === 'removed' ? null : previewOf(entry)}
        {@const after = preview ? cardIn(preview, entry.key) : null}
        {@const before = cardIn(set, entry.key)}
        {@const afterHero = entry.kind === 'character' && preview ? heroIn(preview, entry.key) : null}
        {@const beforeHero = entry.kind === 'character' ? heroIn(set, entry.key) : null}
        <li class="entry" class:conflict={entry.conflict}>
          <label class="entry-head">
            <input type="checkbox" checked={chosen.has(entry.key)} onchange={() => toggle(entry.key)} />
            <span class="badge" data-change={entry.change}>{entry.change}</span>
            <span class="entry-label">{entry.label}</span>
            {#if entry.conflict}<span class="flag">you changed this too</span>{/if}
          </label>

          {#if before || after}
            <div class="compare">
              {#if before}
                <figure class="side">
                  <figcaption>Yours now</figcaption>
                  <div class="card">
                    <CardRenderer
                      card={before}
                      character={characterForCard(set, before)}
                      theme={resolveStyleForCard(set, before)}
                      customSymbols={set.customSymbols}
                    />
                  </div>
                </figure>
              {/if}

              {#if after && preview}
                <figure class="side">
                  <figcaption>Offered</figcaption>
                  <div class="card">
                    <CardRenderer
                      card={after}
                      character={characterForCard(preview, after)}
                      theme={resolveStyleForCard(preview, after)}
                      customSymbols={preview.customSymbols}
                    />
                  </div>
                </figure>
              {/if}
            </div>
          {:else if beforeHero || afterHero}
            <!--
              A hero's own entity bundles its stats *and* its printed
              character-card design (`Character.characterCard`) — neither
              lives in `set.cards`, so `cardIn` above finds nothing and this
              entry fell through with no preview at all. `HeroCharacterCardFace`
              reads straight off the `Character`, the same way a deck back
              does, so it takes the same `statCard` prop `PreviewPanel` already
              uses rather than a second drawing path. Always the primary
              identity (`statCardEntry` left unset) — an offer names one
              character, not which of its "+1 character card" sheets changed.
            -->
            <div class="compare">
              {#if beforeHero}
                <figure class="side">
                  <figcaption>Yours now</figcaption>
                  <div class="card">
                    <CardRenderer card={null} statCard={beforeHero} customSymbols={set.customSymbols} />
                  </div>
                </figure>
              {/if}

              {#if afterHero && preview}
                <figure class="side">
                  <figcaption>Offered</figcaption>
                  <div class="card">
                    <CardRenderer
                      card={null}
                      statCard={afterHero}
                      customSymbols={preview.customSymbols}
                    />
                  </div>
                </figure>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>

    <div class="actions">
      <Button variant="primary" disabled={busy} onclick={accept}>
        Take {chosen.size} of {reviewed.length}
      </Button>
      <Button variant="danger" disabled={busy} onclick={decline}>Decline all</Button>
    </div>
    <p class="fineprint">
      Taking these changes edits this set here, in your browser. Nothing anyone
      else can see moves until you publish again.
    </p>
  {:else}
    <!-- The list ---------------------------------------------------------- -->
    {#if done}<p class="message">{done}</p>{/if}
    {#if progress}<p class="message">{progress}</p>{/if}

    {#if waiting.length === 0 && settled.length === 0}
      <EmptyState
        icon="users"
        title="Nothing offered yet"
        description="Anyone who copies this set from its share link can send their changes back here."
      />
    {/if}

    {#if waiting.length > 0}
      <section class="group">
        <h2 class="group-title">Waiting <span class="group-count numeric">{waiting.length}</span></h2>
        {#each waiting as offer (offer.id)}
          <button type="button" class="row" disabled={busy} onclick={() => openOffer(offer.id)}>
            <span class="row-main">
              <span class="row-title">{offer.title || `${offer.entry_count} changes`}</span>
              <span class="row-meta">
                {offer.contributor?.display_name || 'someone'} · {offer.entry_count}
                {offer.entry_count === 1 ? 'change' : 'changes'} · against revision
                {offer.base_revision} · {new Date(offer.created_at).toLocaleDateString()}
              </span>
            </span>
            <Icon name="chevronRight" size={13} />
          </button>
        {/each}
      </section>
    {/if}

    {#if settled.length > 0}
      <section class="group">
        <h2 class="group-title">Decided <span class="group-count numeric">{settled.length}</span></h2>
        {#each settled as offer (offer.id)}
          <div class="row settled">
            <span class="row-main">
              <span class="row-title">{offer.title || `${offer.entry_count} changes`}</span>
              <span class="row-meta">
                {offer.contributor?.display_name || 'someone'} · {offer.status}
                {#if offer.status === 'accepted'}
                  · {offer.applied_keys.length} of {offer.entry_count} taken
                {/if}
              </span>
            </span>
          </div>
        {/each}
      </section>
    {/if}
  {/if}
</div>

<style>
  .page {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-7) var(--space-8) var(--space-10);
  }

  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-5);
  }

  .eyebrow {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .title {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }

  .lede,
  .message,
  .fineprint,
  .byline {
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }

  .fineprint {
    font-size: var(--text-xs);
  }

  .error {
    color: var(--danger);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .group-title {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  .group-count {
    color: var(--text-muted);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-base);
    text-align: left;
    color: var(--text-secondary);
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  button.row:hover:not(:disabled) {
    border-color: var(--border-strong);
  }

  .row.settled {
    opacity: 0.65;
  }

  .row-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .row-title {
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .row-meta,
  .offer-message {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  /* -- one offer --------------------------------------------------------- */
  .offer-head {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .offer-title {
    font-size: var(--text-lg);
    color: var(--text-primary);
  }

  .offer-message {
    display: block;
    margin-top: var(--space-1);
  }

  .warn {
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--warning);
  }

  .entries {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .entry {
    padding: var(--space-4);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-base);
  }

  .entry.conflict {
    border-color: color-mix(in oklab, var(--warning) 45%, transparent);
  }

  .entry-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    cursor: pointer;
  }

  .entry-head input {
    accent-color: var(--brand-gold);
  }

  .badge,
  .flag {
    padding: 0 var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid var(--border-subtle);
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--text-muted);
  }

  .badge[data-change='added'] {
    color: var(--success);
    border-color: color-mix(in oklab, var(--success) 40%, transparent);
  }

  .badge[data-change='removed'] {
    color: var(--danger);
    border-color: color-mix(in oklab, var(--danger) 40%, transparent);
  }

  .flag {
    color: var(--warning);
    border-color: color-mix(in oklab, var(--warning) 40%, transparent);
    text-transform: none;
  }

  .entry-label {
    flex: 1;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .compare {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
    margin-top: var(--space-4);
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
  }

  .side figcaption {
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  /* A readable size rather than true size: this is a judgement, not a proof. */
  .card {
    width: 190px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
