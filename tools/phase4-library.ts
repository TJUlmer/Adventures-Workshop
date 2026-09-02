import { composeDraftLibrary } from '../src/lib/persistence/library';
import type { DraftSummary } from '../src/lib/cloud/drafts';
import type { CachedDraftState } from '../src/lib/persistence/types';
import type { LibraryEntry } from '../src/lib/storage/library';
import type { SetId } from '../src/lib/sets/types';
import { asId, asIsoDateTime } from '../src/lib/core/id';

const status = document.querySelector<HTMLParagraphElement>('#status');
const checks = document.querySelector<HTMLUListElement>('#checks');
if (!status || !checks) throw new Error('Verification page is incomplete.');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function addCheck(message: string): void {
  const item = document.createElement('li');
  item.textContent = message;
  checks.append(item);
}

function local(id: string, name: string, deletedAt?: string): LibraryEntry {
  return {
    id: asId<SetId>(id),
    name,
    subtitle: '',
    updatedAt: asIsoDateTime('2026-09-01T12:00:00.000Z'),
    cardCount: 3,
    characterCount: 1,
    characters: [],
    bytes: 2048,
    blockers: 0,
    gaps: 0,
    issueCount: 0,
    ...(deletedAt ? { deletedAt: asIsoDateTime(deletedAt) } : {})
  };
}

function remote(id: string, name: string, revision = 1, deletedAt: string | null = null): DraftSummary {
  return {
    id: `draft-${id}`,
    localId: id,
    name,
    subtitle: '',
    kind: 'adventure',
    cardCount: 5,
    characterCount: 2,
    characters: [],
    blockers: 0,
    gaps: 1,
    issueCount: 1,
    origin: null,
    documentUpdatedAt: '2026-09-02T12:00:00.000Z',
    schemaVersion: 47,
    revision,
    deletedAt,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-02T12:00:00.000Z'
  };
}

function synced(id: string, revision: number): CachedDraftState {
  return {
    localId: asId<SetId>(id),
    cloudRevision: revision,
    syncedHash: 'hash',
    pending: false,
    lastCloudSaveAt: asIsoDateTime('2026-09-02T12:00:00.000Z'),
    assetPaths: [],
    cloudDraft: true
  };
}

try {
  const localOnly = local('set-local', 'Local only');
  const cached = local('set-cached', 'Old cached name');
  const collision = local('set-collision', 'Local collision');
  const purgedElsewhere = local('set-purged', 'Stale retained cache');
  const retry = local('set-retry', 'First upload needs retry');
  const states = new Map<SetId, CachedDraftState | null>([
    [cached.id, synced(cached.id, 2)],
    [collision.id, null],
    [purgedElsewhere.id, synced(purgedElsewhere.id, 1)],
    [
      retry.id,
      {
        ...synced(retry.id, 1),
        cloudRevision: null,
        syncedHash: null,
        pending: true
      }
    ]
  ]);
  const composed = composeDraftLibrary({
    local: [localOnly, cached, collision, purgedElsewhere, retry],
    states,
    remote: [
      remote('set-cached', 'Cloud wins', 3),
      remote('set-cloud-only', 'Cloud only', 1),
      remote('set-collision', 'Remote collision', 4),
      remote('set-deleted', 'Deleted online', 2, '2026-09-02T13:00:00.000Z')
    ],
    authority: 'cloud',
    ownerId: 'owner',
    error: null
  });

  assert(composed.active.length === 5, 'Active cloud/local composition lost a row.');
  assert(composed.deleted.length === 1, 'Cloud Recently Deleted did not remain separate.');
  assert(
    composed.active.find((entry) => entry.id === cached.id)?.name === 'Cloud wins',
    'A cached local summary overrode the authoritative cloud summary.'
  );
  assert(
    composed.active.find((entry) => entry.id === asId<SetId>('set-cloud-only'))?.cached === false,
    'A cloud-only draft was incorrectly labelled as cached.'
  );
  assert(
    composed.active.find((entry) => entry.id === collision.id)?.availability === 'conflict',
    'A same-id local/cloud collision was not stopped as a conflict.'
  );
  assert(
    composed.active.find((entry) => entry.id === localOnly.id)?.migrationCandidate === true,
    'An untouched local set was not offered for explicit migration.'
  );
  assert(
    !composed.active.some((entry) => entry.id === purgedElsewhere.id),
    'A clean cache resurrected a draft purged in another browser.'
  );
  assert(
    composed.active.find((entry) => entry.id === retry.id)?.migrationCandidate === true,
    'A failed first upload lost its migration retry control.'
  );
  addCheck('Cloud summaries remain authoritative without downloading documents.');
  addCheck('Cloud-only, migration, retry, conflict, purge, and Recently Deleted states stay distinct.');

  const fallback = composeDraftLibrary({
    local: [localOnly, cached],
    states,
    remote: null,
    authority: 'cloud-fallback',
    ownerId: 'owner',
    error: 'offline'
  });
  assert(fallback.error === 'offline', 'The fallback did not preserve its visible error.');
  assert(
    fallback.active.find((entry) => entry.id === cached.id)?.availability === 'online',
    'A last-acknowledged cached draft lost its online state during fallback.'
  );
  assert(
    fallback.active.find((entry) => entry.id === localOnly.id)?.availability === 'local-only',
    'An unmigrated local set was confused with an online cache.'
  );
  addCheck('An unreachable cloud falls back only to labelled device copies.');
  status.textContent = 'PASS — Phase 4 summary composition is stable.';
} catch (cause) {
  status.textContent = `FAIL — ${cause instanceof Error ? cause.message : 'Unknown error'}`;
  throw cause;
}
