import { auth } from '../src/lib/cloud/auth.svelte';
import {
  fetchDraft,
  fetchDraftSummary,
  purgeDraft,
  saveDraft,
  softDeleteDraft,
  type DraftMutationResult
} from '../src/lib/cloud/drafts';
import { listDraftAssetPaths } from '../src/lib/cloud/draft-assets';
import { CloudError } from '../src/lib/cloud/http';
import { createArtwork } from '../src/lib/core/artwork';
import { now } from '../src/lib/core/id';
import { serializeSet } from '../src/lib/export/json';
import { createFigure } from '../src/lib/figures/types';
import { PersistenceCoordinator } from '../src/lib/persistence/coordinator.svelte';
import { createEmptySet } from '../src/lib/sets/factory';
import type { AdventureSet, SetId } from '../src/lib/sets/types';
import {
  purgeSet as purgeLocalSet,
  readDraftState,
  writeDraftState
} from '../src/lib/storage/library';

interface ProbeState {
  localId: SetId;
  revision: number;
  verified: boolean;
}

const STATE_KEY = 'unmatched-labs-phase35-asset-efficiency-v1';
const PNG_A =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=';
const PNG_B =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const OBJ_TEXT = ['# Phase 3.5 probe', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3', ''].join('\n');
const OBJ_URL = `data:model/obj;base64,${btoa(OBJ_TEXT)}`;

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

function fixture(id?: SetId): AdventureSet {
  const set = createEmptySet({
    name: 'Phase 3.5 asset efficiency probe',
    subtitle: 'Synthetic missing-only upload verification'
  });
  if (id) set.id = id;
  set.boxArt = createArtwork({ source: PNG_A, label: 'phase35-a.png' });
  const figure = createFigure('figure', 'Phase 3.5 triangle');
  figure.model = {
    name: 'phase35.obj',
    source: OBJ_URL,
    size: new TextEncoder().encode(OBJ_TEXT).length
  };
  set.figures.push(figure);
  set.meta.updatedAt = now();
  return set;
}

function assertSaved(
  result: DraftMutationResult,
  revision: number,
  uploadedAssets: number
): asserts result is DraftMutationResult & { assetPaths: string[] } {
  assert(
    result.outcome === 'saved' && result.revision === revision,
    `Expected saved revision ${revision}.`
  );
  assert(result.uploadedAssets === uploadedAssets, `Expected ${uploadedAssets} asset uploads.`);
  assert(Array.isArray(result.assetPaths), 'The save did not return its confirmed manifest.');
}

async function runVerification(): Promise<void> {
  assert(auth.signedIn && !auth.isAnonymous, 'A permanent Account A session is required.');
  assert(!state, 'A Phase 3.5 probe already exists. Resume or clean it before starting another.');
  checks.replaceChildren();

  const set = fixture();
  saveState({ localId: set.id, revision: 0, verified: false });
  const transfers: DraftMutationResult[] = [];
  const coordinator = new PersistenceCoordinator({
    saveDraft: async (...arguments_) => {
      const result = await saveDraft(...arguments_);
      transfers.push(result);
      return result;
    }
  });

  assert(await coordinator.flush(set, serializeSet(set)), 'Initial coordinator save failed.');
  const first = transfers[0];
  assert(first, 'Initial transfer was not observed.');
  assertSaved(first, 1, 2);
  assert(first.uploadedBytes && first.uploadedBytes > 0, 'Initial asset byte count was empty.');
  let metadata = await readDraftState(set.id);
  assert(metadata?.assetPaths?.length === 2, 'Initial manifest was not acknowledged in IndexedDB.');
  assert((await listDraftAssetPaths(set.id)).length === 2, 'Initial Storage prefix was incomplete.');
  addCheck('the initial revision uploaded exactly its two unique assets and persisted the manifest.');

  const textEdit = {
    ...set,
    subtitle: 'Text-only edit must upload zero artwork',
    meta: { ...set.meta, updatedAt: now() }
  };
  assert(await coordinator.flush(textEdit, serializeSet(textEdit)), 'Text-only coordinator save failed.');
  const second = transfers[1];
  assert(second, 'Text-only transfer was not observed.');
  assertSaved(second, 2, 0);
  assert(second.uploadedBytes === 0, 'Text-only edit uploaded asset bytes.');
  addCheck('a text-only revision uploaded zero assets and only committed its reference document.');

  const changedArt = structuredClone(textEdit);
  changedArt.boxArt = createArtwork({ source: PNG_B, label: 'phase35-b.png' });
  changedArt.meta.updatedAt = now();
  assert(await coordinator.flush(changedArt, serializeSet(changedArt)), 'Changed-art save failed.');
  const third = transfers[2];
  assert(third, 'Changed-art transfer was not observed.');
  assertSaved(third, 3, 1);
  assert(third.assetPaths.length === 2, 'Changed-art manifest did not retain the unchanged model.');
  assert((await listDraftAssetPaths(set.id)).length === 3, 'Changed art did not create one new hash.');
  addCheck('changing one asset uploaded one new hash and reused the unchanged model.');

  metadata = await readDraftState(set.id);
  assert(metadata, 'Acknowledged metadata disappeared before reconciliation.');
  assert(await writeDraftState({ ...metadata, assetPaths: null }), 'Could not simulate legacy metadata.');
  const reconciled = {
    ...changedArt,
    description: 'Legacy manifest reconciliation',
    meta: { ...changedArt.meta, updatedAt: now() }
  };
  assert(await coordinator.flush(reconciled, serializeSet(reconciled)), 'Reconciled save failed.');
  const fourth = transfers[3];
  assert(fourth, 'Reconciled transfer was not observed.');
  assertSaved(fourth, 4, 0);
  assert((await readDraftState(set.id))?.assetPaths?.length === 2, 'Reconciled manifest was not persisted.');
  addCheck('missing legacy metadata reconciled the private prefix once without re-uploading bytes.');

  const loaded = await fetchDraft(set.id);
  assert(loaded?.summary.revision === 4, 'The reconciled draft could not be hydrated.');
  assert(loaded.assetPaths.length === 2, 'Hydration did not return the remote manifest.');
  assert(loaded.set.boxArt.source === PNG_B, 'Changed artwork did not hydrate byte-for-byte.');
  assert(loaded.set.figures[0]?.model?.source === OBJ_URL, 'Unchanged model did not hydrate byte-for-byte.');
  const freshCoordinator = new PersistenceCoordinator({
    saveDraft: async (...arguments_) => {
      const result = await saveDraft(...arguments_);
      transfers.push(result);
      return result;
    }
  });
  await freshCoordinator.acknowledgeHydrated(
    loaded.set,
    loaded.summary.revision,
    loaded.assetPaths
  );
  const hydratedEdit = {
    ...loaded.set,
    description: 'Clean-browser manifest seeding',
    meta: { ...loaded.set.meta, updatedAt: now() }
  };
  assert(
    await freshCoordinator.flush(hydratedEdit, serializeSet(hydratedEdit)),
    'Hydrated-manifest save failed.'
  );
  const fifth = transfers[4];
  assert(fifth, 'Hydrated-manifest transfer was not observed.');
  assertSaved(fifth, 5, 0);
  addCheck('a clean-browser hydration seeded its manifest and the next text edit uploaded zero assets.');

  saveState({ localId: set.id, revision: 5, verified: true });
  statusLine.textContent =
    'PASS — missing-only upload, changed-asset upload, legacy reconciliation, and hydration seeding passed. Synthetic cloud data awaits confirmed cleanup.';
}

async function resume(): Promise<void> {
  assert(auth.signedIn && !auth.isAnonymous, 'The permanent Account A session is required.');
  assert(state, 'No Phase 3.5 probe is available.');
  const summary = await fetchDraftSummary(state.localId);
  assert(summary, 'The interrupted probe row no longer exists.');
  const loaded = await fetchDraft(state.localId);
  assert(loaded, 'The interrupted probe could not be hydrated.');
  saveState({ localId: state.localId, revision: summary.revision, verified: true });
  addCheck('the interrupted synthetic draft and every referenced object remain recoverable.');
  statusLine.textContent =
    'PASS — the interrupted probe is recoverable. Full transfer counts require a fresh probe after cleanup.';
}

async function verifyRpcRetryManifest(): Promise<void> {
  let attempts = 0;
  let retryKnownPaths: readonly string[] | null | undefined;
  const set = createEmptySet({ name: 'Phase 3.5 local retry probe' });
  const confirmedPath = `synthetic/${set.id}/${'a'.repeat(64)}.png`;
  const coordinator = new PersistenceCoordinator({
    hasPermanentSession: () => true,
    isOnline: () => true,
    saveDraft: async (_set, _revision, options = {}) => {
      attempts += 1;
      if (attempts === 1) {
        await options.onAssetsReady?.([confirmedPath]);
        throw new CloudError('Synthetic document RPC interruption.', 503);
      }
      retryKnownPaths = options.knownAssetPaths;
      await options.onAssetsReady?.([confirmedPath]);
      return {
        outcome: 'saved',
        draftId: 'synthetic-retry',
        revision: 1,
        documentUpdatedAt: now(),
        updatedAt: now(),
        deletedAt: null,
        assetPaths: [confirmedPath],
        uploadedAssets: 0,
        uploadedBytes: 0
      };
    }
  });
  assert(await coordinator.flush(set), 'The retry probe local write failed.');
  assert(coordinator.status.kind === 'retrying', 'The synthetic RPC failure did not enter backoff.');
  assert(
    (await readDraftState(set.id))?.assetPaths?.includes(confirmedPath),
    'Confirmed objects were not persisted before the failed document RPC.'
  );
  await waitFor(
    () => attempts === 2 && coordinator.status.kind === 'synced',
    'The synthetic document RPC retry did not complete.',
    4000
  );
  assert(
    retryKnownPaths?.includes(confirmedPath),
    'The retry did not receive the already-confirmed asset manifest.'
  );
  addCheck('a failed document RPC retained confirmed assets, so its retry required no re-upload.');
  coordinator.forget(set.id);
  await purgeLocalSet(set.id);
  statusLine.textContent = 'PASS — document-RPC retry reused its pre-acknowledged asset manifest.';
}

async function cleanup(): Promise<void> {
  assert(auth.signedIn && !auth.isAnonymous, 'The permanent Account A session is required.');
  assert(state, 'No Phase 3.5 probe is ready for cleanup.');
  const summary = await fetchDraftSummary(state.localId);
  if (summary) {
    const deleted = await softDeleteDraft(state.localId, summary.revision);
    assert(deleted.outcome === 'deleted' && deleted.revision, 'Synthetic soft delete failed.');
    const purged = await purgeDraft(state.localId, deleted.revision);
    assert(purged.outcome === 'purged', 'Synthetic purge failed.');
  } else {
    // `purgeDraft` deliberately accepts not-found retries so a row deletion
    // that outlived its object cleanup remains recoverable.
    const purged = await purgeDraft(state.localId, state.revision);
    assert(purged.outcome === 'not_found', 'Missing-row cleanup returned an unexpected outcome.');
  }
  assert((await listDraftAssetPaths(state.localId)).length === 0, 'The private set prefix is not empty.');
  await purgeLocalSet(state.localId);
  localStorage.removeItem(STATE_KEY);
  state = null;
  addCheck('permanent purge deleted the row, every current/obsolete object, and the local probe.');
  statusLine.textContent = 'PASS — Phase 3.5 verification and cleanup are complete.';
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
    instruction.textContent = 'Run the production missing-only asset upload checks.';
    actions.append(button('Run Phase 3.5 verification', runVerification));
    return;
  }
  if (!state.verified) {
    instruction.textContent = 'Recover the interrupted Phase 3.5 probe before cleanup.';
    actions.append(button('Recover Phase 3.5 probe', resume));
    return;
  }
  instruction.textContent =
    'Checks passed. Cleanup permanently deletes only this synthetic draft, all objects under its exact private prefix, and its local cache.';
  actions.append(button('Run RPC retry manifest check', verifyRpcRetryManifest));
  actions.append(button('Delete synthetic Phase 3.5 data', cleanup));
}

auth.restore();
auth.captureRedirect();
void auth.ensureFresh().catch(() => undefined).finally(render);
render();
