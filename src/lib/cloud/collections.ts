/**
 * Collections, over the wire.
 *
 * A collection holds no document — it points at published rows that other
 * people own (see `COLLECTIONS.md`), so unlike `cloud/sets.ts` there is
 * nothing here that uploads artwork, lifts data URLs into Storage or embeds
 * them again on the way back. Every function in this file moves small rows,
 * and the whole of the trust lives in `supabase/migrations/0015_collections.sql`
 * rather than in anything a client could get wrong.
 *
 * **Every public read is `anonymous: true`**, and that is not an
 * optimisation. `cloud/sets.ts` records what it cost to learn: RLS answers a
 * public read identically whether or not a token is attached, but PostgREST
 * refuses an *expired* one outright — so a signed-in visitor whose session
 * went stale overnight saw an empty gallery while every stranger saw it fine,
 * and the screen said "JWT expired". A collection link is precisely the kind
 * that gets opened weeks after it was pasted into a Discord, by someone who
 * signed in once and forgot, so anything reading a collection by its slug is
 * on the same footing.
 */
import { decodeDataUrl } from './assets';
import { auth } from './auth.svelte';
import { CloudError, request } from './http';
import { assetPrefix, uploadAsset } from './sets';
import { hashHex } from '$lib/core/hash';
import { readArtworkFile } from '$lib/core/image-import';

export type CollectionVisibility = 'private' | 'unlisted' | 'public';

/**
 * Where a deck has got to in joining.
 *
 * Two pending states rather than one, because which side is waiting is the
 * whole of what the other side has to be shown: `invited` waits on the deck's
 * owner, `submitted` waits on an organizer. Collapsing them would mean
 * deriving that from who inserted the row.
 */
export type MembershipStatus = 'invited' | 'submitted' | 'accepted' | 'declined' | 'removed';

export interface Collection {
  id: string;
  created_by: string | null;
  slug: string;
  name: string;
  subtitle: string;
  blurb: string;
  banner_url: string;
  visibility: CollectionVisibility;
  hidden: boolean;
  open_submissions: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * One accepted deck, as the collection page draws it.
 *
 * Comes back from `collection_members_by_slug` rather than from a table read,
 * and that is the point: the function is `security definer`, so it can return
 * an **unlisted** member deck's tile, which no ordinary policy would allow.
 * That is safe only because a deck is in a collection by its own owner's
 * acceptance — which is why the accept control has to say so in plain words.
 *
 * Shaped to match what a gallery tile already draws, so `GalleryScreen`'s own
 * tile can render one of these without a second shape to learn.
 */
export interface CollectionTile {
  set_id: string;
  owner_id: string;
  slug: string;
  name: string;
  subtitle: string;
  thumbnail_url: string;
  cover_url: string;
  cover_bleeds: boolean;
  card_count: number;
  character_count: number;
  hero_count: number;
  kind: string | null;
  scope: string;
  revision: number;
  author_name: string;
  author_avatar: string;
  sort_order: number;
  ready: boolean;
}

/**
 * A membership row as the two parties to it see it — an organizer reviewing
 * what is waiting, or an author looking at their own invitations.
 *
 * Distinct from `CollectionTile` on purpose: a tile is the *public* view of
 * an accepted deck, and this is the private one, carrying the undecided
 * statuses a visitor must never see. The `set` embed is what lets a pending
 * row be shown by name rather than by uuid.
 */
export interface CollectionMembership {
  collection_id: string;
  set_id: string;
  status: MembershipStatus;
  ready: boolean;
  sort_order: number;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
  set: {
    slug: string;
    name: string;
    subtitle: string;
    thumbnail_url: string;
    owner_id: string;
    author: { display_name: string; avatar_url: string } | null;
  } | null;
  collection: { slug: string; name: string; subtitle: string } | null;
}

export interface CollectionOrganizer {
  collection_id: string;
  user_id: string;
  created_at: string;
  profile: { display_name: string; avatar_url: string } | null;
}

const COLLECTION_COLUMNS =
  'id,created_by,slug,name,subtitle,blurb,banner_url,visibility,hidden,' +
  'open_submissions,created_at,updated_at';

/**
 * A membership row plus enough of both ends to name them.
 *
 * `set:sets(...)` and `collection:collections(...)` are PostgREST embeds along
 * the two foreign keys. Named by the *column* would be ambiguous here — both
 * point at one table each — so the table name is unambiguous, unlike
 * `sets!forked_from` in `cloud/sets.ts`, where naming the table resolved a
 * self-reference backwards.
 */
const MEMBERSHIP_COLUMNS =
  'collection_id,set_id,status,ready,sort_order,invited_by,created_at,updated_at,' +
  'set:sets(slug,name,subtitle,thumbnail_url,owner_id,author:profiles(display_name,avatar_url)),' +
  'collection:collections(slug,name,subtitle)';

/** Both halves of the composite key, as a PostgREST filter. */
function memberFilter(collectionId: string, setId: string): string {
  return (
    `collection_id=eq.${encodeURIComponent(collectionId)}` +
    `&set_id=eq.${encodeURIComponent(setId)}`
  );
}

// -- Reading, by link ----------------------------------------------------

/**
 * One collection by its share token, or `null`.
 *
 * Through the `security definer` function, never the table: the read policy
 * exposes *public* collections only, so an unlisted one — which is every
 * collection for the whole of its production phase — is reachable no other
 * way. `private` is excluded inside the function, so turning a collection
 * private really does revoke a link that was already shared.
 */
export async function fetchCollectionBySlug(slug: string): Promise<Collection | null> {
  const rows = await request<Collection[]>('/rest/v1/rpc/collection_by_slug', {
    method: 'POST',
    body: { share_slug: slug.trim() },
    anonymous: true
  });
  return rows[0] ?? null;
}

/** The accepted decks in a collection, in the order its organizers set. */
export async function fetchCollectionTiles(slug: string): Promise<CollectionTile[]> {
  return request<CollectionTile[]>('/rest/v1/rpc/collection_members_by_slug', {
    method: 'POST',
    body: { share_slug: slug.trim() },
    anonymous: true
  });
}

/**
 * Which collections a published set appears in, for the reverse link on its
 * own shared page — *part of Winter Extravaganza*.
 *
 * Swallows its own failure, the same way `fetchSetsContributedTo` does: a
 * shared set page must draw whether or not this answers, because the set is
 * what the visitor came for and the credit line is a bonus on top of it.
 */
export async function collectionsForSet(
  setId: string
): Promise<{ slug: string; name: string }[]> {
  try {
    return await request<{ slug: string; name: string }[]>(
      '/rest/v1/rpc/collections_for_set',
      { method: 'POST', body: { target: setId }, anonymous: true }
    );
  } catch {
    return [];
  }
}

// -- Creating and editing ------------------------------------------------

export interface CollectionFields {
  name?: string;
  subtitle?: string;
  blurb?: string;
  banner_url?: string;
  visibility?: CollectionVisibility;
  open_submissions?: boolean;
}

/**
 * Make one. The creator becomes its first organizer.
 *
 * That second row is written by a **trigger**, not here — see
 * `seed_collection_organizer`. As a client-side pair it would be one failed
 * request away from a collection nobody can administer, and since only an
 * organizer may insert into `collection_organizers`, that state is
 * unrecoverable without a service role.
 *
 * `created_by` *is* sent, and that is deliberate rather than lax: the policy
 * checks it against `auth.uid()`, so naming anybody else is refused outright.
 * Withholding it instead — the shape `set_contributions` uses — meant the
 * check saw NULL and refused every insert. `slug` is still never sent; the
 * database mints it unguessably.
 */
export async function createCollection(fields: CollectionFields = {}): Promise<Collection> {
  await auth.ensureFresh();
  const rows = await request<Collection[]>(`/rest/v1/collections?select=${COLLECTION_COLUMNS}`, {
    method: 'POST',
    body: {
      /* Sent, not defaulted. `collections_insert` checks it against
         `auth.uid()`, so a client can only ever name itself — the check is
         the enforcement, and a withheld column simply arrived NULL when that
         check ran. Same arrangement `publishSet` uses for `sets.owner_id`. */
      created_by: auth.user?.id ?? null,
      name: fields.name?.trim() || 'Untitled collection',
      subtitle: fields.subtitle?.trim() ?? '',
      blurb: fields.blurb?.trim() ?? '',
      banner_url: fields.banner_url ?? '',
      visibility: fields.visibility ?? 'unlisted',
      open_submissions: fields.open_submissions ?? false
    },
    headers: { Prefer: 'return=representation' }
  });

  const row = rows[0];
  if (!row) throw new Error('The collection was created but did not come back.');
  return row;
}

/** Edit the parts an organizer chooses. Silently a no-op for anyone else. */
export async function updateCollection(id: string, fields: CollectionFields): Promise<void> {
  await auth.ensureFresh();
  const body: Record<string, unknown> = {};
  if (fields.name !== undefined) body['name'] = fields.name.trim();
  if (fields.subtitle !== undefined) body['subtitle'] = fields.subtitle.trim();
  if (fields.blurb !== undefined) body['blurb'] = fields.blurb.trim();
  if (fields.banner_url !== undefined) body['banner_url'] = fields.banner_url;
  if (fields.visibility !== undefined) body['visibility'] = fields.visibility;
  if (fields.open_submissions !== undefined) body['open_submissions'] = fields.open_submissions;
  if (Object.keys(body).length === 0) return;

  await request(`/rest/v1/collections?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
    headers: { Prefer: 'return=minimal' }
  });
}

/**
 * Delete a collection outright. **Only an empty one.**
 *
 * Its organizer rows cascade away; no set is touched, by construction —
 * nothing in the schema cascades upward into `sets`. This is the one
 * destructive call in the file, and it destroys only the curation.
 *
 * The database refuses this while any membership is `accepted`, `invited` or
 * `submitted`, so a full collection cannot be wound up by one organizer
 * without the others noticing. Callers should use `liveMemberCount` to say so
 * *before* offering the button rather than letting the attempt fail.
 */
export async function deleteCollection(id: string): Promise<void> {
  await auth.ensureFresh();
  await request(`/rest/v1/collections?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * How many decks are in or waiting on a collection.
 *
 * Counted rather than derived from the tiles, because tiles are the accepted
 * members only and an undecided invitation blocks deletion just as an
 * accepted deck does — a control that read the grid would offer Delete on a
 * collection the database is about to refuse.
 */
export function liveMemberCount(rows: readonly CollectionMembership[]): number {
  return rows.filter(
    (row) => row.status === 'accepted' || row.status === 'invited' || row.status === 'submitted'
  ).length;
}

/** A collection on somebody's own shelf, with how they are part of it. */
export interface MyCollection {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  banner_url: string;
  visibility: CollectionVisibility;
  open_submissions: boolean;
  /** Organizer, as against being here because a deck of yours is. */
  is_organizer: boolean;
  /** Accepted decks, so a shelf tile can say how big the box is. */
  deck_count: number;
  updated_at: string;
}

/**
 * Every collection this person is part of — organizing, or with a deck in.
 *
 * Through `my_collections()`, a `security definer` function, rather than a
 * filtered table read. "Mine" is not a column here: it is *organizer of*, or
 * *owner of a deck that is in it*, which PostgREST cannot express as a
 * filter. Leaving it to RLS instead — an unfiltered select — would return
 * every **public** collection alongside the caller's own, which is precisely
 * the bug `listMyPublishedSets` had.
 *
 * This is the only way back to a collection once its link is out of somebody's
 * clipboard, so it is also what stops an author making a second one because
 * they cannot find the first.
 */
export async function listMyCollections(): Promise<MyCollection[]> {
  await auth.ensureFresh();
  if (!auth.user) return [];
  return request<MyCollection[]>('/rest/v1/rpc/my_collections', { method: 'POST', body: {} });
}

// -- Membership ----------------------------------------------------------

/**
 * Open a membership, whether or not one was opened before.
 *
 * `(collection_id, set_id)` is the primary key, and a decision leaves the row
 * behind rather than deleting it — `removed` and `declined` are recorded so a
 * declined offer is not re-presented the instant it is turned down. A plain
 * insert therefore collides the second time anybody is involved, so **a deck
 * that left could never rejoin and a declined invitation could never be
 * re-sent**, which is the ordinary way a project changes its mind.
 *
 * Insert first, then PATCH the existing row on a 409 — rather than
 * PostgREST's `resolution=merge-duplicates`, which was tried and refused with
 * "permission denied for table collection_members". An upsert compiles to
 * `on conflict do update set` across *every* column it was given, so it
 * demands UPDATE on `collection_id` and `set_id`; those are the key, they are
 * deliberately outside the update grant, and widening the grant to buy one
 * round trip would be trading the guarantee for the convenience.
 *
 * Which statuses each side may write is still RLS's decision either way — the
 * two update policies pin each party to its own — so this only ever changes
 * whether a row can be re-opened, never by whom.
 */
async function join(
  collectionId: string,
  setId: string,
  status: MembershipStatus,
  extra: Record<string, unknown> = {}
): Promise<void> {
  try {
    await request('/rest/v1/collection_members', {
      method: 'POST',
      body: { collection_id: collectionId, set_id: setId, status, ...extra },
      headers: { Prefer: 'return=minimal' }
    });
  } catch (error) {
    if (!(error instanceof CloudError) || error.status !== 409) throw error;
    /* Status only. `extra` carries `invited_by`, which is insert-only by
       grant — sending it here is refused outright ("permission denied for
       table collection_members"), and it should not be rewritten anyway:
       it records who opened the membership, not who last reopened it. */
    await request(`/rest/v1/collection_members?${memberFilter(collectionId, setId)}`, {
      method: 'PATCH',
      body: { status },
      headers: { Prefer: 'return=minimal' }
    });
  }
}

/**
 * An organizer asks a deck to join. The deck's owner decides.
 *
 * `status` is pinned to `invited` by `members_invite`'s own `with check`, so
 * an organizer cannot insert a row that is already accepted on somebody's
 * behalf — the invitation and the acceptance are always two separate acts by
 * two different people.
 */
export async function inviteDeck(collectionId: string, setId: string): Promise<void> {
  await auth.ensureFresh();
  await join(collectionId, setId, 'invited', { invited_by: auth.user?.id ?? null });
}

/** An author offers their own deck. An organizer decides. */
export async function submitDeck(collectionId: string, setId: string): Promise<void> {
  await auth.ensureFresh();
  await join(collectionId, setId, 'submitted');
}

/**
 * An organizer puts one of their own decks straight in.
 *
 * No invitation and no acceptance, because both parties to that exchange
 * would be the same person — `members_self_add` allows `accepted` only when
 * the caller owns the deck *and* organizes the collection. Anything else
 * still goes the long way round.
 */
export async function addOwnDeckDirectly(collectionId: string, setId: string): Promise<void> {
  await auth.ensureFresh();
  await join(collectionId, setId, 'accepted');
}

/**
 * The deck owner's answer to an invitation.
 *
 * Accepting is what makes the deck reachable through the collection's link —
 * including while the deck itself is unlisted, which is the whole of the
 * consent boundary. The control that calls this has to say so.
 */
export async function respondToInvitation(
  collectionId: string,
  setId: string,
  decision: 'accepted' | 'declined'
): Promise<void> {
  await auth.ensureFresh();
  await request(`/rest/v1/collection_members?${memberFilter(collectionId, setId)}`, {
    method: 'PATCH',
    body: { status: decision },
    headers: { Prefer: 'return=minimal' }
  });
}

/** An organizer's answer to a submission. Same shape, other side. */
export async function resolveSubmission(
  collectionId: string,
  setId: string,
  decision: 'accepted' | 'declined'
): Promise<void> {
  await auth.ensureFresh();
  await request(`/rest/v1/collection_members?${memberFilter(collectionId, setId)}`, {
    method: 'PATCH',
    body: { status: decision },
    headers: { Prefer: 'return=minimal' }
  });
}

/**
 * Unlink a deck. **Not a delete of anything the author owns.**
 *
 * `removed` rather than a row delete, so the collection remembers that this
 * deck was once in it and an organizer is not offered the same submission
 * again the moment it is declined. Either party may do it: an author leaves,
 * an organizer unlinks, and neither touches the set itself.
 *
 * The database clears `ready` on its way out (`guard_collection_member_fields`),
 * so re-joining later cannot re-arm the publish gate with an assurance nobody
 * gave a second time.
 */
export async function removeMember(collectionId: string, setId: string): Promise<void> {
  await auth.ensureFresh();
  await request(`/rest/v1/collection_members?${memberFilter(collectionId, setId)}`, {
    method: 'PATCH',
    body: { status: 'removed' },
    headers: { Prefer: 'return=minimal' }
  });
}

/**
 * The deck's own author says it is finished.
 *
 * **Only they can.** A `before update` trigger enforces it rather than a
 * policy, because a `with check` sees only the new row and cannot notice that
 * an organizer's otherwise-legitimate update also flipped somebody's `ready`
 * — and `ready` is what the publish gate reads, so an organizer who could set
 * it could debut a half-finished deck over its author's head.
 */
export async function setMemberReady(
  collectionId: string,
  setId: string,
  ready: boolean
): Promise<void> {
  await auth.ensureFresh();
  await request(`/rest/v1/collection_members?${memberFilter(collectionId, setId)}`, {
    method: 'PATCH',
    body: { ready },
    headers: { Prefer: 'return=minimal' }
  });
}

/** Where a deck sits in the printed order. Organizers only, by the same trigger. */
export async function reorderMember(
  collectionId: string,
  setId: string,
  sortOrder: number
): Promise<void> {
  await auth.ensureFresh();
  await request(`/rest/v1/collection_members?${memberFilter(collectionId, setId)}`, {
    method: 'PATCH',
    body: { sort_order: Math.round(sortOrder) },
    headers: { Prefer: 'return=minimal' }
  });
}

/**
 * Every membership row of one collection, undecided ones included.
 *
 * The organizer's view, and deliberately not what the page draws for a
 * visitor — that comes from `fetchCollectionTiles`, which returns accepted
 * rows only. Reading this as a stranger returns nothing; the policy decides,
 * so asking wrongly cannot widen it.
 */
export async function listMemberships(collectionId: string): Promise<CollectionMembership[]> {
  await auth.ensureFresh();
  return request<CollectionMembership[]>(
    `/rest/v1/collection_members?select=${MEMBERSHIP_COLUMNS}` +
      `&collection_id=eq.${encodeURIComponent(collectionId)}` +
      '&order=status.asc,sort_order.asc'
  );
}

/**
 * Everything waiting on *this person* to decide, across every collection.
 *
 * Both directions in one call, because Home's attention strip asks one
 * question — "is anything waiting on me?" — and already answers it for
 * contributions. An `invited` row waits on the deck's owner; a `submitted`
 * row waits on an organizer; `members_read` means each side only ever sees
 * the rows it is a party to, so a single unfiltered fetch cannot leak the
 * other side's pending work.
 */
export async function listPendingMemberships(): Promise<CollectionMembership[]> {
  await auth.ensureFresh();
  if (!auth.user) return [];
  return request<CollectionMembership[]>(
    `/rest/v1/collection_members?select=${MEMBERSHIP_COLUMNS}` +
      '&status=in.(invited,submitted)&order=created_at.desc'
  );
}

// -- Organizers ----------------------------------------------------------

export async function listOrganizers(collectionId: string): Promise<CollectionOrganizer[]> {
  await auth.ensureFresh();
  return request<CollectionOrganizer[]>(
    '/rest/v1/collection_organizers?select=collection_id,user_id,created_at,' +
      'profile:profiles(display_name,avatar_url)' +
      `&collection_id=eq.${encodeURIComponent(collectionId)}&order=created_at.asc`
  );
}

/** Hand curation to somebody else. Only an existing organizer may. */
export async function promoteOrganizer(collectionId: string, userId: string): Promise<void> {
  await auth.ensureFresh();
  await request('/rest/v1/collection_organizers', {
    method: 'POST',
    body: { collection_id: collectionId, user_id: userId },
    headers: { Prefer: 'return=minimal' }
  });
}

/**
 * Stand down, or remove another organizer.
 *
 * The database refuses the *last* one — an empty organizer table would be
 * unrecoverable through PostgREST, since only an organizer may promote one.
 * So transferring a collection is promote-then-leave, and needs no mechanism
 * of its own.
 */
export async function removeOrganizer(collectionId: string, userId: string): Promise<void> {
  await auth.ensureFresh();
  await request(
    `/rest/v1/collection_organizers?collection_id=eq.${encodeURIComponent(collectionId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}`,
    { method: 'DELETE' }
  );
}

/**
 * Am I one of this collection's organizers?
 *
 * Asked as a filtered read of one row rather than by listing them all,
 * because the answer gates a whole edit surface and every visitor's page load
 * would otherwise pay for the full list. Signed out, the answer is no without
 * a request at all — `organizers_read` would return nothing anyway, and a
 * public page should not fire an authenticated call to be told so.
 */
export async function amOrganizer(collectionId: string): Promise<boolean> {
  if (!auth.signedIn) return false;
  await auth.ensureFresh();
  const me = auth.user;
  if (!me) return false;
  const rows = await request<{ user_id: string }[]>(
    `/rest/v1/collection_organizers?select=user_id` +
      `&collection_id=eq.${encodeURIComponent(collectionId)}` +
      `&user_id=eq.${encodeURIComponent(me.id)}&limit=1`
  );
  return rows.length > 0;
}

/**
 * Put a banner picture in Storage and answer with its URL.
 *
 * Through `readArtworkFile` first, exactly as every "choose an image" control
 * in the app does: a banner an author points at a 12MP phone photo would
 * otherwise be uploaded at 12MP and downloaded again by everyone who opens
 * the link, to be drawn about 200px tall.
 *
 * Reuses the set-assets bucket and `uploadAsset`'s own `<uid>/<id>/<hash>`
 * path. The storage policy only ever checks the *first* segment against
 * `auth.uid()`, so a collection id in the second is as valid as a set id —
 * and the content-hash name means re-uploading the same picture writes the
 * same object rather than accumulating copies.
 */
export async function uploadCollectionBanner(
  collectionId: string,
  file: File
): Promise<string> {
  await auth.ensureFresh();
  const me = auth.user;
  if (!me) throw new Error('Sign in to change the banner.');

  const dataUrl = await readArtworkFile(file);
  const { contentType, bytes } = decodeDataUrl(dataUrl);
  const hash = await hashHex(bytes);
  return uploadAsset({ dataUrl, contentType, bytes, hash }, me.id, collectionId);
}

/** Whether a URL is one of ours, so a banner can be cleared without guessing. */
export function isOwnAsset(url: string): boolean {
  const prefix = assetPrefix();
  return prefix.length > 0 && url.startsWith(prefix);
}

// -- The link ------------------------------------------------------------

/**
 * The link to hand somebody.
 *
 * A real path, not the in-app hash form, for exactly the reason `shareUrl`
 * documents: a fragment never leaves the browser, so a link unfurler reading
 * it server-side has no way to know which collection is being asked for. This
 * is the second such path in the app and wants the same specific
 * justification — see `middleware.ts`.
 */
export function collectionUrl(slug: string): string {
  return `${window.location.origin}${window.location.pathname}collection/${slug}`;
}

/**
 * Whether a collection may go public yet, and who is holding it up.
 *
 * The gate itself is a UI decision rather than a database one, deliberately:
 * an organizer may publish anyway, and a rule the server enforced could not
 * be overridden without a second, weaker rule beside it. What the server does
 * guarantee is the part that matters — that `ready` can only ever have been
 * set by the deck's own author.
 */
export function readinessOf(tiles: readonly CollectionTile[]): {
  ready: number;
  total: number;
  waitingOn: string[];
} {
  const waitingOn = tiles.filter((tile) => !tile.ready).map((tile) => tile.name);
  return { ready: tiles.length - waitingOn.length, total: tiles.length, waitingOn };
}
