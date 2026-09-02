import { CloudError } from '../src/lib/cloud/http';
import type { DraftMutationResult, DraftTransferOptions } from '../src/lib/cloud/drafts';
import { asId } from '../src/lib/core/id';
import { serializeSet } from '../src/lib/export/json';
import {
  createDiagnosticEvent,
  createDiagnosticsReport,
  type DraftDiagnosticInput
} from '../src/lib/persistence/diagnostics.svelte';
import { PersistenceCoordinator } from '../src/lib/persistence/coordinator.svelte';
import { evaluateDraftRollout } from '../src/lib/persistence/rollout.svelte';
import { createEmptySet } from '../src/lib/sets/factory';
import type { AdventureSet, SetId } from '../src/lib/sets/types';
import { purgeSet, readDraftState, readIndex } from '../src/lib/storage/library';
import {
  clearCloudDraftOptIn,
  readCloudDraftOptIn,
  writeCloudDraftOptIn
} from '../src/lib/storage/settings';

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

function fixture(label: string): AdventureSet {
  return {
    ...createEmptySet({ name: `Phase 6 ${label}`, kind: 'heroes' }),
    id: asId<SetId>(`set_phase6_${label}_${crypto.randomUUID()}`)
  };
}

function saved(set: AdventureSet, revision = 1): DraftMutationResult {
  return {
    outcome: 'saved',
    draftId: `draft-${set.id}`,
    revision,
    documentUpdatedAt: set.meta.updatedAt,
    updatedAt: '2026-09-02T18:00:00.000Z',
    deletedAt: null,
    assetPaths: [],
    uploadedAssets: 1,
    uploadedBytes: 2048
  };
}

async function removeFixtures(ids?: readonly SetId[]): Promise<void> {
  const targets =
    ids ??
    (await readIndex()).map((entry) => entry.id).filter((id) => id.startsWith('set_phase6_'));
  for (const id of targets) await purgeSet(id);
}

const created: SetId[] = [];
const preferenceUser = `phase6-user-${crypto.randomUUID()}`;

try {
  await removeFixtures();

  const baseDecision = {
    configured: true,
    userId: 'permanent-account',
    anonymous: false,
    optedIn: false,
    internalUserIds: [] as string[],
    cohortPercent: 0
  };
  assert(!evaluateDraftRollout({ ...baseDecision, mode: 'off' }), 'The off flag admitted an account.');
  assert(
    !evaluateDraftRollout({ ...baseDecision, mode: 'on', anonymous: true }),
    'An anonymous account entered the draft rollout.'
  );
  assert(
    evaluateDraftRollout({ ...baseDecision, mode: 'opt-in', optedIn: true }),
    'An explicit permanent-account opt-in was not honoured.'
  );
  assert(
    evaluateDraftRollout({
      ...baseDecision,
      mode: 'cohort',
      internalUserIds: ['permanent-account']
    }),
    'An internal account was not admitted to the cohort.'
  );
  assert(
    evaluateDraftRollout({ ...baseDecision, mode: 'cohort', cohortPercent: 100 }) &&
      !evaluateDraftRollout({ ...baseDecision, mode: 'cohort', cohortPercent: 0 }),
    'The stable cohort percentage boundaries are wrong.'
  );
  addCheck('The default-off, opt-in, internal, cohort, and anonymous rollout boundaries hold.');

  assert(
    await writeCloudDraftOptIn(preferenceUser, true),
    'The browser could not persist an account-scoped opt-in.'
  );
  assert(await readCloudDraftOptIn(preferenceUser), 'The account-scoped opt-in did not round-trip.');
  await clearCloudDraftOptIn(preferenceUser);
  assert(!(await readCloudDraftOptIn(preferenceUser)), 'The scoped opt-in cleanup did not hold.');
  addCheck('A preview opt-in is stored per account in IndexedDB and can be removed independently.');

  const disabled = fixture('disabled');
  created.push(disabled.id);
  let disabledCloudCalls = 0;
  const disabledCoordinator = new PersistenceCoordinator({
    hasPermanentSession: () => false,
    isOnline: () => true,
    saveDraft: async () => {
      disabledCloudCalls += 1;
      return saved(disabled);
    }
  });
  await disabledCoordinator.enableCloud(disabled.id);
  assert(await disabledCoordinator.flush(disabled), 'The disabled rollout lost its local save.');
  assert(disabledCloudCalls === 0, 'The disabled rollout sent a cloud write.');
  assert((await readDraftState(disabled.id))?.pending, 'Disabled cloud work was not retained locally.');
  addCheck('Disabling cloud authority stops network writes while retaining the IndexedDB outbox.');

  const measured = fixture('measured');
  created.push(measured.id);
  const inputs: DraftDiagnosticInput[] = [];
  let tick = 0;
  const measuredCoordinator = new PersistenceCoordinator({
    hasPermanentSession: () => true,
    isOnline: () => true,
    monotonicNow: () => (tick += 7),
    recordDiagnostic: (event) => inputs.push(event),
    saveDraft: async (
      set: AdventureSet,
      _expected: number | null,
      options: DraftTransferOptions = {}
    ) => {
      options.onProgress?.({ stage: 'assets', done: 0, total: 1 });
      options.onProgress?.({ stage: 'assets', done: 1, total: 1 });
      await options.onAssetsReady?.([]);
      options.onProgress?.({ stage: 'document', done: 0, total: 1 });
      options.onProgress?.({ stage: 'document', done: 1, total: 1 });
      return saved(set);
    }
  });
  await measuredCoordinator.enableCloud(measured.id);
  assert(await measuredCoordinator.flush(measured), 'The measured save failed.');
  const events = inputs.map((input, index) =>
    createDiagnosticEvent(input, `2026-09-02T18:00:0${index}.000Z`)
  );
  assert(
    ['local-cache', 'assets', 'document', 'acknowledgement'].every((stage) =>
      events.some((entry) => entry.stage === stage && entry.outcome === 'succeeded')
    ),
    'The successful save did not describe every required stage.'
  );
  const documentEvent = events.find((entry) => entry.stage === 'document');
  assert(
    documentEvent?.revision === 1 && documentEvent.retryCount === 0 && documentEvent.byteCount > 0,
    'The document diagnostic omitted revision, retry, or byte metadata.'
  );
  const reportText = JSON.stringify(createDiagnosticsReport(events, 'opt-in', true));
  assert(!reportText.includes(measured.id), 'A real set id escaped into the support report.');
  assert(!reportText.includes(measured.name), 'Set contents escaped into the support report.');
  addCheck('Save diagnostics include stage, duration, bytes, revision, and retry count without set data.');

  const failing = fixture('failing');
  created.push(failing.id);
  const failures: DraftDiagnosticInput[] = [];
  const failingCoordinator = new PersistenceCoordinator({
    hasPermanentSession: () => true,
    isOnline: () => true,
    recordDiagnostic: (event) => failures.push(event),
    saveDraft: async () => {
      throw new CloudError('Synthetic service interruption.', 503);
    }
  });
  await failingCoordinator.enableCloud(failing.id);
  assert(await failingCoordinator.flush(failing), 'The failed cloud attempt lost its local save.');
  assert(
    failures.some(
      (entry) =>
        entry.outcome === 'failed' && entry.statusCode === 503 && entry.retryCount === 0
    ),
    'The failed attempt did not retain its HTTP status and retry count.'
  );
  assert(failingCoordinator.status.kind === 'retrying', 'The retryable failure did not queue retry.');
  failingCoordinator.forget(failing.id);
  addCheck('Retryable failures retain their status code and attempt number while work stays local.');

  const large = fixture('large');
  created.push(large.id);
  large.boxArt.source = `data:image/png;base64,${'A'.repeat(6 * 1024 * 1024)}`;
  large.boxArt.label = 'large-fixture.png';
  const largeEvents: DraftDiagnosticInput[] = [];
  const largeCoordinator = new PersistenceCoordinator({
    hasPermanentSession: () => false,
    isOnline: () => false,
    recordDiagnostic: (event) => largeEvents.push(event)
  });
  await largeCoordinator.enableCloud(large.id);
  assert(await largeCoordinator.flush(large, serializeSet(large)), 'The realistic large local save failed.');
  assert(
    largeEvents.some(
      (entry) => entry.stage === 'local-cache' && entry.byteCount > 6 * 1024 * 1024
    ),
    'The large-document diagnostic did not measure the complete serialised bytes.'
  );
  assert((await readDraftState(large.id)) !== null, 'The large document lost its durable cache state.');
  addCheck('A self-contained document above 6 MB saves locally and reports its measured size.');

  status.textContent = 'PASS — Phase 6 rollout, diagnostics, rollback, and large-document checks passed.';
} catch (cause) {
  status.textContent = `FAIL — ${cause instanceof Error ? cause.message : 'Unknown error'}`;
  throw cause;
} finally {
  await clearCloudDraftOptIn(preferenceUser);
  await removeFixtures(created);
}
