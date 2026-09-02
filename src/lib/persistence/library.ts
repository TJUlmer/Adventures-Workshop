/**
 * Compose Home's lightweight library without hydrating cloud documents.
 *
 * A permanent account's remote summaries are authoritative. IndexedDB rows
 * contribute only cache presence/size and explicit local migration candidates;
 * when the cloud is unreachable they remain a labelled fallback, never a
 * silent claim that the device holds the complete account library.
 */
import { auth } from '$lib/cloud/auth.svelte';
import { listDrafts } from '$lib/cloud/drafts';
import type { DraftSummary } from '$lib/cloud/drafts';
import { asId } from '$lib/core/id';
import type { IsoDateTime } from '$lib/core/id';
import type { CharacterId } from '$lib/characters/types';
import type { SetId } from '$lib/sets/types';
import { readDraftState, readIndex } from '$lib/storage/library';
import type { LibraryEntry } from '$lib/storage/library';
import type {
  CachedDraftState,
  DraftLibraryEntry,
  DraftLibrarySnapshot,
  LibraryAvailability
} from './types';

function byUpdated(a: DraftLibraryEntry, b: DraftLibraryEntry): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

function byDeleted(a: DraftLibraryEntry, b: DraftLibraryEntry): number {
  return (b.deletedAt ?? b.updatedAt).localeCompare(a.deletedAt ?? a.updatedAt);
}

function localAvailability(
  state: CachedDraftState | null,
  context: 'signed-out' | 'fallback' | 'remote-missing'
): LibraryAvailability {
  if (state?.pending) return 'pending';
  if (context === 'signed-out') return 'local-only';
  if (state?.cloudRevision !== null && state?.cloudRevision !== undefined) {
    return context === 'fallback' ? 'online' : 'conflict';
  }
  return 'local-only';
}

function fromLocal(
  entry: LibraryEntry,
  state: CachedDraftState | null,
  context: 'signed-out' | 'fallback' | 'remote-missing'
): DraftLibraryEntry {
  const availability = localAvailability(state, context);
  return {
    id: entry.id,
    name: entry.name,
    subtitle: entry.subtitle,
    kind: null,
    updatedAt: entry.updatedAt,
    cardCount: entry.cardCount,
    characterCount: entry.characterCount,
    characters: entry.characters ?? [],
    ...(entry.blockers === undefined ? {} : { blockers: entry.blockers }),
    ...(entry.gaps === undefined ? {} : { gaps: entry.gaps }),
    ...(entry.issueCount === undefined ? {} : { issueCount: entry.issueCount }),
    ...(entry.originAuthor === undefined ? {} : { originAuthor: entry.originAuthor }),
    ...(entry.originRevision === undefined ? {} : { originRevision: entry.originRevision }),
    ...(entry.originSlug === undefined ? {} : { originSlug: entry.originSlug }),
    ...(entry.deletedAt === undefined ? {} : { deletedAt: entry.deletedAt }),
    bytes: entry.bytes,
    cached: true,
    cloudRevision: state?.cloudRevision ?? null,
    availability,
    migrationCandidate:
      entry.deletedAt === undefined &&
      (availability === 'local-only' ||
        (availability === 'pending' && state?.cloudRevision === null))
  };
}

function remoteAvailability(
  local: LibraryEntry | undefined,
  state: CachedDraftState | null,
  summary: DraftSummary
): LibraryAvailability {
  if (!local) return 'online';
  // A pre-cloud local document colliding with an existing remote id is two
  // independent complete documents. Only Phase 5's conflict choice may pick.
  if (!state || state.cloudRevision === null) return 'conflict';
  if (state.pending && state.cloudRevision !== summary.revision) return 'conflict';
  return state.pending ? 'pending' : 'online';
}

function fromRemote(
  summary: DraftSummary,
  local: LibraryEntry | undefined,
  state: CachedDraftState | null
): DraftLibraryEntry {
  const id = asId<SetId>(summary.localId);
  return {
    id,
    name: summary.name,
    subtitle: summary.subtitle,
    kind: summary.kind,
    updatedAt: summary.documentUpdatedAt as IsoDateTime,
    cardCount: summary.cardCount,
    characterCount: summary.characterCount,
    characters: summary.characters.map((character) => ({
      ...character,
      id: asId<CharacterId>(character.id)
    })),
    blockers: summary.blockers,
    gaps: summary.gaps,
    issueCount: summary.issueCount,
    ...(summary.origin
      ? {
          originAuthor: summary.origin.author,
          originRevision: summary.origin.revision,
          originSlug: summary.origin.slug
        }
      : {}),
    ...(summary.deletedAt ? { deletedAt: summary.deletedAt as IsoDateTime } : {}),
    bytes: local?.bytes ?? null,
    cached: local !== undefined,
    cloudRevision: summary.revision,
    availability: remoteAvailability(local, state, summary),
    migrationCandidate: false
  };
}

async function localRows(): Promise<{
  entries: LibraryEntry[];
  states: Map<SetId, CachedDraftState | null>;
}> {
  const entries = await readIndex();
  const states = new Map<SetId, CachedDraftState | null>();
  await Promise.all(
    entries.map(async (entry) => states.set(entry.id, await readDraftState(entry.id)))
  );
  return { entries, states };
}

function split(entries: DraftLibraryEntry[]): Pick<DraftLibrarySnapshot, 'active' | 'deleted'> {
  return {
    active: entries.filter((entry) => entry.deletedAt === undefined).sort(byUpdated),
    deleted: entries.filter((entry) => entry.deletedAt !== undefined).sort(byDeleted)
  };
}

export interface ComposeDraftLibraryOptions {
  local: LibraryEntry[];
  states: Map<SetId, CachedDraftState | null>;
  remote: DraftSummary[] | null;
  authority: DraftLibrarySnapshot['authority'];
  ownerId: string | null;
  error?: string | null;
}

/** Pure summary composition, exported so the no-document Home contract can be probed directly. */
export function composeDraftLibrary(options: ComposeDraftLibraryOptions): DraftLibrarySnapshot {
  const { local, states, remote, authority, ownerId, error = null } = options;
  if (remote === null) {
    const context = authority === 'local' ? 'signed-out' : 'fallback';
    return {
      ...split(local.map((entry) => fromLocal(entry, states.get(entry.id) ?? null, context))),
      authority,
      ownerId,
      error
    };
  }

  const localById = new Map(local.map((entry) => [entry.id, entry]));
  const remoteIds = new Set<SetId>();
  const combined: DraftLibraryEntry[] = remote.map((summary) => {
    const id = asId<SetId>(summary.localId);
    remoteIds.add(id);
    return fromRemote(summary, localById.get(id), states.get(id) ?? null);
  });

  for (const entry of local) {
    if (remoteIds.has(entry.id)) continue;
    const state = states.get(entry.id) ?? null;
    // A clean, previously acknowledged cache whose row is absent from a
    // successful cloud listing was purged elsewhere. Keep its bytes in
    // IndexedDB during rollout, but do not resurrect it on the authoritative
    // shelf. Pending work remains visible because it needs conflict handling.
    if (typeof state?.cloudRevision === 'number' && !state.pending) continue;
    combined.push(fromLocal(entry, state, 'remote-missing'));
  }

  return { ...split(combined), authority, ownerId, error };
}

/** Load summary-only Home data, retaining an honest cache fallback on failure. */
export async function loadDraftLibrary(): Promise<DraftLibrarySnapshot> {
  const { entries: local, states } = await localRows();
  const permanent = auth.signedIn && !auth.isAnonymous;
  if (!permanent) {
    return composeDraftLibrary({
      local,
      states,
      remote: null,
      authority: 'local',
      ownerId: null,
      error: null
    });
  }

  const ownerId = auth.user?.id ?? null;
  try {
    const remote = await listDrafts('all');
    return composeDraftLibrary({
      local,
      states,
      remote,
      authority: 'cloud',
      ownerId,
      error: null
    });
  } catch (cause) {
    return composeDraftLibrary({
      local,
      states,
      remote: null,
      authority: 'cloud-fallback',
      ownerId,
      error:
        cause instanceof Error
          ? cause.message
          : 'Could not load the online library; showing copies on this device.'
    });
  }
}
