import { auth } from '../src/lib/cloud/auth.svelte';
import {
  fetchDraftSummary,
  listDrafts,
  purgeDraft,
  softDeleteDraft
} from '../src/lib/cloud/drafts';
import { asId, now } from '../src/lib/core/id';
import { serializeSet } from '../src/lib/export/json';
import { PersistenceCoordinator } from '../src/lib/persistence/coordinator.svelte';
import type { DraftDiagnosticInput } from '../src/lib/persistence/diagnostics.svelte';
import { draftRollout } from '../src/lib/persistence/rollout.svelte';
import type { CachedDraftState } from '../src/lib/persistence/types';
import { createEmptySet } from '../src/lib/sets/factory';
import type { AdventureSet, SetId } from '../src/lib/sets/types';
import { purgeSet, readDraftState, writeDraftState } from '../src/lib/storage/library';

const TARGET_SAVES = 200;
const TARGET_CONFLICTS = 20;
const TOTAL_OPERATIONS = TARGET_SAVES + TARGET_CONFLICTS;
const SYNTHETIC_PREFIX = 'set_phase6_pilot_';
const STATE_KEY = 'unmatched-labs-phase6-pilot-soak-v1';

type RunStage = 'idle' | 'saving' | 'conflicts' | 'cleanup' | 'complete' | 'failed';

interface SoakReport {
  format: 'unmatched-labs-cloud-pilot-soak';
  version: 1;
  generatedAt: string;
  requestedSaves: number;
  successfulSaves: number;
  requestedConflicts: number;
  stoppedConflicts: number;
  successRate: number;
  referenceSaveP95Ms: number;
  referenceSaveMaxMs: number;
  finalRevision: number;
  elapsedMs: number;
  syntheticDataRemoved: true;
}

interface RunState {
  stage: RunStage;
  localId: string | null;
  revision: number | null;
  successfulSaves: number;
  stoppedConflicts: number;
  durationsMs: number[];
  startedAt: string | null;
  report: SoakReport | null;
}

const sessionLine = requiredElement<HTMLParagraphElement>('session');
const instruction = requiredElement<HTMLParagraphElement>('instruction');
const status = requiredElement<HTMLParagraphElement>('status');
const progress = requiredElement<HTMLProgressElement>('progress');
const counts = requiredElement<HTMLParagraphElement>('counts');
const results = requiredElement<HTMLDListElement>('results');
const actions = requiredElement<HTMLDivElement>('actions');

let state = loadState();
let busy = false;

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Verifier element is missing: ${id}`);
  return element as T;
}

function blankState(): RunState {
  return {
    stage: 'idle',
    localId: null,
    revision: null,
    successfulSaves: 0,
    stoppedConflicts: 0,
    durationsMs: [],
    startedAt: null,
    report: null
  };
}

function loadState(): RunState {
  const raw = sessionStorage.getItem(STATE_KEY);
  if (!raw) return blankState();
  try {
    const parsed = JSON.parse(raw) as Partial<RunState>;
    if (
      typeof parsed.stage === 'string' &&
      (parsed.localId === null || typeof parsed.localId === 'string') &&
      Array.isArray(parsed.durationsMs)
    ) {
      return { ...blankState(), ...parsed } as RunState;
    }
  } catch {
    // Only disposable verifier progress uses this key.
  }
  return blankState();
}

function saveState(): void {
  sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function button(label: string, action: () => Promise<void> | void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.disabled = busy;
  element.addEventListener('click', () => void run(action));
  return element;
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return Math.round(sorted[index] ?? 0);
}

function elapsedSince(iso: string): number {
  return Math.max(0, Date.now() - new Date(iso).getTime());
}

function fixture(localId: string): AdventureSet {
  return {
    ...createEmptySet({ name: 'Phase 6 pilot soak — synthetic', kind: 'heroes' }),
    id: asId<SetId>(localId),
    subtitle: 'Automated preview verification; safe to delete'
  };
}

function updateProgress(): void {
  progress.value = state.successfulSaves + state.stoppedConflicts;
  counts.textContent = `${state.successfulSaves} of ${TARGET_SAVES} saves; ${state.stoppedConflicts} of ${TARGET_CONFLICTS} conflicts.`;
}

function showReport(report: SoakReport): void {
  results.replaceChildren();
  const rows: Array<[string, string]> = [
    ['Ordinary cloud saves', `${report.successfulSaves} / ${report.requestedSaves}`],
    ['Stopped stale conflicts', `${report.stoppedConflicts} / ${report.requestedConflicts}`],
    ['Save success rate', `${report.successRate.toFixed(1)}%`],
    ['Reference-save p95', `${report.referenceSaveP95Ms} ms`],
    ['Slowest reference save', `${report.referenceSaveMaxMs} ms`],
    ['Final accepted revision', String(report.finalRevision)],
    ['Elapsed time', `${Math.round(report.elapsedMs / 1000)} seconds`],
    ['Synthetic cleanup', report.syntheticDataRemoved ? 'Complete' : 'Incomplete']
  ];
  for (const [label, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    results.append(term, description);
  }
}

function render(): void {
  sessionLine.textContent = !auth.signedIn
    ? 'Session: signed out'
    : auth.isAnonymous
      ? 'Session: temporary anonymous user'
      : `Session: permanent account; cloud drafts ${draftRollout.enabled ? 'enabled' : 'not enabled'}`;
  updateProgress();
  if (state.report) showReport(state.report);

  actions.replaceChildren();
  if (busy) return;

  if (!auth.signedIn) {
    instruction.textContent = 'Sign in with the permanent account being used for the pilot.';
    actions.append(
      button('Continue with Google', () => auth.signInWithProvider('google')),
      button('Continue with Discord', () => auth.signInWithProvider('discord'))
    );
    return;
  }
  if (auth.isAnonymous) {
    instruction.textContent = 'A permanent account is required.';
    actions.append(button('Sign out temporary user', signOut));
    return;
  }
  if (!draftRollout.enabled) {
    instruction.textContent = 'Enable private cloud drafts for this account before running the soak test.';
    if (draftRollout.canOptIn) actions.append(button('Enable cloud drafts for this browser', enableCloudDrafts));
    return;
  }
  if (state.localId && state.stage !== 'complete') {
    instruction.textContent = 'A previous run stopped before cleanup. Remove only its synthetic data before retrying.';
    actions.append(button('Clean up interrupted soak data', cleanUpAndReset));
    return;
  }

  instruction.textContent =
    'Run this while online. It normally takes a few minutes and must remain open through cleanup.';
  actions.append(
    button('Run 200-save and 20-conflict soak test', startSoak),
    button('Find and remove previous synthetic soak data', cleanUpAndReset)
  );
  if (state.report) actions.append(button('Download result', downloadReport));
}

async function run(action: () => Promise<void> | void): Promise<void> {
  if (busy) return;
  busy = true;
  render();
  try {
    await action();
  } catch (cause) {
    state.stage = 'failed';
    saveState();
    status.textContent = `FAIL — ${cause instanceof Error ? cause.message : 'Unexpected verifier error.'}`;
  } finally {
    busy = false;
    render();
  }
}

async function signOut(): Promise<void> {
  await auth.signOut();
  await draftRollout.refresh();
  status.textContent = 'Signed out locally.';
}

async function enableCloudDrafts(): Promise<void> {
  assert(await draftRollout.setOptedIn(true), 'This browser could not remember the cloud-draft opt-in.');
  status.textContent = 'Cloud drafts enabled for this account in this browser.';
}

async function removeRemote(localId: string): Promise<void> {
  const summary = await fetchDraftSummary(localId);
  if (!summary) return;

  let revision = summary.revision;
  if (!summary.deletedAt) {
    const deleted = await softDeleteDraft(localId, revision);
    assert(
      deleted.outcome === 'deleted' && deleted.revision !== null,
      `Synthetic soft delete returned ${deleted.outcome}.`
    );
    revision = deleted.revision;
  }
  const purged = await purgeDraft(localId, revision);
  assert(
    purged.outcome === 'purged' || purged.outcome === 'not_found',
    `Synthetic purge returned ${purged.outcome}.`
  );
}

async function syntheticRemoteIds(): Promise<string[]> {
  const rows = await listDrafts('all');
  return rows
    .map((row) => row.localId)
    .filter((localId) => localId.startsWith(SYNTHETIC_PREFIX));
}

async function cleanUpAndReset(): Promise<void> {
  assert(auth.signedIn && !auth.isAnonymous, 'Sign in with the account that ran the soak test.');
  assert(draftRollout.enabled, 'Cloud drafts must be enabled to inspect and remove synthetic data.');
  status.textContent = 'Finding synthetic soak data…';

  const ids = new Set(await syntheticRemoteIds());
  if (state.localId) ids.add(state.localId);
  for (const localId of ids) {
    await removeRemote(localId);
    await purgeSet(asId<SetId>(localId));
  }
  state = blankState();
  saveState();
  results.innerHTML = '<dt>Status</dt><dd>Not run yet.</dd>';
  status.textContent = `Cleanup complete — removed ${ids.size} synthetic soak ${ids.size === 1 ? 'draft' : 'drafts'}.`;
}

function cloudState(
  localId: SetId,
  revision: number | null,
  pending: boolean
): CachedDraftState {
  return {
    localId,
    cloudRevision: revision,
    syncedHash: null,
    pending,
    lastCloudSaveAt: null,
    assetPaths: [],
    cloudDraft: true
  };
}

async function assertStoppedConflict(set: AdventureSet, remoteRevision: number): Promise<void> {
  const staleRevision = remoteRevision - 1;
  assert(
    await writeDraftState(cloudState(set.id, staleRevision, true)),
    'Could not prepare the synthetic stale cache.'
  );

  const diagnostics: DraftDiagnosticInput[] = [];
  const coordinator = new PersistenceCoordinator({
    hasPermanentSession: () => auth.signedIn && !auth.isAnonymous && draftRollout.enabled,
    isOnline: () => navigator.onLine,
    recordDiagnostic: (event) => diagnostics.push(event)
  });
  const wrote = await coordinator.flush(set, serializeSet(set));
  assert(wrote, 'The stale generation did not reach its local safety copy.');
  assert(
    coordinator.status.kind === 'conflict' && coordinator.conflict?.remoteRevision === remoteRevision,
    'The stale save did not stop in the conflict state.'
  );
  assert(
    diagnostics.some((event) => event.stage === 'document' && event.outcome === 'conflict'),
    'The stopped conflict was not recorded in diagnostics.'
  );
  coordinator.forget(set.id);
}

async function startSoak(): Promise<void> {
  assert(auth.signedIn && !auth.isAnonymous, 'A permanent account is required.');
  assert(draftRollout.enabled, 'Private cloud drafts are not enabled for this account.');
  assert(navigator.onLine, 'This browser is offline. Reconnect before starting.');
  assert((await syntheticRemoteIds()).length === 0, 'Previous synthetic soak data exists. Run cleanup first.');

  state = blankState();
  state.stage = 'saving';
  state.localId = `${SYNTHETIC_PREFIX}${crypto.randomUUID()}`;
  state.startedAt = new Date().toISOString();
  saveState();
  const set = fixture(state.localId);
  assert(
    await writeDraftState(cloudState(set.id, null, false)),
    'Could not prepare the synthetic cloud-enabled cache.'
  );
  const acceptedDiagnostics: DraftDiagnosticInput[] = [];
  const acceptedCoordinator = new PersistenceCoordinator({
    hasPermanentSession: () => auth.signedIn && !auth.isAnonymous && draftRollout.enabled,
    isOnline: () => navigator.onLine,
    recordDiagnostic: (event) => acceptedDiagnostics.push(event)
  });

  try {
    for (let revision = 1; revision <= TARGET_SAVES; revision += 1) {
      assert(navigator.onLine, `Browser went offline before save ${revision}.`);
      set.subtitle = `Synthetic accepted revision ${revision} of ${TARGET_SAVES}`;
      set.meta.updatedAt = now();
      status.textContent = `Saving accepted revision ${revision} of ${TARGET_SAVES}…`;
      acceptedDiagnostics.length = 0;
      const started = performance.now();
      const wrote = await acceptedCoordinator.flush(set, serializeSet(set));
      state.durationsMs.push(performance.now() - started);
      const cached = await readDraftState(set.id);
      assert(wrote, `Save ${revision} did not reach its local safety copy.`);
      assert(
        acceptedCoordinator.status.kind === 'synced' &&
          cached?.cloudRevision === revision &&
          cached.pending === false,
        `Save ${revision} did not receive a complete cloud acknowledgement.`
      );
      assert(
        acceptedDiagnostics.some(
          (event) =>
            event.stage === 'document' &&
            event.outcome === 'succeeded' &&
            event.revision === revision
        ),
        `Save ${revision} did not record a successful document stage.`
      );
      state.revision = revision;
      state.successfulSaves = revision;
      saveState();
      updateProgress();
    }
  } finally {
    acceptedCoordinator.forget(set.id);
  }

  const acceptedSubtitle = set.subtitle;
  const accepted = await fetchDraftSummary(set.id);
  assert(
    accepted?.revision === TARGET_SAVES && accepted.subtitle === acceptedSubtitle,
    'The server did not retain the final accepted revision before conflict testing.'
  );

  state.stage = 'conflicts';
  saveState();
  for (let attempt = 1; attempt <= TARGET_CONFLICTS; attempt += 1) {
    assert(navigator.onLine, `Browser went offline before conflict ${attempt}.`);
    set.subtitle = `Synthetic stale conflict ${attempt}; this must never be accepted`;
    set.meta.updatedAt = now();
    status.textContent = `Testing stopped conflict ${attempt} of ${TARGET_CONFLICTS}…`;
    await assertStoppedConflict(set, TARGET_SAVES);
    state.stoppedConflicts = attempt;
    saveState();
    updateProgress();
  }

  const afterConflicts = await fetchDraftSummary(set.id);
  assert(
    afterConflicts?.revision === TARGET_SAVES && afterConflicts.subtitle === acceptedSubtitle,
    'A stale conflict changed the accepted server document.'
  );

  state.stage = 'cleanup';
  saveState();
  status.textContent = 'Verifying and removing the synthetic draft…';
  await removeRemote(set.id);
  await purgeSet(set.id);
  assert((await fetchDraftSummary(set.id)) === null, 'The synthetic cloud row remained after cleanup.');

  const startedAt = state.startedAt;
  assert(startedAt, 'The verifier lost its start time.');
  const report: SoakReport = {
    format: 'unmatched-labs-cloud-pilot-soak',
    version: 1,
    generatedAt: new Date().toISOString(),
    requestedSaves: TARGET_SAVES,
    successfulSaves: state.successfulSaves,
    requestedConflicts: TARGET_CONFLICTS,
    stoppedConflicts: state.stoppedConflicts,
    successRate: (state.successfulSaves / TARGET_SAVES) * 100,
    referenceSaveP95Ms: percentile95(state.durationsMs),
    referenceSaveMaxMs: Math.round(Math.max(...state.durationsMs)),
    finalRevision: TARGET_SAVES,
    elapsedMs: elapsedSince(startedAt),
    syntheticDataRemoved: true
  };
  state = { ...state, stage: 'complete', localId: null, report };
  saveState();
  showReport(report);
  status.textContent = 'PASS — 200 saves and 20 stopped conflicts passed; synthetic data was removed.';
}

function downloadReport(): void {
  const report = state.report;
  assert(report, 'No completed result is available.');
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `unmatched-labs-cloud-pilot-soak-${report.generatedAt.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

auth.restore();
auth.captureRedirect();
void auth
  .ensureFresh()
  .then(() => draftRollout.refresh())
  .catch((cause: unknown) => {
    status.textContent = `Could not prepare the verifier: ${cause instanceof Error ? cause.message : 'Unknown error'}`;
  })
  .finally(render);
render();
