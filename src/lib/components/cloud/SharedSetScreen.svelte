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
  import ExportPanel from '$lib/components/export/ExportPanel.svelte';
  import AssetsOverview from '$lib/components/tools/AssetsOverview.svelte';
  import { listContributors } from '$lib/cloud/contributions';
  import type { Contributor } from '$lib/cloud/contributions';
  import { fetchAuthorName, fetchSetBySlug, hydratePublishedSet } from '$lib/cloud/sets';
  import type { PublishedSetWithDocument } from '$lib/cloud/sets';
  import { cloudEnabled } from '$lib/cloud/config';
  import PrintScreen from '$lib/print/PrintScreen.svelte';
  import { forkSet, sourceOf } from '$lib/sets/fork';
  import type { AdventureSet } from '$lib/sets/types';
  import { navigation } from '$lib/state/navigation.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { saveSet } from '$lib/storage/library';
  import { Button, Icon } from '$lib/ui';

  interface Props {
    slug: string;
  }

  let { slug }: Props = $props();

  /**
   * Whether to offer taking a copy.
   *
   * Off for now, and the whole of what "off" means is that the button is not
   * drawn: `fork()` below, `sets/fork.ts`, the fingerprint it records and the
   * lineage the row carries are all untouched, and a copy already taken still
   * shows its way back to the library. Contributions are the next rung and
   * this release is the heroes' — offering a route into a feature that is not
   * finished is worse than not offering it yet.
   */
  const SHOW_FORK = false;

  let row = $state<PublishedSetWithDocument | null>(null);
  let set = $state<AdventureSet | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let progress = $state<string | null>(null);

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

  $effect(() => {
    const wanted = slug;
    loading = true;
    error = null;
    forked = null;

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
  function fork(): void {
    if (!set || !row || forking) return;
    forking = true;
    try {
      // `$state.snapshot` because `forkSet` clones, and `structuredClone`
      // throws on a reactive proxy.
      const copy = forkSet($state.snapshot(set), sourceOf(row, authorName));
      saveSet(copy);
      workshop.refreshLibrary();
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
              With contributions from {contributors
                .map((person) => person.display_name || 'someone')
                .join(', ')}
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
      <!--
        The set left, its exports right — the same arrangement as the map
        editor, and for the same reason: the thing being looked at is by far
        the tallest element on the page, so anything placed under it is off
        screen exactly when it is wanted.
      -->
      <div class="split">
        <div class="main">
          <AssetsOverview {set} interactive={false} heading={false} />
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
                onclick={() => navigation.leaveShared({ kind: 'library' })}
              >
                Go to my library
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
            <p class="panel-hint">Everything here covers the whole set.</p>
            <ExportPanel {set} onprint={() => (printing = true)} />
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

  .credit {
    font-style: italic;
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
    min-width: 0;
    min-height: 0;
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
