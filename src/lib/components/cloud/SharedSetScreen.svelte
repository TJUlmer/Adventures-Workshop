<script lang="ts">
  /**
   * What someone sees when they open a share link.
   *
   * Often the first thing a person ever sees of this app, and quite possibly
   * with no idea what it is — so it shows the set itself, whole, and offers the
   * exports. It renders outside the shell for that reason: a title bar and a
   * nav for a set they do not have would be chrome for a workshop they have not
   * entered yet.
   *
   * A copy taken here is a **fork**: it records what it came from, credits the
   * author, and remembers which revision it started at. There was a plain "Add
   * to my library" button here once and it was removed, because a copy that
   * forgets its origin makes every share link a fork button — the author's set
   * edited onward under the author's name, and a gallery of near-identical
   * copies with nothing to tell them apart. The objection was never to copying;
   * it was to copying that erased where the set came from. See `sets/fork.ts`.
   *
   * None of that is a lock, and it is worth being honest about which parts are
   * enforced: the whole document is in the viewer's browser the moment the page
   * renders, and the `.json` export is a re-importable copy of it. What the
   * fork route gives is a copy that can later offer its changes *back*, which
   * an exported-and-reimported one cannot.
   *
   * The overview is `AssetsOverview` read-only, not a sketch of it, for the
   * same reason the export photographs the renderer: one drawing path, so what
   * a viewer sees cannot drift from what the author approved.
   */
  import { untrack } from 'svelte';
  import type { CharacterId } from '$lib/characters/types';
  import ExportPanel from '$lib/components/export/ExportPanel.svelte';
  import AssetsOverview from '$lib/components/tools/AssetsOverview.svelte';
  import { listContributors } from '$lib/cloud/contributions';
  import type { Contributor } from '$lib/cloud/contributions';
  import {
    fetchAuthorName,
    fetchParentSet,
    fetchSetBySlug,
    hydratePublishedSet
  } from '$lib/cloud/sets';
  import type { PublishedSetWithDocument } from '$lib/cloud/sets';
  import { cloudEnabled } from '$lib/cloud/config';
  import PrintScreen from '$lib/print/PrintScreen.svelte';
  import { forkSet, sourceOf } from '$lib/sets/fork';
  import { computeScopedSet, parseScopeKey, scopeKeyOf, scopeOptionsFor } from '$lib/sets/scope';
  import type { PublishScope } from '$lib/sets/scope';
  import type { AdventureSet } from '$lib/sets/types';
  import { navigation } from '$lib/state/navigation.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { saveSet } from '$lib/storage/library';
  import { Button, Icon, Select } from '$lib/ui';

  interface Props {
    slug: string;
    /**
     * Which character to default the export scope to — set when this was
     * reached by clicking one specific hero inside a box that has no listing
     * of its own. See `navigation.svelte.ts`'s `View['shared']`.
     */
    characterHint?: string;
  }

  let { slug, characterHint }: Props = $props();

  /**
   * Whether to offer taking a copy.
   *
   * "Off" ever meant only that the button was not drawn: `fork()` below,
   * `sets/fork.ts`, the fingerprint it records and the lineage the row
   * carries were never touched by the flag, and a copy already taken always
   * showed its way back to the library. Back on now that the heroes release
   * is out.
   */
  const SHOW_FORK = true;

  let row = $state<PublishedSetWithDocument | null>(null);
  let set = $state<AdventureSet | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let progress = $state<string | null>(null);

  /**
   * What the overview below is showing, and what `ExportPanel` exports —
   * one piece of state, bound into both the filter here and `ExportPanel`'s
   * own picker (`bind:scope`), so "what will this export" and "what am I
   * looking at" can never disagree. Starts on `characterHint`, for a visitor
   * who arrived by clicking one specific hero inside a box with no listing
   * of its own.
   */
  let viewScope = $state<PublishScope>(
    untrack(() =>
      characterHint ? { kind: 'hero', characterId: characterHint as CharacterId } : { kind: 'full' }
    )
  );

  /*
   * Print sheets are a screen, not a file, and this screen is outside the
   * router — so it shows them itself rather than navigating. `navigation.go`
   * would leave the shared view entirely and land on whatever set happened to
   * be open in the library.
   */
  let printing = $state(false);

  /** The author's display name, for the credit a fork will carry. */
  let authorName = $state('');

  /**
   * Everyone whose offer this set has taken. Credit for work already visible
   * in the document below, not a window into anything still private — see
   * `listContributors`.
   */
  let contributors = $state<Contributor[]>([]);

  /** The forked copy, once one has been taken. Names the set for the message. */
  let forked = $state<string | null>(null);
  let forking = $state(false);

  /**
   * The whole set this one was sliced out of, for a hero- or villain-scoped
   * publish.
   *
   * A scoped row keeps the same `local_id` as its master (`sets/scope.ts`), so
   * the box is simply the `full` row beside it — nothing here is recorded at
   * publish time and nothing can go stale. Null both for a set that *is* the
   * whole thing and for one whose box was never published publicly, and the
   * two are deliberately not distinguished: either way there is nowhere to go.
   *
   * The subtitle already reads "From {the box}", so this is not new
   * information — it is the same fact made clickable, which is the whole of
   * what was missing.
   */
  let parent = $state<{ slug: string; name: string } | null>(null);

  $effect(() => {
    const wanted = slug;
    loading = true;
    error = null;
    forked = null;
    parent = null;
    // A stale hero id from the previous set would otherwise survive the
    // navigation and quietly filter the overview down to nothing.
    viewScope = characterHint ? { kind: 'hero', characterId: characterHint as CharacterId } : { kind: 'full' };

    void (async () => {
      try {
        const found = await fetchSetBySlug(wanted);
        if (found === null) {
          // Withdrawn, made private, or simply mistyped — and deliberately not
          // distinguished, since telling a stranger "that one exists but is
          // private" is more than they are owed.
          error = 'That link does not lead to a set. It may have been withdrawn.';
          return;
        }
        row = found;
        // Fired off rather than awaited: the credit is wanted for the fork
        // button, and nothing on the page should wait on a display name.
        void fetchAuthorName(found.owner_id).then((name) => (authorName = name));
        void listContributors(found.id).then((people) => (contributors = people));
        /* Only a slice has a box to go back to, and like the credit above this
           is fired off rather than awaited — a navigation aid must not hold up
           the set it sits over. */
        if (found.scope !== 'full') {
          void fetchParentSet(found.owner_id, found.local_id).then((box) => (parent = box));
        }
        set = await hydratePublishedSet(found, (done, total) => {
          progress = total > 0 ? `Fetching artwork ${done} of ${total}…` : null;
        });
        progress = null;
      } catch (cause) {
        error = cause instanceof Error ? cause.message : 'Could not open that set.';
      } finally {
        loading = false;
      }
    })();
  });

  /**
   * Take a copy to work on.
   *
   * Stops at the library rather than opening the copy, because "where did it
   * go?" is the question that follows a screen changing under someone — and
   * this screen is very often the first thing a person sees of the app.
   */
  async function fork(): Promise<void> {
    if (!set || !row || forking) return;
    forking = true;
    try {
      // `$state.snapshot` because `forkSet` clones, and `structuredClone`
      // throws on a reactive proxy.
      const copy = forkSet($state.snapshot(set), sourceOf(row, authorName));
      await saveSet(copy);
      await workshop.refreshLibrary();
      forked = copy.name;
    } finally {
      forking = false;
    }
  }
</script>

{#if printing && set}
  <PrintScreen {set} onback={() => (printing = false)} />
{:else}
  <div class="screen">
    <header class="head">
      <span class="mark" aria-hidden="true"></span>

      <div class="titles">
        <span class="eyebrow">Shared adventure set</span>
        <h1 class="title">{set?.name ?? row?.name ?? 'Opening…'}</h1>
        {#if set?.subtitle}<p class="subtitle">{set.subtitle}</p>{/if}

        <!--
          The creator, clearly visible at the top of their own set — not
          buried in the fork fineprint below, which is the only place a name
          showed before this. Bound through `@const` for the same reason the
          box link below is: the `{#if}` cannot narrow a reactive read for a
          callback that runs after it.
        -->
        {#if authorName && row}
          {@const ownerId = row.owner_id}
          <button type="button" class="author-link" onclick={() => navigation.openAuthor(ownerId)}>
            By {authorName}
          </button>
        {/if}

        <!--
          The box this slice came out of. Sits directly under the subtitle
          because that is the line that already names it — "From Forgotten
          Pantheons" as prose, then the same thing as somewhere to go.
        -->
        {#if parent}
          <!-- Bound through `@const`, because the `{#if}` cannot narrow a
               reactive read for a callback that runs long after it. -->
          {@const box = parent}
          <button type="button" class="parent-link" onclick={() => navigation.openShared(box.slug)}>
            <Icon name="layers" size={13} />
            Open {box.name}
          </button>
        {/if}

        {#if set}
          <p class="stats">
            {set.characters.length}
            {set.characters.length === 1 ? 'character' : 'characters'} ·
            {set.cards.length} cards
            {#if row?.published_at}
              · published {new Date(row.published_at).toLocaleDateString()}
            {/if}
            {#if row}· updated {new Date(row.updated_at).toLocaleDateString()}{/if}
            {#if row && row.revision > 1}· revision {row.revision}{/if}
          </p>

          <!--
            What the author says changed. Shown because a revision number tells
            a reader that something moved but not whether it matters to them.
          -->
          {#if row?.change_note}
            <p class="stats">Latest change: “{row.change_note}”</p>
          {/if}

          <!--
            A credit, not a changelog: who helped, not what they changed. The
            "what" stays between the owner and whoever proposed it — this only
            exists because their work is already sitting in the set below.
          -->
          {#if contributors.length > 0}
            <p class="stats credit">
              With contributions from
              {#each contributors as person, index (person.id)}
                {#if index > 0}{index === contributors.length - 1 ? ' and ' : ', '}{/if}
                <button
                  type="button"
                  class="author-link inline"
                  onclick={() => navigation.openAuthor(person.id)}
                >
                  {person.display_name || 'someone'}
                </button>
              {/each}
            </p>
          {/if}
        {/if}
      </div>

      <Button variant="ghost" onclick={() => navigation.leaveShared()}>
        <Icon name="chevronRight" size={13} />
        Done
      </Button>
    </header>

    {#if !cloudEnabled()}
      <p class="message">Sharing is not set up in this build.</p>
    {:else if loading}
      <p class="message">{progress ?? 'Opening the set…'}</p>
    {:else if error}
      <p class="message error" role="alert">{error}</p>
    {:else if set}
      {@const shown = computeScopedSet(set, viewScope)}
      {@const scopeOptions = scopeOptionsFor(set)}
      <!--
        The set left, its exports right — the same arrangement as the map
        editor, and for the same reason: the thing being looked at is by far
        the tallest element on the page, so anything placed under it is off
        screen exactly when it is wanted.
      -->
      <div class="split">
        <div class="main">
          <!--
            The filter, in the one place a viewer looking at the content would
            actually check for it — not tucked into the Export rail, where it
            was correct but easy to miss entirely (see `sets/scope.ts`'s
            `scopeOptionsFor`, the same list `ExportPanel`'s own picker builds
            from). Both read and write `viewScope`, so picking a character
            here also sets what `ExportPanel` exports, and vice versa — one
            piece of state, not two that could disagree.
          -->
          {#if scopeOptions.length > 1}
            <label class="filter-row">
              <span class="filter-label">Showing</span>
              <Select
                value={scopeKeyOf(viewScope)}
                options={scopeOptions}
                onchange={(key) => (viewScope = parseScopeKey(key))}
              />
            </label>
          {/if}
          <AssetsOverview set={shown} interactive={false} heading={false} />
        </div>

        <aside class="rail scroll-y">
          <!--
            Above the exports, because it is the one thing here that starts
            something rather than finishing it.

            Shown only once a copy exists — see `SHOW_FORK`. Nothing below is
            removed: a fork already taken still finds its way home from here.
          -->
          {#if SHOW_FORK || forked}
          <section class="panel">
            <h2 class="panel-title">Build on this</h2>

            {#if forked}
              <p class="panel-hint">
                “{forked}” is in your library, with this set recorded as where it
                came from.
              </p>
              <Button
                variant="primary"
                onclick={() => navigation.leaveShared({ kind: 'home' })}
              >
                Go to Home
              </Button>
            {:else}
              <Button variant="primary" disabled={forking} onclick={fork}>
                <Icon name="download" size={13} />
                Make a copy to work on
              </Button>
              <p class="fineprint">
                Yours to change{authorName ? `, credited to ${authorName}` : ''}, and
                it remembers which version it started from. Their set is untouched
                by anything you do to yours.
              </p>
            {/if}
          </section>
          {/if}

          <section class="panel">
            <h2 class="panel-title">Export</h2>
            <p class="panel-hint">
              Shares the "Showing" pick above — change either one and the other follows.
            </p>
            <ExportPanel {set} onprint={() => (printing = true)} bind:scope={viewScope} />
          </section>
        </aside>
      </div>
    {/if}
  </div>
{/if}

<style>
  /*
   * The masthead is fixed and the body scrolls, rather than the page scrolling
   * as a whole: the overview is hundreds of cards long, and the set's name is
   * the one thing a viewer should never have to scroll back up to find.
   *
   * `base.css` sets `body { overflow: hidden }` — the shell owns all scrolling
   * — and this screen renders outside the shell, so the scrolling here is its
   * own or there is none at all.
   */
  .screen {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    background: var(--surface-sunken);
    color: var(--text-default);
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-6);
    border-bottom: 1px solid var(--border-default);
    background: var(--surface-default);
  }

  .mark {
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    background: linear-gradient(140deg, var(--accent, #c0392b), var(--grey-900, #222));
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    margin-right: auto;
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

  .subtitle,
  .stats,
  .message,
  .fineprint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .stats {
    font-size: var(--text-xs);
  }

  /*
   * `align-self: start` because `.titles` is a column flex container, and a
   * button in one stretches to the column's full width by default — which put
   * a full-bleed bar across the header for a two-word link.
   */
  .parent-link {
    display: flex;
    align-self: start;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-xs);
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .parent-link:hover {
    border-color: var(--accent);
    color: var(--text-default);
  }

  .credit {
    font-style: italic;
  }

  /*
   * Reads as text, not as a pill — this sits right under the title, where the
   * author's name has always belonged, and a button styled to disappear into
   * a line of prose is what makes "By Someone" read as a byline rather than a
   * control bolted on beside it.
   */
  .author-link {
    align-self: start;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: transparent;
    transition: color var(--duration-fast) var(--ease-out);
  }

  .author-link:hover {
    color: var(--text-default);
    text-decoration-color: currentcolor;
  }

  /* Inline inside the "With contributions from …" sentence, at its size. */
  .author-link.inline {
    display: inline;
    font-size: inherit;
    color: var(--text-secondary);
  }

  .message {
    padding: var(--space-6);
  }

  .error {
    color: var(--danger);
  }

  /*
   * A fixed rail rather than a shrinking one: the export list has a natural
   * width and the overview does not, so the flexible column is the board.
   */
  .split {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(240px, 24vw, 320px);
  }

  /* The overview owns its own scrolling; this is only the box it fills. */
  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  /* `AssetsOverview`'s own `.page` carries `flex: 1 1 auto`, which is what
     lets it still fill the column below this rather than needing a size of
     its own here. */
  .filter-row {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-8) 0;
  }

  .filter-label {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--text-tertiary);
  }

  .rail {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    border-left: 1px solid var(--border-default);
    background: var(--surface-base);
  }

  .panel {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
  }

  /* A rule between the two, so "build on this" reads as its own offer. */
  .panel + .panel {
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-default);
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

  .fineprint {
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }
</style>
