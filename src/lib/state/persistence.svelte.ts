/**
 * Wires the store to the set library. Call `useAutosave()` once, from the root
 * component's setup — it registers an effect and cleans up with it.
 */
import { serializeSet } from '$lib/export/json';
import { navigation } from './navigation.svelte';
import {
  loadSet,
  migrateLegacyDocument,
  readIndex,
  readLastOpen,
  rememberLastOpen,
  saveSet
} from '$lib/storage/library';
import type { WorkshopStore } from './workshop.svelte';

/**
 * Pick up where the author left off.
 *
 * A pre-library document is adopted into the library on first run rather than
 * stranded. Failing that, the last-open set is reopened; failing that, the
 * library screen is where you land, which is the correct place to start.
 */
export function restoreSession(store: WorkshopStore): void {
  const adopted = migrateLegacyDocument();
  if (adopted) {
    store.load(adopted);
    store.markSaved(adopted.meta.updatedAt);
    store.refreshLibrary();
    navigation.openSet('home');
    return;
  }

  store.refreshLibrary();

  const lastOpen = readLastOpen();
  if (lastOpen) {
    const set = loadSet(lastOpen);
    if (set) {
      store.load(set);
      store.markSaved(set.meta.updatedAt);
      navigation.openSet('home');
      return;
    }
    rememberLastOpen(null);
  }

  navigation.openLibrary();
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
    const json = serializeSet(set);

    // Nothing to save while the library is on screen.
    if (!inSet) return;

    const handle = setTimeout(() => {
      if (saveSet(set, json)) {
        store.markSaved();
        store.library = readIndex();
      } else {
        store.markSaveFailed('Autosave failed — export the set to keep your work.');
      }
    }, delayMs);

    return () => clearTimeout(handle);
  });
}
