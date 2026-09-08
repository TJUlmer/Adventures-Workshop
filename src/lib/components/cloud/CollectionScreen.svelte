<script lang="ts">
  /**
   * A collection's own page — the one link a project is announced with.
   *
   * Read-only at this step: it draws what is there and links onward, and the
   * authoring controls (creating, inviting, accepting, readiness) come in
   * steps 5–7 of `COLLECTIONS.md`'s build order. Nothing here writes.
   *
   * Rendered outside `AppShell`, beside `GalleryScreen` and
   * `SharedSetScreen`, and for the same reason: this is very often somebody's
   * first sight of the app, and chrome for a set they do not have would
   * answer a question they have not asked. That also means it owns its own
   * scrolling — `base.css` sets `body { overflow: hidden }` because the shell
   * normally owns it, so a screen outside the shell has its own or has none.
   *
   * **Both reads are anonymous**, through `cloud/collections.ts`. RLS answers
   * a public read the same either way, but PostgREST refuses a *stale* token
   * outright — and a collection link is exactly the kind opened weeks after
   * it was pasted, by somebody who signed in once and forgot.
   */
  import {
    amOrganizer,
    collectionUrl,
    combinableProblem,
    deleteCollection,
    fetchCollectionDecks,
    liveMemberCount,
    readinessOf,
    fetchCollectionBySlug,
    fetchCollectionTiles,
    addOwnDeckDirectly,
    inviteDeck,
    listMemberships,
    claimInviteLink,
    createInviteLink,
    deleteInvite,
    inviteLinkUrl,
    listCollectionInvites,
    listOrganizers,
    promotableFrom,
    promoteOrganizer,
    removeInviteClaim,
    removeMember,
    removeOrganizer,
    revokeInvite,
    resolveSubmission,
    respondToInvitation,
    setMemberReady,
    submitDeck,
    updateCollection,
    uploadCollectionBanner
  } from '$lib/cloud/collections';
  import { fetchSetSummaryBySlug, listMyPublishedSets } from '$lib/cloud/sets';
  import type { PublishedSet } from '$lib/cloud/sets';
  import type { CharacterId } from '$lib/characters/types';
  import type {
    Collection,
    CollectionMembership,
    CollectionTile,
    CollectionVisibility
  } from '$lib/cloud/collections';
  import { cloudEnabled } from '$lib/cloud/config';
  import type {
    CollectionDeck,
    CollectionInvite,
    CollectionOrganizer
  } from '$lib/cloud/collections';
  import PrintScreen from '$lib/print/PrintScreen.svelte';
  import type { PrintMember } from '$lib/print/sheet';
  import { createTtsAssetHost } from '$lib/cloud/tts-assets';
  import { exportCollectionBundle } from '$lib/export/tts-bundle';
  import { exportCollectionCardPngs, saveExport } from '$lib/export';
  import { setVisibility as setDeckVisibility } from '$lib/cloud/sets';
  import { readTtsSavedObjectsPath, writeTtsSavedObjectsPath } from '$lib/storage/settings';
  import { initials, tint } from '$lib/core/swatch';
  import { CARD_FORMATS, trimBox } from '$lib/renderer/geometry';
  import { auth } from '$lib/cloud/auth.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { applyCharacterExportSelection } from '$lib/sets/export-selection';
  import CollectionExportSelector from '$lib/components/export/CollectionExportSelector.svelte';

  interface Props {
    slug: string;
  }

  let { slug }: Props = $props();

  let collection = $state<Collection | null>(null);
  let tiles = $state<CollectionTile[]>([]);
  let loading = $state(true);
  let failed = $state(false);

  /*
   * How much of a bleed-canvas picture to scale away to reach the trim.
   * Derived rather than typed in, the same as `GalleryScreen`'s — a cover
   * that says `cover_bleeds` is a full print plate, and showing its margin
   * would put a band of frame round a tile that is already a frame.
   */
  const TRIM_SCALE_WIDE = CARD_FORMATS.action.bleed.width / trimBox(CARD_FORMATS.action).width;

  /** The same fallback order the gallery uses: a real thumbnail, then the
      database-derived cover, then nothing and let the tint show. */
  function tileImage(tile: CollectionTile): string {
    return tile.thumbnail_url || tile.cover_url;
  }

  $effect(() => {
    const wanted = slug;
    loading = true;
    failed = false;

    void (async () => {
      try {
        const found = await fetchCollectionBySlug(wanted);
        /* The slug can change under an in-flight fetch — one collection page
           linking to another — so a late answer for a previous slug must not
           overwrite the current one. */
        if (wanted !== slug) return;
        collection = found;
        const rows = found ? await fetchCollectionTiles(wanted) : [];
        if (wanted !== slug) return;
        tiles = rows;
      } catch {
        if (wanted === slug) failed = true;
      } finally {
        if (wanted === slug) loading = false;
      }
    })();
  });

  const heading = $derived(collection?.name.trim() || 'Untitled collection');

  // -- Organizer editing --------------------------------------------------

  let organizer = $state(false);
  let editing = $state(false);
  let saving = $state(false);
  let notice = $state<string | null>(null);
  let bannerInput = $state<HTMLInputElement | null>(null);

  /* Draft fields, held apart from `collection` so an abandoned edit changes
     nothing and Cancel needs no undo. */
  let draftName = $state('');
  let draftSubtitle = $state('');
  let draftBlurb = $state('');

  $effect(() => {
    const id = collection?.id;
    if (!id) {
      organizer = false;
      return;
    }
    /* Read `auth.signedIn` synchronously so signing in *while this page is
       open* is a tracked dependency — inside the async closure it would not
       be, and the edit controls would never appear without a reload. Same
       reason `HomeScreen`'s published-sets effect reads it at the top. */
    void auth.signedIn;
    void (async () => {
      const yes = await amOrganizer(id).catch(() => false);
      if (collection?.id === id) organizer = yes;
    })();
  });

  // -- Invitations ---------------------------------------------------------

  /**
   * Who has been asked to take part, as against whose deck is already in.
   *
   * Membership is a deck (`collection_members` is keyed on one), so until
   * somebody has published something there is nothing to be a member *of*.
   * An invitation is how a project gets its people before anybody has built
   * anything — see `0019`.
   */
  let invites = $state<CollectionInvite[]>([]);
  let linkLabel = $state('');
  let copiedLink = $state<string | null>(null);

  $effect(() => {
    const id = collection?.id;
    if (!id || !organizer) {
      invites = [];
      return;
    }
    void (async () => {
      const rows = await listCollectionInvites(id).catch(() => []);
      if (collection?.id === id) invites = rows;
    })();
  });

  async function refreshInvites(): Promise<void> {
    if (!collection || !organizer) return;
    invites = await listCollectionInvites(collection.id).catch(() => invites);
  }

  const pendingInvites = $derived(invites.filter((row) => row.invited_user && row.status === 'open'));
  const linkInvites = $derived(invites.filter((row) => !row.invited_user));

  function makeLink(): void {
    if (!collection) return;
    void run('make-link', async () => {
      await createInviteLink(collection!.id, linkLabel);
      linkLabel = '';
      await refreshInvites();
    });
  }

  function stopLink(inviteId: string): void {
    void run(`revoke-${inviteId}`, async () => {
      await revokeInvite(inviteId);
      await refreshInvites();
    });
  }

  function dropInvite(inviteId: string): void {
    void run(`drop-${inviteId}`, async () => {
      await deleteInvite(inviteId);
      await refreshInvites();
    });
  }

  function dropClaim(inviteId: string, userId: string): void {
    void run(`claim-${inviteId}-${userId}`, async () => {
      await removeInviteClaim(inviteId, userId);
      await refreshInvites();
    });
  }

  async function copyInviteLink(token: string): Promise<void> {
    if (!collection) return;
    try {
      await navigator.clipboard.writeText(inviteLinkUrl(collection.slug, token));
      copiedLink = token;
      setTimeout(() => (copiedLink = copiedLink === token ? null : copiedLink), 2000);
    } catch {
      notice = 'Could not reach the clipboard. Select the link and copy it by hand.';
    }
  }

  /**
   * Take a join link on arrival.
   *
   * The token rides on the collection's own path as `?join=`, so whoever
   * opens it lands on the collection they have just joined rather than on a
   * page of its own. Stripped from the address bar afterwards with
   * `replaceState`: a reload should not read as a second claim, and the token
   * has no business staying in a URL somebody might screenshot.
   */
  let claimNotice = $state<string | null>(null);
  let claimAttempted = $state('');

  $effect(() => {
    const token = new URLSearchParams(window.location.search).get('join') ?? '';
    if (!token || claimAttempted === token) return;
    claimAttempted = token;
    void auth.signedIn;
    void (async () => {
      if (!auth.signedIn) {
        claimNotice = 'Sign in to accept this invitation, then open the link again.';
        return;
      }
      const result = await claimInviteLink(token).catch(() => null);
      const url = new URL(window.location.href);
      url.searchParams.delete('join');
      window.history.replaceState({}, '', url.toString());
      if (!result || result.outcome === 'not_found') {
        claimNotice = 'That invitation link is not valid.';
      } else if (result.outcome === 'revoked') {
        claimNotice = 'That invitation link has been turned off. Ask the organizers for a new one.';
      } else {
        claimNotice = `You have joined ${result.collection_name || 'this collection'}. Offer a deck whenever one is ready.`;
        await refreshAfterDecision();
      }
    })();
  });

  // -- Co-organizers ------------------------------------------------------

  /**
   * Who else can curate this collection.
   *
   * The governance model is several organizers rather than one owner — see
   * *Governance* in `COLLECTIONS.md` — but until this existed only the
   * creator was ever one, because `seed_collection_organizer` is what writes
   * the first row and nothing wrote a second. A founder who went quiet took
   * the collection with them.
   */
  let organizers = $state<CollectionOrganizer[]>([]);
  let promoteTarget = $state('');

  $effect(() => {
    const id = collection?.id;
    if (!id || !organizer) {
      organizers = [];
      return;
    }
    void (async () => {
      const rows = await listOrganizers(id).catch(() => []);
      if (collection?.id === id) organizers = rows;
    })();
  });

  const organizerIds = $derived(new Set(organizers.map((row) => row.user_id)));

  const promotable = $derived(promotableFrom(tiles, organizerIds));

  const iAmOnlyOrganizer = $derived(
    organizers.length === 1 && organizers[0]?.user_id === auth.user?.id
  );

  /**
   * Re-ask whether *I* still curate, rather than assume.
   *
   * Standing down is the one action here that removes the caller's own
   * access, and the effect that first set `organizer` depends on the
   * collection id and sign-in state — neither of which changed. Without this
   * the settings stay on screen until a reload, offering controls the
   * database will now refuse.
   */
  async function refreshOrganizers(): Promise<void> {
    const id = collection?.id;
    if (!id) {
      organizers = [];
      return;
    }
    organizer = await amOrganizer(id).catch(() => false);
    organizers = organizer ? await listOrganizers(id).catch(() => []) : [];
  }

  function promote(userId: string): void {
    if (!collection || !userId) return;
    void run('promote', async () => {
      await promoteOrganizer(collection!.id, userId);
      promoteTarget = '';
      await refreshOrganizers();
    });
  }

  function demote(userId: string): void {
    if (!collection) return;
    void run(`demote-${userId}`, async () => {
      await removeOrganizer(collection!.id, userId);
      await refreshOrganizers();
    });
  }

  function startEditing(): void {
    if (!collection) return;
    draftName = collection.name;
    draftSubtitle = collection.subtitle;
    draftBlurb = collection.blurb;
    editing = true;
    notice = null;
  }

  async function saveEdits(): Promise<void> {
    if (!collection || saving) return;
    saving = true;
    notice = null;
    try {
      await updateCollection(collection.id, {
        name: draftName,
        subtitle: draftSubtitle,
        blurb: draftBlurb
      });
      /* Written back locally rather than re-fetched: the server has accepted
         these exact values, and a re-read would cost a round trip to be told
         what we just sent. A failure throws before reaching here. */
      collection = {
        ...collection,
        name: draftName.trim(),
        subtitle: draftSubtitle.trim(),
        blurb: draftBlurb.trim()
      };
      editing = false;
    } catch (error) {
      notice = error instanceof Error ? error.message : 'Could not save those changes.';
    } finally {
      saving = false;
    }
  }

  async function setVisibility(next: CollectionVisibility): Promise<void> {
    if (!collection || collection.visibility === next) return;
    const previous = collection.visibility;
    collection = { ...collection, visibility: next };
    try {
      await updateCollection(collection.id, { visibility: next });
    } catch (error) {
      collection = { ...collection, visibility: previous };
      notice = publishRefusalMessage(error, 'collection');
    }
  }

  /**
   * Say what an author can act on, not what the database said.
   *
   * Two restrictive policies refuse a temporary identity making something
   * public — `collections_anon_no_public_update` for a collection and
   * `sets_anon_no_public_update` for a deck — correctly, since a public
   * listing outlives the browser that made it. But PostgREST reports both as
   * "new row violates row-level security policy", naming a policy an author
   * has never heard of and suggesting nothing to do about it.
   *
   * Both were found by clicking the buttons while signed in anonymously. The
   * failures were surfaced, just not in a language anybody could use — and
   * they read as bugs rather than as the deliberate rule they are. One helper
   * for both, because the rule is one rule.
   */
  function publishRefusalMessage(error: unknown, what: 'collection' | 'deck'): string {
    const raw = error instanceof Error ? error.message : '';
    if (/anon_no_public/.test(raw)) {
      return what === 'collection'
        ? 'Publishing a collection needs a permanent account. You are signed in temporarily on this browser — sign in properly and the collection keeps everything it already has.'
        : 'Listing a deck in the gallery needs a permanent account. You are signed in temporarily on this browser; the deck stays in this collection either way.';
    }
    return raw || `Could not change who can see this ${what}.`;
  }

  async function setOpenSubmissions(next: boolean): Promise<void> {
    if (!collection) return;
    const previous = collection.open_submissions;
    collection = { ...collection, open_submissions: next };
    try {
      await updateCollection(collection.id, { open_submissions: next });
    } catch (error) {
      collection = { ...collection, open_submissions: previous };
      notice = error instanceof Error ? error.message : 'Could not change submissions.';
    }
  }

  async function pickBanner(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !collection) return;
    saving = true;
    notice = null;
    try {
      const url = await uploadCollectionBanner(collection.id, file);
      await updateCollection(collection.id, { banner_url: url });
      collection = { ...collection, banner_url: url };
    } catch (error) {
      notice = error instanceof Error ? error.message : 'Could not upload that picture.';
    } finally {
      saving = false;
    }
  }

  async function copyLink(): Promise<void> {
    if (!collection) return;
    try {
      await navigator.clipboard.writeText(collectionUrl(collection.slug));
      notice = 'Link copied.';
    } catch {
      notice = collectionUrl(collection.slug);
    }
  }

  // -- Membership ---------------------------------------------------------

  /**
   * What accepting actually promises, said in one sentence on the button that
   * does it.
   *
   * A member deck is reachable through the collection's link even while the
   * deck itself is unlisted — that is what `collection_members_by_slug` is
   * for, and it is only defensible because the deck's own author agreed to
   * it. Somebody should never discover that after the fact, so the words live
   * next to the click rather than in a help page.
   */
  const CONSENT =
    'Accepting makes your deck reachable to anyone holding this collection\u2019s link, ' +
    'even while the deck itself is unlisted.';

  let memberships = $state<CollectionMembership[]>([]);
  let myPublished = $state<PublishedSet[]>([]);
  let inviteLink = $state('');
  let busy = $state<string | null>(null);

  /** Rows this visitor is a party to, split by which side has to move. */
  const submissions = $derived(memberships.filter((row) => row.status === 'submitted'));
  const myInvitations = $derived(
    memberships.filter(
      (row) => row.status === 'invited' && row.set?.owner_id === auth.user?.id
    )
  );
  const invitedOut = $derived(
    memberships.filter(
      (row) => row.status === 'invited' && row.set?.owner_id !== auth.user?.id
    )
  );

  /**
   * Published decks of mine I could offer.
   *
   * A `removed` or `declined` row is not a bar — leaving and rejoining, or
   * being turned down and offering again after more work, are both ordinary.
   * Only a row that is currently live or awaiting somebody's decision takes a
   * deck out of this list.
   */
  const offerable = $derived(
    myPublished.filter((row) => {
      const existing = memberships.find((m) => m.set_id === row.id);
      return !existing || existing.status === 'removed' || existing.status === 'declined';
    })
  );

  /**
   * Home is an editable-draft library; this picker is a publication library.
   *
   * A publication may legitimately outlive its local draft or have been made
   * on another device, so it remains offerable. Marking that distinction on
   * the row keeps an old publication from looking like a local-preview bug.
   */
  const homeSetIds = $derived(new Set(workshop.library.map((entry) => String(entry.id))));

  function draftIsOnHome(row: PublishedSet): boolean {
    return homeSetIds.has(row.local_id);
  }

  /**
   * My decks that are waiting on somebody else — offered, not yet decided.
   *
   * Without this the page went silent the moment an offer succeeded: the
   * joining panel correctly stopped inviting a second offer, and nothing took
   * its place, so the answer to "did that work?" was a blank page. An offer
   * that vanishes is indistinguishable from one that failed.
   */
  const myPending = $derived(
    memberships.filter(
      (row) => row.status === 'submitted' && row.set?.owner_id === auth.user?.id
    )
  );

  /**
   * Whether this visitor already has a deck here, in any state that means
   * "you are dealt with" — accepted, or awaiting somebody's decision.
   */
  const iHaveADeckHere = $derived(
    memberships.some(
      (row) =>
        row.set?.owner_id === auth.user?.id &&
        (row.status === 'accepted' || row.status === 'invited' || row.status === 'submitted')
    )
  );

  /**
   * Where a visitor stands on joining, as one value.
   *
   * **This exists because the page used to say nothing at all.** The offer
   * panel was gated on being signed in *and* having an offerable deck *and*
   * the collection being open — and when any of those failed it simply did
   * not render, so somebody who had just published a deck specifically to
   * join saw a page with no way in and no explanation. Silence is the worst
   * answer to "what do I do here", and it was the answer in three of the four
   * cases.
   *
   * One derived rather than conditions scattered through the markup, so every
   * case has to be given an answer and a new one cannot quietly fall through
   * to nothing.
   */
  const joining = $derived.by(() => {
    if (organizer || iHaveADeckHere) return 'settled';
    if (!auth.signedIn) return 'signed-out';
    if (myPublished.length === 0) return 'nothing-published';
    if (offerable.length === 0) return 'settled';
    return collection?.open_submissions ? 'can-offer' : 'invite-only';
  });

  /**
   * Accepted rows this visitor may end.
   *
   * Both parties can, and the governance table says so: a deck's author
   * leaves, an organizer unlinks. Neither is destructive — `removeMember`
   * writes a status, and the set's own row, slug, shelf entry and gallery
   * listing are untouched by either.
   */
  const removable = $derived(
    memberships.filter(
      (row) =>
        row.status === 'accepted' &&
        (organizer || row.set?.owner_id === auth.user?.id)
    )
  );

  async function loadMembership(): Promise<void> {
    if (!collection || !auth.signedIn) {
      memberships = [];
      myPublished = [];
      return;
    }
    const [rows, mine] = await Promise.all([
      listMemberships(collection.id).catch(() => []),
      listMyPublishedSets().catch(() => [])
    ]);
    memberships = rows;
    myPublished = mine;
  }

  $effect(() => {
    void collection?.id;
    void auth.signedIn;
    void loadMembership();
  });

  /** Re-read both the private rows and the public tiles after any decision. */
  async function refreshAfterDecision(): Promise<void> {
    if (!collection) return;
    const [rows, freshTiles] = await Promise.all([
      listMemberships(collection.id).catch(() => []),
      fetchCollectionTiles(collection.slug).catch(() => tiles)
    ]);
    memberships = rows;
    tiles = freshTiles;
    boxDecks = null;
    excludedExportCharacters = new Map();
    exportSelectorOpen = false;
  }

  async function run(key: string, work: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = key;
    notice = null;
    try {
      await work();
      await refreshAfterDecision();
    } catch (error) {
      notice = error instanceof Error ? error.message : 'That did not go through.';
    } finally {
      busy = null;
    }
  }

  /**
   * Invite a deck by its share link.
   *
   * Resolved through `set_summary_by_slug`, not `fetchSetBySlug` — the summary
   * carries the id and a name, where fetching the set itself would pull a
   * multi-megabyte document across to read one uuid off it.
   */
  /**
   * Put one of my own decks forward.
   *
   * An organizer's own deck goes straight in; anybody else's is an offer the
   * organizers decide on. There is no consent to collect in the first case,
   * because both parties to it would be the same person — which is what
   * `members_self_add` says, and why this no longer routes an organizer
   * through an invitation they then had to accept from themselves.
   */
  async function addOwnDeck(setId: string): Promise<void> {
    await run(`offer-${setId}`, async () => {
      if (organizer) await addOwnDeckDirectly(collection!.id, setId);
      else await submitDeck(collection!.id, setId);
    });
  }

  async function invite(): Promise<void> {
    const typed = inviteLink.trim();
    if (!typed || !collection) return;
    await run('invite', async () => {
      /* Accepts a whole share link or a bare slug, because both are what
         somebody actually has to hand — `readSharedSlug` only reads the
         address bar, so the pattern is applied to the typed text here. */
      const slug = /([A-Za-z0-9_-]+)\/?$/.exec(typed)?.[1] ?? typed;
      const summary = await fetchSetSummaryBySlug(slug);
      if (!summary) throw new Error('No published set at that link.');
      await inviteDeck(collection!.id, summary.id);
      inviteLink = '';
    });
  }

  // -- Readiness, and the gate on going public ----------------------------

  /**
   * Read off the *tiles*, not the membership rows.
   *
   * Tiles are the accepted members, which is exactly the set the question is
   * about — a pending invitation is not a deck that is late, it is a deck
   * that has not joined. Membership rows would also be empty for a signed-out
   * visitor, so the count would silently read zero rather than being absent.
   */
  const readiness = $derived(readinessOf(tiles));

  /**
   * Accepted memberships whose deck is mine, so I can say it is finished.
   *
   * Only the deck's own author may — enforced by a trigger, not a policy,
   * because a `with check` sees only the new row and cannot notice that an
   * organizer's otherwise-legitimate update also flipped somebody's `ready`.
   * The UI simply agrees with that rather than being what enforces it.
   */
  const myAccepted = $derived(
    memberships.filter(
      (row) => row.status === 'accepted' && row.set?.owner_id === auth.user?.id
    )
  );

  /**
   * My accepted decks here that are still unlisted, once the collection is
   * public.
   *
   * **A public collection does not publish anybody's deck**, and it must not:
   * `sets.visibility` is the author's, guarded by RLS, and an organizer has
   * no route to it. Staying unlisted is also a legitimate choice — "this deck
   * exists only as part of this project" — so the flow asks rather than
   * nudging either way, and asks only the person who can answer.
   *
   * The ask appears at launch rather than at acceptance because that is when
   * it becomes a real question: before the collection is public, an unlisted
   * deck and a public one are reachable the same way.
   */
  const myUnlistedHere = $derived(
    collection?.visibility === 'public'
      ? myAccepted.filter((row) => row.set?.visibility === 'unlisted')
      : []
  );

  /**
   * How many accepted decks here are unlisted, for the organizer's benefit.
   *
   * Counted from `memberships`, which an organizer can read in full, rather
   * than from `tiles` — a tile is the public projection and carries no
   * visibility. Zero for a visitor, who sees none of this.
   */
  const unlistedMemberCount = $derived(
    memberships.filter((row) => row.status === 'accepted' && row.set?.visibility === 'unlisted')
      .length
  );

  async function publishMyDeck(setId: string): Promise<void> {
    if (busy) return;
    busy = `publish-deck-${setId}`;
    notice = null;
    try {
      await setDeckVisibility(setId, 'public');
      await refreshAfterDecision();
    } catch (error) {
      notice = publishRefusalMessage(error, 'deck');
    } finally {
      busy = null;
    }
  }

  /**
   * Set when Public was asked for while somebody is still not ready.
   *
   * A confirmation rather than a refusal: the gate exists so one eager
   * organizer cannot debut a half-finished deck over its author's head, but
   * an absent member must not be able to freeze a project for ever either —
   * so it names who, and lets an organizer go anyway having read the names.
   */
  let publishGate = $state<string[] | null>(null);

  // -- Downloading the whole box ------------------------------------------

  /**
   * The combined export, offered to anybody who can see the collection.
   *
   * Not organizer-only: a box is for playing, and everybody a link reaches is
   * a potential player. Nothing it produces is anybody's to authorise —
   * every deck in it is already downloadable one at a time from its own
   * shared page, and this only saves the visitor doing that six times and
   * assembling the result by hand.
   */
  let boxProgress = $state<string | null>(null);
  let boxProblem = $state<string | null>(null);
  let boxSkipped = $state<{ name: string; reason: string }[]>([]);
  let boxDecks = $state<CollectionDeck[] | null>(null);
  let excludedExportCharacters = $state<Map<string, ReadonlySet<CharacterId>>>(new Map());
  let exportSelectorOpen = $state(false);
  let boxCollectionId = $state('');
  let hostBoxOnline = $state(true);
  let boxPath = $state('');
  void readTtsSavedObjectsPath().then((value) => (boxPath = value));

  const onlineAvailable = cloudEnabled();

  $effect(() => {
    const collectionId = collection?.id ?? '';
    if (collectionId === boxCollectionId) return;
    boxCollectionId = collectionId;
    boxDecks = null;
    excludedExportCharacters = new Map();
    exportSelectorOpen = false;
  });

  const exportCharacterTotal = $derived(
    boxDecks
      ? boxDecks.reduce(
          (count, deck) =>
            count + deck.set.characters.filter((character) => character.role === 'hero').length,
          0
        )
      : tiles.reduce((count, tile) => count + tile.hero_count, 0)
  );

  const selectedCharacterCount = $derived(
    boxDecks
      ? boxDecks.reduce(
          (count, deck) =>
            count +
            deck.set.characters.filter(
              (character) =>
                character.role === 'hero' &&
                !excludedExportCharacters.get(deck.tile.set_id)?.has(character.id)
            ).length,
          0
        )
      : exportCharacterTotal
  );

  const exportSelectionActive = $derived(
    [...excludedExportCharacters.values()].some((excluded) => excluded.size > 0)
  );

  /**
   * Fetch every member's document and check the box can be built at all.
   *
   * Shared by both the Tabletop Simulator download and the print sheets so
   * the two cannot come to disagree about which collections are a box —
   * `combinableProblem` is one rule, and it is checked against the decks that
   * actually arrived rather than against the tiles, because a member that
   * failed to load is not in the box and must not decide whether it can be
   * built.
   */
  async function loadBox(): Promise<CollectionDeck[] | null> {
    if (!collection) return null;
    if (boxDecks) return boxDecks;

    /* Fetched rather than read off the tiles: a tile is a summary, and both
       rendering and paging need the whole document. This is also the slow
       half, so it reports per deck. */
    const { decks, skipped } = await fetchCollectionDecks(collection.slug, (progress) => {
      boxProgress = `Fetching ${progress.name} — ${progress.done} of ${progress.total}…`;
    });
    boxSkipped = skipped;

    const problem = combinableProblem(decks);
    if (problem) {
      boxProblem = problem;
      return null;
    }
    boxDecks = decks;
    return decks;
  }

  /** Apply the one character selection before any of the three exporters. */
  function selectedBox(decks: readonly CollectionDeck[]): CollectionDeck[] {
    return decks.flatMap((deck) => {
      const excluded = excludedExportCharacters.get(deck.tile.set_id);
      const included = new Set<CharacterId>(
        deck.set.characters
          .filter((character) => character.role === 'hero' && !excluded?.has(character.id))
          .map((character) => character.id)
      );
      if (included.size === 0) return [];
      return [
        {
          ...deck,
          set: excluded?.size
            ? applyCharacterExportSelection(deck.set, included)
            : deck.set
        }
      ];
    });
  }

  async function loadSelectedBox(): Promise<CollectionDeck[] | null> {
    const decks = await loadBox();
    if (!decks) return null;
    const selected = selectedBox(decks);
    if (selected.length > 0) return selected;
    boxProblem = 'Choose at least one character to include.';
    return null;
  }

  async function openExportSelector(): Promise<void> {
    if (boxProgress !== null) return;
    boxProgress = 'Fetching decks…';
    boxProblem = null;
    boxSkipped = [];
    notice = null;
    try {
      const decks = await loadBox();
      if (decks) exportSelectorOpen = true;
    } catch (error) {
      notice = error instanceof Error ? error.message : 'Those decks could not be fetched.';
    } finally {
      boxProgress = null;
    }
  }

  /**
   * The same decks, laid out as printable sheets instead.
   *
   * Swaps the whole screen for `PrintScreen`, the way `SharedSetScreen`
   * already does — a print view nested inside this page's own header would
   * have chrome to hide at print time and a chance to shift the sheet.
   */
  let printMembers = $state<PrintMember[] | null>(null);

  async function openPrint(): Promise<void> {
    if (!collection || boxProgress !== null) return;
    boxProgress = 'Fetching decks…';
    boxProblem = null;
    boxSkipped = [];
    notice = null;
    try {
      const decks = await loadSelectedBox();
      if (!decks) return;
      printMembers = decks.map((deck) => ({
        author: deck.tile.author_name || 'Anonymous',
        set: deck.set
      }));
    } catch (error) {
      notice = error instanceof Error ? error.message : 'Those decks could not be fetched.';
    } finally {
      boxProgress = null;
    }
  }

  /**
   * The same decks as loose PNGs, one folder per creator.
   *
   * Bleed is off by default here, matching `ExportPanel`: somebody taking a
   * whole box is far more often printing it at home than sending it to a
   * shop, and the trimmed images are the ones that can be cut on the line.
   */
  let pngBleed = $state(false);

  async function downloadImages(): Promise<void> {
    if (!collection || boxProgress !== null) return;
    boxProgress = 'Fetching decks…';
    boxProblem = null;
    boxSkipped = [];
    notice = null;
    try {
      const decks = await loadSelectedBox();
      if (!decks) return;

      const result = await exportCollectionCardPngs(
        decks.map((deck) => ({ author: deck.tile.author_name || 'Anonymous', set: deck.set })),
        collection.name || 'Collection',
        {
          bleed: pngBleed,
          onProgress: (done, total) => (boxProgress = `Rendering ${done} of ${total}…`)
        }
      );
      saveExport(result);
      notice = `Downloaded ${result.filename}.`;
    } catch (error) {
      notice = error instanceof Error ? error.message : 'That export did not finish.';
    } finally {
      boxProgress = null;
    }
  }

  async function downloadBox(): Promise<void> {
    if (!collection || boxProgress !== null) return;
    if (!hostBoxOnline && !boxPath.trim()) {
      notice = 'Enter your Tabletop Simulator Saved Objects folder below, then try again.';
      return;
    }
    if (hostBoxOnline && !onlineAvailable) {
      notice = 'Online hosting is not configured for this copy of Unmatched Labs.';
      return;
    }

    boxProgress = 'Fetching decks…';
    boxProblem = null;
    boxSkipped = [];
    notice = null;

    try {
      const decks = await loadSelectedBox();
      if (!decks) return;

      if (!hostBoxOnline) void writeTtsSavedObjectsPath(boxPath);

      const hosting = hostBoxOnline
        ? { kind: 'online' as const, host: await createTtsAssetHost(collection.id) }
        : { kind: 'local' as const, savedObjectsPath: boxPath };

      const result = await exportCollectionBundle(
        decks.map((deck) => ({ author: deck.tile.author_name || 'Anonymous', set: deck.set })),
        {
          name: collection.name || 'Collection',
          subtitle: collection.subtitle,
          hosting,
          onProgress: (done, total, label) => (boxProgress = `${label} — ${done} of ${total}…`)
        }
      );

      if (result.download) saveExport(result.download);
      notice = result.directory
        ? `Wrote ${result.fileCount} files to ${result.directory}.`
        : result.hosting === 'online'
          ? `Downloaded the box. ${result.uploadedCount} files uploaded, ${result.reusedCount} already online.`
          : `Downloaded the box as ${result.download?.filename ?? 'an archive'}.`;
    } catch (error) {
      notice = error instanceof Error ? error.message : 'That export did not finish.';
    } finally {
      boxProgress = null;
    }
  }

  // -- Deleting an empty collection ---------------------------------------

  /**
   * Counted from the membership rows, not from the tiles.
   *
   * Tiles are the accepted members only, and an undecided invitation blocks
   * deletion just as an accepted deck does — reading the grid would offer
   * Delete on a collection the database is about to refuse.
   */
  const liveMembers = $derived(liveMemberCount(memberships));
  let confirmingDelete = $state(false);

  type PageMode = 'showcase' | 'manage' | 'member';
  type ManageTab = 'decks' | 'people' | 'settings';
  type ExportChoice = 'print' | 'images' | 'tts' | null;

  let pageMode = $state<PageMode>('showcase');
  let manageTab = $state<ManageTab>('decks');
  let exportChoice = $state<ExportChoice>(null);
  let previewed = $state(new Set<string>());

  const displayedRemovable = $derived(
    pageMode === 'member'
      ? removable.filter((row) => row.set?.owner_id === auth.user?.id)
      : removable
  );

  const creators = $derived.by(() => {
    const seen = new Set<string>();
    return tiles.flatMap((tile) => {
      if (seen.has(tile.owner_id)) return [];
      seen.add(tile.owner_id);
      return [{ id: tile.owner_id, name: tile.author_name || 'Anonymous', avatar: tile.author_avatar }];
    });
  });

  const hasMemberTools = $derived(
    auth.signedIn &&
      (myPending.length > 0 ||
        myInvitations.length > 0 ||
        myAccepted.length > 0 ||
        offerable.length > 0 ||
        joining !== 'settled')
  );

  const deckAttention = $derived(submissions.length + myInvitations.length);
  const peopleAttention = $derived(pendingInvites.length);

  function showShowcase(): void {
    pageMode = 'showcase';
    editing = false;
  }

  function showManage(tab: ManageTab = 'decks'): void {
    pageMode = 'manage';
    manageTab = tab;
  }

  function primePreview(setId: string): void {
    if (previewed.has(setId)) return;
    previewed = new Set(previewed).add(setId);
  }

  async function removeCollection(): Promise<void> {
    if (!collection) return;
    await run('delete', async () => {
      await deleteCollection(collection!.id);
      /* Straight Home, and through `leaveCollection` so the
         `/collection/{slug}` path is cleared — otherwise a reload would try
         to reopen something that no longer exists. */
      navigation.leaveCollection({ kind: 'home' });
    });
  }

  async function askToPublish(): Promise<void> {
    if (!collection) return;
    if (readiness.waitingOn.length > 0) {
      publishGate = readiness.waitingOn;
      return;
    }
    await setVisibility('public');
  }

  const VISIBILITIES: { value: CollectionVisibility; label: string; hint: string }[] = [
    { value: 'private', label: 'Private', hint: 'Only organizers. The link stops working.' },
    { value: 'unlisted', label: 'Unlisted', hint: 'Anyone with the link. Not in the gallery.' },
    { value: 'public', label: 'Public', hint: 'Listed for everyone to find.' }
  ];
</script>

{#if printMembers}
  <!-- Swapped for, not nested inside: `PrintScreen` renders outside the app
       shell for the same reason, since chrome around a sheet is chrome to
       hide at print time and a chance to shift it by a millimetre. -->
  <PrintScreen members={printMembers} onback={() => (printMembers = null)} />
{:else}
  <CollectionExportSelector
    open={exportSelectorOpen}
    members={boxDecks ?? []}
    excludedBySet={excludedExportCharacters}
    onchange={(next) => (excludedExportCharacters = next)}
    onclose={() => (exportSelectorOpen = false)}
  />
  <div class="screen">
  <main class="body">
    {#if loading}
      <p class="message">Loading…</p>
    {:else if failed}
      <p class="message">That collection could not be loaded. Check the link, or try again.</p>
    {:else if !collection}
      <!--
        One message for "no such collection" and for "made private since the
        link was shared", because `collection_by_slug` deliberately cannot
        tell them apart — saying which would confirm that a private
        collection exists, which is what turning it private was meant to stop.
      -->
      <p class="message">No collection here. The link may be wrong, or no longer shared.</p>
    {:else}
      <section class="hero" aria-labelledby="collection-heading">
        <div class="banner" style:background={tint(collection.id)}>
          {#if collection.banner_url}
            <img src={collection.banner_url} alt="" />
          {:else}
            <span class="banner-initials">{initials(heading)}</span>
          {/if}
          {#if organizer && pageMode === 'manage' && manageTab === 'settings'}
            <input
              bind:this={bannerInput}
              class="sr-only"
              type="file"
              accept="image/*"
              onchange={pickBanner}
            />
            <button type="button" class="banner-edit" onclick={() => bannerInput?.click()}>
              {collection.banner_url ? 'Change banner' : 'Add a banner'}
            </button>
          {/if}
        </div>

        <div class="hero-copy">
          {#if editing}
            <div class="editor">
              <label class="field">
                <span class="field-label">Name</span>
                <input type="text" bind:value={draftName} placeholder="Winter Extravaganza" />
              </label>
              <label class="field">
                <span class="field-label">Subtitle</span>
                <input type="text" bind:value={draftSubtitle} placeholder="Six winter-themed decks" />
              </label>
              <label class="field">
                <span class="field-label">About</span>
                <textarea rows="3" bind:value={draftBlurb} placeholder="What this project is."></textarea>
              </label>
              <div class="editor-actions">
                <button type="button" class="btn primary" onclick={saveEdits} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button type="button" class="btn" onclick={() => (editing = false)}>Cancel</button>
              </div>
            </div>
          {:else}
            <div class="title-row">
              <div>
                <p class="eyebrow">Community collection</p>
                <h1 id="collection-heading" class="collection-title">{heading}</h1>
                {#if collection.subtitle}<p class="subtitle">{collection.subtitle}</p>{/if}
              </div>
              <div class="hero-actions">
                {#if pageMode === 'showcase'}
                  {#if hasMemberTools}
                    <button type="button" class="btn" onclick={() => (pageMode = 'member')}>
                      Your decks
                    </button>
                  {/if}
                  {#if organizer}
                    <button type="button" class="btn primary" onclick={() => showManage()}>
                      Manage collection
                    </button>
                  {/if}
                {:else}
                  <button type="button" class="btn" onclick={showShowcase}>View collection</button>
                {/if}
              </div>
            </div>
            {#if collection.blurb}<p class="blurb">{collection.blurb}</p>{/if}
            <div class="hero-meta">
              <span>{tiles.length} {tiles.length === 1 ? 'deck' : 'decks'}</span>
              <span>{creators.length} {creators.length === 1 ? 'creator' : 'creators'}</span>
              {#if collection.visibility !== 'public' && tiles.length > 0 && auth.signedIn}
                <span class:ready={readiness.waitingOn.length === 0}>
                  {readiness.ready} of {readiness.total} ready
                </span>
              {/if}
              {#if creators.length > 0}
                <span class="creator-stack" aria-label={`Creators: ${creators.map((row) => row.name).join(', ')}`}>
                  {#each creators.slice(0, 6) as creator (creator.id)}
                    {#if creator.avatar}
                      <img src={creator.avatar} alt="" loading="lazy" />
                    {:else}
                      <span aria-hidden="true">{initials(creator.name)}</span>
                    {/if}
                  {/each}
                </span>
              {/if}
            </div>
          {/if}
        </div>
      </section>

      {#if pageMode === 'manage' && organizer}
        <nav class="manage-tabs" aria-label="Collection management">
          <button
            type="button"
            class:on={manageTab === 'decks'}
            aria-current={manageTab === 'decks' ? 'page' : undefined}
            onclick={() => (manageTab = 'decks')}
          >
            Decks {#if deckAttention > 0}<span>{deckAttention}</span>{/if}
          </button>
          <button
            type="button"
            class:on={manageTab === 'people'}
            aria-current={manageTab === 'people' ? 'page' : undefined}
            onclick={() => (manageTab = 'people')}
          >
            People {#if peopleAttention > 0}<span>{peopleAttention}</span>{/if}
          </button>
          <button
            type="button"
            class:on={manageTab === 'settings'}
            aria-current={manageTab === 'settings' ? 'page' : undefined}
            onclick={() => (manageTab = 'settings')}
          >
            Settings
          </button>
        </nav>
      {:else if pageMode === 'member'}
        <div class="workspace-heading">
          <p class="eyebrow">Contributor tools</p>
          <h2>Your decks in {heading}</h2>
        </div>
      {/if}

      {#if organizer && pageMode === 'manage' && (manageTab === 'settings' || manageTab === 'people')}
        <!--
          Organizer-only, and each control says what the setting *does* rather
          than naming it: "unlisted" means nothing to somebody who has not read
          the schema, while "anyone with the link" is the actual promise being
          made about their collaborators' work.
        -->
        <section class="admin">
          <h2>{manageTab === 'settings' ? 'Collection settings' : 'Organizers'}</h2>
          {#if manageTab === 'settings'}
            <div class="admin-row presentation-row">
              <span class="field-label">Presentation</span>
              <button type="button" class="btn" onclick={startEditing}>Edit title and description</button>
              <span class="hint">The banner, title and introduction visitors see first.</span>
            </div>
          {/if}
          <div class="admin-row" class:hidden={manageTab !== 'settings'}>
            <span class="field-label">Who can see this</span>
            <div class="choices">
              {#each VISIBILITIES as option (option.value)}
                <button
                  type="button"
                  class="choice"
                  class:on={collection.visibility === option.value}
                  title={option.hint}
                  onclick={() =>
                    option.value === 'public' ? askToPublish() : setVisibility(option.value)}
                >
                  {option.label}
                </button>
              {/each}
            </div>
            <span class="hint">
              {VISIBILITIES.find((entry) => entry.value === collection?.visibility)?.hint}
            </span>

            <!--
              Said at the control rather than left to be discovered. An
              organizer publishing a box could reasonably assume it publishes
              the decks in it; it does not, and cannot — `sets.visibility`
              belongs to each author and RLS keeps it there. Each of them is
              asked on this page instead, under their own deck.
            -->
            {#if unlistedMemberCount > 0}
              <span class="hint">
                {unlistedMemberCount}
                {unlistedMemberCount === 1 ? 'deck here is' : 'decks here are'} unlisted.
                Publishing the collection does not change that — a deck's own listing is
                its author's to decide, and each of them is asked here.
              </span>
            {/if}
          </div>

          {#if publishGate && manageTab === 'settings'}
            <div class="gate">
              <p class="gate-title">
                {publishGate.length}
                {publishGate.length === 1 ? 'deck is' : 'decks are'} not marked ready
              </p>
              <p class="gate-names">{publishGate.join(', ')}</p>
              <p class="hint">
                Their authors have not said they are finished. You can publish anyway.
              </p>
              <div class="row-actions">
                <button
                  type="button"
                  class="btn primary"
                  disabled={busy !== null}
                  onclick={() => {
                    publishGate = null;
                    void setVisibility('public');
                  }}
                >
                  Publish anyway
                </button>
                <button type="button" class="btn" onclick={() => (publishGate = null)}>
                  Wait for them
                </button>
              </div>
            </div>
          {/if}

          <div class="admin-row" class:hidden={manageTab !== 'settings'}>
            <span class="field-label">Submissions</span>
            <label class="toggle">
              <input
                type="checkbox"
                checked={collection.open_submissions}
                onchange={(event) => setOpenSubmissions(event.currentTarget.checked)}
              />
              <span>Let anyone with this link offer their own deck</span>
            </label>
            <!--
              Says what it does to *other people's* view, because that is the
              thing an organizer cannot see from here and the reason this was
              confusing: turning it off makes the page silent for visitors
              unless they are told why.
            -->
            <span class="hint">
              {collection.open_submissions
                ? 'You still decide what is added — an offer is only a request.'
                : 'Visitors are told the collection is invitation-only and asked to send you a link.'}
            </span>
          </div>

          <div class="admin-row" class:hidden={manageTab !== 'people'}>
            <span class="field-label">Organizers</span>

            <ul class="organizers">
              {#each organizers as row (row.user_id)}
                <li>
                  <span class="who">
                    {row.profile?.display_name || 'Anonymous'}
                    {#if row.user_id === auth.user?.id}<span class="you">you</span>{/if}
                  </span>
                  {#if row.user_id === auth.user?.id}
                    <!--
                      Standing down is offered only when somebody else curates.
                      The database refuses the last one either way — the button
                      is hidden rather than left to fail, and the reason is
                      said, because a control that only ever errors is worse
                      than one that explains itself.
                    -->
                    {#if iAmOnlyOrganizer}
                      <span class="hint">Promote somebody before you can stand down.</span>
                    {:else}
                      <button
                        type="button"
                        class="btn"
                        disabled={busy !== null}
                        onclick={() => demote(row.user_id)}
                      >
                        {busy === `demote-${row.user_id}` ? 'Standing down…' : 'Stand down'}
                      </button>
                    {/if}
                  {:else}
                    <button
                      type="button"
                      class="btn"
                      disabled={busy !== null}
                      onclick={() => demote(row.user_id)}
                    >
                      {busy === `demote-${row.user_id}` ? 'Removing…' : 'Remove'}
                    </button>
                  {/if}
                </li>
              {/each}
            </ul>

            {#if promotable.length > 0}
              <div class="row-actions">
                <select bind:value={promoteTarget} disabled={busy !== null}>
                  <option value="">Choose a creator…</option>
                  {#each promotable as tile (tile.owner_id)}
                    <option value={tile.owner_id}>{tile.author_name || 'Anonymous'}</option>
                  {/each}
                </select>
                <button
                  type="button"
                  class="btn"
                  disabled={busy !== null || !promoteTarget}
                  onclick={() => promote(promoteTarget)}
                >
                  {busy === 'promote' ? 'Adding…' : 'Make organizer'}
                </button>
              </div>
              <span class="hint">
                An organizer can invite decks, decide on offers, edit this page and publish it.
                Anyone with a deck here can be one.
              </span>
            {:else if tiles.length === 0}
              <span class="hint">
                Once a deck is in the collection, its creator can be made an organizer too.
              </span>
            {:else}
              <span class="hint">Everyone with a deck here is already an organizer.</span>
            {/if}
          </div>

          <div class="admin-row" class:hidden={manageTab !== 'settings'}>
            <span class="field-label">Delete</span>
            {#if liveMembers > 0}
              <!--
                Said rather than hidden. A missing button is a puzzle; naming
                the condition tells an organizer what to do about it.
              -->
              <span class="hint">
                Only an empty collection can be deleted. Remove its
                {liveMembers}
                {liveMembers === 1 ? 'deck or pending request' : 'decks and pending requests'}
                first.
              </span>
            {:else if confirmingDelete}
              <div class="row-actions">
                <button
                  type="button"
                  class="btn danger"
                  disabled={busy !== null}
                  onclick={removeCollection}
                >
                  {busy === 'delete' ? 'Deleting…' : 'Delete for good'}
                </button>
                <button type="button" class="btn" onclick={() => (confirmingDelete = false)}>
                  Keep it
                </button>
              </div>
            {:else}
              <button type="button" class="btn" onclick={() => (confirmingDelete = true)}>
                Delete this collection
              </button>
              <span class="hint">It is empty, so nothing of anyone else's is affected.</span>
            {/if}
          </div>

          <div class="admin-row" class:hidden={manageTab !== 'settings'}>
            <span class="field-label">Link</span>
            <button type="button" class="btn" onclick={copyLink}>Copy link</button>
            <span class="hint">
              {collection.visibility === 'private'
                ? 'The link is off while this is private.'
                : 'Anyone you send this to can open the collection.'}
            </span>
          </div>
        </section>
      {/if}

      {#if claimNotice}
        <p class="notice claim">{claimNotice}</p>
      {/if}

      {#if notice}<p class="notice">{notice}</p>{/if}

      <div class="content-flow">

      {#if pageMode === 'member' && myPending.length > 0}
        <section class="panel">
          <h2>Waiting on the organizers</h2>
          <p class="hint">
            Offered, and not decided yet. It will appear in the collection once an organizer
            accepts it; you can withdraw it before then.
          </p>
          <ul class="rows">
            {#each myPending as row (row.set_id)}
              <li>
                <span class="row-name">{row.set?.name || 'Untitled'}</span>
                <button
                  type="button"
                  class="btn"
                  disabled={busy !== null}
                  onclick={() =>
                    run(`withdraw-${row.set_id}`, () => removeMember(collection!.id, row.set_id))}
                >
                  Withdraw
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if pageMode === 'member' && myInvitations.length > 0}
        <!--
          The deck owner's own decision, and the one place the consent
          sentence has to appear — see `CONSENT`.
        -->
        <section class="panel invitations">
          <h2>Invitations for you</h2>
          <p class="consent">{CONSENT}</p>
          <ul class="rows">
            {#each myInvitations as row (row.set_id)}
              <li>
                <span class="row-name">{row.set?.name || 'Untitled'}</span>
                <span class="row-actions">
                  <button
                    type="button"
                    class="btn primary"
                    disabled={busy !== null}
                    onclick={() =>
                      run(`accept-${row.set_id}`, () =>
                        respondToInvitation(collection!.id, row.set_id, 'accepted')
                      )}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    class="btn"
                    disabled={busy !== null}
                    onclick={() =>
                      run(`decline-${row.set_id}`, () =>
                        respondToInvitation(collection!.id, row.set_id, 'declined')
                      )}
                  >
                    Decline
                  </button>
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if organizer && pageMode === 'manage' && manageTab === 'decks' && submissions.length > 0}
        <section class="panel">
          <h2>Decks offered to this collection</h2>
          <ul class="rows">
            {#each submissions as row (row.set_id)}
              <li>
                <span class="row-name">
                  {row.set?.name || 'Untitled'}
                  <span class="row-by">{row.set?.author?.display_name || 'Anonymous'}</span>
                </span>
                <span class="row-actions">
                  <button
                    type="button"
                    class="btn primary"
                    disabled={busy !== null}
                    onclick={() =>
                      run(`take-${row.set_id}`, () =>
                        resolveSubmission(collection!.id, row.set_id, 'accepted')
                      )}
                  >
                    Add to collection
                  </button>
                  <button
                    type="button"
                    class="btn"
                    disabled={busy !== null}
                    onclick={() =>
                      run(`pass-${row.set_id}`, () =>
                        resolveSubmission(collection!.id, row.set_id, 'declined')
                      )}
                  >
                    Decline
                  </button>
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if organizer && pageMode === 'manage' && manageTab === 'decks'}
        <section class="panel">
          <h2>Invite a deck</h2>
          <p class="hint">
            Paste the share link of a published deck. Its author decides whether to join.
          </p>
          <div class="invite-row">
            <input
              type="text"
              bind:value={inviteLink}
              placeholder="https://…/shared/… or the code at its end"
            />
            <button
              type="button"
              class="btn primary"
              disabled={busy !== null || inviteLink.trim().length === 0}
              onclick={invite}
            >
              {busy === 'invite' ? 'Inviting…' : 'Invite'}
            </button>
          </div>
          {#if invitedOut.length > 0}
            <p class="hint">
              Waiting on {invitedOut.length}
              {invitedOut.length === 1 ? 'author' : 'authors'}:
              {invitedOut.map((row) => row.set?.name || 'Untitled').join(', ')}
            </p>
          {/if}
        </section>
      {/if}

      {#if (pageMode === 'member' || (organizer && pageMode === 'manage' && manageTab === 'decks')) && displayedRemovable.length > 0}
        <section class="panel">
          <h2>In this collection</h2>
          <p class="hint">
            Removing a deck only unlinks it. Its own page, link and listing are untouched.
          </p>
          <ul class="rows">
            {#each displayedRemovable as row (row.set_id)}
              <li>
                <span class="row-name">
                  {row.set?.name || 'Untitled'}
                  {#if row.set?.owner_id !== auth.user?.id}
                    <span class="row-by">{row.set?.author?.display_name || 'Anonymous'}</span>
                  {/if}
                </span>
                <button
                  type="button"
                  class="btn"
                  disabled={busy !== null}
                  onclick={() =>
                    run(`remove-${row.set_id}`, () => removeMember(collection!.id, row.set_id))}
                >
                  {row.set?.owner_id === auth.user?.id ? 'Leave' : 'Remove'}
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <!--
        Always answers "can I join, and how?" — see the `joining` derived for
        why every branch here has to exist rather than the panel simply not
        rendering.
      -->
      {#if pageMode === 'member' && joining !== 'settled'}
        <section class="panel joining">
          <h2>Offer one of your published decks</h2>

          {#if joining === 'signed-out'}
            <p class="hint">
              Sign in to offer one of your published decks to this collection. Your deck stays
              yours — a collection only points at it.
            </p>
          {:else if joining === 'nothing-published'}
            <p class="hint">
              A collection gathers decks that are already published, so publish one first:
              open it, then <strong>Export → Publish</strong>. Come back here afterwards and
              it will be offerable.
            </p>
          {:else if joining === 'invite-only'}
            <p class="hint">
              This collection is invitation-only. Send an organizer the share link of the deck
              you would like to add, and they can invite it.
            </p>
          {:else}
            <p class="consent">{CONSENT}</p>
            <p class="hint publication-note">
              Home shows editable drafts in this browser. This list shows published copies owned
              by your account, including copies whose draft is on another device or no longer in Home.
            </p>
            <ul class="rows">
              {#each offerable as row (row.id)}
                <li>
                  <span class="row-name deck-source">
                    <span>{row.name || 'Untitled'}</span>
                    {#if !draftIsOnHome(row)}
                      <span class="row-source">Published copy · draft not in Home on this browser</span>
                    {/if}
                  </span>
                  <button
                    type="button"
                    class="btn primary"
                    disabled={busy !== null}
                    onclick={() => addOwnDeck(row.id)}
                  >
                    Offer this deck
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

      {#if organizer && pageMode === 'manage' && manageTab === 'decks' && offerable.length > 0}
        <section class="panel">
          <h2>Add one of your published decks</h2>
          <p class="hint">
            Published copies owned by your account go straight in. Home shows editable drafts,
            so a copy published on another device or left after its draft was deleted may also appear.
          </p>
          <ul class="rows">
            {#each offerable as row (row.id)}
              <li>
                <span class="row-name deck-source">
                  <span>{row.name || 'Untitled'}</span>
                  {#if !draftIsOnHome(row)}
                    <span class="row-source">Published copy · draft not in Home on this browser</span>
                  {/if}
                </span>
                <button
                  type="button"
                  class="btn"
                  disabled={busy !== null}
                  onclick={() => addOwnDeck(row.id)}
                >
                  Add this deck
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if pageMode === 'showcase'}
      <p class="count showcase-count">
        {tiles.length}
        {tiles.length === 1 ? 'deck' : 'decks'}
        <!--
          Only while a collection is still being built. Once it is public the
          line has done its job, and a permanent "6 of 6 ready" is noise on a
          page whose visitors are readers rather than contributors.
        -->
        {#if collection.visibility !== 'public' && tiles.length > 0}
          <span class="ready-line" class:all={readiness.waitingOn.length === 0}>
            · {readiness.ready} of {readiness.total} ready
          </span>
        {/if}
      </p>
      {/if}

      {#if pageMode === 'member' && myAccepted.length > 0}
        <section class="panel">
          <h2>Your deck{myAccepted.length === 1 ? '' : 's'} here</h2>
          <p class="hint">
            Marking a deck ready tells the organizers it is finished. Only you can, and you
            can change your mind while the collection is still unpublished.
          </p>
          <ul class="rows">
            {#each myAccepted as row (row.set_id)}
              <li>
                <span class="row-name">{row.set?.name || 'Untitled'}</span>
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={row.ready}
                    disabled={busy !== null}
                    onchange={(event) =>
                      run(`ready-${row.set_id}`, () =>
                        setMemberReady(collection!.id, row.set_id, event.currentTarget.checked)
                      )}
                  />
                  <span>Ready</span>
                </label>
              </li>
            {/each}
          </ul>

          {#if myUnlistedHere.length > 0}
            <!--
              Shown only to the deck's own author, and only once the collection
              is public. Both outcomes are stated because neither is the
              default-correct one: a deck can belong to a box without wanting a
              listing of its own.
            -->
            <div class="launch-ask">
              <p class="hint">
                This collection is public.
                {myUnlistedHere.length === 1 ? 'Your deck is' : 'Your decks are'}
                still unlisted — reachable through the box and its own link, but not
                shown in the gallery. Publishing is yours to decide; the collection
                never changes it.
              </p>
              {#each myUnlistedHere as row (row.set_id)}
                <div class="row-actions">
                  <span class="row-name">{row.set?.name || 'Untitled'}</span>
                  <button
                    type="button"
                    class="btn"
                    disabled={busy !== null}
                    onclick={() => void publishMyDeck(row.set_id)}
                  >
                    {busy === `publish-deck-${row.set_id}`
                      ? 'Publishing…'
                      : 'List it in the gallery'}
                  </button>
                </div>
              {/each}
              <p class="hint">
                Leaving it unlisted is a real choice — some decks are meant to exist
                only as part of their collection.
              </p>
            </div>
          {/if}
        </section>
      {/if}

      {#if organizer && pageMode === 'manage' && manageTab === 'people'}
        <section class="panel invites">
          <h2>Invite people</h2>
          <!--
            Says what an invitation does, not how membership is stored. The
            first draft explained that `collection_members` is keyed on a deck
            and concluded "somebody with nothing published cannot be added",
            which is true of a *member* and flatly wrong about the panel it
            introduces — the whole point here is that they can.
          -->
          <p class="hint">
            For anyone who does not have a deck here yet, including creators who have not
            published anything at all. An invitation gives them a place in the project now;
            they can offer a deck whenever one is ready.
          </p>

          {#if pendingInvites.length > 0}
            <h3 class="sub">Waiting on an answer</h3>
            <ul class="rows">
              {#each pendingInvites as row (row.id)}
                <li>
                  <span class="row-name">{row.invited?.display_name || 'Anonymous'}</span>
                  <button
                    type="button"
                    class="btn"
                    disabled={busy !== null}
                    onclick={() => dropInvite(row.id)}
                  >
                    {busy === `drop-${row.id}` ? 'Withdrawing…' : 'Withdraw'}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}

          <h3 class="sub">A link anyone can join with</h3>
          <!--
            Said before the link is made, not after. One link admits everybody
            it reaches, which is the point and also the risk — an organizer who
            learns that from the consequences has learnt it too late.
          -->
          <p class="hint warn">
            Anyone who opens the link can join this collection. Send it to the people you
            mean to invite — do not post it publicly.
          </p>

          {#each linkInvites as row (row.id)}
            <div class="link-row" class:off={row.status === 'revoked'}>
              <span class="row-name">{row.label || 'Invitation link'}</span>
              <span class="link-state">
                {row.status === 'revoked' ? 'turned off' : 'active'}
                · {row.claims.length}
                {row.claims.length === 1 ? 'person joined' : 'people joined'}
              </span>
              <span class="row-actions">
                {#if row.status !== 'revoked'}
                  <button type="button" class="btn" onclick={() => void copyInviteLink(row.token)}>
                    {copiedLink === row.token ? 'Copied' : 'Copy link'}
                  </button>
                  <button
                    type="button"
                    class="btn"
                    disabled={busy !== null}
                    onclick={() => stopLink(row.id)}
                  >
                    {busy === `revoke-${row.id}` ? 'Turning off…' : 'Turn off'}
                  </button>
                {/if}
                <button
                  type="button"
                  class="btn"
                  disabled={busy !== null}
                  onclick={() => dropInvite(row.id)}
                >
                  Delete
                </button>
              </span>

              {#if row.claims.length > 0}
                <!--
                  Turning a link off stops it admitting anybody new; it does not
                  put out the people already through. Removing one of them is
                  this, deliberately separate.
                -->
                <ul class="claims">
                  {#each row.claims as claim (claim.user_id)}
                    <li>
                      <span>{claim.who?.display_name || 'Anonymous'}</span>
                      <button
                        type="button"
                        class="btn tiny"
                        disabled={busy !== null}
                        onclick={() => dropClaim(row.id, claim.user_id)}
                      >
                        Remove
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/each}

          <div class="row-actions">
            <input
              type="text"
              class="label-input"
              placeholder="What this link is for — your note, nobody else sees it"
              bind:value={linkLabel}
              disabled={busy !== null}
            />
            <button type="button" class="btn" disabled={busy !== null} onclick={makeLink}>
              {busy === 'make-link' ? 'Making…' : 'New link'}
            </button>
          </div>

          <p class="hint">
            To invite one particular person, open a deck they published, follow their name to
            their profile, and invite them from there — that way the invitation is addressed
            to them rather than to a name somebody else could take.
          </p>
        </section>
      {/if}

      {#if pageMode === 'showcase' && tiles.length === 0}
        <!-- An empty project is a beginning, not a broken collection. -->
        <p class="message empty-collection">
          No decks yet. Whoever is organizing this can invite them, or open it for submissions.
        </p>
      {:else if pageMode === 'showcase'}
        <ul class="grid showcase-grid">
          {#each tiles as tile (tile.set_id)}
            <li>
              <button
                type="button"
                class="tile"
                aria-label={`Open ${tile.name || 'Untitled'} deck by ${tile.author_name || 'Anonymous'}`}
                onclick={() => navigation.openShared(tile.slug)}
                onmouseenter={() => tile.preview_card_url && primePreview(tile.set_id)}
                onfocus={() => tile.preview_card_url && primePreview(tile.set_id)}
              >
                <span
                  class="cover"
                  style:--trim-scale={TRIM_SCALE_WIDE}
                  style:background={tint(tile.set_id)}
                >
                  {#if tileImage(tile)}
                    <img
                      src={tileImage(tile)}
                      class="cover-art"
                      class:trimmed={tile.cover_bleeds}
                      alt=""
                      loading="lazy"
                    />
                  {:else}
                    <span class="initials">{initials(tile.name)}</span>
                  {/if}
                  {#if tile.preview_card_url && previewed.has(tile.set_id)}
                    <img class="preview-card" src={tile.preview_card_url} alt="" />
                  {/if}
                </span>

                <span class="card-body">
                  <span class="deck-name">{tile.name || 'Untitled'}</span>
                  {#if tile.subtitle}<span class="subtitle-line">{tile.subtitle}</span>{/if}
                  <span class="by">
                    {#if tile.author_avatar}
                      <img class="avatar" src={tile.author_avatar} alt="" loading="lazy" />
                    {/if}
                    <span class="author">{tile.author_name || 'Anonymous'}</span>
                  </span>
                  <span class="meta">
                    <span>revision {tile.revision}</span>
                    {#if tile.hero_count > 0}
                      <span>{tile.hero_count} {tile.hero_count === 1 ? 'hero' : 'heroes'}</span>
                    {/if}
                    <span>{tile.card_count} {tile.card_count === 1 ? 'card' : 'cards'}</span>
                  </span>
                  <span class="open-deck">
                    Explore this deck <span aria-hidden="true">→</span>
                  </span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if pageMode === 'showcase' && tiles.length > 0}
        <section class="panel box showcase-export">
          <p class="eyebrow">Ready for the table</p>
          <h2>Play or print this collection</h2>
          <p class="hint">
            Take every deck together, while preserving each creator's artwork and styling.
          </p>
          <div class="customize-row">
            <button
              type="button"
              class="btn"
              disabled={boxProgress !== null}
              onclick={() => void openExportSelector()}
            >
              {boxProgress ?? "Customize what's included"}
            </button>
            <span>
              {#if exportSelectionActive}
                {selectedCharacterCount} of {exportCharacterTotal} characters
              {:else}
                {exportCharacterTotal}
                {exportCharacterTotal === 1 ? 'character' : 'characters'} included
              {/if}
            </span>
          </div>

          <div class="export-choices" aria-label="Export format">
            <button
              type="button"
              class:chosen={exportChoice === 'print'}
              aria-pressed={exportChoice === 'print'}
              onclick={() => (exportChoice = 'print')}
            >
              <strong>Print sheets</strong>
              <span>Lay out the whole collection for printing.</span>
            </button>
            <button
              type="button"
              class:chosen={exportChoice === 'images'}
              aria-pressed={exportChoice === 'images'}
              onclick={() => (exportChoice = 'images')}
            >
              <strong>Card images</strong>
              <span>Download every card as an image archive.</span>
            </button>
            <button
              type="button"
              class:chosen={exportChoice === 'tts'}
              aria-pressed={exportChoice === 'tts'}
              onclick={() => (exportChoice = 'tts')}
            >
              <strong>Tabletop Simulator</strong>
              <span>Build one save with a row per creator.</span>
            </button>
          </div>

          {#if exportChoice === 'print'}
            <div class="export-options">
              <p>Cards are grouped into printable sheets by their finished size.</p>
              <button
                type="button"
                class="btn primary"
                disabled={boxProgress !== null || selectedCharacterCount === 0}
                onclick={openPrint}
              >
                Open print sheets
              </button>
            </div>
          {:else if exportChoice === 'images'}
            <div class="export-options">
              <label class="toggle">
                <input type="checkbox" bind:checked={pngBleed} disabled={boxProgress !== null} />
                <span>Include the printer's bleed</span>
              </label>
              <button
                type="button"
                class="btn primary"
                disabled={boxProgress !== null || selectedCharacterCount === 0}
                onclick={downloadImages}
              >
                {boxProgress ?? 'Download card images'}
              </button>
            </div>
          {:else if exportChoice === 'tts'}
            <div class="export-options">
              {#if onlineAvailable}
                <label class="toggle">
                  <input type="checkbox" bind:checked={hostBoxOnline} />
                  <span>Host the images online so everyone at the table can see them</span>
                </label>
              {/if}

              {#if !hostBoxOnline || !onlineAvailable}
                <!-- A local save addresses images by a path on this machine. -->
                <label class="field">
                  <span class="field-label">Saved Objects folder</span>
                  <input
                    type="text"
                    bind:value={boxPath}
                    placeholder="C:\Users\you\Documents\My Games\Tabletop Simulator\Saves\Saved Objects"
                  />
                </label>
              {/if}

              <button
                type="button"
                class="btn primary"
                disabled={boxProgress !== null || selectedCharacterCount === 0}
                onclick={downloadBox}
              >
                {boxProgress ?? 'Download the save'}
              </button>
            </div>
          {/if}

          {#if boxProblem}
            <p class="hint problem">{boxProblem}</p>
          {/if}

          {#if boxSkipped.length > 0}
            <!--
              Named rather than counted. A box quietly missing a deck is worse
              than one that says which, because the person downloading it has
              no other way to find out.
            -->
            <p class="hint problem">
              Left out:
              {#each boxSkipped as entry, index (entry.name)}
                {#if index > 0}; {/if}{entry.name} — {entry.reason}
              {/each}
            </p>
          {/if}
        </section>
      {/if}

      </div>
    {/if}
  </main>
</div>
{/if}

<style>
  /* Owns its own scrolling — see the note at the top of this file. */
  .screen {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow-y: auto;
    background: var(--surface-canvas);
  }

  .body {
    width: min(76rem, 100%);
    margin: 0 auto;
    padding: var(--space-6) var(--space-6) var(--space-10);
  }

  .banner {
    height: clamp(7rem, 18vw, 12rem);
    border-radius: var(--radius-md);
    overflow: hidden;
    margin-bottom: var(--space-5);
  }
  .banner img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  h1 {
    margin: 0 0 var(--space-2);
    color: var(--text-primary);
  }

  .subtitle {
    margin: 0 0 var(--space-3);
    color: var(--text-secondary);
    font-size: var(--text-lg);
  }

  .blurb {
    margin: 0 0 var(--space-4);
    max-width: 62ch;
    color: var(--text-secondary);
  }

  .count {
    margin: 0 0 var(--space-5);
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .message {
    color: var(--text-tertiary);
  }

  .notice {
    color: var(--text-secondary);
    background: var(--surface-inset);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    margin: 0 0 var(--space-4);
  }

  .banner {
    position: relative;
  }
  .banner-edit {
    position: absolute;
    right: var(--space-3);
    bottom: var(--space-3);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
  }
  .banner-edit:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    max-width: 40rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .field-label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
  }
  .editor input,
  .editor textarea {
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    resize: vertical;
  }
  .editor input:focus-visible,
  .editor textarea:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .editor-actions {
    display: flex;
    gap: var(--space-2);
  }

  .btn {
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
    flex: none;
  }
  .btn:hover {
    border-color: var(--border-strong);
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--text-on-accent);
  }
  .btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .admin {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    margin-bottom: var(--space-5);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-base);
  }
  .admin-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
  }
  .admin-row .field-label {
    width: 9rem;
    flex: none;
  }
  .choices {
    display: flex;
    gap: var(--space-1);
  }
  .choice {
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
  }
  .choice.on {
    background: var(--accent-soft);
    border-color: var(--border-accent);
    color: var(--text-accent);
  }
  .choice:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .panel {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-base);
    padding: var(--space-4);
    margin-bottom: var(--space-4);
  }
  .panel h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-base);
    color: var(--text-primary);
  }
  .launch-ask {
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-subtle, var(--border-default));
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .launch-ask .row-actions {
    align-items: center;
    gap: var(--space-3);
  }

  .notice.claim {
    border-left: 3px solid var(--accent);
  }
  .hint.warn {
    color: var(--warning);
  }
  .link-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-top: 1px solid var(--border-subtle, var(--border-default));
  }
  .link-row.off {
    opacity: 0.6;
  }
  .link-state {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .link-row .claims {
    grid-column: 1 / -1;
    list-style: none;
    margin: 0;
    padding: 0 0 0 var(--space-4);
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .link-row .claims li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }
  .label-input {
    flex: 1;
    min-width: 16rem;
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
  }

  .organizers {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .organizers li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .organizers .who {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 12rem;
  }
  .organizers .you {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-2);
  }

  .panel.box .field {
    max-width: 44rem;
    margin-bottom: var(--space-3);
  }
  .panel.box .field input {
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
  }
  .panel.box .field input:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .panel.box .toggle {
    margin-bottom: var(--space-3);
  }
  .hint.problem {
    color: var(--warning);
    margin-top: var(--space-3);
  }

  .panel.joining {
    border-color: var(--border-accent);
  }
  .panel.invitations {
    border-color: var(--border-accent);
    background: var(--accent-soft);
  }

  /* The promise being made, so it is read before the button beneath it. */
  .consent {
    margin: 0 0 var(--space-3);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    max-width: 60ch;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .rows li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .row-name {
    color: var(--text-primary);
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }
  .row-by {
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }
  .deck-source {
    align-items: flex-start;
    flex-direction: column;
    gap: 0;
  }
  .row-source {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .publication-note {
    margin-top: 0;
  }
  .row-actions {
    display: flex;
    gap: var(--space-2);
  }

  .invite-row {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .invite-row input {
    flex: 1 1 auto;
    min-width: 0;
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
  }
  .invite-row input:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .btn.danger {
    border-color: var(--danger);
    color: var(--danger);
  }
  .btn.danger:hover {
    background: var(--danger);
    color: var(--text-on-accent);
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .ready-line {
    color: var(--warning);
  }
  .ready-line.all {
    color: var(--success);
  }

  .gate {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
  }
  .gate-title {
    margin: 0;
    color: var(--text-primary);
    font-weight: 600;
  }
  .gate-names {
    margin: 0;
    color: var(--text-secondary);
  }
  .gate .hint {
    margin: 0;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: var(--space-4);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .tile {
    display: flex;
    flex-direction: column;
    width: 100%;
    text-align: left;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    cursor: pointer;
    font: inherit;
    color: inherit;
    transition: border-color var(--duration-fast) var(--ease-out);
  }
  .tile:hover {
    border-color: var(--border-strong);
  }
  .tile:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .cover {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 4 / 3;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /*
   * A cover drawn from a full print plate is scaled up and re-centred so the
   * bleed margin falls outside the box, rather than printing a band of empty
   * frame inside a tile that is already framed. `--trim-scale` carries the
   * ratio; see its derivation above.
   */
  .cover img.trimmed {
    transform: scale(var(--trim-scale));
  }

  .initials {
    font-size: var(--text-2xl);
    font-weight: 600;
    color: var(--text-on-accent);
    opacity: 0.7;
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .subtitle-line {
    color: var(--text-tertiary);
    font-size: var(--text-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .by {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-1);
    min-width: 0;
  }
  .avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex: none;
  }
  .author {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  /* The collection is a showcase first; management is a deliberate mode. */
  .hero {
    margin-bottom: var(--space-8);
  }

  .hero .banner {
    height: clamp(10rem, 24vw, 19rem);
    margin: 0;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
  }

  .banner-initials {
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
    color: var(--text-on-accent);
    font-family: var(--font-display);
    font-size: clamp(var(--text-2xl), 7vw, var(--space-10));
    font-weight: var(--weight-semibold);
    opacity: 0.72;
  }

  .hero-copy {
    position: relative;
    width: calc(100% - var(--space-8));
    margin: calc(var(--space-7) * -1) auto 0;
    padding: var(--space-6);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
    box-shadow: var(--shadow-md);
  }

  .eyebrow {
    margin: 0 0 var(--space-2);
    color: var(--text-accent);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
  }

  .hero .title-row {
    align-items: flex-start;
  }

  .collection-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
  }

  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .hero .blurb {
    margin-top: var(--space-4);
    margin-bottom: var(--space-5);
    font-size: var(--text-md);
    line-height: var(--leading-relaxed);
  }

  .hero-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .hero-meta > span:not(.creator-stack) + span:not(.creator-stack)::before {
    content: '·';
    margin-right: var(--space-4);
    color: var(--border-strong);
  }

  .hero-meta .ready {
    color: var(--success);
  }

  .creator-stack {
    display: flex;
    margin-left: auto;
    padding-left: var(--space-2);
  }

  .creator-stack img,
  .creator-stack > span {
    display: grid;
    width: var(--space-7);
    height: var(--space-7);
    margin-left: calc(var(--space-2) * -1);
    place-items: center;
    border: 2px solid var(--surface-raised);
    border-radius: var(--radius-full);
    background: var(--surface-selected);
    color: var(--text-accent);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    object-fit: cover;
  }

  .manage-tabs {
    display: flex;
    gap: var(--space-1);
    margin-bottom: var(--space-5);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border-subtle);
  }

  .manage-tabs button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .manage-tabs button:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .manage-tabs button.on {
    background: var(--surface-selected);
    color: var(--text-accent);
    font-weight: var(--weight-semibold);
  }

  .manage-tabs button span {
    min-width: 1.25rem;
    padding: 0 var(--space-1);
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--text-on-accent);
    font-size: var(--text-2xs);
    text-align: center;
  }

  .workspace-heading {
    margin-bottom: var(--space-5);
  }

  .workspace-heading h2,
  .admin h2 {
    margin: 0;
    color: var(--text-primary);
    font-family: var(--font-display);
    font-size: var(--text-xl);
  }

  .hidden {
    display: none;
  }

  .content-flow {
    display: flex;
    flex-direction: column;
  }

  .showcase-count {
    order: 0;
    margin-bottom: var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
  }

  .showcase-grid {
    order: 1;
  }

  .showcase-export {
    order: 2;
    margin-top: var(--space-9);
    margin-bottom: 0;
    padding: var(--space-6);
    background: var(--surface-base);
  }

  .showcase-export h2 {
    margin-bottom: var(--space-2);
    font-family: var(--font-display);
    font-size: var(--text-xl);
  }

  .export-choices {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
    margin-top: var(--space-5);
  }

  .customize-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
    margin-top: var(--space-4);
  }

  .customize-row span {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .export-choices button {
    display: flex;
    min-height: 6rem;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    color: var(--text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .export-choices button:hover,
  .export-choices button.chosen {
    border-color: var(--border-accent);
    background: var(--accent-soft);
  }

  .export-choices button span {
    color: var(--text-tertiary);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }

  .export-options {
    display: flex;
    align-items: flex-start;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-subtle);
  }

  .export-options p {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .grid {
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    gap: var(--space-5);
  }

  .grid li {
    display: flex;
  }

  .tile {
    height: 100%;
    gap: 0;
    padding: 0;
    overflow: hidden;
    box-shadow: var(--shadow-sm);
  }

  .tile:hover {
    border-color: var(--border-accent);
    box-shadow: var(--shadow-md);
  }

  .cover {
    position: relative;
    width: 100%;
    padding: 0;
    border: 0;
    border-radius: 0;
    font: inherit;
  }

  .cover img.cover-art,
  .cover img.preview-card {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .cover img.cover-art {
    object-fit: cover;
  }

  .cover img.preview-card {
    object-fit: contain;
    background: inherit;
    opacity: 0;
    transition: opacity var(--duration-normal) var(--ease-out);
  }

  .tile:focus .preview-card {
    opacity: 1;
  }

  @media (hover: hover) {
    .tile:hover .preview-card {
      opacity: 1;
    }
  }

  .card-body {
    flex: 1;
    gap: var(--space-2);
    padding: var(--space-4);
  }

  .deck-name {
    overflow: hidden;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .open-deck {
    display: flex;
    min-height: calc(var(--space-7) + var(--space-3));
    align-items: center;
    align-self: flex-start;
    margin-top: auto;
    padding: var(--space-2) 0 0;
    border: 0;
    background: transparent;
    color: var(--text-accent);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }

  @media (prefers-reduced-motion: reduce) {
    .cover img.preview-card {
      transition: none;
    }
  }

  @media (max-width: 720px) {
    .body {
      padding: var(--space-4) var(--space-4) var(--space-9);
    }

    .hero-copy {
      width: calc(100% - var(--space-4));
      margin-top: calc(var(--space-5) * -1);
      padding: var(--space-4);
    }

    .hero .title-row {
      flex-direction: column;
    }

    .hero-actions {
      width: 100%;
      justify-content: flex-start;
    }

    .creator-stack {
      width: 100%;
      margin: var(--space-1) 0 0 var(--space-2);
    }

    .hero-meta > span:not(.creator-stack) + span:not(.creator-stack)::before {
      margin-right: var(--space-2);
    }

    .manage-tabs {
      overflow-x: auto;
    }

    .manage-tabs button {
      white-space: nowrap;
    }

    .export-choices {
      grid-template-columns: 1fr;
    }

    .export-choices button {
      min-height: 0;
    }
  }
</style>
