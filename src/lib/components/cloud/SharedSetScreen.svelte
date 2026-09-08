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
  import { collectionsForSet } from '$lib/cloud/collections';
  import type { Contributor } from '$lib/cloud/contributions';
  import { auth } from '$lib/cloud/auth.svelte';
  import {
    createSetComment,
    deleteSetComment,
    editSetComment,
    favouriteKey,
    listMyFavourites,
    listMyLikes,
    listSetComments,
    reportSetComment,
    setFavourite,
    setLiked
  } from '$lib/cloud/engagement';
  import type { FavouriteTarget, SetComment } from '$lib/cloud/engagement';
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
  import { Button, Icon, Select, TextArea } from '$lib/ui';

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
  /**
   * Collections this set is an accepted member of.
   *
   * Accepted and reachable only — `collections_for_set` filters both, so a
   * pending invitation and a private project can never be disclosed here by a
   * page that anybody with a link can open.
   */
  let partOf = $state<{ slug: string; name: string }[]>([]);

  /** The forked copy, once one has been taken. Names the set for the message. */
  let forked = $state<string | null>(null);
  let forking = $state(false);
  let compactLayout = $state(false);
  let actionsDialog = $state<HTMLDialogElement | null>(null);

  let comments = $state<SetComment[]>([]);
  let commentsLoading = $state(false);
  let commentDraft = $state('');
  let commentBusy = $state(false);
  let editingCommentId = $state<string | null>(null);
  let editDraft = $state('');
  let deletingCommentId = $state<string | null>(null);
  let reportingCommentId = $state<string | null>(null);
  let reportReason = $state('');
  let communityError = $state<string | null>(null);
  let communityMessage = $state<string | null>(null);
  let liked = $state(false);
  let favourited = $state(false);
  let likeCount = $state(0);
  let commentCount = $state(0);
  let reactionBusy = $state(false);

  const canEngage = $derived(auth.signedIn && !auth.isAnonymous);

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

  /*
   * The export rail needs a real minimum width to remain usable, but that is
   * most of a phone. Let the same actions become a modal sheet there instead
   * of squeezing the set overview into the leftover strip.
   */
  $effect(() => {
    const query = window.matchMedia('(max-width: 700px)');
    const update = (): void => {
      compactLayout = query.matches;
    };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  });

  $effect(() => {
    if (!compactLayout && actionsDialog?.open) actionsDialog.close();
  });

  $effect(() => {
    const wanted = slug;
    loading = true;
    error = null;
    forked = null;
    parent = null;
    comments = [];
    commentsLoading = false;
    commentDraft = '';
    editingCommentId = null;
    reportingCommentId = null;
    communityError = null;
    communityMessage = null;
    liked = false;
    favourited = false;
    likeCount = 0;
    commentCount = 0;
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
        likeCount = found.like_count ?? 0;
        commentCount = found.comment_count ?? 0;
        // Fired off rather than awaited: the credit is wanted for the fork
        // button, and nothing on the page should wait on a display name.
        void fetchAuthorName(found.owner_id).then((name) => (authorName = name));
        void listContributors(found.id).then((people) => (contributors = people));
        /* Fired off like the credit above, and for the same reason: a
           navigation aid must never hold up the set somebody came to see.
           `collectionsForSet` swallows its own failure, so this cannot throw
           into the load. */
        void collectionsForSet(found.id).then((rows) => (partOf = rows));
        /* Only a slice has a box to go back to, and like the credit above this
           is fired off rather than awaited — a navigation aid must not hold up
           the set it sits over. */
        if (found.scope !== 'full') {
          void fetchParentSet(found.owner_id, found.local_id).then((box) => (parent = box));
        }
        if (found.visibility === 'public') void refreshComments(found.id);
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
      if (await workshop.addSet(copy)) forked = copy.name;
    } finally {
      forking = false;
    }
  }

  async function refreshComments(setId: string): Promise<void> {
    commentsLoading = true;
    try {
      const found = await listSetComments(setId);
      if (row?.id !== setId) return;
      comments = found;
      commentCount = found.length;
    } catch (cause) {
      if (row?.id === setId) {
        communityError = cause instanceof Error ? cause.message : 'Could not load the comments.';
      }
    } finally {
      if (row?.id === setId) commentsLoading = false;
    }
  }

  $effect(() => {
    const setId = row?.visibility === 'public' ? row.id : '';
    const accountId = canEngage ? (auth.user?.id ?? '') : '';
    if (!setId || !accountId) {
      liked = false;
      favourited = false;
      return;
    }

    void Promise.all([listMyLikes(), listMyFavourites()])
      .then(([likes, favourites]) => {
        if (row?.id !== setId || auth.user?.id !== accountId || auth.isAnonymous) return;
        liked = likes.includes(setId);
        favourited = favourites.some(
          (target) => favouriteKey(target) === favouriteKey({ kind: 'set', set_id: setId })
        );
      })
      .catch(() => {
        // The shared set and its comments are public. A private-state failure
        // must not replace either one with an account error.
      });
  });

  function needAccount(): void {
    communityError = auth.isAnonymous
      ? 'Likes, favourites and comments need a permanent account.'
      : 'Sign in with a permanent account to like, favourite or comment.';
  }

  async function toggleLike(): Promise<void> {
    if (!row || reactionBusy) return;
    if (!canEngage) {
      needAccount();
      return;
    }

    const next = !liked;
    liked = next;
    likeCount = Math.max(0, likeCount + (next ? 1 : -1));
    reactionBusy = true;
    communityError = null;
    try {
      await setLiked(row.id, next);
    } catch (cause) {
      liked = !next;
      likeCount = Math.max(0, likeCount + (next ? -1 : 1));
      communityError = cause instanceof Error ? cause.message : 'Could not update that like.';
    } finally {
      reactionBusy = false;
    }
  }

  async function toggleFavourite(): Promise<void> {
    if (!row || reactionBusy) return;
    if (!canEngage) {
      needAccount();
      return;
    }

    const target: FavouriteTarget = { kind: 'set', set_id: row.id };
    const next = !favourited;
    favourited = next;
    reactionBusy = true;
    communityError = null;
    try {
      await setFavourite(target, next);
    } catch (cause) {
      favourited = !next;
      communityError = cause instanceof Error ? cause.message : 'Could not update that favourite.';
    } finally {
      reactionBusy = false;
    }
  }

  async function postComment(): Promise<void> {
    if (!row || commentBusy) return;
    if (!canEngage) {
      needAccount();
      return;
    }
    commentBusy = true;
    communityError = null;
    communityMessage = null;
    try {
      await createSetComment(row.id, commentDraft);
      commentDraft = '';
      await refreshComments(row.id);
    } catch (cause) {
      communityError = cause instanceof Error ? cause.message : 'Could not post that comment.';
    } finally {
      commentBusy = false;
    }
  }

  function beginEdit(comment: SetComment): void {
    editingCommentId = comment.id;
    editDraft = comment.body;
    deletingCommentId = null;
    reportingCommentId = null;
    communityError = null;
  }

  async function saveEdit(commentId: string): Promise<void> {
    if (!row || commentBusy) return;
    commentBusy = true;
    communityError = null;
    try {
      await editSetComment(commentId, editDraft);
      editingCommentId = null;
      await refreshComments(row.id);
    } catch (cause) {
      communityError = cause instanceof Error ? cause.message : 'Could not edit that comment.';
    } finally {
      commentBusy = false;
    }
  }

  async function removeComment(commentId: string): Promise<void> {
    if (!row || commentBusy || deletingCommentId !== commentId) return;
    commentBusy = true;
    communityError = null;
    try {
      await deleteSetComment(commentId);
      if (editingCommentId === commentId) editingCommentId = null;
      await refreshComments(row.id);
    } catch (cause) {
      communityError = cause instanceof Error ? cause.message : 'Could not delete that comment.';
    } finally {
      deletingCommentId = null;
      commentBusy = false;
    }
  }

  async function sendReport(commentId: string): Promise<void> {
    if (commentBusy) return;
    commentBusy = true;
    communityError = null;
    communityMessage = null;
    try {
      await reportSetComment(commentId, reportReason);
      reportingCommentId = null;
      reportReason = '';
      communityMessage = 'Report sent. Thank you.';
    } catch (cause) {
      communityError = cause instanceof Error ? cause.message : 'Could not send that report.';
    } finally {
      commentBusy = false;
    }
  }

  function commentDate(comment: SetComment): string {
    const edited = comment.updated_at !== comment.created_at;
    const date = new Date(edited ? comment.updated_at : comment.created_at).toLocaleDateString();
    return edited ? `${date} · edited` : date;
  }

  function openActions(): void {
    if (actionsDialog && !actionsDialog.open) actionsDialog.showModal();
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

        {#if row?.visibility === 'public'}
          <div class="header-engagement">
            <button
              type="button"
              class="engagement-button"
              class:active={liked}
              aria-pressed={liked}
              disabled={reactionBusy}
              onclick={() => void toggleLike()}
            >
              <Icon name="thumbUp" size={15} />
              <span class="numeric">{likeCount}</span>
              <span>{liked ? 'Liked' : 'Like'}</span>
            </button>
            <span class="engagement-count" title="Comments">
              <Icon name="message" size={15} />
              <span class="numeric">{commentCount}</span>
            </span>
            <button
              type="button"
              class="engagement-button"
              class:active={favourited}
              aria-pressed={favourited}
              disabled={reactionBusy}
              onclick={() => void toggleFavourite()}
            >
              <Icon name="bookmark" size={15} />
              <span>{favourited ? 'Favourited' : 'Favourite'}</span>
            </button>
          </div>
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
          <!--
            Where this deck is played as part of something bigger. Placed with
            the credits rather than in the header because it is the same kind
            of fact: whose work surrounds this one, not what the set is.
          -->
          {#if partOf.length > 0}
            <p class="stats credit">
              Part of
              {#each partOf as entry, index (entry.slug)}
                {#if index > 0}{index === partOf.length - 1 ? ' and ' : ', '}{/if}
                <button
                  type="button"
                  class="author-link inline"
                  onclick={() => navigation.openCollection(entry.slug)}
                >
                  {entry.name || 'a collection'}
                </button>
              {/each}
            </p>
          {/if}

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
      {#snippet commentPanel()}
        {#if row?.visibility === 'public'}
          <section class="panel community-panel">
            <h2 class="panel-title">Comments</h2>

            {#if communityError}
              <p class="community-note error" role="alert">{communityError}</p>
            {:else if communityMessage}
              <p class="community-note" role="status">{communityMessage}</p>
            {/if}

            {#if commentsLoading}
              <p class="panel-hint">Loading comments…</p>
            {:else if comments.length === 0}
              <p class="panel-hint">No comments yet.</p>
            {:else}
              <div class="comments">
                {#each comments as comment (comment.id)}
                  <article class="comment">
                    <header class="comment-head">
                      <button
                        type="button"
                        class="comment-author"
                        onclick={() => navigation.openAuthor(comment.author_id)}
                      >
                        {#if comment.author?.avatar_url}
                          <img src={comment.author.avatar_url} alt="" loading="lazy" />
                        {/if}
                        <span>{comment.author?.display_name || 'Anonymous'}</span>
                      </button>
                      <time datetime={comment.updated_at}>{commentDate(comment)}</time>
                    </header>

                    {#if editingCommentId === comment.id}
                      <form
                        class="comment-form"
                        onsubmit={(event) => {
                          event.preventDefault();
                          void saveEdit(comment.id);
                        }}
                      >
                        <TextArea bind:value={editDraft} rows={3} maxlength={2000} />
                        <div class="comment-form-actions">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onclick={() => (editingCommentId = null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={commentBusy || editDraft.trim().length === 0}
                          >
                            Save
                          </Button>
                        </div>
                      </form>
                    {:else}
                      <p class="comment-body">{comment.body}</p>
                      <div class="comment-actions">
                        {#if auth.user?.id === comment.author_id && !auth.isAnonymous}
                          <button type="button" onclick={() => beginEdit(comment)}>Edit</button>
                          {#if deletingCommentId === comment.id}
                            <button type="button" onclick={() => (deletingCommentId = null)}>Cancel</button>
                            <button
                              type="button"
                              class="confirm-delete"
                              disabled={commentBusy}
                              onclick={() => void removeComment(comment.id)}
                            >
                              {commentBusy ? 'Deleting…' : 'Delete comment'}
                            </button>
                          {:else}
                            <button
                              type="button"
                              onclick={() => {
                                deletingCommentId = comment.id;
                                reportingCommentId = null;
                              }}
                            >Delete</button>
                          {/if}
                        {:else}
                          <button
                            type="button"
                            onclick={() => {
                              reportingCommentId = reportingCommentId === comment.id ? null : comment.id;
                              reportReason = '';
                            }}
                          >
                            Report
                          </button>
                        {/if}
                      </div>
                    {/if}

                    {#if reportingCommentId === comment.id}
                      <form
                        class="comment-form report-form"
                        onsubmit={(event) => {
                          event.preventDefault();
                          void sendReport(comment.id);
                        }}
                      >
                        <TextArea
                          bind:value={reportReason}
                          rows={2}
                          maxlength={500}
                          placeholder="What should a moderator know?"
                        />
                        <div class="comment-form-actions">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onclick={() => (reportingCommentId = null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={commentBusy || reportReason.trim().length === 0}
                          >
                            Send report
                          </Button>
                        </div>
                      </form>
                    {/if}
                  </article>
                {/each}
              </div>
            {/if}

            {#if canEngage}
              <form
                class="comment-form new-comment"
                onsubmit={(event) => {
                  event.preventDefault();
                  void postComment();
                }}
              >
                <TextArea
                  bind:value={commentDraft}
                  rows={3}
                  maxlength={2000}
                  placeholder="Add a comment…"
                />
                <div class="comment-form-actions">
                  <span class="character-count numeric">{commentDraft.length}/2000</span>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={commentBusy || commentDraft.trim().length === 0}
                  >
                    {commentBusy ? 'Posting…' : 'Post comment'}
                  </Button>
                </div>
              </form>
            {:else}
              <button type="button" class="sign-in-note" onclick={needAccount}>
                Sign in with a permanent account to comment.
              </button>
            {/if}
          </section>
        {/if}
      {/snippet}

      {#snippet actions(currentSet: AdventureSet)}
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
          <ExportPanel set={currentSet} onprint={() => (printing = true)} bind:scope={viewScope} />
        </section>

        {@render commentPanel()}
      {/snippet}
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
          {#if compactLayout}
            <button type="button" class="mobile-actions" onclick={openActions}>
              <Icon name="settings" size={14} />
              Actions
            </button>
          {/if}
          <AssetsOverview set={shown} interactive={false} heading={false} />
        </div>

        {#if !compactLayout}
          <aside class="rail scroll-y">
            {@render actions(set)}
          </aside>
        {/if}
      </div>

      <dialog bind:this={actionsDialog} class="actions-sheet" aria-labelledby="actions-sheet-title">
        {#if compactLayout}
          <div class="sheet-inner scroll-y">
            <header class="sheet-head">
              <h2 id="actions-sheet-title">Actions</h2>
              <button type="button" class="sheet-close" onclick={() => actionsDialog?.close()}>
                Close
              </button>
            </header>
            {@render actions(set)}
          </div>
        {/if}
      </dialog>
    {/if}
  </div>
{/if}

<style>
  /*
   * The masthead is fixed and the body scrolls, rather than the page scrolling
   * as a whole: the overview is hundreds of cards long, and the set's name is
   * the one thing a viewer should never have to scroll back up to find.
   *
    * `base.css` sets `body { overflow: hidden }`. This screen is outside the
    * set shell but inside the application frame, so the overview still owns
    * its scrolling within the height left beneath the global banner.
   */
  .screen {
    display: flex;
    flex-direction: column;
    height: 100%;
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

  .header-engagement {
    display: flex;
    align-items: center;
    align-self: flex-start;
    gap: var(--space-1);
    margin-top: var(--space-2);
  }

  .engagement-button,
  .engagement-count {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 30px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .engagement-button {
    border: 1px solid transparent;
    background: transparent;
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .engagement-button:hover,
  .engagement-button.active {
    border-color: var(--border-default);
    background: var(--surface-selected);
    color: var(--text-default);
  }

  .engagement-button.active :global(svg) {
    fill: currentColor;
  }

  .engagement-button:disabled {
    opacity: 0.55;
    cursor: wait;
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

  .mobile-actions {
    display: none;
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

  .community-panel,
  .comments,
  .comment-form {
    width: 100%;
  }

  .community-note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .comments {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .comment {
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
  }

  .comment-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .comment-author {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-default);
    font: inherit;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    cursor: pointer;
  }

  .comment-author img {
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
  }

  .comment-head time,
  .character-count {
    flex: none;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .comment-body {
    margin: var(--space-2) 0 0;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .comment-actions {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-1);
  }

  .comment-actions button,
  .sign-in-note {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-2xs);
    text-decoration: underline;
    text-decoration-color: transparent;
    cursor: pointer;
  }

  .comment-actions button:hover,
  .sign-in-note:hover {
    color: var(--text-default);
    text-decoration-color: currentcolor;
  }

  .comment-actions .confirm-delete {
    color: var(--danger);
  }

  .comment-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .comment-form-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .new-comment {
    padding-top: var(--space-1);
  }

  .new-comment .character-count {
    margin-right: auto;
  }

  .report-form {
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
  }

  .sign-in-note {
    text-align: left;
  }

  .fineprint {
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }

  /* The content is the page on a phone. Copying and exporting are still one
     tap away, but no longer take a permanent slice out of the card overview. */
  @media (max-width: 700px) {
    .split {
      grid-template-columns: minmax(0, 1fr);
    }

    .filter-row {
      padding: var(--space-4) var(--space-4) 0;
    }

    .mobile-actions {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      min-height: 44px;
      margin: var(--space-3) var(--space-4) 0;
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
      background: var(--surface-default);
      color: var(--text-default);
      font: inherit;
      font-size: var(--text-sm);
      font-weight: var(--weight-semibold);
    }

    .actions-sheet {
      width: 100%;
      max-width: none;
      max-height: min(78dvh, 640px);
      margin: auto 0 0;
      padding: 0;
      border: 1px solid var(--border-default);
      border-bottom: none;
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      background: var(--surface-base);
      color: var(--text-default);
    }

    .actions-sheet::backdrop {
      background: color-mix(in srgb, var(--grey-1000) 68%, transparent);
    }

    .sheet-inner {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      max-height: inherit;
      padding: var(--space-5) var(--space-4) calc(var(--space-5) + env(safe-area-inset-bottom));
    }

    .sheet-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4);
    }

    .sheet-head h2 {
      margin: 0;
      font-size: var(--text-lg);
    }

    .sheet-close {
      min-height: 44px;
      padding: 0 var(--space-3);
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--text-muted);
      font: inherit;
      font-size: var(--text-sm);
    }
  }
</style>
