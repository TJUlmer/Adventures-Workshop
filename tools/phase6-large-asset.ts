import { auth } from '../src/lib/cloud/auth.svelte';
import { deleteDraftAssets } from '../src/lib/cloud/draft-assets';
import {
  fetchDraft,
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

const SAMPLE_COUNT = 5;
const ASSET_BYTES = 9_500_000;
const SAVE_P95_LIMIT_MS = 15_000;
const SYNTHETIC_PREFIX = 'set_phase6_asset_';
const STATE_KEY = 'unmatched-labs-phase6-large-asset-v1';

type RunStage = 'idle' | 'running' | 'cleanup' | 'complete' | 'failed';

interface LargeAssetReport {
  format: 'unmatched-labs-cloud-large-asset';
  version: 1;
  generatedAt: string;
  requestedSamples: number;
  verifiedSamples: number;
  rawAssetBytesPerSample: number;
  totalUploadedBytes: number;
  saveP95Ms: number;
  saveMaxMs: number;
  hydrationP95Ms: number;
  hydrationMaxMs: number;
  saveP95LimitMs: number;
  elapsedMs: number;
  syntheticDataRemoved: true;
  passed: boolean;
}

interface RunState {
  stage: RunStage;
  localIds: string[];
  verifiedSamples: number;
  saveDurationsMs: number[];
  hydrationDurationsMs: number[];
  totalUploadedBytes: number;
  startedAt: string | null;
  report: LargeAssetReport | null;
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
    localIds: [],
    verifiedSamples: 0,
    saveDurationsMs: [],
    hydrationDurationsMs: [],
    totalUploadedBytes: 0,
    startedAt: null,
    report: null
  };
}

function loadState(): RunState {
  const raw = localStorage.getItem(STATE_KEY);
  if (!raw) return blankState();
  try {
    const parsed = JSON.parse(raw) as Partial<RunState>;
    if (
      typeof parsed.stage === 'string' &&
      Array.isArray(parsed.localIds) &&
      parsed.localIds.every((id) => typeof id === 'string') &&
      Array.isArray(parsed.saveDurationsMs) &&
      Array.isArray(parsed.hydrationDurationsMs)
    ) {
      return { ...blankState(), ...parsed } as RunState;
    }
  } catch {
    // Only disposable verifier progress uses this key.
  }
  return blankState();
}

function saveState(): void {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** A valid SVG whose comment carries incompressible test bytes without affecting rendering. */
function syntheticSvgDataUrl(seed: number): string {
  const prefix = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><!--'
  );
  const suffix = new TextEncoder().encode('--><rect width="1" height="1" fill="#000"/></svg>');
  const bytes = new Uint8Array(ASSET_BYTES);
  bytes.set(prefix, 0);
  let value = seed >>> 0;
  for (let index = prefix.length; index < ASSET_BYTES - suffix.length; index += 1) {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    bytes[index] = 65 + (value % 26);
  }
  bytes.set(suffix, ASSET_BYTES - suffix.length);
  return `data:image/svg+xml;base64,${bytesToBase64(bytes)}`;
}

function fixture(localId: string, sample: number, source: string): AdventureSet {
  const set: AdventureSet = {
    ...createEmptySet({ name: 'Phase 6 large asset — synthetic', kind: 'heroes' }),
    id: asId<SetId>(localId),
    subtitle: `Automated 9.5 MB sample ${sample} of ${SAMPLE_COUNT}`
  };
  set.boxArt.source = source;
  set.boxArt.label = `synthetic-large-asset-${sample}.svg`;
  set.meta.updatedAt = now();
  return set;
}

function initialCloudState(localId: SetId): CachedDraftState {
  return {
    localId,
    cloudRevision: null,
    syncedHash: null,
    pending: false,
    lastCloudSaveAt: null,
    assetPaths: [],
    cloudDraft: true
  };
}

function updateProgress(): void {
  progress.value = state.verifiedSamples;
  counts.textContent = `${state.verifiedSamples} of ${SAMPLE_COUNT} samples verified and removed.`;
}

function showReport(report: LargeAssetReport): void {
  results.replaceChildren();
  const rows: Array<[string, string]> = [
    ['Verified samples', `${report.verifiedSamples} / ${report.requestedSamples}`],
    ['Raw asset per sample', `${(report.rawAssetBytesPerSample / 1_000_000).toFixed(1)} MB`],
    ['Total uploaded', `${(report.totalUploadedBytes / 1_000_000).toFixed(1)} MB`],
    ['Save p95', `${report.saveP95Ms} ms`],
    ['Slowest save', `${report.saveMaxMs} ms`],
    ['Hydration p95', `${report.hydrationP95Ms} ms`],
    ['Slowest hydration', `${report.hydrationMaxMs} ms`],
    ['Required save p95', `≤ ${report.saveP95LimitMs} ms`],
    ['Elapsed time', `${Math.round(report.elapsedMs / 1000)} seconds`],
    ['Synthetic cleanup', report.syntheticDataRemoved ? 'Complete' : 'Incomplete'],
    ['Result', report.passed ? 'PASS' : 'FAIL']
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
    instruction.textContent = 'Enable private cloud drafts for this account before running the test.';
    if (draftRollout.canOptIn) actions.append(button('Enable cloud drafts for this browser', enableCloudDrafts));
    return;
  }
  if (state.localIds.length > 0 && state.stage !== 'complete') {
    instruction.textContent = 'A previous sample stopped before cleanup. Remove only its synthetic data first.';
    actions.append(button('Clean up interrupted large-asset data', cleanUpAndReset));
    return;
  }

  instruction.textContent =
    'Run this on an ordinary connection with no request blocking. The transfer is about 95 MB.';
  actions.append(
    button('Run five 9.5 MB asset samples', startLargeAssetRun),
    button('Find and remove previous synthetic asset data', cleanUpAndReset)
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

async function removeSynthetic(localId: string): Promise<void> {
  const summary = await fetchDraftSummary(localId);
  if (summary) {
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
  // Covers an interrupted upload that never reached the document RPC.
  await deleteDraftAssets(localId);
  await purgeSet(asId<SetId>(localId));
}

async function syntheticRemoteIds(): Promise<string[]> {
  return (await listDrafts('all'))
    .map((row) => row.localId)
    .filter((localId) => localId.startsWith(SYNTHETIC_PREFIX));
}

async function cleanUpAndReset(): Promise<void> {
  assert(auth.signedIn && !auth.isAnonymous, 'Sign in with the account that ran the asset test.');
  assert(draftRollout.enabled, 'Cloud drafts must be enabled to inspect and remove synthetic data.');
  status.textContent = 'Finding synthetic large-asset data…';
  const ids = new Set([...state.localIds, ...(await syntheticRemoteIds())]);
  for (const localId of ids) await removeSynthetic(localId);
  state = blankState();
  saveState();
  results.innerHTML = '<dt>Status</dt><dd>Not run yet.</dd>';
  status.textContent = `Cleanup complete — removed ${ids.size} synthetic ${ids.size === 1 ? 'sample' : 'samples'}.`;
}

async function runSample(sample: number): Promise<void> {
  const localId = `${SYNTHETIC_PREFIX}${crypto.randomUUID()}`;
  state.localIds.push(localId);
  saveState();
  status.textContent = `Generating 9.5 MB artwork for sample ${sample} of ${SAMPLE_COUNT}…`;
  const source = syntheticSvgDataUrl(sample * 104_729 + Date.now());
  const set = fixture(localId, sample, source);
  assert(await writeDraftState(initialCloudState(set.id)), 'Could not prepare the synthetic local cache.');

  const diagnostics: DraftDiagnosticInput[] = [];
  const coordinator = new PersistenceCoordinator({
    hasPermanentSession: () => auth.signedIn && !auth.isAnonymous && draftRollout.enabled,
    isOnline: () => navigator.onLine,
    recordDiagnostic: (event) => diagnostics.push(event)
  });
  status.textContent = `Uploading and saving sample ${sample} of ${SAMPLE_COUNT}…`;
  const saveStarted = performance.now();
  try {
    const wrote = await coordinator.flush(set, serializeSet(set));
    state.saveDurationsMs.push(performance.now() - saveStarted);
    const cached = await readDraftState(set.id);
    const assetEvent = diagnostics.find(
      (event) => event.stage === 'assets' && event.outcome === 'succeeded'
    );
    assert(wrote, `Sample ${sample} did not reach its local safety copy.`);
    assert(
      coordinator.status.kind === 'synced' && cached?.cloudRevision === 1 && !cached.pending,
      `Sample ${sample} did not receive a complete cloud acknowledgement.`
    );
    assert(
      assetEvent && assetEvent.byteCount === ASSET_BYTES,
      `Sample ${sample} reported ${assetEvent?.byteCount ?? 0} uploaded bytes instead of ${ASSET_BYTES}.`
    );
    state.totalUploadedBytes += assetEvent.byteCount;
  } finally {
    coordinator.forget(set.id);
  }

  status.textContent = `Downloading and hash-verifying sample ${sample} of ${SAMPLE_COUNT}…`;
  const hydrationStarted = performance.now();
  const hydrated = await fetchDraft(set.id);
  state.hydrationDurationsMs.push(performance.now() - hydrationStarted);
  assert(hydrated?.summary.revision === 1, `Sample ${sample} did not hydrate revision 1.`);
  assert(hydrated.assetPaths.length === 1, `Sample ${sample} did not retain exactly one private asset.`);
  assert(hydrated.set.boxArt.source === source, `Sample ${sample} did not hydrate the exact original bytes.`);

  state.stage = 'cleanup';
  saveState();
  status.textContent = `Removing sample ${sample} of ${SAMPLE_COUNT}…`;
  await removeSynthetic(localId);
  assert((await fetchDraftSummary(localId)) === null, `Sample ${sample} cloud row remained after cleanup.`);
  state.localIds = state.localIds.filter((id) => id !== localId);
  state.verifiedSamples = sample;
  state.stage = 'running';
  saveState();
  updateProgress();
}

async function startLargeAssetRun(): Promise<void> {
  assert(auth.signedIn && !auth.isAnonymous, 'A permanent account is required.');
  assert(draftRollout.enabled, 'Private cloud drafts are not enabled for this account.');
  assert(navigator.onLine, 'This browser is offline. Reconnect before starting.');
  assert((await syntheticRemoteIds()).length === 0, 'Previous synthetic asset data exists. Run cleanup first.');

  state = blankState();
  state.stage = 'running';
  state.startedAt = new Date().toISOString();
  saveState();
  for (let sample = 1; sample <= SAMPLE_COUNT; sample += 1) {
    assert(navigator.onLine, `Browser went offline before sample ${sample}.`);
    await runSample(sample);
  }

  const startedAt = state.startedAt;
  assert(startedAt, 'The verifier lost its start time.');
  const saveP95Ms = percentile95(state.saveDurationsMs);
  const report: LargeAssetReport = {
    format: 'unmatched-labs-cloud-large-asset',
    version: 1,
    generatedAt: new Date().toISOString(),
    requestedSamples: SAMPLE_COUNT,
    verifiedSamples: state.verifiedSamples,
    rawAssetBytesPerSample: ASSET_BYTES,
    totalUploadedBytes: state.totalUploadedBytes,
    saveP95Ms,
    saveMaxMs: Math.round(Math.max(...state.saveDurationsMs)),
    hydrationP95Ms: percentile95(state.hydrationDurationsMs),
    hydrationMaxMs: Math.round(Math.max(...state.hydrationDurationsMs)),
    saveP95LimitMs: SAVE_P95_LIMIT_MS,
    elapsedMs: elapsedSince(startedAt),
    syntheticDataRemoved: true,
    passed: state.verifiedSamples === SAMPLE_COUNT && saveP95Ms <= SAVE_P95_LIMIT_MS
  };
  state = { ...state, stage: 'complete', report };
  saveState();
  showReport(report);
  status.textContent = report.passed
    ? 'PASS — five 9.5 MB assets saved, hydrated, verified, and removed.'
    : `FAIL — transfers verified and cleaned up, but save p95 ${saveP95Ms} ms exceeded ${SAVE_P95_LIMIT_MS} ms.`;
}

function downloadReport(): void {
  const report = state.report;
  assert(report, 'No completed result is available.');
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `unmatched-labs-cloud-large-asset-${report.generatedAt.slice(0, 10)}.json`;
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
