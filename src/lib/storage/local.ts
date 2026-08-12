/**
 * Local-first persistence.
 *
 * The document lives in `localStorage` and nowhere else. Reuses the same
 * envelope as the file exporter so there is exactly one serialisation path
 * to keep correct.
 */
import { parseSetFile, serializeSet } from '$lib/export/json';
import type { AdventureSet } from '$lib/sets/types';

const STORAGE_KEY = 'adventures-workshop:document:v1';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Private mode, or storage blocked by policy.
    return null;
  }
}

export function writeStoredSet(set: AdventureSet): boolean {
  return writeStoredJson(serializeSet(set));
}

/** Write a pre-serialised document — lets the autosave effect skip a re-encode. */
export function writeStoredJson(json: string): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, json);
    return true;
  } catch {
    // Quota exceeded — most likely embedded artwork.
    return false;
  }
}

export function readStoredSet(): AdventureSet | null {
  const store = storage();
  if (!store) return null;

  const raw = store.getItem(STORAGE_KEY);
  if (raw === null) return null;

  const result = parseSetFile(raw);
  if (!result.ok) {
    console.warn(`[storage] Discarding unreadable saved document: ${result.error}`);
    return null;
  }
  return result.set;
}

export function clearStoredSet(): void {
  storage()?.removeItem(STORAGE_KEY);
}
