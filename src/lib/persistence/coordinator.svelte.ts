/**
 * Two-tier draft persistence: IndexedDB first, revision-safe cloud second.
 *
 * The local cache is the crash/offline safety copy. Cloud delivery is a
 * generation queue: one request per set at a time, always followed by the
 * newest observed generation, and only that exact generation may be marked
 * clean by its response.
 */
import { hashHex } from '$lib/core/hash';
import { now } from '$lib/core/id';
import { serializeSet } from '$lib/export/json';
import { canonicalJson } from '$lib/sets/fingerprint';
import type { AdventureSet, SetId } from '$lib/sets/types';
import { auth } from '$lib/cloud/auth.svelte';
import {
  fetchDraft,
  fetchDraftSummary,
  purgeDraft,
  restoreDraft,
  saveDraft,
  softDeleteDraft
} from '$lib/cloud/drafts';
import type { DraftMutationResult } from '$lib/cloud/drafts';
import { CloudError } from '$lib/cloud/http';
import {
  loadSet,
  readDraftState,
  saveSetWithDraftState,
  writeDraftState
} from '$lib/storage/library';
import type {
  CachedDraftState,
  DraftConflict,
  OpenCachedDraft,
  SyncStatus
} from './types';

const CLOUD_DEBOUNCE_MS = 1750;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;
const encoder = new TextEncoder();

interface Generation {
  number: number;
  set: AdventureSet;
  json: string;
  hash: string;
}

interface SetQueue {
  id: SetId;
  generation: number;
  latest: Generation | null;
  localTail: Promise<void>;
  pumping: Promise<void> | null;
  cloudTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryAttempt: number;
  conflict: DraftConflict | null;
  stopped: boolean;
}

function blankState(localId: SetId): CachedDraftState {
  return {
    localId,
    cloudRevision: null,
    syncedHash: null,
    pending: false,
    lastCloudSaveAt: null,
    // A never-uploaded draft has a known-empty prefix. Legacy records are
    // normalised to `null` by `readDraftState` and reconcile once instead.
    assetPaths: [],
    cloudDraft: false
  };
}

export interface PersistenceServices {
  saveDraft: typeof saveDraft;
  fetchDraft: typeof fetchDraft;
  fetchDraftSummary: typeof fetchDraftSummary;
  softDeleteDraft: typeof softDeleteDraft;
  restoreDraft: typeof restoreDraft;
  purgeDraft: typeof purgeDraft;
  hasPermanentSession: () => boolean;
  isOnline: () => boolean;
}

const browserServices: PersistenceServices = {
  saveDraft,
  fetchDraft,
  fetchDraftSummary,
  softDeleteDraft,
  restoreDraft,
  purgeDraft,
  hasPermanentSession: () => auth.signedIn && !auth.isAnonymous,
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine
};

/** Stable over repeated serialisation, including objects whose key insertion order differs. */
export async function draftContentHash(set: AdventureSet): Promise<string> {
  return hashHex(encoder.encode(canonicalJson(set)));
}

export class PersistenceCoordinator {
  activeSetId = $state<SetId | null>(null);
  status = $state<SyncStatus>({ kind: 'local-only', attempt: 0, message: null });
  conflict = $state<DraftConflict | null>(null);

  #queues = new Map<SetId, SetQueue>();
  #started = false;
  #services: PersistenceServices;

  constructor(services: Partial<PersistenceServices> = {}) {
    this.#services = { ...browserServices, ...services };
  }

  activate(id: SetId): void {
    this.activeSetId = id;
    const queue = this.#queues.get(id);
    if (queue) queue.stopped = false;
    this.conflict = queue?.conflict ?? null;
  }

  /** Stop background delivery without discarding the durable outbox state. */
  pause(id: SetId): void {
    const queue = this.#queues.get(id);
    if (!queue) return;
    queue.stopped = true;
    this.#clearTimers(queue);
  }

  /** Drop in-memory work after the local document has been permanently removed. */
  forget(id: SetId): void {
    const queue = this.#queues.get(id);
    if (!queue) return;
    queue.stopped = true;
    this.#clearTimers(queue);
    this.#queues.delete(id);
    if (this.activeSetId === id) {
      this.activeSetId = null;
      this.conflict = null;
      this.status = { kind: 'local-only', attempt: 0, message: null };
    }
  }

  start(): void {
    if (this.#started || typeof window === 'undefined') return;
    this.#started = true;
    window.addEventListener('online', this.#onOnline);
    window.addEventListener('offline', this.#onOffline);
  }

  stop(): void {
    if (!this.#started || typeof window === 'undefined') return;
    window.removeEventListener('online', this.#onOnline);
    window.removeEventListener('offline', this.#onOffline);
    this.#started = false;
  }

  #onOnline = (): void => {
    for (const queue of this.#queues.values()) {
      if (!queue.conflict && !queue.stopped) this.#schedule(queue, 0);
    }
  };

  #onOffline = (): void => {
    if (this.activeSetId) {
      this.#setStatus(this.activeSetId, {
        kind: 'offline',
        attempt: 0,
        message: 'Cloud save is waiting for a connection.'
      });
    }
  };

  sessionChanged(): void {
    if (!this.#services.hasPermanentSession()) {
      for (const queue of this.#queues.values()) this.#clearTimers(queue);
      if (this.activeSetId) {
        this.#setStatus(this.activeSetId, { kind: 'local-only', attempt: 0, message: null });
      }
      return;
    }

    for (const queue of this.#queues.values()) {
      if (!queue.conflict && !queue.stopped) this.#schedule(queue, 0);
    }
  }

  /**
   * Opt one document into cloud delivery.
   *
   * Existing local libraries remain opted out until the author accepts the
   * copy-first migration. New/imported/forked sets call this before their
   * first flush so permanent-account creation is online by construction.
   */
  async enableCloud(id: SetId): Promise<boolean> {
    const current = (await readDraftState(id)) ?? blankState(id);
    if (current.cloudDraft) return true;
    return writeDraftState({ ...current, cloudDraft: true });
  }

  #queue(id: SetId): SetQueue {
    let queue = this.#queues.get(id);
    if (!queue) {
      queue = {
        id,
        generation: 0,
        latest: null,
        localTail: Promise.resolve(),
        pumping: null,
        cloudTimer: null,
        retryTimer: null,
        retryAttempt: 0,
        conflict: null,
        stopped: false
      };
      this.#queues.set(id, queue);
    }
    return queue;
  }

  #serial<T>(queue: SetQueue, operation: () => Promise<T>): Promise<T> {
    const run = queue.localTail.then(operation, operation);
    queue.localTail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  #setStatus(id: SetId, status: SyncStatus): void {
    if (this.activeSetId === id) this.status = status;
  }

  #clearTimers(queue: SetQueue): void {
    if (queue.cloudTimer) clearTimeout(queue.cloudTimer);
    if (queue.retryTimer) clearTimeout(queue.retryTimer);
    queue.cloudTimer = null;
    queue.retryTimer = null;
  }

  #schedule(queue: SetQueue, delay = CLOUD_DEBOUNCE_MS): void {
    if (!this.#services.hasPermanentSession() || queue.conflict || queue.stopped) return;
    if (queue.cloudTimer) clearTimeout(queue.cloudTimer);
    queue.cloudTimer = setTimeout(() => {
      queue.cloudTimer = null;
      void this.#pump(queue);
    }, delay);
  }

  /**
   * Persist one observed generation locally and queue it for cloud when this
   * account owns cloud drafts. Calls are serialised per set so a slow hash or
   * IndexedDB transaction cannot write generation N after generation N+1.
   */
  async save(
    set: AdventureSet,
    json = serializeSet(set),
    cloudDelay = CLOUD_DEBOUNCE_MS
  ): Promise<boolean> {
    const queue = this.#queue(set.id);
    this.activate(set.id);
    const generation = ++queue.generation;

    return this.#serial(queue, async () => {
      const hash = await draftContentHash(set);
      const current = (await readDraftState(set.id)) ?? blankState(set.id);
      const tracked =
        current.cloudDraft ||
        current.cloudRevision !== null ||
        current.syncedHash !== null ||
        current.pending;
      const inFlightMayMoveCloud = queue.pumping !== null;
      const matchesAcknowledged = current.syncedHash === hash && !inFlightMayMoveCloud;
      const pending = matchesAcknowledged
        ? false
        : (this.#services.hasPermanentSession() && current.cloudDraft) || tracked;
      const next: CachedDraftState = { ...current, pending };
      const wrote = await saveSetWithDraftState(set, next, json);
      if (!wrote) return false;

      if (!queue.latest || generation >= queue.latest.number) {
        queue.latest = { number: generation, set, json, hash };
      }

      if (queue.conflict) {
        this.#setStatus(set.id, {
          kind: 'conflict',
          attempt: 0,
          message: 'Cloud changed in another browser; automatic saving is paused.'
        });
      } else if (!this.#services.hasPermanentSession() || !current.cloudDraft) {
        this.#setStatus(set.id, { kind: 'local-only', attempt: 0, message: null });
      } else if (!pending) {
        this.#setStatus(set.id, {
          kind: current.cloudRevision === null ? 'local-only' : 'synced',
          attempt: 0,
          message: null
        });
      } else if (!this.#services.isOnline()) {
        this.#setStatus(set.id, {
          kind: 'offline',
          attempt: 0,
          message: 'Saved on this device; cloud save is waiting for a connection.'
        });
      } else {
        this.#setStatus(set.id, { kind: 'pending', attempt: 0, message: null });
        this.#schedule(queue, cloudDelay);
      }
      return true;
    });
  }

  /** Local durability plus one immediate cloud attempt; offline remains safely pending. */
  async flush(set: AdventureSet, json = serializeSet(set)): Promise<boolean> {
    const wrote = await this.save(set, json, 0);
    if (!wrote) return false;
    const queue = this.#queue(set.id);
    if (queue.cloudTimer) {
      clearTimeout(queue.cloudTimer);
      queue.cloudTimer = null;
    }
    await this.#pump(queue);
    return true;
  }

  async #pump(queue: SetQueue): Promise<void> {
    if (queue.pumping) return queue.pumping;
    queue.pumping = this.#runPump(queue).finally(() => {
      queue.pumping = null;
    });
    return queue.pumping;
  }

  async #runPump(queue: SetQueue): Promise<void> {
    await queue.localTail;
    if (queue.conflict || queue.stopped || !this.#services.hasPermanentSession()) return;
    if (!this.#services.isOnline()) {
      this.#setStatus(queue.id, {
        kind: 'offline',
        attempt: queue.retryAttempt,
        message: 'Saved on this device; cloud save is waiting for a connection.'
      });
      return;
    }

    for (;;) {
      await queue.localTail;
      const job = queue.latest;
      const state = (await readDraftState(queue.id)) ?? blankState(queue.id);
      if (!job || !state.pending) {
        this.#setStatus(queue.id, {
          kind: state.cloudRevision === null ? 'local-only' : 'synced',
          attempt: 0,
          message: null
        });
        return;
      }

      this.#setStatus(queue.id, { kind: 'saving', attempt: queue.retryAttempt, message: null });
      try {
        const result = await this.#services.saveDraft(job.set, state.cloudRevision, {
          knownAssetPaths: state.assetPaths,
          onAssetsReady: async (assetPaths) => {
            const persisted = await this.#serial(queue, async () => {
              const current = (await readDraftState(queue.id)) ?? state;
              return writeDraftState({ ...current, assetPaths: [...assetPaths] });
            });
            if (!persisted) {
              throw new CloudError(
                'Private assets uploaded, but this device could not record their manifest.',
                0
              );
            }
          }
        });
        // A soft/permanent delete can happen while the request is in flight.
        // The server may already have accepted it, but a stopped queue must
        // never recreate local acknowledgement state after that decision.
        if (queue.stopped) return;
        if (result.outcome === 'conflict') {
          const conflict: DraftConflict = {
            localId: queue.id,
            baseRevision: state.cloudRevision,
            remoteRevision: result.revision
          };
          queue.conflict = conflict;
          this.conflict = this.activeSetId === queue.id ? conflict : this.conflict;
          this.#clearTimers(queue);
          this.#setStatus(queue.id, {
            kind: 'conflict',
            attempt: 0,
            message: 'Cloud changed in another browser; automatic saving is paused.'
          });
          return;
        }
        if (result.outcome !== 'saved' || result.revision === null) {
          throw new CloudError(`Unexpected draft save outcome: ${result.outcome}.`, 0);
        }

        const acknowledgedAt = now();
        const persisted = await this.#serial(queue, async () => {
          const current = (await readDraftState(queue.id)) ?? state;
          const latest = queue.latest;
          const pending = latest !== null && latest.hash !== job.hash;
          return writeDraftState({
            ...current,
            cloudRevision: result.revision,
            syncedHash: job.hash,
            pending,
            lastCloudSaveAt: acknowledgedAt,
            assetPaths: result.assetPaths ?? current.assetPaths
          });
        });
        if (!persisted) {
          this.#setStatus(queue.id, {
            kind: 'error',
            attempt: 0,
            message: 'Cloud saved, but this device could not record the acknowledgement.'
          });
          return;
        }

        queue.retryAttempt = 0;
        if (queue.retryTimer) clearTimeout(queue.retryTimer);
        queue.retryTimer = null;
        const latest = queue.latest;
        if (!latest || latest.hash === job.hash) {
          this.#setStatus(queue.id, { kind: 'synced', attempt: 0, message: null });
          return;
        }
        // A newer local generation appeared while this request was in flight.
        // Loop immediately with the newly acknowledged revision as its base.
      } catch (cause) {
        const status = cause instanceof CloudError ? cause.status : 0;
        const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
        if (!retryable) {
          this.#setStatus(queue.id, {
            kind: 'error',
            attempt: queue.retryAttempt,
            message: cause instanceof Error ? cause.message : 'Cloud save failed.'
          });
          return;
        }

        queue.retryAttempt += 1;
        const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (queue.retryAttempt - 1));
        this.#setStatus(queue.id, {
          kind: this.#services.isOnline() ? 'retrying' : 'offline',
          attempt: queue.retryAttempt,
          message: this.#services.isOnline()
            ? `Cloud save will retry in ${Math.round(delay / 1000)} seconds.`
            : 'Saved on this device; cloud save is waiting for a connection.'
        });
        if (queue.retryTimer) clearTimeout(queue.retryTimer);
        queue.retryTimer = setTimeout(() => {
          queue.retryTimer = null;
          void this.#pump(queue);
        }, delay);
        return;
      }
    }
  }

  /**
   * Open the cache without ever replacing pending local work. A clean cache may
   * advance to a newer cloud revision; acknowledgement is written before the
   * returned document can be installed in the reactive WorkshopStore.
   */
  async open(localId: SetId): Promise<OpenCachedDraft | null> {
    const cached = await loadSet(localId);
    this.activate(localId);
    const queue = this.#queue(localId);
    const state = (await readDraftState(localId)) ?? blankState(localId);

    if (!this.#services.hasPermanentSession()) {
      this.#setStatus(localId, { kind: 'local-only', attempt: 0, message: null });
      return cached ? { set: cached, source: 'cache', conflict: null } : null;
    }
    if (!this.#services.isOnline()) {
      this.#setStatus(localId, {
        kind: state.pending || !cached ? 'offline' : 'synced',
        attempt: 0,
        message: !cached
          ? 'This draft is not cached on this device. Connect to open it.'
          : state.pending
            ? 'Cloud save is waiting for a connection.'
            : null
      });
      if (cached && state.pending) void this.save(cached, serializeSet(cached), 0);
      return cached ? { set: cached, source: 'cache', conflict: null } : null;
    }

    let remote;
    try {
      remote = await this.#services.fetchDraftSummary(localId);
    } catch (cause) {
      this.#setStatus(localId, {
        kind: state.pending ? 'retrying' : 'error',
        attempt: 0,
        message: cause instanceof Error ? cause.message : 'Could not check the cloud draft.'
      });
      if (cached && state.pending) void this.save(cached, serializeSet(cached), 0);
      return cached ? { set: cached, source: 'cache', conflict: null } : null;
    }

    if (!remote) {
      if (!cached) return null;
      if (state.pending) void this.save(cached, serializeSet(cached), 0);
      else this.#setStatus(localId, { kind: 'local-only', attempt: 0, message: null });
      return { set: cached, source: 'cache', conflict: null };
    }
    if (remote.deletedAt !== null) return null;

    if (!cached) {
      const loaded = await this.#services.fetchDraft(localId);
      if (!loaded) return null;
      await this.acknowledgeHydrated(loaded.set, loaded.summary.revision, loaded.assetPaths);
      return { set: loaded.set, source: 'cloud', conflict: null };
    }

    if (state.pending) {
      if (state.cloudRevision === remote.revision) {
        void this.save(cached, serializeSet(cached), 0);
        return { set: cached, source: 'cache', conflict: null };
      }
      return this.#recordConflict(queue, state.cloudRevision, remote.revision, cached);
    }

    if (state.cloudRevision === null) {
      return this.#recordConflict(queue, null, remote.revision, cached);
    }
    if (remote.revision < state.cloudRevision) {
      return this.#recordConflict(queue, state.cloudRevision, remote.revision, cached);
    }
    if (remote.revision === state.cloudRevision) {
      const hash = await draftContentHash(cached);
      if (state.syncedHash !== null && hash !== state.syncedHash) {
        void this.save(cached, serializeSet(cached), 0);
        return { set: cached, source: 'cache', conflict: null };
      }
      this.#setStatus(localId, { kind: 'synced', attempt: 0, message: null });
      return { set: cached, source: 'cache', conflict: null };
    }

    const loaded = await this.#services.fetchDraft(localId);
    if (!loaded) return { set: cached, source: 'cache', conflict: null };
    await this.acknowledgeHydrated(loaded.set, loaded.summary.revision, loaded.assetPaths);
    return { set: loaded.set, source: 'cloud', conflict: null };
  }

  async acknowledgeHydrated(
    set: AdventureSet,
    revision: number,
    assetPaths: readonly string[]
  ): Promise<void> {
    const queue = this.#queue(set.id);
    const json = serializeSet(set);
    const hash = await draftContentHash(set);
    const state: CachedDraftState = {
      localId: set.id,
      cloudRevision: revision,
      syncedHash: hash,
      pending: false,
      lastCloudSaveAt: now(),
      assetPaths: [...assetPaths],
      cloudDraft: true
    };
    if (!(await saveSetWithDraftState(set, state, json))) {
      throw new Error('Could not cache the hydrated cloud draft on this device.');
    }
    const generation = ++queue.generation;
    queue.latest = { number: generation, set, json, hash };
    queue.conflict = null;
    this.conflict = null;
    this.#setStatus(set.id, { kind: 'synced', attempt: 0, message: null });
  }

  #recordConflict(
    queue: SetQueue,
    baseRevision: number | null,
    remoteRevision: number | null,
    cached: AdventureSet
  ): OpenCachedDraft {
    const conflict: DraftConflict = { localId: queue.id, baseRevision, remoteRevision };
    queue.conflict = conflict;
    this.conflict = conflict;
    this.#clearTimers(queue);
    this.#setStatus(queue.id, {
      kind: 'conflict',
      attempt: 0,
      message: 'Cloud changed in another browser; automatic saving is paused.'
    });
    return { set: cached, source: 'cache', conflict };
  }

  async softDelete(localId: SetId, expectedRevision: number): Promise<DraftMutationResult> {
    return this.#lifecycle(localId, expectedRevision, 'delete');
  }

  async restore(localId: SetId, expectedRevision: number): Promise<DraftMutationResult> {
    return this.#lifecycle(localId, expectedRevision, 'restore');
  }

  async purge(localId: SetId, expectedRevision: number): Promise<DraftMutationResult> {
    return this.#lifecycle(localId, expectedRevision, 'purge');
  }

  async #lifecycle(
    localId: SetId,
    expectedRevision: number,
    operation: 'delete' | 'restore' | 'purge'
  ): Promise<DraftMutationResult> {
    const queue = this.#queue(localId);
    queue.stopped = true;
    this.#clearTimers(queue);
    await queue.pumping;

    let result: DraftMutationResult;
    try {
      result = await (operation === 'delete'
        ? this.#services.softDeleteDraft(localId, expectedRevision)
        : operation === 'restore'
          ? this.#services.restoreDraft(localId, expectedRevision)
          : this.#services.purgeDraft(localId, expectedRevision));
    } catch (cause) {
      // A failed delete changed nothing, so ordinary saving must resume. A
      // failed restore/purge still refers to a deleted draft and stays paused.
      if (operation === 'delete') {
        queue.stopped = false;
        if (!queue.conflict) this.#schedule(queue, 0);
      }
      throw cause;
    }

    if (result.outcome === 'conflict') {
      queue.conflict = {
        localId,
        baseRevision: expectedRevision,
        remoteRevision: result.revision
      };
      if (this.activeSetId === localId) this.conflict = queue.conflict;
      this.#setStatus(localId, {
        kind: 'conflict',
        attempt: 0,
        message: 'Cloud changed in another browser; the library action was not applied.'
      });
      return result;
    }

    const succeeded =
      operation === 'delete'
        ? result.outcome === 'deleted'
        : operation === 'restore'
          ? result.outcome === 'restored'
          : result.outcome === 'purged' || result.outcome === 'not_found';
    if (!succeeded) {
      if (operation === 'delete') {
        queue.stopped = false;
        this.#schedule(queue, 0);
      }
      return result;
    }

    const state = await readDraftState(localId);
    if (state && result.revision !== null) {
      await writeDraftState({
        ...state,
        cloudRevision: result.revision,
        pending: false,
        lastCloudSaveAt: now(),
        cloudDraft: true
      });
    }

    if (operation === 'restore') {
      queue.stopped = false;
      queue.conflict = null;
    } else if (operation === 'purge') {
      this.forget(localId);
    }
    return result;
  }
}

export const persistenceCoordinator = new PersistenceCoordinator();
