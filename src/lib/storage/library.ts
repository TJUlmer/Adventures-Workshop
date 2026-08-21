/**
 * The set library.
 *
 * Backed by IndexedDB rather than `localStorage`, which is where this lived
 * until it turned out to be too small for the job: `localStorage` is roughly
 * 5MB **per origin**, shared across every set in the library rather than
 * metered per set, and a handful of unresized photos was enough to fill it —
 * see `core/image-import.ts` for the half of this fix that shrinks a picture
 * before it is ever embedded. IndexedDB's own ceiling is tied to available
 * disk space instead, commonly hundreds of megabytes at minimum, which is
 * the actual room a set with dozens of images needs.
 *
 * Sets are stored one key per document, with a small index alongside — same
 * split as before, and for the same reason: the library screen needs names
 * and counts for a dozen sets, and reading a dozen documents, each carrying
 * embedded artwork, just to draw a list would be wasteful and slow.
 *
 * Every function here is now async, `indexeddb.ts`'s doing rather than a
 * choice made for its own sake — there is no synchronous IndexedDB API to
 * have kept this on. Callers that do not need to wait on the result use
 * `void`, the same as anywhere else in the app that fires a write and moves
 * on; see `state/persistence.svelte.ts` and `state/workshop.svelte.ts`.
 */
import { characterLabel } from '$lib/characters/factory';
import type { CharacterId, CharacterRole } from '$lib/characters/types';
import { parseSetFile, serializeSet } from '$lib/export/json';
import type { AdventureSet, SetId } from '$lib/sets/types';
import type { IsoDateTime } from '$lib/core/id';
import { now } from '$lib/core/id';
import { idbDelete, idbGet, idbPut, META_STORE, SETS_STORE } from './indexeddb';

/** The pre-IndexedDB keys, read once each to migrate whatever they hold. */
const OLD_INDEX_KEY = 'adventures-workshop:library:v1';
const OLD_SET_PREFIX = 'adventures-workshop:set:';
const OLD_LAST_OPEN_KEY = 'adventures-workshop:last-open:v1';
/** The single-document key used before the library existed at all. */
const LEGACY_KEY = 'adventures-workshop:document:v1';

const INDEX_KEY = 'library-index';
const LAST_OPEN_KEY = 'last-open';

/** What the library screen needs, without loading a whole document. */
export interface LibraryEntry {
  id: SetId;
  name: string;
  subtitle: string;
  updatedAt: IsoDateTime;
  cardCount: number;
  characterCount: number;
  /** Approximate bytes, so a set that is outgrowing storage is visible. */
  bytes: number;
  /**
   * Who to credit, for a set copied from a published one. Denormalised into
   * the index for the same reason every other field here is: the shelf draws
   * from the index, and reading a document per tile to find one string would
   * pull every set in the library into memory to show a list of them.
   *
   * Absent on an original and on any index row written before forking existed.
   */
  originAuthor?: string;
  /**
   * The revision of the published set this copy was forked from, frozen at
   * the moment of copying — see `SetOrigin.revision`. Denormalised for the
   * same reason `originAuthor` is: it is what tells two forks of the same
   * set apart on the shelf, without opening each one to find out. Shown
   * unconditionally, the same as `SetHome`'s own lineage line — a first fork
   * is still worth saying "revision 1", once there might be a second beside
   * it on the shelf reading "revision 4".
   *
   * Absent on an original and on any index row written before forking
   * existed.
   */
  originRevision?: number;
  /**
   * Every character in the set, name and role only — enough for a "browse by
   * character" list to search and to say which set each result belongs to,
   * without a picture. A picture was the tempting next field and deliberately
   * left out: an author's artwork is already an embedded data URL several
   * hundred KB apiece, and this index exists specifically so a shelf of a
   * dozen sets does not mean holding a dozen documents in memory just to draw
   * a list — copying that much image data into the very structure built to
   * avoid it would be self-defeating. `LibraryScreen`'s Characters view uses
   * initials instead, same fallback the gallery already draws for a set with
   * no picture.
   *
   * Denormalised for the same reason every other field here is. Absent on an
   * index row written before this existed; `LibraryScreen` reads it as `??
   * []`, not as a sign the set has no characters.
   */
  characters?: LibraryCharacterEntry[];
}

export interface LibraryCharacterEntry {
  id: CharacterId;
  name: string;
  role: CharacterRole;
}

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Every set's index row, most recently saved first.
 *
 * `unshift`-on-save is what gives the order, not a stored field — see
 * `saveSet` — so this simply returns whatever was written, in write order.
 */
export async function readIndex(): Promise<LibraryEntry[]> {
  return (await idbGet<LibraryEntry[]>(META_STORE, INDEX_KEY)) ?? [];
}

async function writeIndex(entries: readonly LibraryEntry[]): Promise<void> {
  await idbPut(META_STORE, INDEX_KEY, entries);
}

function toEntry(set: AdventureSet, bytes: number): LibraryEntry {
  return {
    id: set.id,
    name: set.name,
    subtitle: set.subtitle,
    updatedAt: set.meta.updatedAt,
    cardCount: set.cards.length,
    characterCount: set.characters.length,
    characters: set.characters.map((character) => ({
      id: character.id,
      name: characterLabel(character),
      role: character.role
    })),
    bytes,
    ...(set.origin
      ? { originAuthor: set.origin.authorName, originRevision: set.origin.revision }
      : {})
  };
}

/**
 * Write a document and refresh its index row. Resolves `false` if storage is
 * unavailable or genuinely full — IndexedDB's own ceiling is far larger than
 * `localStorage`'s was, but it is not infinite.
 *
 * `json` may be supplied by a caller that has already serialised the set —
 * the autosave effect does, because serialising is also how it establishes a
 * deep read on every field of the document.
 */
export async function saveSet(set: AdventureSet, json = serializeSet(set)): Promise<boolean> {
  const wrote = await idbPut(SETS_STORE, set.id, json);
  if (!wrote) return false;

  const entries = (await readIndex()).filter((entry) => entry.id !== set.id);
  entries.unshift(toEntry(set, json.length));
  await writeIndex(entries);
  return true;
}

export async function loadSet(id: SetId): Promise<AdventureSet | null> {
  const raw = await idbGet<string>(SETS_STORE, id);
  if (!raw) return null;

  const result = parseSetFile(raw);
  if (!result.ok) {
    console.warn(`[library] Discarding unreadable set ${id}: ${result.error}`);
    return null;
  }
  return result.set;
}

export async function deleteSet(id: SetId): Promise<void> {
  await idbDelete(SETS_STORE, id);
  await writeIndex((await readIndex()).filter((entry) => entry.id !== id));
}

/** Which set was open last, so a reload lands where the author left off. */
export async function rememberLastOpen(id: SetId | null): Promise<void> {
  if (id === null) await idbDelete(META_STORE, LAST_OPEN_KEY);
  else await idbPut(META_STORE, LAST_OPEN_KEY, id);
}

export async function readLastOpen(): Promise<SetId | null> {
  return idbGet<SetId>(META_STORE, LAST_OPEN_KEY);
}

/**
 * Move a pre-library document into the library, once.
 *
 * The old build kept a single set under one `localStorage` key. Rather than
 * stranding it, the first run of the library adopts it and clears the old
 * key — unchanged behaviour from before IndexedDB, just landing in the new
 * store now that `saveSet` writes there.
 */
export async function migrateLegacyDocument(): Promise<AdventureSet | null> {
  const store = localStore();
  if (!store) return null;

  const raw = store.getItem(LEGACY_KEY);
  if (!raw) return null;

  const result = parseSetFile(raw);
  store.removeItem(LEGACY_KEY);
  if (!result.ok) return null;

  const set = result.set;
  set.meta.updatedAt = set.meta.updatedAt || now();
  await saveSet(set);
  await rememberLastOpen(set.id);
  return set;
}

/**
 * Move an existing `localStorage`-backed library into IndexedDB, once.
 *
 * Presence of the old index key is the whole test for whether this has
 * already run: a successful migration clears it below, so a browser that
 * never had a library and one that has already moved both read as "nothing
 * to do" without a separate flag to keep in sync with reality.
 *
 * Copies before it deletes, and only deletes what it confirmed landed —
 * `saveSet` returning `false` for one set leaves that set's old key in place
 * rather than losing it, so a partial failure (an interrupted migration, a
 * write that lost a race with a full disk) is a set still reachable next
 * time rather than one silently dropped.
 */
export async function migrateLibraryFromLocalStorage(): Promise<void> {
  const store = localStore();
  if (!store) return;

  const rawIndex = store.getItem(OLD_INDEX_KEY);
  if (!rawIndex) return;

  let entries: LibraryEntry[];
  try {
    const parsed: unknown = JSON.parse(rawIndex);
    entries = Array.isArray(parsed) ? (parsed as LibraryEntry[]) : [];
  } catch {
    entries = [];
  }

  const movedIds: string[] = [];

  for (const entry of entries) {
    const raw = store.getItem(`${OLD_SET_PREFIX}${entry.id}`);
    if (!raw) continue; // Already moved by an earlier, partial run.

    // Written through `saveSet` rather than copied key-for-key, so the new
    // index row comes from the same `toEntry` every other write uses — an
    // old row written before a field like `originRevision` existed is
    // repaired the same way loading and re-saving it normally would repair it.
    const result = parseSetFile(raw);
    if (!result.ok) continue;

    if (await saveSet(result.set, raw)) movedIds.push(entry.id);
  }

  for (const id of movedIds) store.removeItem(`${OLD_SET_PREFIX}${id}`);

  // Anything still under the old prefix belongs to an entry that failed to
  // move this run — leaving the index blob in place is what lets the next
  // run find it again, rather than the old data becoming unreachable.
  const remaining = entries.some((entry) => store.getItem(`${OLD_SET_PREFIX}${entry.id}`) !== null);
  if (!remaining) store.removeItem(OLD_INDEX_KEY);

  const oldLastOpen = store.getItem(OLD_LAST_OPEN_KEY);
  if (oldLastOpen) {
    // Checked against IndexedDB itself, not just this run's `movedIds` — the
    // set this pointed at may have moved on an earlier, partial run.
    if (await idbGet(SETS_STORE, oldLastOpen)) await rememberLastOpen(oldLastOpen as SetId);
    store.removeItem(OLD_LAST_OPEN_KEY);
  }
}
