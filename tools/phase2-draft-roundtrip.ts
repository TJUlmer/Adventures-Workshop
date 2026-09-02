import { hashHex } from '../src/lib/core/hash';
import { now } from '../src/lib/core/id';
import { createArtwork } from '../src/lib/core/artwork';
import { parseSetFile, serializeSet } from '../src/lib/export/json';
import { createFigure } from '../src/lib/figures/types';
import { hashEntity } from '../src/lib/sets/fingerprint';
import { createEmptySet } from '../src/lib/sets/factory';
import { normalizeSet } from '../src/lib/sets/normalize';
import { SET_SCHEMA_VERSION } from '../src/lib/sets/types';
import { collectStrings, decodeDataUrl, extensionFor } from '../src/lib/cloud/assets';
import { auth } from '../src/lib/cloud/auth.svelte';
import { DRAFT_ASSET_BUCKET, hydrateDraftAssets } from '../src/lib/cloud/draft-assets';
import {
  fetchDraft,
  listDrafts,
  purgeDraft,
  restoreDraft,
  saveDraft,
  softDeleteDraft
} from '../src/lib/cloud/drafts';
import { endpoint, headers } from '../src/lib/cloud/http';

interface ProbeState {
  localId: string;
  assetPaths: string[];
  revision: number;
  verified: boolean;
}

const STATE_KEY = 'unmatched-labs-phase2-draft-roundtrip-v1';
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=';
const OBJ_TEXT = [
  '# Phase 2 round-trip tetrahedron',
  'v 0 0 0',
  'v 1 0 0',
  'v 0 1 0',
  'v 0 0 1',
  'f 1 2 3',
  'f 1 2 4',
  'f 1 3 4',
  'f 2 3 4',
  ''
].join('\n');
const OBJ_DATA_URL = `data:model/obj;base64,${btoa(OBJ_TEXT)}`;

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
      Array.isArray(parsed.assetPaths) &&
      parsed.assetPaths.every((path) => typeof path === 'string') &&
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

function button(label: string, action: () => Promise<void> | void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.disabled = busy;
  element.addEventListener('click', () => void run(action));
  return element;
}

async function run(action: () => Promise<void> | void): Promise<void> {
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

async function assetPath(dataUrl: string, ownerId: string, setId: string): Promise<string> {
  const asset = decodeDataUrl(dataUrl);
  return `${ownerId}/${setId}/${await hashHex(asset.bytes)}.${extensionFor(asset.contentType)}`;
}

function createProbeSet() {
  const set = createEmptySet({
    name: 'Phase 2 draft round-trip probe',
    subtitle: 'Synthetic artwork and model verification'
  });
  set.boxArt = createArtwork({ source: PNG_DATA_URL, label: 'phase2-probe.png' });
  const figure = createFigure('figure', 'Phase 2 tetrahedron');
  figure.reference = createArtwork({ source: PNG_DATA_URL, label: 'phase2-probe.png' });
  figure.model = {
    name: 'phase2-probe.obj',
    source: OBJ_DATA_URL,
    size: new TextEncoder().encode(OBJ_TEXT).length
  };
  set.figures.push(figure);
  set.meta.updatedAt = now();
  return { ...normalizeSet(set), schemaVersion: SET_SCHEMA_VERSION };
}

async function runRoundTrip(): Promise<void> {
  assert(auth.signedIn && !auth.isAnonymous && auth.user, 'A permanent Account A session is required.');
  assert(!state, 'A Phase 2 probe already exists. Clean it up before starting another.');
  checks.replaceChildren();

  const original = createProbeSet();
  const parsed = parseSetFile(serializeSet(original));
  assert(parsed.ok, 'The real v47 fixture did not pass parseSetFile().');
  const normalisedAgain = normalizeSet(parsed.set);
  assert(
    hashEntity(parsed.set) === hashEntity(normalisedAgain),
    'Repeated normalizeSet() changed the fixture.'
  );
  addCheck('parseSetFile() accepted the v47 envelope and repeated normalizeSet() was stable.');

  const assetPaths = await Promise.all(
    [PNG_DATA_URL, OBJ_DATA_URL].map((url) => assetPath(url, auth.user!.id, original.id))
  );
  saveState({ localId: original.id, assetPaths, revision: 0, verified: false });

  const created = await saveDraft(original, null);
  assert(created.outcome === 'saved' && created.revision === 1, 'Initial cloud save was not revision 1.');
  saveState({ localId: original.id, assetPaths, revision: 1, verified: false });
  addCheck('embedded artwork/model bytes uploaded before a revision-1 reference document.');

  const summaries = await listDrafts('active');
  const summary = summaries.find((entry) => entry.localId === original.id);
  assert(summary?.revision === 1 && summary.schemaVersion === SET_SCHEMA_VERSION, 'Draft summary is missing or stale.');
  addCheck('the summary list returned revision and schema metadata without loading a document.');

  const loaded = await fetchDraft(original.id);
  assert(loaded, 'The new cloud draft could not be fetched.');
  assert(hashEntity(loaded.set) === hashEntity(original), 'Hydrated revision 1 changed the set fingerprint.');
  assert(loaded.set.boxArt.source === PNG_DATA_URL, 'Artwork did not round-trip byte-for-byte.');
  assert(loaded.set.figures[0]?.model?.source === OBJ_DATA_URL, 'OBJ model did not round-trip byte-for-byte.');
  assert(
    collectStrings(loaded.set, (value) => value.startsWith('draft-asset:')).size === 0,
    'A private reference escaped hydration.'
  );
  addCheck('authenticated hydration restored identical artwork, model, and complete set fingerprint.');

  const updated = {
    ...loaded.set,
    name: 'Phase 2 draft round-trip probe — revision 2',
    meta: { ...loaded.set.meta, updatedAt: now() }
  };
  const saved = await saveDraft(updated, 1);
  assert(saved.outcome === 'saved' && saved.revision === 2, 'Revision-2 save failed.');
  saveState({ localId: original.id, assetPaths, revision: 2, verified: false });

  const stale = await saveDraft({ ...updated, subtitle: 'This stale write must lose' }, 1);
  assert(stale.outcome === 'conflict' && stale.revision === 2, 'Stale revision did not conflict.');
  const loadedAgain = await fetchDraft(original.id);
  assert(
    loadedAgain?.summary.revision === 2 && loadedAgain.set.name === updated.name,
    'The stale write changed revision 2.'
  );
  addCheck('revision 2 saved and a stale revision-1 write could not replace it.');

  const missingHash = '0'.repeat(64);
  const missingReference =
    `draft-asset:${auth.user.id}/${original.id}/${missingHash}.png#image%2Fpng`;
  let missingRejected = false;
  try {
    await hydrateDraftAssets({ first: PNG_DATA_URL, second: missingReference }, original.id);
  } catch {
    missingRejected = true;
  }
  assert(missingRejected, 'Strict hydration accepted a missing required object.');
  addCheck('one missing required object rejected the whole hydration attempt.');

  saveState({ localId: original.id, assetPaths, revision: 2, verified: true });
  statusLine.textContent =
    'PASS — the real v47 artwork/model draft round-tripped with an identical fingerprint. Synthetic cloud data awaits confirmed cleanup.';
}

async function resumeRoundTrip(): Promise<void> {
  assert(auth.signedIn && !auth.isAnonymous && auth.user, 'A permanent Account A session is required.');
  assert(state && !state.verified && state.revision === 1, 'No revision-1 Phase 2 probe is ready to resume.');

  const loaded = await fetchDraft(state.localId);
  assert(loaded?.summary.revision === 1, 'The interrupted revision-1 draft could not be recovered.');
  assert(loaded.set.boxArt.source === PNG_DATA_URL, 'Recovered artwork differs from the original fixture.');
  assert(loaded.set.figures[0]?.model?.source === OBJ_DATA_URL, 'Recovered OBJ differs from the original fixture.');
  addCheck('the interrupted revision-1 probe recovered with identical artwork and model bytes.');

  const updated = {
    ...loaded.set,
    name: 'Phase 2 draft round-trip probe — revision 2',
    meta: { ...loaded.set.meta, updatedAt: now() }
  };
  const saved = await saveDraft(updated, 1);
  assert(saved.outcome === 'saved' && saved.revision === 2, 'Revision-2 resume failed.');
  saveState({ ...state, revision: 2 });

  const stale = await saveDraft({ ...updated, subtitle: 'This stale write must lose' }, 1);
  assert(stale.outcome === 'conflict' && stale.revision === 2, 'Stale revision did not conflict.');
  const loadedAgain = await fetchDraft(state.localId);
  assert(
    loadedAgain?.summary.revision === 2 && loadedAgain.set.name === updated.name,
    'The stale write changed revision 2.'
  );
  addCheck('revision 2 saved and a stale revision-1 write could not replace it.');

  const missingHash = '0'.repeat(64);
  const missingReference =
    `draft-asset:${auth.user.id}/${state.localId}/${missingHash}.png#image%2Fpng`;
  let missingRejected = false;
  try {
    await hydrateDraftAssets({ first: PNG_DATA_URL, second: missingReference }, state.localId);
  } catch {
    missingRejected = true;
  }
  assert(missingRejected, 'Strict hydration accepted a missing required object.');
  addCheck('one missing required object rejected the whole hydration attempt.');

  saveState({ ...state, revision: 2, verified: true });
  statusLine.textContent =
    'PASS — the recovered v47 artwork/model draft completed with an identical fingerprint. Synthetic cloud data awaits confirmed cleanup.';
}

function encodedPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function deleteAsset(path: string): Promise<void> {
  const response = await fetch(
    endpoint(`/storage/v1/object/${DRAFT_ASSET_BUCKET}/${encodedPath(path)}`),
    { method: 'DELETE', headers: headers() }
  );
  assert(response.ok || response.status === 404, `Private asset cleanup returned HTTP ${response.status}.`);
}

async function cleanup(): Promise<void> {
  assert(auth.signedIn && !auth.isAnonymous, 'The permanent Account A session is required.');
  assert(state?.verified && state.revision === 2, 'No completed Phase 2 probe is ready for cleanup.');

  const deleted = await softDeleteDraft(state.localId, 2);
  assert(deleted.outcome === 'deleted' && deleted.revision === 3, 'Soft delete did not create revision 3.');
  const restored = await restoreDraft(state.localId, 3);
  assert(restored.outcome === 'restored' && restored.revision === 4, 'Restore did not create revision 4.');
  const deletedAgain = await softDeleteDraft(state.localId, 4);
  assert(deletedAgain.outcome === 'deleted' && deletedAgain.revision === 5, 'Final soft delete did not create revision 5.');
  const purged = await purgeDraft(state.localId, 5);
  assert(purged.outcome === 'purged', 'The synthetic draft was not purged.');
  await Promise.all(state.assetPaths.map(deleteAsset));
  assert((await fetchDraft(state.localId)) === null, 'The purged synthetic draft is still visible.');

  localStorage.removeItem(STATE_KEY);
  state = null;
  addCheck('soft delete, restore, final purge, and exact private-object cleanup succeeded.');
  statusLine.textContent = 'PASS — Phase 2 round trip and cleanup are complete; no synthetic draft or asset remains.';
}

function render(): void {
  sessionLine.textContent = !auth.signedIn
    ? 'Session: signed out'
    : auth.isAnonymous
      ? 'Session: temporary anonymous user'
      : 'Session: permanent account';
  actions.replaceChildren();

  if (!auth.signedIn || auth.isAnonymous) {
    instruction.textContent = 'Sign in with the permanent Account A used for Phase 1.';
    return;
  }
  if (!state) {
    instruction.textContent = 'Run the production artwork/model round trip.';
    actions.append(button('Run Phase 2 round trip', runRoundTrip));
    return;
  }
  if (state.verified) {
    instruction.textContent =
      'Round-trip checks passed. Cleanup permanently deletes only this synthetic draft and its two private objects.';
    actions.append(button('Delete synthetic Phase 2 data', cleanup));
    return;
  }
  instruction.textContent = 'Resume the interrupted revision-1 probe after the content-addressed upsert fix.';
  actions.append(button('Resume Phase 2 round trip', resumeRoundTrip));
}

auth.restore();
auth.captureRedirect();
void auth.ensureFresh().catch(() => undefined).finally(render);
render();
