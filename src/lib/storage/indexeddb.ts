/**
 * A minimal promise wrapper over IndexedDB — two object stores, four verbs,
 * nothing this app does not use.
 *
 * Hand-rolled rather than a dependency, for the reason everything else here
 * is: `package.json` has no runtime dependencies to spend, and IndexedDB's own
 * callback API is a small enough surface that wrapping it costs less than
 * shipping a library to do it.
 *
 * Every function here resolves to a safe fallback (`null`, `[]`, `false`)
 * rather than rejecting, the same contract `storage/local.ts` kept for plain
 * `localStorage` — private browsing, a disabled database, a browser that
 * predates IndexedDB, and a genuinely full disk all fail the same way from
 * the caller's side: there was nowhere to put it.
 */

const DB_NAME = 'adventures-workshop';
const DB_VERSION = 1;

/** Sets, keyed by `SetId`. Value is the *serialised* document — a JSON
 *  string, not the object — so `parseSetFile`/`serializeSet` stay the one
 *  round trip everything else already goes through, file export included. */
export const SETS_STORE = 'sets';

/** Everything else this app needs to remember: the library index (one row
 *  per set, for the shelf) and which set was open last. Small, so one store
 *  keyed by a handful of fixed string keys is simpler than one store apiece. */
export const META_STORE = 'meta';

function available(): boolean {
  return typeof indexedDB !== 'undefined';
}

let opening: Promise<IDBDatabase | null> | null = null;

/**
 * Open the database once and reuse the connection.
 *
 * `onupgradeneeded` only ever runs once per browser, the first time this
 * version is requested — creating the stores here rather than assuming they
 * exist is what makes a first run and a later one the same code path.
 */
function open(): Promise<IDBDatabase | null> {
  if (!available()) return Promise.resolve(null);

  opening ??= new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SETS_STORE)) db.createObjectStore(SETS_STORE);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };

    request.onsuccess = () => resolve(request.result);
    // A blocked or refused open is not worth throwing over — every caller
    // already treats "nowhere to put it" as a normal, handleable outcome.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return opening;
}

export async function idbGet<T>(store: string, key: string): Promise<T | null> {
  const db = await open();
  if (!db) return null;

  return new Promise((resolve) => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => resolve(null);
  });
}

/** Every value in a store, in no particular order — callers that care sort it. */
export async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await open();
  if (!db) return [];

  return new Promise((resolve) => {
    const request = db.transaction(store, 'readonly').objectStore(store).getAll();
    request.onsuccess = () => resolve((request.result as T[] | undefined) ?? []);
    request.onerror = () => resolve([]);
  });
}

/**
 * Write one record. `false` covers everything from "no database" to a quota
 * genuinely exceeded — IndexedDB has a ceiling too, just a far larger one —
 * so a caller that reports "could not save" on `false` is still correct.
 */
export async function idbPut(store: string, key: string, value: unknown): Promise<boolean> {
  const db = await open();
  if (!db) return false;

  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    // `oncomplete`, not the request's own `onsuccess`: a transaction can still
    // fail after an individual request inside it reports success.
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

export async function idbDelete(store: string, key: string): Promise<void> {
  const db = await open();
  if (!db) return;

  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}
