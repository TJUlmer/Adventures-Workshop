import type { IsoDateTime } from '$lib/core/id';
import type { CharacterId, CharacterRole } from '$lib/characters/types';
import type { SetId, SetKind } from '$lib/sets/types';

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
  /** Explicit opt-in: old local libraries must not upload before migration consent. */
  cloudDraft: boolean;
}

export type LibraryAvailability = 'online' | 'local-only' | 'pending' | 'conflict';

export interface DraftLibraryCharacter {
  id: CharacterId;
  name: string;
  role: CharacterRole;
}

/** One Home row, regardless of whether its authority is cloud, cache, or local-only. */
export interface DraftLibraryEntry {
  id: SetId;
  name: string;
  subtitle: string;
  kind: SetKind | null;
  updatedAt: IsoDateTime;
  cardCount: number;
  characterCount: number;
  characters: DraftLibraryCharacter[];
  blockers?: number;
  gaps?: number;
  issueCount?: number;
  originAuthor?: string;
  originRevision?: number;
  originSlug?: string;
  deletedAt?: IsoDateTime;
  /** Self-contained cache bytes; absent for a cloud draft not opened on this device. */
  bytes: number | null;
  cached: boolean;
  cloudRevision: number | null;
  availability: LibraryAvailability;
  /** Existing local set eligible for the explicit copy-first migration flow. */
  migrationCandidate: boolean;
}

export type LibraryAuthority = 'local' | 'cloud' | 'cloud-fallback';

export interface DraftLibrarySnapshot {
  active: DraftLibraryEntry[];
  deleted: DraftLibraryEntry[];
  authority: LibraryAuthority;
  ownerId: string | null;
  error: string | null;
}

export type MigrationItemKind = 'idle' | 'uploading' | 'saved' | 'conflict' | 'error';

export interface MigrationItemStatus {
  kind: MigrationItemKind;
  message: string | null;
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
