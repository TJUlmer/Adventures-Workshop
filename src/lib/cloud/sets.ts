/**
 * Publishing a set, and fetching one back.
 *
 * The contract, which every function here keeps: **the cloud is a publish
 * target, never the source of truth.** A published row is a copy of a document
 * that still lives in the author's browser. Nothing in the app reads from here
 * in order to work, and losing the network loses sharing rather than the set.
 *
 * That is what makes the artwork swap in `assets.ts` safe to do on the way out
 * and on the way back in: the local document keeps its data URLs throughout, so
 * offline editing, PNG export and the Tabletop Simulator bundle are all
 * untouched by whether a set has ever been published.
 */
import { parseSetFile, serializeSet } from '$lib/export/json';
import { charactersByRole, setStats } from '$lib/sets/queries';
import { computeScopedSet } from '$lib/sets/scope';
import type { PublishScope } from '$lib/sets/scope';
import type { AdventureSet, SetKind } from '$lib/sets/types';
import { SET_SCHEMA_VERSION } from '$lib/sets/types';
import {
  collectEmbeddedAssets,
  extensionFor,
  fetchAndEmbedAssets,
  substituteStrings,
  totalBytes
} from './assets';
import type { EmbeddedAsset } from './assets';
import { auth } from './auth.svelte';
import { shortHash } from '$lib/core/hash';
import { renderCharacterCards } from './character-cards';
import { renderThumbnail } from './thumbnail';
import { ASSET_BUCKET, cloudConfig } from './config';
import { CloudError, endpoint, headers, request } from './http';

export type Visibility = 'private' | 'unlisted' | 'public';

/** A published set as the browse list and the author's shelf want it. */
export interface PublishedSet {
  id: string;
  owner_id: string;
  local_id: string;
  slug: string;
  name: string;
  subtitle: string;
  card_count: number;
  character_count: number;
  schema_version: number;
  revision: number;
  visibility: Visibility;
  created_at: string;
  updated_at: string;
  /** Small cover for a gallery tile. Empty when the set has no artwork. */
  thumbnail_url: string;
  /**
   * A full-size picture out of the document, derived on the row by the
   * database (`set_cover_image`, `0007_gallery_browse.sql`).
   *
   * Only ever read when `thumbnail_url` is empty, and it exists because that
   * was the common case rather than the rare one: `coverArtwork` used to look
   * for a picture only on the box or a character's portrait, and authors put
   * theirs on cards, so most sets published with no cover at all. Both ends
   * are fixed — but a fix in `renderThumbnail` only reaches sets published
   * *after* it, and this reaches the ones already up there without asking
   * their authors to re-publish. Unscaled, so it is a fallback and not a
   * replacement; a re-publish supersedes it with a real 512px thumbnail.
   */
  cover_url: string;
  /**
   * Whether `cover_url` is a full print plate, bleed and all.
   *
   * True only when the cover fell through to a hero's finished replacement
   * deck back, which is supplied on the action card's own bleed canvas — a
   * villain's or minion's back is drawn at trim size and has none. A reader
   * wants the card as it is cut, so a picture that says this has to be
   * trimmed before it is shown.
   */
  cover_bleeds: boolean;
  /** First time it went public. Null while it has never been listed. */
  published_at: string | null;
  view_count: number;
  /** The author's own line about what changed in this revision. */
  change_note: string;
  /**
   * The published set this one was copied from, if any. Null both for an
   * original and for a fork whose original has since been deleted — the
   * reference is `on delete set null`, because an original going away must
   * orphan its copies rather than take them with it.
   */
  forked_from: string | null;
  /** The revision copied. Stays put as the original moves on. */
  forked_from_revision: number | null;
  /**
   * Which slice of `local_id` this row is — the whole set, one hero, or the
   * villain side. See `sets/scope.ts`. `character_id` names which hero for a
   * `'hero'` row; empty for the other two, never `null` (a unique constraint
   * treats every `null` as distinct, so a non-null sentinel is what keeps two
   * `'full'` publishes of the same set from ever coexisting — see
   * `supabase/migrations/0006_scoped_publishing.sql`).
   */
  scope: 'full' | 'hero' | 'villain';
  character_id: string;
  /**
   * Adventure or heroes set, taken from the document at publish time — see
   * `supabase/migrations/0009_set_kind.sql`. `null` on a row published
   * before that column existed, and left that way rather than guessed at;
   * it simply never matches a `kind` filter until its author republishes.
   */
  kind: SetKind | null;
  /**
   * Heroes on the roster — its own column because `character_count` cannot
   * stand in: that counts the whole roster, villain and minions included.
   * Home splits a heroes set by this (one hero is "Single hero", more than
   * one is a "Heroes set"). See `0010_hero_count_and_kind_backfill.sql`.
   */
  hero_count: number;
}

/** Just enough of a published set to say whether it has moved on. */
export interface SetSummary {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  revision: number;
  visibility: Visibility;
  updated_at: string;
  published_at: string | null;
  change_note: string;
  hidden: boolean;
}

/**
 * A public set with its author attached.
 *
 * One query rather than a set fetch and then a profile fetch per tile, which is
 * what the foreign key from `sets.owner_id` to `profiles` exists for. `author`
 * is nullable because PostgREST returns null for an embed it cannot resolve,
 * and a gallery tile is still worth drawing without a name on it.
 */
export interface GallerySet extends PublishedSet {
  author: { display_name: string; avatar_url: string } | null;
  /**
   * The set this one was copied from, for the credit line on a tile.
   *
   * Null for an original, and also for a fork whose original has been deleted
   * or made private — a credit that cannot be resolved is simply not shown,
   * rather than the tile claiming lineage it cannot name.
   */
  origin: { slug: string; name: string; author: { display_name: string } | null } | null;
}

/** The same row with the document attached. Only ever fetched one at a time. */
export interface PublishedSetWithDocument extends PublishedSet {
  document: unknown;
}

/** Columns for a listing. Never `document` — that is the whole point of them. */
const SUMMARY_COLUMNS =
  'id,owner_id,local_id,slug,name,subtitle,card_count,character_count,schema_version,' +
  'revision,visibility,created_at,updated_at,thumbnail_url,cover_url,cover_bleeds,published_at,' +
  'view_count,change_note,forked_from,forked_from_revision,scope,character_id,kind,hero_count';

/**
 * The same, plus the author and — for a fork — the set it came from.
 *
 * The origin embed is spelled with the **column** name, `forked_from(…)`, and
 * that is not interchangeable with naming the table. `sets` references itself,
 * so `sets!forked_from(…)` is a legal request that quietly resolves the
 * relationship *backwards*: it returns an array of the sets forked **from**
 * this one, so an original was credited to its own copy and a copy showed
 * nothing. Naming the column picks the many-to-one direction and returns a
 * single row, or `null` for a set that is nobody's copy.
 *
 * Only the credit is fetched — slug, name and the original author's display
 * name. Pulling the origin's own row wholesale would put a second row's worth
 * of columns behind every tile, which is what `SUMMARY_COLUMNS` exists to
 * prevent.
 */
const GALLERY_COLUMNS =
  `${SUMMARY_COLUMNS},author:profiles(display_name,avatar_url),` +
  'origin:forked_from(slug,name,author:profiles(display_name))';

/** Public URL prefix for this project's asset bucket. */
export function assetPrefix(): string {
  const config = cloudConfig();
  if (!config) return '';
  return `${config.url}/storage/v1/object/public/${ASSET_BUCKET}/`;
}

// -- Publishing ---------------------------------------------------------

export interface PublishProgress {
  /** What is happening, for a status line. */
  stage: 'assets' | 'document';
  done: number;
  total: number;
}

export interface PublishOptions {
  visibility?: Visibility;
  /**
   * One line on what changed, shown beside the revision number.
   *
   * A version number alone tells a reader something moved but not whether it
   * matters to them; "rebalanced the villain's deck" does.
   */
  changeNote?: string;
  /** Publish the whole set (the default), one hero, or the villain side. */
  scope?: PublishScope;
  onProgress?: (progress: PublishProgress) => void;
}

/**
 * Upload one asset, and answer with its public URL.
 *
 * The path is `<user>/<set>/<hash>.<ext>`, and each segment earns itself: the
 * user id is what the storage policies check, the set id keeps a deleted set's
 * assets findable, and the content hash means republishing an unchanged set
 * re-uploads nothing it does not have to.
 */
export async function uploadAsset(
  asset: EmbeddedAsset,
  userId: string,
  setId: string
): Promise<string> {
  const path = `${userId}/${setId}/${asset.hash}.${extensionFor(asset.contentType)}`;
  const url = endpoint(`/storage/v1/object/${ASSET_BUCKET}/${path}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: headers({
      'Content-Type': asset.contentType,
      /*
       * Re-publishing writes the same hash to the same path. Without this the
       * second publish fails on a duplicate that is, by construction, byte for
       * byte what is already there.
       */
      'x-upsert': 'true'
    }),
    // A copy, because `bytes` is a view onto a buffer we do not own.
    body: new Blob([new Uint8Array(asset.bytes)], { type: asset.contentType })
  });

  if (!response.ok && response.status !== 409) {
    throw new CloudError(`Could not upload artwork (${response.status}).`, response.status);
  }

  return `${assetPrefix()}${path}`;
}

/**
 * Upload an already-encoded blob, named after its own bytes.
 *
 * Same path shape and the same content-hash naming as `uploadAsset` — a
 * thumbnail that has not changed re-uploads to the same key, and a changed one
 * gets a new URL rather than hiding behind a cached old bitmap.
 */
async function uploadBlob(
  blob: Blob,
  userId: string,
  setId: string,
  stem: string
): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const extension = blob.type === 'image/webp' ? 'webp' : 'png';
  const path = `${userId}/${setId}/${stem}-${await shortHash(bytes)}.${extension}`;

  const response = await fetch(endpoint(`/storage/v1/object/${ASSET_BUCKET}/${path}`), {
    method: 'POST',
    headers: headers({ 'Content-Type': blob.type, 'x-upsert': 'true' }),
    body: blob
  });

  if (!response.ok && response.status !== 409) {
    throw new CloudError(`Could not upload the thumbnail (${response.status}).`, response.status);
  }

  return `${assetPrefix()}${path}`;
}

/**
 * Publish, or re-publish, a set.
 *
 * Assets go up first and the row last, deliberately. The row is what makes a
 * set visible, so writing it only once every picture it names is already in
 * place means there is no moment at which someone could fetch a set and find
 * holes in it. The reverse order would be briefly, silently broken.
 */
export async function publishSet(
  set: AdventureSet,
  options: PublishOptions = {}
): Promise<PublishedSet> {
  await auth.ensureFresh();
  const user = auth.user;
  if (!user) throw new CloudError('Sign in to publish a set.', 401);

  const scope = options.scope ?? { kind: 'full' };

  /*
   * Computed once, and read from everywhere below instead of `set` — this is
   * what actually gets published. For `{ kind: 'full' }` it is `set` itself,
   * repaired through the same `normalizeSet` pass as the other two scopes, so
   * every call below can read `scoped` unconditionally rather than branching
   * on whether scoping is happening. `set.id` keeps being used for asset
   * paths and `local_id` below, deliberately — see those call sites.
   */
  const scoped = computeScopedSet(set, scope);

  /*
   * Serialise and re-parse rather than sending the live object.
   *
   * `serializeSet` is the one path that produces a document this app will
   * accept back — it is what the file exporter writes and what `parseSetFile`
   * validates. Publishing anything else would mean a second serialisation to
   * keep correct, and the two would drift.
   */
  const envelope: unknown = JSON.parse(serializeSet(scoped));

  const assets = await collectEmbeddedAssets(envelope);
  options.onProgress?.({ stage: 'assets', done: 0, total: assets.length });

  /*
   * Uploaded under the *master's* id, not the scoped document's — it has none
   * of its own, by design (`sets/scope.ts`). This is also what keeps asset
   * dedup working across scopes: a hero's artwork uploaded once when the
   * whole set was published is reused, not re-uploaded, when that hero is
   * later published on its own, since the path is the same content hash
   * under the same master id either way.
   */
  const mapping = new Map<string, string>();
  for (const [index, asset] of assets.entries()) {
    mapping.set(asset.dataUrl, await uploadAsset(asset, user.id, set.id));
    options.onProgress?.({ stage: 'assets', done: index + 1, total: assets.length });
  }

  const document = substituteStrings(envelope, mapping);
  options.onProgress?.({ stage: 'document', done: 0, total: 1 });

  /*
   * The tile picture, and a failure here must not fail the publish: a set with
   * no cover is a plainer row in the gallery, not a set that could not be
   * shared. An empty string leaves the column at its default and the gallery
   * draws its own placeholder.
   */
  let thumbnailUrl = '';
  try {
    const thumbnail = await renderThumbnail(scoped);
    if (thumbnail) thumbnailUrl = await uploadBlob(thumbnail, user.id, set.id, 'thumb');
  } catch {
    thumbnailUrl = '';
  }

  /*
   * One picture of each hero's character card, for the gallery to show on
   * hover — see `character-cards.ts` for why this has to be rendered here
   * rather than looked up later.
   *
   * Best-effort for the same reason the thumbnail is, and it matters more
   * here: this is the slowest step in a publish by some way (a card apiece,
   * mounted and photographed), so it is exactly the step most likely to be
   * interrupted. A hover that does not happen is not a set that failed to
   * share.
   *
   * Keyed by character id, and sent as its own column rather than folded into
   * `document`: the document is the author's set, and a picture the gallery
   * asked for is not part of it. It would also break every fingerprint in
   * `sets/fingerprint.ts` if it were, since a re-render is a new URL and each
   * character would read as edited on every publish.
   */
  const characterCards: Record<string, string> = {};
  try {
    for (const [characterId, blob] of await renderCharacterCards(scoped)) {
      characterCards[characterId] = await uploadBlob(blob, user.id, set.id, `card-${characterId}`);
    }
  } catch {
    // Leave whatever landed before the failure; a partial set of previews is
    // better than none, and the column is read per character anyway.
  }

  const stats = setStats(scoped);
  const row = {
    owner_id: user.id,
    local_id: set.id,
    name: scoped.name,
    subtitle: scoped.subtitle,
    card_count: stats.printCount,
    character_count: stats.characterCount,
    schema_version: SET_SCHEMA_VERSION,
    document,
    thumbnail_url: thumbnailUrl,
    character_cards: characterCards,
    /* Trimmed and capped here as well as in the field: a note is printed under
       someone else's set, so its length is not the author's alone to decide. */
    change_note: (options.changeNote ?? '').trim().slice(0, 200),
    /*
     * `revision` is deliberately absent. A database trigger owns it, so it
     * cannot be forgotten, raced, or set to a flattering number by a client.
     */
    visibility: options.visibility ?? 'unlisted',
    /*
     * Lineage, taken from the document rather than from anything the publisher
     * chose here. `set.origin` is written once when the copy is taken and never
     * again, so re-publishing a fork cannot quietly re-parent it — and a set
     * with no origin sends nulls, which is what clears the columns if one is
     * ever removed by hand. Reads `scoped.origin`, which is always exactly
     * `set.origin` — `computeScopedSet` never touches it — so a hero sliced out
     * of a set that was itself forked from someone else's box still carries
     * that lineage.
     */
    forked_from: scoped.origin?.setId ?? null,
    forked_from_revision: scoped.origin?.revision ?? null,
    scope: scope.kind,
    character_id: scope.kind === 'hero' ? scope.characterId : '',
    /*
     * `scoped.kind`, not `set.kind` — `computeScopedSet` is what makes this
     * correct for a hero slice without a branch here: `heroSlice` forces
     * `kind: 'heroes'` on a standalone hero regardless of which kind of box
     * it came out of (`sets/scope.ts`), so a lone hero publish is already
     * categorised correctly by the time it reaches this row.
     */
    kind: scoped.kind,
    /* Off `scoped`, like `kind` — a hero slice holds exactly its own hero, so
       this is 1 there without a special case. Counted rather than taken from
       `stats.characterCount`, which includes the villain and every minion. */
    hero_count: charactersByRole(scoped, 'hero').length
  };

  /*
   * Upsert on `(owner_id, local_id, scope, character_id)`, which is what makes
   * re-publishing update the same slice someone already shared rather than
   * mint a second row with a new slug — and a link that had been handed out
   * would quietly stop being the current version. Widened from plain
   * `(owner_id, local_id)` in `0006_scoped_publishing.sql`, specifically so a
   * hero-scoped publish and the full-set publish of the same document can
   * coexist as two rows instead of colliding into one.
   *
   * `slug` is left out of the payload on purpose so the existing one survives.
   */
  const [published] = await request<PublishedSet[]>(
    '/rest/v1/sets?on_conflict=owner_id,local_id,scope,character_id',
    {
      method: 'POST',
      body: row,
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation'
      }
    }
  );

  if (!published) throw new CloudError('The server accepted the set but returned nothing.', 0);

  options.onProgress?.({ stage: 'document', done: 1, total: 1 });
  return published;
}

/**
 * How much a publish would upload, for showing before one starts.
 *
 * Takes the same `scope` `publishSet` would — a hero-scoped publish uploads
 * only that hero's own assets, and a size preview computed off the whole set
 * regardless of scope would overstate it every time.
 */
export async function publishSize(
  set: AdventureSet,
  scope: PublishScope = { kind: 'full' }
): Promise<{ assets: number; bytes: number }> {
  const assets = await collectEmbeddedAssets(JSON.parse(serializeSet(computeScopedSet(set, scope))));
  return { assets: assets.length, bytes: totalBytes(assets) };
}

// -- Reading ------------------------------------------------------------

/** The signed-in author's own published sets, newest first. */
export async function listMyPublishedSets(): Promise<PublishedSet[]> {
  await auth.ensureFresh();
  if (!auth.user) return [];
  return request<PublishedSet[]>(
    `/rest/v1/sets?select=${SUMMARY_COLUMNS}&order=updated_at.desc`
  );
}

export type GallerySort = 'newest' | 'popular' | 'name';

/** Which kind of listing a row is, as a filter. `all` writes no filter. */
export type ScopeFilter = 'all' | 'full' | 'hero' | 'villain';

export interface GalleryQuery {
  /** Free text, matched against name, subtitle and every character's name. */
  search?: string;
  sort?: GallerySort;
  /** Show only whole sets, only heroes, or only villain sides. */
  scope?: ScopeFilter;
  /** Show only adventures or only heroes sets — orthogonal to `scope`, see
      `PublishedSet.kind`. Omitted rather than `'all'`, since a caller that
      does not care about this axis should not have to write it out. */
  kind?: SetKind;
  /**
   * Split a heroes set by roster size — `'single'` is exactly one hero,
   * `'multi'` is more than one. Only meaningful alongside `kind: 'heroes'`,
   * and named rather than exposed as a raw number because those two are the
   * only cuts anything asks for (Home's "Single hero" and "Heroes set"
   * slots).
   */
  heroes?: 'single' | 'multi';
  limit?: number;
  /** Rows to skip, for paging. */
  offset?: number;
}

/**
 * Free text as a `tsquery`, or `''` for a search that asks nothing.
 *
 * Every term becomes a **prefix** (`lou:*`), which is the whole point: this
 * replaced an `ilike '*term*'` substring match, and the difference is exactly
 * the bug it was reported as. A substring matches the middle of a word, so
 * typing "d" returned "Oz A**d**venture" and typing "m" returned a hero whose
 * subtitle is the words "Fro**m** {the box}" — both correct substring
 * searches, neither one anything a person means. Matching word *beginnings*
 * makes "d" find things starting with D and nothing else.
 *
 * Split on anything that is not a letter or a digit, which keeps the tokens
 * safe as well as sensible: `to_tsquery` is a parser and throws on malformed
 * input — an unbalanced quote or a bare `&` would be a failed request rather
 * than an empty result — and a token of only letters and digits can never be
 * malformed. Unicode-aware (`\p{L}`), so a name like Māui survives as one
 * term rather than being cut in half.
 */
export function searchQuery(search: string): string {
  return search
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((term) => `${term.toLowerCase()}:*`)
    .join(' & ');
}

/**
 * A sort as PostgREST's `order`, shared by the set and character listings so
 * the two cannot disagree about what "newest" means.
 *
 * `published_at` rather than `updated_at`, or "newest" would really mean "most
 * recently edited" and a set could climb back to the top by having a typo
 * fixed. `nullslast` because an unlisted row has never been published and has
 * no date — it cannot reach either listing today, but a null sorting *first*
 * is the kind of thing that only shows up once something does.
 */
function galleryOrder(sort: GallerySort, nameColumn = 'name'): string {
  if (sort === 'popular') return 'view_count.desc,published_at.desc.nullslast';
  if (sort === 'name') return `${nameColumn}.asc`;
  return 'published_at.desc.nullslast';
}

/**
 * The public gallery.
 *
 * No token needed and no `visibility` filter written here — the RLS policy is
 * what decides, so this cannot accidentally widen what it returns. `hidden` is
 * likewise handled there: a moderated set is not something the client is
 * trusted to filter out.
 */
export async function listPublicSets(query: GalleryQuery = {}): Promise<GallerySet[]> {
  const {
    search = '',
    sort = 'newest',
    scope = 'all',
    kind,
    heroes,
    limit = 36,
    offset = 0
  } = query;

  const parts = [
    `select=${GALLERY_COLUMNS}`,
    `order=${galleryOrder(sort)}`,
    `limit=${limit}`,
    `offset=${offset}`
  ];

  /* Against `search_document`, which the database fills from name, subtitle
     *and every character's name* — so a hero inside a box finds the box. See
     `searchQuery` for why this is a prefix query and not a substring one. */
  const tsquery = searchQuery(search);
  if (tsquery) parts.push(`search_document=fts(simple).${encodeURIComponent(tsquery)}`);

  if (scope !== 'all') parts.push(`scope=eq.${scope}`);
  if (kind) parts.push(`kind=eq.${kind}`);
  if (heroes) parts.push(heroes === 'single' ? 'hero_count=eq.1' : 'hero_count=gt.1');

  /*
   * Deliberately anonymous, even for a signed-in author.
   *
   * The gallery shows public sets and nothing else, so a user token changes
   * none of what comes back — but a *stale* one changes all of it: PostgREST
   * refuses an expired JWT outright, so the shelf went empty for anyone whose
   * session had aged out while every visitor saw it fine. The one thing a
   * gallery must do is be there.
   */
  return request<GallerySet[]>(`/rest/v1/sets?${parts.join('&')}`, { anonymous: true });
}

// -- Browsing by character ----------------------------------------------

/**
 * One published character, and the listing they can be read in.
 *
 * From the `gallery_characters` view, which is where the deduplication lives:
 * a hero published both inside their box and on their own is one character
 * with two listings, and the view picks the more specific one. See
 * `0007_gallery_browse.sql`.
 */
export interface GalleryCharacter {
  character_id: string;
  name: string;
  role: string;
  /** Their deck back, or failing that a portrait or card art. May be empty. */
  image_url: string;
  /** Whether `image_url` is a full print plate. See `GallerySet.cover_bleeds`. */
  image_bleeds: boolean;
  /**
   * A picture of their character card, photographed at publish.
   *
   * Empty for anyone but a hero — nobody else has one — and empty for a hero
   * whose set was published before this existed, since it cannot be derived
   * from anything already stored. Re-publishing is what fills it.
   */
  card_url: string;
  /**
   * The published row this character was read out of.
   *
   * Not a unique key on its own — a set contributes one row per character —
   * but paired with `character_id` it is, which is what a keyed list needs.
   */
  set_id: string;
  /** The published row that opening this character actually opens. */
  slug: string;
  listing_name: string;
  listing_scope: 'full' | 'hero' | 'villain';
  thumbnail_url: string;
  cover_url: string;
  /** Whether `cover_url` bleeds. See `GallerySet.cover_bleeds`. */
  cover_bleeds: boolean;
  published_at: string | null;
  view_count: number;
  /**
   * The whole set this character belongs to, when it is public too.
   *
   * Equal to `slug`/`listing_name` for a character reached *through* their
   * box, which is the case a caller has to check for rather than the view
   * nulling it out — the view says what is true, and "the set this belongs
   * to is the set you are looking at" is true.
   */
  parent_slug: string | null;
  parent_name: string | null;
}

export interface CharacterQuery {
  search?: string;
  sort?: GallerySort;
  /** `''` for every role. Otherwise `hero`, `villain` or `minion`. */
  role?: string;
  limit?: number;
  offset?: number;
}

/**
 * Every published character, filterable by role.
 *
 * The listing a set-shaped gallery could not give: a hero published inside a
 * box is a row *of that box*, so "show me every hero" had no query behind it
 * until `set_characters` existed. Reading a view rather than the table, for
 * the deduplication described on `GalleryCharacter`.
 *
 * Searched on the character's own name only — this is a roster, and someone
 * typing here is naming a person. The set-level search is the one that also
 * looks at box names, and it is one toggle away.
 *
 * Anonymous, on the same footing as `listPublicSets` and for the same reason:
 * a stale token empties the page for its owner while every stranger sees it
 * fine.
 */
export async function listPublicCharacters(
  query: CharacterQuery = {}
): Promise<GalleryCharacter[]> {
  const { search = '', sort = 'newest', role = '', limit = 36, offset = 0 } = query;

  const parts = [
    'select=*',
    `order=${galleryOrder(sort)}`,
    `limit=${limit}`,
    `offset=${offset}`
  ];

  const term = search.trim();
  if (term) {
    /* `,` and `)` close a PostgREST filter list and `*` is its wildcard, so a
       search containing one would change the query's shape rather than be
       looked for. Stripped rather than escaped — there is no escape for them
       in this syntax. Substring here, unlike the set search: a roster is a
       short list of names and matching inside one is useful rather than
       baffling. */
    const safe = term.replace(/[,()*]/g, ' ').trim();
    if (safe) parts.push(`name=ilike.*${encodeURIComponent(safe)}*`);
  }

  if (role) parts.push(`role=eq.${encodeURIComponent(role)}`);

  return request<GalleryCharacter[]>(`/rest/v1/gallery_characters?${parts.join('&')}`, {
    anonymous: true
  });
}

/**
 * The whole set a hero- or villain-scoped publish was sliced out of.
 *
 * A scoped row keeps the *same* `local_id` as its master (`sets/scope.ts`), so
 * the box is simply the `full` row under the same owner and local id — no new
 * column, and nothing recorded at publish that could go stale.
 *
 * Returns `null` for a set whose box was never published, or was published
 * unlisted: this is a plain filtered select, so `sets_public_read` answers it,
 * and a link nobody can follow is worse than no link. Never throws for the
 * same reason `fetchAuthorName` does not — a navigation aid is not worth
 * failing a page over.
 */
export async function fetchParentSet(
  ownerId: string,
  localId: string
): Promise<{ slug: string; name: string } | null> {
  try {
    const rows = await request<{ slug: string; name: string }[]>(
      `/rest/v1/sets?select=slug,name&owner_id=eq.${encodeURIComponent(ownerId)}` +
        `&local_id=eq.${encodeURIComponent(localId)}&scope=eq.full&limit=1`,
      { anonymous: true }
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Count a view, best-effort.
 *
 * Through an RPC because a reader has no write anywhere near this table, and
 * loosening that so a counter could move would be the widest hole in the
 * schema. Never throws: a number failing to go up is not worth showing anyone.
 */
export async function recordSetView(slug: string): Promise<void> {
  try {
    await request('/rest/v1/rpc/record_set_view', {
      method: 'POST',
      body: { share_slug: slug },
      // Anonymous like the read it accompanies — a view is a view.
      anonymous: true
    });
  } catch {
    // Counting is not the point of the page it happens on.
  }
}

/** Report a set to whoever moderates the gallery. */
export async function reportSet(setId: string, reason: string): Promise<void> {
  await request('/rest/v1/set_reports', {
    method: 'POST',
    /* `reporter_id` is deliberately absent: the column defaults to `auth.uid()`
       and is not in the grant, so who filed it comes from the token and cannot
       be claimed by the request. */
    body: { set_id: setId, reason: reason.slice(0, 500) },
    headers: { Prefer: 'return=minimal' }
  });
}

/**
 * Fetch one set by its share token.
 *
 * Through the `set_by_slug` function rather than a filtered select, and that is
 * the security boundary rather than a convenience: the table's read policy
 * exposes *public* sets only, so an unlisted set is unreachable by query. The
 * function is `security definer` and returns at most one row, which is what
 * makes knowing the token the only way in.
 */
export async function fetchSetBySlug(slug: string): Promise<PublishedSetWithDocument | null> {
  const rows = await request<PublishedSetWithDocument[]>('/rest/v1/rpc/set_by_slug', {
    method: 'POST',
    body: { share_slug: slug.trim() },
    /* Anonymous for the same reason the gallery is: the function is `security
       definer` and answers the same to everyone, so a share link that stopped
       working because the *reader* had an old session would be the worst
       possible failure — the link is the whole product. */
    anonymous: true
  });
  return rows[0] ?? null;
}

/**
 * An author's display name, for crediting a set fetched by share link.
 *
 * A gallery tile gets this through the `owner_id → profiles` embed, but a
 * share link goes through `set_by_slug`, which returns `setof public.sets` and
 * so cannot carry one. Rather than widen that function — it is the security
 * boundary for unlisted sets and every column it gains is a column a share
 * token exposes — the name is fetched separately from `profiles`, which is
 * publicly readable by policy.
 *
 * Empty string rather than an error for anything that fails: a credit is worth
 * having and never worth blocking a page for.
 */
export async function fetchAuthorName(ownerId: string): Promise<string> {
  try {
    const rows = await request<{ display_name: string }[]>(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(ownerId)}&select=display_name&limit=1`,
      { anonymous: true }
    );
    return rows[0]?.display_name ?? '';
  } catch {
    return '';
  }
}

/** One profile, for the header of its own page. Null if it does not exist. */
export interface PublicProfile {
  id: string;
  display_name: string;
  avatar_url: string;
}

/**
 * A profile by id, for `AuthorProfileScreen`'s header — `fetchAuthorName`
 * returns only the name, which is all a credit line needs; a page about the
 * person also wants their picture.
 */
export async function fetchProfile(id: string): Promise<PublicProfile | null> {
  try {
    const rows = await request<PublicProfile[]>(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=id,display_name,avatar_url&limit=1`,
      { anonymous: true }
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Everything this person has published publicly — the whole set, and any
 * hero or villain slice they published on its own.
 *
 * Reuses `GALLERY_COLUMNS`/`sets_public_read`, the same as `listPublicSets`:
 * no `visibility` filter written here, the policy is what decides, and it is
 * deliberately anonymous for the same reason every other public read here is
 * — a stranger's profile page must not go blank because *this browser's own*
 * session happens to have gone stale.
 */
export async function listPublicSetsByOwner(ownerId: string): Promise<GallerySet[]> {
  return request<GallerySet[]>(
    `/rest/v1/sets?select=${GALLERY_COLUMNS}&owner_id=eq.${encodeURIComponent(ownerId)}` +
      `&order=${galleryOrder('newest')}`,
    { anonymous: true }
  );
}

/** Just enough of a set to draw a tile on the "contributed to" shelf. */
export interface ContributedSet {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  thumbnail_url: string;
  cover_url: string;
  cover_bleeds: boolean;
  character_count: number;
  card_count: number;
  view_count: number;
  published_at: string | null;
  updated_at: string;
  revision: number;
}

/**
 * Every public set this person has helped build, through the
 * `sets_contributed_by` function — `set_contributions` itself is readable
 * only by the contributor or the set's owner, so a stranger's profile page
 * needs the same `security definer` boundary `set_contributors` uses, just
 * asked in the other direction. See `supabase/migrations/0008_author_profiles.sql`
 * for why this is scoped to `visibility = 'public'` only, narrower than
 * `set_contributors`'s own `'unlisted', 'public'`: that function is only ever
 * called already holding a specific set's slug, where this is general
 * discovery reachable from a stranger's name alone — listing an unlisted set
 * here would hand out a working link to it.
 */
export async function fetchSetsContributedTo(contributorId: string): Promise<ContributedSet[]> {
  try {
    return await request<ContributedSet[]>('/rest/v1/rpc/sets_contributed_by', {
      method: 'POST',
      body: { contributor: contributorId },
      anonymous: true
    });
  } catch {
    return [];
  }
}

/**
 * The state of a published set, without its document.
 *
 * For a forked set asking whether its original has moved on — a question that
 * compares one integer and must not cost a multi-megabyte download to ask.
 * `set_by_slug` would return the whole thing, and a filtered select cannot see
 * an unlisted original, so this is its own `security definer` function.
 *
 * Returns `null` for a slug that leads nowhere, exactly like `fetchSetBySlug`:
 * an original that was withdrawn is simply an original nothing more is known
 * about, and a fork must go on working regardless.
 */
export async function fetchSetSummaryBySlug(slug: string): Promise<SetSummary | null> {
  const rows = await request<SetSummary[]>('/rest/v1/rpc/set_summary_by_slug', {
    method: 'POST',
    body: { share_slug: slug.trim() },
    // Anonymous like every other published read. See `listPublicSets`.
    anonymous: true
  });
  return rows[0] ?? null;
}

/**
 * Turn a fetched row back into a set this app can open.
 *
 * Every asset comes back down and is re-embedded, so what lands in the
 * library is an ordinary local document with no dependency on the network —
 * which is the same thing an imported `.json` file would have been. A set that
 * still pointed at remote artwork would break offline, and would taint the
 * canvas in `card-image.ts`, so PNG export would fail somewhere far away from
 * the cause.
 */
export async function hydratePublishedSet(
  row: PublishedSetWithDocument,
  onProgress?: (done: number, total: number) => void
): Promise<AdventureSet> {
  if (row.schema_version > SET_SCHEMA_VERSION) {
    throw new CloudError(
      `That set was published from a newer version of the app (v${row.schema_version}).`,
      0
    );
  }

  const document = await fetchAndEmbedAssets(row.document, assetPrefix(), onProgress);

  /*
   * Back through `parseSetFile`, so a downloaded set passes the same validation
   * and repair as one imported from a file. The server is not trusted more than
   * a file on disk is — it holds whatever some other author published.
   */
  const result = parseSetFile(JSON.stringify(document));
  if (!result.ok) throw new CloudError(`That set could not be read: ${result.error}`, 0);
  return result.set;
}

// -- Managing -----------------------------------------------------------

export async function setVisibility(id: string, visibility: Visibility): Promise<void> {
  await auth.ensureFresh();
  await request(`/rest/v1/sets?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { visibility },
    headers: { Prefer: 'return=minimal' }
  });
}

/**
 * Withdraw a published set.
 *
 * The row goes; the assets stay. Storage has no cascade, and chasing them from
 * the browser would be a best-effort loop that fails halfway on a flaky
 * connection and leaves the row deleted anyway. Orphaned objects cost storage;
 * a half-deleted set costs trust.
 */
export async function unpublishSet(id: string): Promise<void> {
  await auth.ensureFresh();
  await request(`/rest/v1/sets?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });
}

/**
 * The link to hand someone.
 *
 * A real path (`…/shared/{slug}`), not the in-app hash form — a fragment
 * never leaves the browser, so a link unfurler reading it server-side (see
 * `middleware.ts`) would have no way to know which set was being asked for.
 * `window.location.pathname` carries the app's own base path along, the same
 * as the old hash form did, so this still works for a sub-path deploy.
 */
export function shareUrl(slug: string): string {
  return `${window.location.origin}${window.location.pathname}shared/${slug}`;
}
