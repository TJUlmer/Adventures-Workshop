import { auth } from '../src/lib/cloud/auth.svelte';
import {
  fetchDraftSummary,
  purgeDraft,
  softDeleteDraft,
  type DraftMutationResult
} from '../src/lib/cloud/drafts';
import { CloudError } from '../src/lib/cloud/http';
import { now } from '../src/lib/core/id';
import { serializeSet } from '../src/lib/export/json';
import {
  PersistenceCoordinator,
  draftContentHash,
  persistenceCoordinator
} from '../src/lib/persistence/coordinator.svelte';
import { createEmptySet } from '../src/lib/sets/factory';
import type { AdventureSet, SetId } from '../src/lib/sets/types';
import {
  loadSet,
  purgeSet as purgeLocalSet,
  readDraftState
} from '../src/lib/storage/library';

interface ProbeState {
  localId: SetId;
  revision: number;
  verified: boolean;
}

const STATE_KEY = 'unmatched-labs-phase3-persistence-v1';
const sessionLine = requiredElement('session');
const instruction = requiredElement('instruction');
const statusLine = requiredElement('status');
const actions = requiredElement('actions');
const checks = requiredElement('checks');
let state = loadState();
let busy = false;

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Verifier element is missing: ${id}`);
  return element;
}

function loadState(): ProbeState | null {
  const raw = localStorage.getItem(STATE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProbeState>;
    if (
      typeof parsed.localId === 'string' &&
      typeof parsed.revision === 'number' &&
      typeof parsed.verified === 'boolean'
    ) {
      return parsed as ProbeState;
    }
  } catch {
    // Only this disposable verifier owns the key.
  }
  return null;
}

function saveState(next: ProbeState): void {
  state = next;
  localStorage.setItem(STATE_KEY, JSON.stringify(next));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function addCheck(text: string): void {
  const item = document.createElement('li');
  item.textContent = `PASS — ${text}`;
  checks.append(item);
}

function button(label: string, action: () => Promise<void>): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.disabled = busy;
  element.addEventListener('click', () => void run(action));
  return element;
}

async function run(action: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  statusLine.textContent = 'Running…';
  render();
  try {
    await action();
  } catch (cause) {
    statusLine.textContent = `FAIL — ${cause instanceof Error ? cause.message : 'Unexpected verifier error.'}`;
  } finally {
    busy = false;
    render();
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate: () => boolean, message: string, timeout = 5000): Promise<void> {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > timeout) throw new Error(message);
    await delay(10);
  }
}

function saved(revision: number): DraftMutationResult {
  return {
    outcome: 'saved',
    draftId: `fake-${revision}`,
    revision,
    documentUpdatedAt: now(),
    updatedAt: now(),
    deletedAt: null
  };
}

function createProbeSet(id?: SetId, name = 'Phase 3 persistence probe'): AdventureSet {
  const set = createEmptySet({ name, subtitle: 'Synthetic cache and outbox verification' });
  if (id) set.id = id;
  set.meta.updatedAt = now();
  return set;
}

async function verifyProductionCoordinator(): Promise<void> {
  assert(auth.signedIn && !auth.isAnonymous, 'A permanent Account A session is required.');

  let probe: AdventureSet;
  if (state) {
    probe = (await loadSet(state.localId)) ?? createProbeSet(state.localId);
  } else {
    probe = createProbeSet();
    saveState({ localId: probe.id, revision: 0, verified: false });
  }

  const wrote = await persistenceCoordinator.flush(probe, serializeSet(probe));
  assert(wrote, 'The production coordinator could not write the local cache.');
  const summary = await fetchDraftSummary(probe.id);
  assert(summary, 'The production coordinator did not create the cloud draft.');
  saveState({ localId: probe.id, revision: summary.revision, verified: false });

  const metadata = await readDraftState(probe.id);
  assert(metadata, 'The durable outbox metadata was not written.');
  assert(!metadata.pending, 'The acknowledged production draft remained pending.');
  assert(metadata.cloudRevision === summary.revision, 'The cached revision does not match cloud.');
  assert(
    metadata.syncedHash === (await draftContentHash(probe)),
    'The acknowledged content hash does not match the cached set.'
  );
  addCheck('a real production save committed locally first, then recorded its cloud acknowledgement.');

  const beforeOpenRevision = summary.revision;
  const opened = await persistenceCoordinator.open(probe.id);
  assert(opened?.source === 'cache', 'An unchanged clean draft unnecessarily replaced its cache.');
  await delay(2200);
  const afterOpen = await fetchDraftSummary(probe.id);
  assert(afterOpen?.revision === beforeOpenRevision, 'Opening an unchanged draft echoed a cloud save.');
  saveState({ localId: probe.id, revision: beforeOpenRevision, verified: false });
  addCheck('opening an unchanged remote draft did not echo another cloud revision.');
}

async function verifyGenerationGuard(): Promise<void> {
  let resolveFirst: ((result: DraftMutationResult) => void) | null = null;
  let resolveSecond: ((result: DraftMutationResult) => void) | null = null;
  const calls: Array<{ name: string; expected: number | null }> = [];
  const coordinator = new PersistenceCoordinator({
    hasPermanentSession: () => true,
    isOnline: () => true,
    saveDraft: async (set, expected) => {
      calls.push({ name: set.name, expected });
      return new Promise<DraftMutationResult>((resolve) => {
        if (calls.length === 1) resolveFirst = resolve;
        else resolveSecond = resolve;
      });
    }
  });
  const first = createProbeSet(undefined, 'generation one');
  const firstFlush = coordinator.flush(first, serializeSet(first));
  await waitFor(() => calls.length === 1, 'The first controlled cloud request did not start.');

  const second = { ...first, name: 'generation two', meta: { ...first.meta, updatedAt: now() } };
  assert(await coordinator.save(second, serializeSet(second), 0), 'The newer local generation failed.');
  assert(resolveFirst, 'The first response controller was not installed.');
  resolveFirst(saved(1));
  await waitFor(() => calls.length === 2, 'The newer generation did not follow the old response.');

  const between = await readDraftState(first.id);
  assert(between?.pending, 'The old response falsely marked newer work clean.');
  assert(between.cloudRevision === 1, 'The first acknowledgement revision was not recorded.');
  assert((await loadSet(first.id))?.name === second.name, 'The old response replaced newer local content.');
  assert(calls[1]?.expected === 1, 'The newer request did not use revision 1 as its base.');

  assert(resolveSecond, 'The second response controller was not installed.');
  resolveSecond(saved(2));
  await firstFlush;
  const final = await readDraftState(first.id);
  assert(final?.cloudRevision === 2 && !final.pending, 'The newest generation was not acknowledged.');
  assert(final.syncedHash === (await draftContentHash(second)), 'The wrong generation hash was acknowledged.');
  addCheck('an old cloud response could neither replace nor falsely acknowledge newer local work.');
  coordinator.forget(first.id);
  await purgeLocalSet(first.id);
}

async function verifyOfflineAndRetry(): Promise<void> {
  let isOnline = false;
  let offlineCalls = 0;
  const offline = new PersistenceCoordinator({
    hasPermanentSession: () => true,
    isOnline: () => isOnline,
    saveDraft: async () => {
      offlineCalls += 1;
      return saved(1);
    }
  });
  const offlineSet = createProbeSet(undefined, 'offline outbox');
  assert(await offline.flush(offlineSet), 'The offline local write failed.');
  assert(offline.status.kind === 'offline', 'Offline work was not reported as offline.');
  assert((await readDraftState(offlineSet.id))?.pending, 'Offline work was not durable in the outbox.');
  assert(offlineCalls === 0, 'The coordinator attempted cloud I/O while offline.');
  isOnline = true;
  offline.sessionChanged();
  await waitFor(
    () => offlineCalls === 1 && offline.status.kind === 'synced',
    'The offline outbox did not resume when connectivity returned.'
  );
  assert(!(await readDraftState(offlineSet.id))?.pending, 'Resumed offline work remained pending.');
  addCheck('offline edits stayed durable and resumed automatically when connectivity returned.');
  offline.forget(offlineSet.id);
  await purgeLocalSet(offlineSet.id);

  let retryCalls = 0;
  const retrying = new PersistenceCoordinator({
    hasPermanentSession: () => true,
    isOnline: () => true,
    saveDraft: async () => {
      retryCalls += 1;
      if (retryCalls === 1) throw new CloudError('Synthetic transient failure.', 503);
      return saved(1);
    }
  });
  const retrySet = createProbeSet(undefined, 'retry outbox');
  assert(await retrying.flush(retrySet), 'The retry probe local write failed.');
  assert(retrying.status.kind === 'retrying', 'A retryable HTTP 503 did not enter backoff.');
  assert((await readDraftState(retrySet.id))?.pending, 'Retryable work was not kept pending.');
  await waitFor(
    () => retryCalls === 2 && retrying.status.kind === 'synced',
    'The backoff retry did not deliver the pending generation.',
    4000
  );
  addCheck('a retryable cloud failure kept the outbox pending and succeeded after backoff.');
  retrying.forget(retrySet.id);
  await purgeLocalSet(retrySet.id);
}

async function verifyConflictStop(): Promise<void> {
  let calls = 0;
  const coordinator = new PersistenceCoordinator({
    hasPermanentSession: () => true,
    isOnline: () => true,
    saveDraft: async () => {
      calls += 1;
      return { ...saved(9), outcome: 'conflict' };
    }
  });
  const first = createProbeSet(undefined, 'conflict generation');
  assert(await coordinator.flush(first), 'The conflict probe local write failed.');
  assert(coordinator.status.kind === 'conflict', 'A stale revision did not stop the queue.');
  const second = { ...first, name: 'still local after conflict' };
  assert(await coordinator.save(second, serializeSet(second), 0), 'Local save failed after conflict.');
  await delay(50);
  assert(calls === 1, 'Automatic cloud saving continued after a revision conflict.');
  assert((await readDraftState(first.id))?.pending, 'Conflict work was not preserved as pending.');
  assert((await loadSet(first.id))?.name === second.name, 'Conflict handling lost the local edit.');
  addCheck('a stale-revision conflict stopped cloud autosave while local saving continued.');
  coordinator.forget(first.id);
  await purgeLocalSet(first.id);
}

async function runVerification(): Promise<void> {
  checks.replaceChildren();
  await verifyProductionCoordinator();
  await verifyGenerationGuard();
  await verifyOfflineAndRetry();
  await verifyConflictStop();
  assert(state, 'The production probe state disappeared.');
  saveState({ ...state, verified: true });
  statusLine.textContent =
    'PASS — Phase 3 cache, outbox, generation, retry, offline, and conflict checks passed. Synthetic cloud data awaits confirmed cleanup.';
}

async function cleanup(): Promise<void> {
  assert(auth.signedIn && !auth.isAnonymous, 'The permanent Account A session is required.');
  assert(state, 'No Phase 3 probe is ready for cleanup.');
  const summary = await fetchDraftSummary(state.localId);
  if (summary) {
    const deleted = await softDeleteDraft(state.localId, summary.revision);
    assert(deleted.outcome === 'deleted' && deleted.revision, 'The synthetic draft soft delete failed.');
    const purged = await purgeDraft(state.localId, deleted.revision);
    assert(purged.outcome === 'purged', 'The synthetic draft purge failed.');
  }
  persistenceCoordinator.forget(state.localId);
  await purgeLocalSet(state.localId);
  localStorage.removeItem(STATE_KEY);
  state = null;
  addCheck('the exact synthetic production draft and local cache were deleted.');
  statusLine.textContent = 'PASS — Phase 3 verification and cleanup are complete.';
}

function render(): void {
  sessionLine.textContent = !auth.signedIn
    ? 'Session: signed out'
    : auth.isAnonymous
      ? 'Session: temporary anonymous user'
      : 'Session: permanent account';
  actions.replaceChildren();
  if (!auth.signedIn || auth.isAnonymous) {
    instruction.textContent = 'Sign in with the permanent Account A used for the earlier phases.';
    return;
  }
  if (!state) {
    instruction.textContent = 'Run the production coordinator and deterministic failure/race checks.';
    actions.append(button('Run Phase 3 verification', runVerification));
    return;
  }
  if (!state.verified) {
    instruction.textContent = 'Resume the interrupted Phase 3 verification.';
    actions.append(button('Resume Phase 3 verification', runVerification));
    return;
  }
  instruction.textContent =
    'Checks passed. Cleanup permanently deletes only this synthetic cloud draft and its local cache.';
  actions.append(button('Delete synthetic Phase 3 data', cleanup));
}

auth.restore();
auth.captureRedirect();
void auth.ensureFresh().catch(() => undefined).finally(render);
render();
