/**
 * Wires the store to the set library. Call `useAutosave()` once, from the root
 * component's setup — it registers an effect and cleans up with it.
 */
import { serializeSet } from '$lib/export/json';
import { navigation } from './navigation.svelte';
import {
  loadSet,
  migrateLegacyDocument,
  migrateLibraryFromLocalStorage,
  readIndex,
  readLastOpen,
  rememberLastOpen,
  saveSet
} from '$lib/storage/library';
import { requestPersistentStorage } from '$lib/storage/indexeddb';
import type { WorkshopStore } from './workshop.svelte';

/**
 * Pick up where the author left off.
 *
 * Two migrations run first, oldest scheme last: a `localStorage`-backed
 * library (`migrateLibraryFromLocalStorage`, the common case for anyone
 * upgrading into IndexedDB) and, older still, a single pre-library document
 * (`migrateLegacyDocument`). Both are safe to call on every startup — each
 * is a no-op the moment there is nothing left of its own to move — so there
 * is no separate "have we migrated" flag to keep in sync with reality.
 *
 * Async now, where this used to resolve before the first paint: IndexedDB
 * has no synchronous API to have kept it on. `App.svelte` gates its first
 * render on this rather than showing Home and then jumping, which is what
 * awaiting it here without a caller-side gate would have looked like.
 */
export async function restoreSession(store: WorkshopStore): Promise<void> {
  // Not awaited: this only lowers the odds of a rare, silent eviction under
  // storage pressure — see `requestPersistentStorage` — and nothing below
  // depends on its answer, so it should not add its own latency to the
  // restore `App.svelte` is gating first paint on.
  void requestPersistentStorage();

  await migrateLibraryFromLocalStorage();

  const adopted = await migrateLegacyDocument();
  if (adopted) {
    store.load(adopted);
    store.markSaved(adopted.meta.updatedAt);
    await store.refreshLibrary();
    navigation.openSet('home');
    return;
  }

  await store.refreshLibrary();

  const lastOpen = await readLastOpen();
  if (lastOpen) {
    const set = await loadSet(lastOpen);
    if (set) {
      store.load(set);
      store.markSaved(set.meta.updatedAt);
      navigation.openSet('home');
      return;
    }
    await rememberLastOpen(null);
  }

  navigation.openHome();
}

export function useAutosave(store: WorkshopStore, delayMs = 500): void {
  $effect(() => {
    const inSet = navigation.inSet;

    /*
     * Serialising here is not just preparation — it is how this effect
     * subscribes to the document. Reading `store.adventure` alone would track
     * the reference and nothing inside it, so field edits would never trigger
     * a save. Walking every field is what makes the dependency deep.
     */
    const set = store.adventure;
    store.syncSingleHeroName();
    const json = serializeSet(set);

    // Nothing to save while Home is on screen.
    if (!inSet) return;

    const handle = setTimeout(() => {
      // `$effect` cannot itself be `async`; the write is fired from inside a
      // plain callback instead, same as everywhere else in the app that
      // starts an async task from a synchronous handler.
      void (async () => {
        if (await saveSet(set, json)) {
          store.markSaved();
          store.library = await readIndex();
        } else {
          store.markSaveFailed('Autosave failed — export the set to keep your work.');
        }
      })();
    }, delayMs);

    return () => clearTimeout(handle);
  });
}
