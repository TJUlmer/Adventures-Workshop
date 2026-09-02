import type { IsoDateTime } from '$lib/core/id';
import type { SetId } from '$lib/sets/types';

/** Sync-only state beside the cached document, never inside an exported set. */
export interface CachedDraftState {
  localId: SetId;
  /** Last cloud generation this device acknowledged; `null` before first upload. */
  cloudRevision: number | null;
  /** SHA-256 of the self-contained set content acknowledged at that revision. */
  syncedHash: string | null;
  /** Local cache differs from `syncedHash` and still needs cloud attention. */
  pending: boolean;
  lastCloudSaveAt: IsoDateTime | null;
  /** Confirmed Storage objects; `null` means one legacy reconciliation is needed. */
  assetPaths: string[] | null;
}

export interface DraftConflict {
  localId: SetId;
  baseRevision: number | null;
  remoteRevision: number | null;
}

export type SyncStatusKind =
  | 'local-only'
  | 'synced'
  | 'pending'
  | 'saving'
  | 'offline'
  | 'retrying'
  | 'conflict'
  | 'error';

export interface SyncStatus {
  kind: SyncStatusKind;
  attempt: number;
  message: string | null;
}

export interface OpenCachedDraft {
  set: import('$lib/sets/types').AdventureSet;
  source: 'cache' | 'cloud';
  conflict: DraftConflict | null;
}
