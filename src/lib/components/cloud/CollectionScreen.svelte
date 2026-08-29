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
    deleteCollection,
    liveMemberCount,
    readinessOf,
    fetchCollectionBySlug,
    fetchCollectionTiles,
    addOwnDeckDirectly,
    inviteDeck,
    listMemberships,
    removeMember,
    resolveSubmission,
    respondToInvitation,
    setMemberReady,
    submitDeck,
    updateCollection,
    uploadCollectionBanner
  } from '$lib/cloud/collections';
  import { fetchSetSummaryBySlug, listMyPublishedSets } from '$lib/cloud/sets';
  import type { PublishedSet } from '$lib/cloud/sets';
  import type {
    Collection,
    CollectionMembership,
    CollectionTile,
    CollectionVisibility
  } from '$lib/cloud/collections';
  import { cloudEnabled } from '$lib/cloud/config';
  import { initials, tint } from '$lib/core/swatch';
  import { CARD_FORMATS, trimBox } from '$lib/renderer/geometry';
  import { auth } from '$lib/cloud/auth.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { ThemeToggle } from '$lib/ui';
  import AccountMenu from './AccountMenu.svelte';

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
      notice = error instanceof Error ? error.message : 'Could not change who can see this.';
    }
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
   * Set when Public was asked for while somebody is still not ready.
   *
   * A confirmation rather than a refusal: the gate exists so one eager
   * organizer cannot debut a half-finished deck over its author's head, but
   * an absent member must not be able to freeze a project for ever either —
   * so it names who, and lets an organizer go anyway having read the names.
   */
  let publishGate = $state<string[] | null>(null);

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

<div class="screen">
  <header class="head">
    <div class="head-left">
      <button
        type="button"
        class="link"
        onclick={() => navigation.leaveCollection({ kind: 'home' })}
      >
        Home
      </button>
      {#if cloudEnabled()}
        <button
          type="button"
          class="link"
          onclick={() => navigation.leaveCollection({ kind: 'gallery' })}
        >
          Gallery
        </button>
      {/if}
    </div>
    <div class="head-right">
      <ThemeToggle />
      <AccountMenu />
    </div>
  </header>

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
      <div class="banner" style:background={tint(collection.id)}>
        {#if collection.banner_url}
          <img src={collection.banner_url} alt="" />
        {/if}
        {#if organizer}
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
          <h1>{heading}</h1>
          {#if organizer}
            <button type="button" class="btn" onclick={startEditing}>Edit details</button>
          {/if}
        </div>
        {#if collection.subtitle}<p class="subtitle">{collection.subtitle}</p>{/if}
        {#if collection.blurb}<p class="blurb">{collection.blurb}</p>{/if}
      {/if}

      {#if organizer}
        <!--
          Organizer-only, and each control says what the setting *does* rather
          than naming it: "unlisted" means nothing to somebody who has not read
          the schema, while "anyone with the link" is the actual promise being
          made about their collaborators' work.
        -->
        <section class="admin">
          <div class="admin-row">
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
          </div>

          {#if publishGate}
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

          <div class="admin-row">
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

          <div class="admin-row">
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

          <div class="admin-row">
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

      {#if notice}<p class="notice">{notice}</p>{/if}

      {#if myPending.length > 0}
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

      {#if myInvitations.length > 0}
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

      {#if organizer && submissions.length > 0}
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

      {#if organizer}
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

      {#if removable.length > 0}
        <section class="panel">
          <h2>In this collection</h2>
          <p class="hint">
            Removing a deck only unlinks it. Its own page, link and listing are untouched.
          </p>
          <ul class="rows">
            {#each removable as row (row.set_id)}
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
      {#if joining !== 'settled'}
        <section class="panel joining">
          <h2>Add your own deck</h2>

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
            <ul class="rows">
              {#each offerable as row (row.id)}
                <li>
                  <span class="row-name">{row.name || 'Untitled'}</span>
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

      {#if organizer && offerable.length > 0}
        <section class="panel">
          <h2>Add one of your own decks</h2>
          <p class="hint">
            Yours goes straight in — you own the deck and you organize the collection, so
            there is nobody else to ask.
          </p>
          <ul class="rows">
            {#each offerable as row (row.id)}
              <li>
                <span class="row-name">{row.name || 'Untitled'}</span>
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

      <p class="count">
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

      {#if myAccepted.length > 0}
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
        </section>
      {/if}

      {#if tiles.length === 0}
        <!--
          Not an error. A collection with no accepted decks is the ordinary
          state of a project on the day it is created, and the page has to
          read as "not started yet" rather than "broken".
        -->
        <p class="message">
          No decks yet. Whoever is organizing this can invite them, or open it for submissions.
        </p>
      {:else}
        <ul class="grid">
          {#each tiles as tile (tile.set_id)}
            <li>
              <!--
                Opens the member's own shared page rather than anything
                collection-shaped: the deck belongs to its author, and its
                page is where they publish, export and are credited. A
                collection links to its members; it does not contain them.
              -->
              <button type="button" class="tile" onclick={() => navigation.openShared(tile.slug)}>
                <span
                  class="cover"
                  style:--trim-scale={TRIM_SCALE_WIDE}
                  style:background={tint(tile.set_id)}
                >
                  {#if tileImage(tile)}
                    <img
                      src={tileImage(tile)}
                      class:trimmed={tile.cover_bleeds}
                      alt=""
                      loading="lazy"
                    />
                  {:else}
                    <span class="initials">{initials(tile.name)}</span>
                  {/if}
                </span>

                <span class="card-body">
                  <span class="name">{tile.name || 'Untitled'}</span>
                  {#if tile.subtitle}<span class="subtitle-line">{tile.subtitle}</span>{/if}

                  <!--
                    The author line is the whole point of a collection page:
                    every tile is somebody else's, and saying whose is what
                    makes this a project rather than one person's box.
                  -->
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
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </main>
</div>

<style>
  /* Owns its own scrolling — see the note at the top of this file. */
  .screen {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow-y: auto;
    background: var(--surface-canvas);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-6);
    border-bottom: 1px solid var(--border-subtle);
    background: var(--surface-base);
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .head-left,
  .head-right {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .link {
    border: 0;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    cursor: pointer;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
  }
  .link:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .link:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
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

  .name {
    color: var(--text-primary);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
</style>
