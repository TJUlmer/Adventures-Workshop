/**
 * The set library.
 *
 * Sets are stored one key per document, with a small index alongside. That
 * split matters: the library screen needs names and counts for a dozen sets,
 * and reading a dozen documents — each carrying embedded artwork — just to
 * draw a list would be wasteful and slow.
 */
import { parseSetFile, serializeSet } from '$lib/export/json';
import type { AdventureSet, SetId } from '$lib/sets/types';
import type { IsoDateTime } from '$lib/core/id';
import { now } from '$lib/core/id';

const INDEX_KEY = 'adventures-workshop:library:v1';
const SET_PREFIX = 'adventures-workshop:set:';
/** The single-document key used before the library existed. */
const LEGACY_KEY = 'adventures-workshop:document:v1';

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
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function setKey(id: SetId): string {
  return `${SET_PREFIX}${id}`;
}

export function readIndex(): LibraryEntry[] {
  const store = storage();
  if (!store) return [];

  const raw = store.getItem(INDEX_KEY);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as LibraryEntry[];
  } catch {
    return [];
  }
}

function writeIndex(entries: readonly LibraryEntry[]): void {
  storage()?.setItem(INDEX_KEY, JSON.stringify(entries));
}

function toEntry(set: AdventureSet, bytes: number): LibraryEntry {
  return {
    id: set.id,
    name: set.name,
    subtitle: set.subtitle,
    updatedAt: set.meta.updatedAt,
    cardCount: set.cards.length,
    characterCount: set.characters.length,
    bytes,
    ...(set.origin
      ? { originAuthor: set.origin.authorName, originRevision: set.origin.revision }
      : {})
  };
}

/**
 * Write a document and refresh its index row. Returns false if storage is full.
 *
 * `json` may be supplied by a caller that has already serialised the set —
 * the autosave effect does, because serialising is also how it establishes a
 * deep read on every field of the document.
 */
export function saveSet(set: AdventureSet, json = serializeSet(set)): boolean {
  const store = storage();
  if (!store) return false;

  try {
    store.setItem(setKey(set.id), json);
  } catch {
    return false;
  }

  const entries = readIndex().filter((entry) => entry.id !== set.id);
  entries.unshift(toEntry(set, json.length));
  writeIndex(entries);
  return true;
}

export function loadSet(id: SetId): AdventureSet | null {
  const raw = storage()?.getItem(setKey(id));
  if (!raw) return null;

  const result = parseSetFile(raw);
  if (!result.ok) {
    console.warn(`[library] Discarding unreadable set ${id}: ${result.error}`);
    return null;
  }
  return result.set;
}

export function deleteSet(id: SetId): void {
  storage()?.removeItem(setKey(id));
  writeIndex(readIndex().filter((entry) => entry.id !== id));
}

/** Which set was open last, so a reload lands where the author left off. */
const LAST_OPEN_KEY = 'adventures-workshop:last-open:v1';

export function rememberLastOpen(id: SetId | null): void {
  const store = storage();
  if (!store) return;
  if (id === null) store.removeItem(LAST_OPEN_KEY);
  else store.setItem(LAST_OPEN_KEY, id);
}

export function readLastOpen(): SetId | null {
  return (storage()?.getItem(LAST_OPEN_KEY) as SetId | null) ?? null;
}

/**
 * Move a pre-library document into the library, once.
 *
 * The old build kept a single set under one key. Rather than stranding it, the
 * first run of the library adopts it and clears the old key.
 */
export function migrateLegacyDocument(): AdventureSet | null {
  const store = storage();
  if (!store) return null;

  const raw = store.getItem(LEGACY_KEY);
  if (!raw) return null;

  const result = parseSetFile(raw);
  store.removeItem(LEGACY_KEY);
  if (!result.ok) return null;

  const set = result.set;
  set.meta.updatedAt = set.meta.updatedAt || now();
  saveSet(set);
  rememberLastOpen(set.id);
  return set;
}
