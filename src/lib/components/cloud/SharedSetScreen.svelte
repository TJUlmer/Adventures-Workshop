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
  import { fillCss } from '$lib/cards/style';
  import { resolveCardTheme } from '$lib/cards/theme';
  import { characterLabel } from '$lib/characters/factory';
  import type { Character, CharacterId } from '$lib/characters/types';
  import ExportPanel from '$lib/components/export/ExportPanel.svelte';
  import AssetsOverview from '$lib/components/tools/AssetsOverview.svelte';
  import { GALLERY_CARD_SIZE } from '$lib/components/tools/gallery-inspection';
  import { listContributors } from '$lib/cloud/contributions';
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
  import { CARD_PREVIEW_RENDERER_VERSION } from '$lib/cloud/card-previews';
  import { coverArtwork } from '$lib/cloud/thumbnail';
  import {
    fetchAuthorName,
    fetchParentSet,
    fetchSetBySlug,
    hydratePublishedSet,
    readPublishedSet
  } from '$lib/cloud/sets';
  import type { PublishedSetWithDocument } from '$lib/cloud/sets';
  import { cloudEnabled } from '$lib/cloud/config';
  import PrintScreen from '$lib/print/PrintScreen.svelte';
  import { displayFontStack, displayFontWeight } from '$lib/renderer/fonts';
  import { forkSet, sourceOf } from '$lib/sets/fork';
  import { computeScopedSet, parseScopeKey, scopeKeyOf, scopeOptionsFor } from '$lib/sets/scope';
  import { charactersByRole, setStats } from '$lib/sets/queries';
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
  /** Immediate URL-backed copy, promoted to embedded assets after first paint. */
  let set = $state<AdventureSet | null>(null);
  /** Fully embedded copy required by exports, printing and offline forks. */
  let portableSet = $state.raw<AdventureSet | null>(null);
  let portableProgress = $state<string | null>(null);
  let portableError = $state<string | null>(null);
  let portableBusy = $state(false);
  let portablePromise: Promise<AdventureSet> | null = null;
  let loadGeneration = 0;
  let sharedLoadController: AbortController | null = null;

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
  let viewScope = $state<PublishScope>({ kind: 'full' });
  let previousScopeKey = untrack(() => scopeKeyOf(viewScope));

  /*
   * Print sheets are a screen, not a file, and this screen is outside the
   * router — so it shows them itself rather than navigating. `navigation.go`
   * would leave the shared view entirely and land on whatever set happened to
   * be open in the library.
   */
  let printSet = $state.raw<AdventureSet | null>(null);

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
  let compactLayout = $state(false);
  let actionsDialog = $state<HTMLDialogElement | null>(null);
  let cardSize = $state<number>(GALLERY_CARD_SIZE.start);
  const publishedCardPreviews = $derived(
    row?.card_preview_version === CARD_PREVIEW_RENDERER_VERSION ? row.card_previews : undefined
  );

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
  let failedMastheadArtwork = $state<string[]>([]);

  function openPrint(selected: AdventureSet): void {
    printSet = selected;
  }

  function retryPreparation(): void {
    const published = row;
    if (!published) return;
    portableError = null;
    void preparePortable(published).catch(() => {
      // `preparePortable` leaves the useful error beside the retry control.
    });
  }

  function preparePortable(
    published: PublishedSetWithDocument,
    generation = loadGeneration,
    signal = sharedLoadController?.signal
  ): Promise<AdventureSet> {
    if (portableSet && row?.id === published.id) return Promise.resolve(portableSet);
    if (portablePromise && row?.id === published.id) return portablePromise;

    portableBusy = true;
    portableError = null;
    portableProgress = 'Preparing downloads…';
    const task = hydratePublishedSet(
      published,
      (done, total) => {
        if (generation !== loadGeneration || row?.id !== published.id) return;
        portableProgress =
          total > 0 ? `Preparing artwork ${done} of ${total}…` : 'Preparing downloads…';
      },
      signal
    )
      .then((hydrated) => {
        if (generation === loadGeneration && row?.id === published.id) {
          /* Canvas and WebGL component previews cannot safely consume the
             public URLs used for first paint. Keep that fast paint, then
             promote the viewer to the embedded copy once it is available. */
          set = hydrated;
          portableSet = hydrated;
          portableProgress = null;
        }
        return hydrated;
      })
      .catch((cause: unknown) => {
        if (generation === loadGeneration && row?.id === published.id) {
          portableError =
            cause instanceof Error ? cause.message : 'Could not prepare this set for download.';
          portableProgress = null;
        }
        throw cause;
      })
      .finally(() => {
        if (generation === loadGeneration && row?.id === published.id) {
          portableBusy = false;
          if (portablePromise === task) portablePromise = null;
        }
      });
    portablePromise = task;
    return task;
  }

  const canEngage = $derived(auth.signedIn && !auth.isAnonymous);

  type MastheadMode = 'hero' | 'villain' | 'adventure' | 'set';

  /**
   * The masthead celebrates what the visitor is actually looking at, not
   * merely the database row that got them here. A character-gallery click is
   * a full-set URL plus `characterHint`, so using `set.name` alone is exactly
   * how a Maui page kept announcing Forgotten Pantheons above Maui's cards.
   */
  const shownSet = $derived(set ? computeScopedSet(set, viewScope) : null);

  const mastheadMode = $derived.by((): MastheadMode => {
    if (viewScope.kind === 'hero' || (viewScope.kind === 'full' && row?.scope === 'hero')) {
      return 'hero';
    }
    if (viewScope.kind === 'villain' || (viewScope.kind === 'full' && row?.scope === 'villain')) {
      return 'villain';
    }
    if (!set) return row?.kind === 'adventure' ? 'adventure' : 'set';
    if (set.kind === 'adventure') return 'adventure';
    return charactersByRole(set, 'hero').length === 1 ? 'hero' : 'set';
  });

  const mastheadCharacter = $derived.by((): Character | null => {
    const currentSet = set;
    const currentScope = viewScope;
    const currentRow = row;
    if (!currentSet) return null;
    if (currentScope.kind === 'hero') {
      return (
        currentSet.characters.find((character) => character.id === currentScope.characterId) ?? null
      );
    }
    if (currentScope.kind === 'villain' || currentRow?.scope === 'villain') {
      return charactersByRole(currentSet, 'villain')[0] ?? null;
    }
    if (currentRow?.scope === 'hero') {
      return (
        currentSet.characters.find((character) => character.id === currentRow.character_id) ??
        charactersByRole(currentSet, 'hero')[0] ??
        null
      );
    }
    if (currentSet.kind === 'heroes' && charactersByRole(currentSet, 'hero').length === 1) {
      return charactersByRole(currentSet, 'hero')[0] ?? null;
    }
    return null;
  });

  const mastheadThemeCharacter = $derived(
    mastheadCharacter ??
      (set ? charactersByRole(set, 'villain')[0] ?? charactersByRole(set, 'hero')[0] ?? null : null)
  );
  const mastheadTheme = $derived(
    resolveCardTheme(
      set?.style ?? null,
      mastheadThemeCharacter?.style ?? null,
      null,
      'action',
      mastheadThemeCharacter?.role
    )
  );
  const mastheadAccent = $derived(
    (mastheadMode === 'adventure' || mastheadMode === 'villain') && set?.threat.enabled
      ? set.threat.accent
      : fillCss(mastheadTheme.banner)
  );
  const mastheadCover = $derived(shownSet ? coverArtwork(shownSet) : null);
  const mastheadSubjectIsScoped = $derived(
    viewScope.kind !== 'full' || row?.scope === 'hero' || row?.scope === 'villain'
  );
  const mastheadTitle = $derived(shownSet?.name || row?.name || 'Opening…');
  const mastheadContext = $derived(shownSet?.subtitle || row?.subtitle || '');
  const mastheadKicker = $derived(
    mastheadMode === 'hero'
      ? 'Meet the hero'
      : mastheadMode === 'villain'
        ? 'Face the villain'
        : mastheadMode === 'adventure'
          ? 'Enter the adventure'
          : 'Discover the set'
  );
  const mastheadCoverUrl = $derived(mastheadCover?.source ?? '');
  const mastheadBackdropCandidates = $derived(
    mastheadSubjectIsScoped
      ? artworkCandidates(mastheadCoverUrl, row?.thumbnail_url, row?.cover_url)
      : artworkCandidates(
          row?.thumbnail_url,
          mastheadCoverUrl,
          row?.cover_url,
          row?.social_image_url
        )
  );
  const mastheadPosterCandidates = $derived.by(() => {
    if (mastheadSubjectIsScoped) {
      if (row?.scope === 'hero' && viewScope.kind === 'full') {
        return artworkCandidates(
          row.social_image_url,
          mastheadCoverUrl,
          row.thumbnail_url,
          row.cover_url
        );
      }
      return artworkCandidates(mastheadCoverUrl, row?.thumbnail_url, row?.cover_url);
    }
    if (mastheadMode === 'hero' || mastheadMode === 'set') {
      return artworkCandidates(
        row?.social_image_url,
        mastheadCoverUrl,
        row?.thumbnail_url,
        row?.cover_url
      );
    }
    return artworkCandidates(
      row?.thumbnail_url,
      mastheadCoverUrl,
      row?.social_image_url,
      row?.cover_url
    );
  });
  const mastheadBackdropUrl = $derived(
    mastheadBackdropCandidates.find((url) => !failedMastheadArtwork.includes(url)) ?? ''
  );
  const mastheadPosterUrl = $derived(
    mastheadPosterCandidates.find((url) => !failedMastheadArtwork.includes(url)) ?? ''
  );
  const mastheadPosterIsComposition = $derived(
    Boolean(row?.social_image_url && mastheadPosterUrl === row.social_image_url)
  );

  function artworkCandidates(...candidates: Array<string | null | undefined>): string[] {
    const unique: string[] = [];
    for (const candidate of candidates) {
      if (candidate && !unique.includes(candidate)) unique.push(candidate);
    }
    return unique;
  }

  function rejectMastheadArtwork(event: Event): void {
    const source = (event.currentTarget as HTMLImageElement).getAttribute('src');
    if (source && !failedMastheadArtwork.includes(source)) {
      failedMastheadArtwork = [...failedMastheadArtwork, source];
    }
  }

  /**
   * A gallery character hint can identify any roster role. Heroes have their
   * own scope; a villain or minion belongs to the one combined villain side.
   * Published slices already state their scope and therefore take priority.
   */
  function scopeForPublishedView(
    published: PublishedSetWithDocument,
    hydrated: AdventureSet,
    hint: string | undefined
  ): PublishScope {
    if (published.scope === 'villain') return { kind: 'villain' };
    if (published.scope === 'hero') {
      const characterId = published.character_id || hint;
      return characterId
        ? { kind: 'hero', characterId: characterId as CharacterId }
        : { kind: 'full' };
    }
    if (!hint) return { kind: 'full' };

    const character = hydrated.characters.find((candidate) => candidate.id === hint);
    if (character?.role === 'hero') {
      /* A one-hero heroes set already is that hero's complete product. Slicing
         it only removes unassigned companion pieces — sidekick dials and
         tokens have no separate character id to attach to — and swaps the
         set's current social composition for its fallback artwork. */
      if (hydrated.kind === 'heroes' && charactersByRole(hydrated, 'hero').length === 1) {
        return { kind: 'full' };
      }
      return { kind: 'hero', characterId: character.id };
    }
    if (character?.role === 'villain' || character?.role === 'minion') {
      return { kind: 'villain' };
    }
    return { kind: 'full' };
  }

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
    const nextScopeKey = scopeKeyOf(viewScope);
    if (nextScopeKey === previousScopeKey) return;
    previousScopeKey = nextScopeKey;
    // ExportPanel edits this same state from the rail/sheet, so scope changes
    // from either control reset the one shared viewing surface consistently.
    requestAnimationFrame(() => scrollToExplore('top', false));
  });

  $effect(() => {
    const wanted = slug;
    const hint = characterHint;
    const generation = ++loadGeneration;
    const controller = new AbortController();
    sharedLoadController = controller;
    let current = true;
    let cancelPreparation = (): void => {};
    loading = true;
    error = null;
    row = null;
    set = null;
    portableSet = null;
    portablePromise = null;
    portableProgress = null;
    portableError = null;
    portableBusy = false;
    authorName = '';
    contributors = [];
    progress = null;
    failedMastheadArtwork = [];
    forked = null;
    parent = null;
    comments = [];
    commentsLoading = false;
    commentDraft = '';
    editingCommentId = null;
    reportingCommentId = null;
    communityError = null;
    communityMessage = null;
    printSet = null;
    liked = false;
    favourited = false;
    likeCount = 0;
    commentCount = 0;
    // A stale hero id from the previous set would otherwise survive the
    // navigation and quietly filter the overview down to nothing.
    viewScope = { kind: 'full' };

    void (async () => {
      try {
        const found = await fetchSetBySlug(wanted, controller.signal);
        if (!current) return;
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
        void fetchAuthorName(found.owner_id).then((name) => {
          if (current) authorName = name;
        });
        void listContributors(found.id).then((people) => {
          if (current) contributors = people;
        });
        /* Only a slice has a box to go back to, and like the credit above this
           is fired off rather than awaited — a navigation aid must not hold up
           the set it sits over. */
        if (found.scope !== 'full') {
          void fetchParentSet(found.owner_id, found.local_id).then((box) => {
            if (current) parent = box;
          });
        }
        if (found.visibility === 'public') void refreshComments(found.id);
        const readable = readPublishedSet(found);
        if (!current) return;
        viewScope = scopeForPublishedView(found, readable, hint);
        set = readable;
        requestAnimationFrame(() => scrollToExplore('top', false));
        progress = null;

        /* Let the masthead and first Overview placeholders paint before the
           work needed only by export/fork begins. It still starts on its own,
           so those actions are usually ready by the time someone reaches
           them; an immediate click simply awaits the same promise. */
        const beginPreparation = (): void => {
          if (!current || generation !== loadGeneration) return;
          void preparePortable(found, generation, controller.signal).catch(() => {
            // `portableError` is the user-facing result of a background failure.
          });
        };
        const idleWindow = window as unknown as {
          requestIdleCallback?: Window['requestIdleCallback'];
          cancelIdleCallback?: Window['cancelIdleCallback'];
        };
        if (idleWindow.requestIdleCallback) {
          const idleId = idleWindow.requestIdleCallback(beginPreparation, { timeout: 1200 });
          cancelPreparation = () => idleWindow.cancelIdleCallback?.(idleId);
        } else {
          const timeoutId = window.setTimeout(beginPreparation, 250);
          cancelPreparation = () => window.clearTimeout(timeoutId);
        }
      } catch (cause) {
        if (current) error = cause instanceof Error ? cause.message : 'Could not open that set.';
      } finally {
        if (current) loading = false;
      }
    })();

    return () => {
      current = false;
      cancelPreparation();
      controller.abort();
      if (sharedLoadController === controller) sharedLoadController = null;
    };
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
    portableError = null;
    try {
      const source = portableSet ?? (await preparePortable(row));
      const copy = forkSet(source, sourceOf(row, authorName));
      if (await workshop.addSet(copy)) forked = copy.name;
    } catch (cause) {
      portableError =
        cause instanceof Error ? cause.message : 'Could not prepare this set for copying.';
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

  interface ExploreLink {
    key: string;
    label: string;
  }

  const EXPLORE_ANCHOR_PREFIX = 'shared-explore';

  function exploreAnchorId(key: string): string {
    return `${EXPLORE_ANCHOR_PREFIX}-${key}`;
  }

  /** Match the Overview's physical order so the bar reads left-to-right like the page. */
  function exploreLinksFor(currentSet: AdventureSet): ExploreLink[] {
    const links: ExploreLink[] = [];
    if (currentSet.threat.enabled || currentSet.map.enabled) {
      links.push({ key: 'battlefield', label: 'Battlefield' });
    }
    if (currentSet.figures.length > 0) links.push({ key: 'components', label: 'Components' });

    const characters = [
      ...charactersByRole(currentSet, 'hero'),
      ...charactersByRole(currentSet, 'villain'),
      ...charactersByRole(currentSet, 'minion'),
      ...charactersByRole(currentSet, 'sidekick')
    ];
    for (const character of characters) {
      links.push({ key: `character-${character.id}`, label: characterLabel(character) });
    }

    const characterIds = new Set(currentSet.characters.map((character) => character.id));
    const sharedDeckIds = new Set(
      currentSet.decks
        .filter((deck) => deck.ownerId === null || !characterIds.has(deck.ownerId))
        .map((deck) => deck.id)
    );
    if (currentSet.cards.some((card) => sharedDeckIds.has(card.deckId))) {
      links.push({ key: 'set-decks', label: 'Shared decks' });
    }
    return links;
  }

  function scopedCounts(currentSet: AdventureSet): string {
    const stats = setStats(currentSet);
    const characters = stats.characterCount;
    const cards = stats.cardCount;
    const components = currentSet.figures.length;
    return `${characters} ${characters === 1 ? 'character' : 'characters'} · ${cards} card ${cards === 1 ? 'design' : 'designs'} · ${components} ${components === 1 ? 'component' : 'components'}`;
  }

  function compactScopedCounts(currentSet: AdventureSet): string {
    const stats = setStats(currentSet);
    return `${stats.characterCount} ${stats.characterCount === 1 ? 'char' : 'chars'} · ${stats.cardCount} ${stats.cardCount === 1 ? 'design' : 'designs'} · ${currentSet.figures.length} ${currentSet.figures.length === 1 ? 'piece' : 'pieces'}`;
  }

  function scrollToExplore(key: string, animate = true): void {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = animate && !reduceMotion ? 'smooth' : 'auto';
    const scroller = document.getElementById(exploreAnchorId('top'));
    if (key === 'top') {
      scroller?.scrollTo({ top: 0, behavior });
      return;
    }

    const target = document.getElementById(exploreAnchorId(key));
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior });
    // A visual jump alone leaves keyboard and assistive-technology users at
    // the toolbar. Negative tabindex makes the destination focusable without
    // adding it to the ordinary tab order.
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }

  function changeViewScope(key: string): void {
    viewScope = parseScopeKey(key);
  }
</script>

{#if printSet}
  <PrintScreen set={printSet} onback={() => (printSet = null)} />
{:else}
  <div class="screen">
    <header
      class="head"
      class:has-poster={Boolean(mastheadPosterUrl)}
      style:--masthead-base={fillCss(mastheadTheme.frame)}
      style:--masthead-accent={mastheadAccent}
      style:--masthead-title-font={displayFontStack(mastheadTheme.displayFont)}
      style:--masthead-title-weight={displayFontWeight(mastheadTheme.displayFont)}
    >
      <!-- The art is atmosphere rather than content; the heading below is the identity. -->
      <div class="masthead-visual" aria-hidden="true">
        {#if mastheadBackdropUrl}
          <img
            class="masthead-backdrop"
            src={mastheadBackdropUrl}
            alt=""
            draggable="false"
            onerror={rejectMastheadArtwork}
          />
        {/if}
        <span class="masthead-scrim"></span>
        <span class="masthead-lines"></span>
        <span class="masthead-blade"></span>
        <span class="masthead-ghost">{mastheadTitle}</span>
      </div>

      {#if mastheadPosterUrl}
        <div
          class="masthead-poster"
          class:composition={mastheadPosterIsComposition}
          aria-hidden="true"
        >
          <div class="masthead-poster-window">
            <img
              src={mastheadPosterUrl}
              alt=""
              draggable="false"
              onerror={rejectMastheadArtwork}
            />
          </div>
        </div>
      {/if}

      <div class="titles">
        <span class="eyebrow">{mastheadKicker}</span>
        <h1 class="title">{mastheadTitle}</h1>
        {#if mastheadContext}<p class="subtitle">{mastheadContext}</p>{/if}

        <div class="masthead-identity-row">
          <!--
            The creator, clearly visible at the top of their own set — not
            buried in the fork fineprint below. Bound through `@const` because
            the `{#if}` cannot narrow a reactive read for a later callback.
          -->
          {#if authorName && row}
            {@const ownerId = row.owner_id}
            <button type="button" class="author-link" onclick={() => navigation.openAuthor(ownerId)}>
              By {authorName}
            </button>
          {/if}

          {#if row?.visibility === 'public'}
            <div class="header-engagement">
              <button
                type="button"
                class="engagement-button"
                class:active={liked}
                aria-pressed={liked}
                aria-label={liked ? `Unlike this set. ${likeCount} likes` : `Like this set. ${likeCount} likes`}
                disabled={reactionBusy}
                onclick={() => void toggleLike()}
              >
                <Icon name="thumbUp" size={15} />
                <span class="numeric">{likeCount}</span>
                <span class="engagement-label">{liked ? 'Liked' : 'Like'}</span>
              </button>
              <span class="engagement-count" aria-label={`${commentCount} comments`}>
                <Icon name="message" size={15} />
                <span class="numeric">{commentCount}</span>
              </span>
              <button
                type="button"
                class="engagement-button"
                class:active={favourited}
                aria-pressed={favourited}
                aria-label={favourited ? 'Remove from favourites' : 'Add to favourites'}
                disabled={reactionBusy}
                onclick={() => void toggleFavourite()}
              >
                <Icon name="bookmark" size={15} />
                <span class="engagement-label">{favourited ? 'Favourited' : 'Favourite'}</span>
              </button>
            </div>
          {/if}
        </div>

        <!-- The box this independently published slice came out of. -->
        {#if parent}
          {@const box = parent}
          <button type="button" class="parent-link" onclick={() => navigation.openShared(box.slug)}>
            <Icon name="layers" size={13} />
            Open {box.name}
          </button>
        {/if}

        {#if set}
          <div class="masthead-details">
            {#if row}
              <p class="stats header-detail">
                {#if row.published_at}
                  Published {new Date(row.published_at).toLocaleDateString()} ·
                {/if}
                updated {new Date(row.updated_at).toLocaleDateString()}
                {#if row.revision > 1}· revision {row.revision}{/if}
              </p>
            {/if}

            {#if row?.change_note}
              <p class="stats header-detail">Latest change: “{row.change_note}”</p>
            {/if}

            {#if contributors.length > 0}
              <p class="stats credit header-detail">
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
          </div>
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
      {@const shown = shownSet ?? set}
      {@const scopeOptions = scopeOptionsFor(set)}
      {@const exploreLinks = exploreLinksFor(shown)}
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

      {#snippet actions()}
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
                {forking ? 'Preparing copy…' : 'Make a copy to work on'}
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
          {#if portableSet}
            <ExportPanel
              set={portableSet}
              onprint={openPrint}
              bind:scope={viewScope}
              projectFileMode="copy"
            />
          {:else}
            <p class="panel-hint" aria-live="polite">
              {portableError ?? portableProgress ?? 'Preparing download tools…'}
            </p>
            {#if portableError}
              <Button size="sm" variant="ghost" disabled={portableBusy} onclick={retryPreparation}>
                Try again
              </Button>
            {/if}
          {/if}
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
            The Overview below owns the scrollbar, so this sibling remains in
            reach through a long set without fixed positioning or viewport
            offsets. Scope is still the same state ExportPanel edits: what a
            visitor sees and what they export cannot silently disagree.
          -->
          <section class="explore-bar" aria-labelledby="explore-title">
            <div class="explore-controls">
              <div class="explore-copy">
                <h2 id="explore-title">Explore</h2>
                <p
                  class="explore-counts"
                  aria-label={scopedCounts(shown)}
                  aria-live="polite"
                >
                  <span class="explore-counts-full" aria-hidden="true">{scopedCounts(shown)}</span>
                  <span class="explore-counts-compact" aria-hidden="true">
                    {compactScopedCounts(shown)}
                  </span>
                </p>
              </div>

              <label class="filter-row">
                <span class="filter-label">Showing</span>
                {#if scopeOptions.length > 1}
                  <span class="filter-control">
                    <Select
                      value={scopeKeyOf(viewScope)}
                      options={scopeOptions}
                      onchange={changeViewScope}
                    />
                  </span>
                {:else}
                  <span class="scope-static">{scopeOptions[0]?.label ?? 'Whole set'}</span>
                {/if}
              </label>

              <label class="zoom-control" title="Card size">
                <Icon name="search" size={12} />
                <input
                  type="range"
                  min={GALLERY_CARD_SIZE.min}
                  max={GALLERY_CARD_SIZE.max}
                  step={GALLERY_CARD_SIZE.step}
                  value={cardSize}
                  aria-label="Card size"
                  oninput={(event) => (cardSize = event.currentTarget.valueAsNumber)}
                />
              </label>

              {#if compactLayout}
                <button
                  type="button"
                  class="mobile-actions"
                  aria-label="Open set actions"
                  aria-haspopup="dialog"
                  aria-controls="shared-set-actions"
                  title="Actions"
                  onclick={openActions}
                >
                  <Icon name="settings" size={16} />
                  <span class="mobile-actions-label">Actions</span>
                </button>
              {/if}
            </div>

            {#if exploreLinks.length > 0}
              <nav class="jump-nav" aria-label="Explore this set">
                <span class="jump-label">Jump to</span>
                <div class="jump-scroll">
                  {#each exploreLinks as link (link.key)}
                    <button
                      type="button"
                      class="jump-link"
                      aria-controls={exploreAnchorId(link.key)}
                      onclick={() => scrollToExplore(link.key)}
                    >
                      {link.label}
                    </button>
                  {/each}
                </div>
              </nav>
            {/if}
          </section>

          <AssetsOverview
            set={shown}
            interactive={false}
            inspectable
            componentPreviewsReady={portableSet !== null}
            cardPreviews={publishedCardPreviews}
            heading={false}
            {cardSize}
            showZoom={false}
            anchorPrefix={EXPLORE_ANCHOR_PREFIX}
          />
        </div>

        {#if !compactLayout}
          <aside class="rail scroll-y">
            {@render actions()}
          </aside>
        {/if}
      </div>

      <dialog
        id="shared-set-actions"
        bind:this={actionsDialog}
        class="actions-sheet"
        aria-labelledby="actions-sheet-title"
      >
        {#if compactLayout}
          <div class="sheet-inner scroll-y">
            <header class="sheet-head">
              <h2 id="actions-sheet-title">Actions</h2>
              <button type="button" class="sheet-close" onclick={() => actionsDialog?.close()}>
                Close
              </button>
            </header>
            {@render actions()}
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
    position: relative;
    isolation: isolate;
    flex: none;
    display: flex;
    align-items: center;
    min-height: 184px;
    padding: var(--space-5) var(--space-8);
    overflow: hidden;
    border-bottom: 1px solid var(--border-default);
    background: var(--masthead-base, var(--grey-1000));
    color: var(--grey-50);
  }

  .masthead-visual {
    position: absolute;
    z-index: 0;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .masthead-backdrop {
    position: absolute;
    inset: -8%;
    width: 116%;
    height: 116%;
    max-width: none;
    object-fit: cover;
    opacity: 0.46;
    filter: saturate(1.18) contrast(1.08);
    transform: scale(1.04);
  }

  .masthead-scrim,
  .masthead-lines,
  .masthead-blade,
  .masthead-ghost {
    position: absolute;
    pointer-events: none;
  }

  .masthead-scrim {
    inset: 0;
    background:
      linear-gradient(
        90deg,
        color-mix(in oklab, var(--grey-1000) 98%, transparent) 0%,
        color-mix(in oklab, var(--grey-1000) 94%, transparent) 34%,
        color-mix(in oklab, var(--grey-1000) 68%, transparent) 62%,
        color-mix(in oklab, var(--grey-1000) 42%, transparent) 100%
      ),
      linear-gradient(
        0deg,
        color-mix(in oklab, var(--grey-1000) 78%, transparent),
        transparent 64%
      );
  }

  .masthead-lines {
    inset: 0;
    opacity: 0.32;
    background: repeating-linear-gradient(
      112deg,
      transparent 0 38px,
      color-mix(in oklab, var(--grey-50) 10%, transparent) 38px 39px
    );
  }

  .masthead-blade {
    top: -35%;
    bottom: -35%;
    right: 37%;
    width: clamp(18px, 2.5vw, 38px);
    background: var(--masthead-accent, var(--accent));
    opacity: 0.88;
    transform: rotate(14deg);
    box-shadow: 0 0 36px color-mix(in oklab, var(--grey-1000) 55%, transparent);
  }

  .masthead-ghost {
    right: 29%;
    bottom: -0.22em;
    max-width: 90%;
    overflow: hidden;
    font-family: var(--masthead-title-font, var(--font-display));
    font-size: clamp(5rem, 12vw, 11rem);
    font-weight: var(--masthead-title-weight, var(--weight-semibold));
    line-height: 0.74;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--grey-50);
    opacity: 0.07;
  }

  .masthead-poster {
    position: absolute;
    z-index: 1;
    top: -48px;
    right: clamp(20px, 4vw, 64px);
    bottom: -54px;
    width: clamp(250px, 35vw, 500px);
    pointer-events: none;
    transform: rotate(2.5deg);
    filter: drop-shadow(
      0 18px 24px color-mix(in oklab, var(--grey-1000) 68%, transparent)
    );
  }

  .masthead-poster::before {
    content: '';
    position: absolute;
    z-index: -1;
    inset: 7px -7px -7px 7px;
    clip-path: polygon(13% 0, 100% 0, 87% 100%, 0 100%);
    background: var(--masthead-accent, var(--accent));
    opacity: 0.9;
  }

  .masthead-poster-window {
    width: 100%;
    height: 100%;
    overflow: hidden;
    clip-path: polygon(13% 0, 100% 0, 87% 100%, 0 100%);
    background: color-mix(in oklab, var(--grey-1000) 72%, transparent);
  }

  .masthead-poster img {
    width: 100%;
    height: 100%;
    max-width: none;
    object-fit: cover;
  }

  .masthead-poster.composition {
    transform: rotate(1.5deg);
  }

  .masthead-poster.composition::before {
    opacity: 0.44;
  }

  .masthead-poster.composition .masthead-poster-window {
    clip-path: none;
    background: transparent;
  }

  .masthead-poster.composition img {
    object-fit: contain;
  }

  .titles {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-1);
    width: 100%;
    max-width: 780px;
    min-width: 0;
    margin-right: auto;
  }

  .head.has-poster .titles {
    max-width: min(59%, 760px);
  }

  .eyebrow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--grey-300);
  }

  .eyebrow::before {
    content: '';
    width: 30px;
    height: 3px;
    flex: none;
    background: var(--masthead-accent, var(--accent));
  }

  .title {
    margin: 0;
    font-family: var(--masthead-title-font, var(--font-display));
    font-size: clamp(2.75rem, 4.8vw, 4.75rem);
    font-weight: var(--masthead-title-weight, var(--weight-semibold));
    line-height: 0.88;
    letter-spacing: var(--tracking-tight);
    text-transform: uppercase;
    text-wrap: balance;
    overflow-wrap: anywhere;
    color: var(--grey-50);
    text-shadow: 0 3px 18px color-mix(in oklab, var(--grey-1000) 84%, transparent);
  }

  .subtitle,
  .stats,
  .message,
  .fineprint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .head .subtitle {
    max-width: 54ch;
    color: var(--grey-200);
  }

  .stats {
    font-size: var(--text-xs);
  }

  .masthead-identity-row,
  .masthead-details {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
  }

  .masthead-identity-row {
    min-height: 30px;
  }

  .masthead-details .stats {
    color: var(--grey-300);
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
    border: 1px solid color-mix(in oklab, var(--grey-50) 22%, transparent);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--grey-1000) 38%, transparent);
    color: var(--grey-200);
    font-size: var(--text-xs);
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .parent-link:hover {
    border-color: color-mix(in oklab, var(--grey-50) 58%, transparent);
    color: var(--grey-50);
  }

  .credit {
    font-style: italic;
  }

  .header-engagement {
    display: flex;
    align-items: center;
    align-self: flex-start;
    gap: var(--space-1);
    margin: 0;
  }

  .engagement-button,
  .engagement-count {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 30px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    color: var(--grey-300);
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
    border-color: color-mix(in oklab, var(--grey-50) 28%, transparent);
    background: color-mix(in oklab, var(--grey-50) 12%, transparent);
    color: var(--grey-50);
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
    color: var(--grey-200);
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: transparent;
    transition: color var(--duration-fast) var(--ease-out);
  }

  .author-link:hover {
    color: var(--grey-50);
    text-decoration-color: currentcolor;
  }

  /* Inline inside the "With contributions from …" sentence, at its size. */
  .author-link.inline {
    display: inline;
    font-size: inherit;
    color: var(--grey-200);
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
     its own here. The bar is a flex sibling, not an overlay, so it stays put
     while the Overview's own scroll container moves beneath it. */
  .explore-bar {
    position: relative;
    z-index: var(--z-sticky);
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-8) var(--space-2);
    border-bottom: 1px solid var(--border-default);
    background: var(--surface-default);
    box-shadow: var(--shadow-xs);
  }

  .explore-controls {
    display: grid;
    grid-template-columns: minmax(170px, auto) minmax(200px, 1fr) auto;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
  }

  .explore-copy {
    min-width: 0;
    overflow: hidden;
  }

  .explore-copy h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .explore-counts {
    margin: 1px 0 0;
    overflow: hidden;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .explore-counts-compact {
    display: none;
  }

  .filter-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .filter-label {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--text-tertiary);
  }

  .filter-control {
    display: block;
    min-width: 0;
  }

  .scope-static {
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .zoom-control {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
  }

  .zoom-control input {
    width: 112px;
  }

  .jump-nav {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .jump-label {
    flex: none;
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .jump-scroll {
    display: flex;
    gap: var(--space-1);
    min-width: 0;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    scrollbar-width: thin;
  }

  .jump-link {
    flex: none;
    min-height: 30px;
    padding: 0 var(--space-3);
    border: 1px solid transparent;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--ease-out),
      background var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .jump-link:hover,
  .jump-link:focus-visible {
    border-color: var(--border-default);
    background: var(--surface-selected);
    color: var(--text-default);
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

  /* The export rail still exists just above the phone breakpoint, leaving the
     gallery column too narrow for three useful controls on one line. */
  @media (min-width: 701px) and (max-width: 900px) {
    .explore-bar {
      padding-inline: var(--space-4);
    }

    .explore-controls {
      grid-template-areas:
        'copy zoom'
        'filter filter';
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-2) var(--space-3);
    }

    .explore-copy {
      grid-area: copy;
      overflow: hidden;
    }

    .explore-counts {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .filter-row {
      grid-area: filter;
    }

    .zoom-control {
      grid-area: zoom;
    }
  }

  /* The content is the page on a phone. Copying and exporting are still one
     tap away, but no longer take a permanent slice out of the card overview. */
  @media (max-width: 700px) {
    .head {
      align-items: center;
      min-height: 168px;
      padding: var(--space-3) var(--space-4);
    }

    .header-detail {
      display: none;
    }

    .masthead-backdrop {
      opacity: 0.5;
    }

    .masthead-scrim {
      background:
        linear-gradient(
          90deg,
          color-mix(in oklab, var(--grey-1000) 98%, transparent) 0%,
          color-mix(in oklab, var(--grey-1000) 92%, transparent) 54%,
          color-mix(in oklab, var(--grey-1000) 66%, transparent) 100%
        ),
        linear-gradient(
          0deg,
          color-mix(in oklab, var(--grey-1000) 84%, transparent),
          transparent 72%
        );
    }

    .masthead-lines {
      opacity: 0.2;
    }

    .masthead-blade {
      right: 18%;
      width: 22px;
      opacity: 0.74;
    }

    .masthead-ghost {
      right: 0;
      bottom: -0.08em;
      max-width: 100%;
      font-size: clamp(4rem, 23vw, 7rem);
      opacity: 0.055;
    }

    .masthead-poster {
      top: -24px;
      right: -5%;
      bottom: -32px;
      width: 48%;
      opacity: 0.48;
      filter: drop-shadow(
        0 10px 18px color-mix(in oklab, var(--grey-1000) 62%, transparent)
      );
    }

    .titles {
      width: 100%;
      max-width: 100%;
      gap: var(--space-1);
    }

    .head.has-poster .titles {
      max-width: 100%;
    }

    .eyebrow {
      gap: var(--space-1);
      font-size: var(--text-2xs);
    }

    .eyebrow::before {
      width: 22px;
      height: 2px;
    }

    .title {
      max-width: 88%;
      font-size: clamp(2.35rem, 11vw, 3.5rem);
      line-height: 0.88;
    }

    .subtitle,
    .author-link {
      font-size: var(--text-xs);
    }

    .subtitle {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .masthead-identity-row {
      gap: var(--space-1) var(--space-2);
    }

    .parent-link {
      min-height: 44px;
      margin-top: var(--space-1);
    }

    .header-engagement {
      gap: var(--space-1);
    }

    .engagement-button,
    .engagement-count {
      justify-content: center;
      min-width: 44px;
      min-height: 44px;
      padding-inline: var(--space-2);
    }

    .engagement-label {
      display: none;
    }

    .split {
      grid-template-columns: minmax(0, 1fr);
    }

    .explore-bar {
      gap: var(--space-2);
      padding: var(--space-2) var(--space-4);
    }

    .explore-controls {
      grid-template-areas:
        'copy actions'
        'filter zoom';
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-2) var(--space-3);
    }

    .explore-copy {
      grid-area: copy;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      gap: 0;
    }

    .explore-copy h2 {
      flex: none;
      font-size: var(--text-sm);
    }

    .explore-counts {
      min-width: 0;
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .explore-counts-full {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .explore-counts-compact {
      display: inline;
    }

    .filter-row {
      grid-area: filter;
      display: block;
    }

    .filter-control :global(.select) {
      min-height: 44px;
    }

    .filter-label {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .zoom-control {
      grid-area: zoom;
      min-height: 44px;
    }

    .zoom-control input {
      width: 76px;
    }

    .mobile-actions {
      grid-area: actions;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      min-height: 44px;
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
      background: var(--surface-default);
      color: var(--text-default);
      font: inherit;
      font-size: var(--text-sm);
      font-weight: var(--weight-semibold);
    }

    .mobile-actions-label,
    .jump-label {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .jump-nav {
      gap: 0;
    }

    .jump-scroll {
      width: 100%;
      scrollbar-width: none;
    }

    .jump-scroll::-webkit-scrollbar {
      display: none;
    }

    .jump-link {
      min-height: 44px;
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
