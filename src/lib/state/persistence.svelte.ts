/**
 * Wires the store to the set library. Call `useAutosave()` once, from the root
 * component's setup — it registers an effect and cleans up with it.
 */
import { untrack } from 'svelte';
import { focusedEditGroup } from './edit-history';
import { serializeSet } from '$lib/export/json';
import { auth } from '$lib/cloud/auth.svelte';
import { persistenceCoordinator } from '$lib/persistence/coordinator.svelte';
import { draftDiagnostics } from '$lib/persistence/diagnostics.svelte';
import { draftRollout } from '$lib/persistence/rollout.svelte';
import {
  DraftSavePreparer,
  SupersededDraftPreparation
} from '$lib/persistence/save-preparer';
import type { AdventureSet } from '$lib/sets/types';
import { withCurrentPublicationFingerprints } from '$lib/sets/publication-fingerprint';
import { navigation } from './navigation.svelte';
import {
  migrateLegacyDocument,
  migrateLibraryFromLocalStorage,
  readLastOpen,
  rememberLastOpen
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
  await Promise.all([draftRollout.refresh(), draftDiagnostics.load()]);

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
  // A successful cloud listing is authoritative. If another browser purged
  // the remembered draft, its deliberately retained cache must not reopen it
  // behind a shelf that correctly no longer lists it.
  if (lastOpen && store.library.some((entry) => entry.id === lastOpen)) {
    const opened = await persistenceCoordinator.open(lastOpen);
    if (opened) {
      store.load(opened.set);
      store.markSaved(opened.set.meta.updatedAt);
      navigation.openSet('home');
      return;
    }
    await rememberLastOpen(null);
  } else if (lastOpen) {
    await rememberLastOpen(null);
  }

  navigation.openHome();
}

export function useAutosave(store: WorkshopStore, delayMs = 500): void {
  let generation = 0;
  let latestObserved: { generation: number; set: AdventureSet } | null = null;
  let latestPrepared: {
    generation: number;
    set: AdventureSet;
    json: string;
    hash: string;
    byteCount: number;
  } | null = null;
  let leavingFlush: Promise<boolean> | null = null;
  let sessionKey = `${auth.user?.id ?? ''}:${auth.isAnonymous}:${draftRollout.enabled}`;
  let wasInSet = navigation.inSet;
  const preparer = new DraftSavePreparer();

  persistenceCoordinator.start();

  $effect(() => {
    store.selection;
    store.mapEditingId;
    untrack(() => store.updateHistoryContext());
  });

  $effect(() => {
    // The preference is account-scoped. A provider redirect or another tab
    // changing the session must never inherit the previous account's choice.
    auth.user?.id;
    auth.isAnonymous;
    void draftRollout.refresh();
  });

  $effect(() => {
    // These reads make sign-in, sign-out and anonymous-account promotion
    // restart or pause the durable outbox without coupling auth to storage.
    const nextSessionKey = `${auth.user?.id ?? ''}:${auth.isAnonymous}:${draftRollout.enabled}`;
    persistenceCoordinator.sessionChanged();
    if (nextSessionKey !== sessionKey) {
      sessionKey = nextSessionKey;
      void store.refreshLibrary();
    }
  });

  $effect(() => {
    const inSet = navigation.inSet;

    /*
     * `$state.snapshot` walks the document and therefore keeps this a deep
     * observer without serialising, canonicalising and hashing every embedded
     * artwork string before the input event can paint. The container copy is
     * also what Undo needs; large primitive strings remain shared.
     */
    const set = store.adventure;
    store.syncSingleHeroName();
    const snapshot = $state.snapshot(set);
    untrack(() => store.recordHistory(snapshot, focusedEditGroup()));
    const observedGeneration = ++generation;
    latestObserved = { generation: observedGeneration, set: snapshot };
    preparer.supersede();

    /* Leaving the editor cancels its debounce. Persist that final generation
       immediately; an ordinary Home render with no open-set transition still
       has nothing to save. */
    const shouldSave = inSet || wasInSet;
    wasInSet = inSet;
    if (!shouldSave) return;

    const handle = setTimeout(() => {
      void (async () => {
        try {
          const prepared = await preparer.prepare(snapshot);
          if (observedGeneration !== generation) return;
          const preparedSet = withCurrentPublicationFingerprints(
            snapshot,
            prepared.currentPublicationFingerprints
          );
          latestPrepared = {
            generation: observedGeneration,
            set: preparedSet,
            json: prepared.json,
            hash: prepared.hash,
            byteCount: prepared.jsonByteCount
          };
          if (
            await persistenceCoordinator.save(
              preparedSet,
              prepared.json,
              undefined,
              true,
              prepared.hash,
              prepared.jsonByteCount
            )
          ) {
            store.markSaved();
            if (!navigation.inSet) await store.refreshLibrary();
          } else {
            store.markSaveFailed('Autosave failed — export the set to keep your work.');
          }
        } catch (cause) {
          if (cause instanceof SupersededDraftPreparation) return;
          console.error('[workshop] Background draft preparation failed.', cause);
          /* Workers are universal in supported browsers, but preserving cloud
             delivery matters more than responsiveness if one is blocked by a
             browser policy or extension. */
          if (await persistenceCoordinator.save(snapshot)) {
            store.markSaved();
            if (!navigation.inSet) await store.refreshLibrary();
          } else {
            store.markSaveFailed('Autosave failed — export the set to keep your work.');
          }
        }
      })();
    }, inSet ? delayMs : 0);

    return () => clearTimeout(handle);
  });

  $effect(() => {
    const flushLatest = (): void => {
      const observed = latestObserved;
      if (!navigation.inSet || !observed || leavingFlush) return;
      const prepared = latestPrepared?.generation === observed.generation ? latestPrepared : null;
      const json = prepared?.json ?? serializeSet(observed.set);
      const set = prepared?.set ?? observed.set;
      leavingFlush = persistenceCoordinator
        .flush(set, json, true, prepared?.hash, prepared?.byteCount)
        .finally(() => {
          leavingFlush = null;
        });
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flushLatest();
    };
    window.addEventListener('pagehide', flushLatest);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushLatest);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      preparer.destroy();
      persistenceCoordinator.stop();
    };
  });
}
