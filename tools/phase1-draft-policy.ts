import { auth } from '../src/lib/cloud/auth.svelte';
import { endpoint, headers } from '../src/lib/cloud/http';

type Stage = 'start' | 'anonymous-passed' | 'owner-a-passed' | 'owner-b-passed' | 'complete';

interface ProbeState {
  stage: Stage;
  localId: string;
  ownerAId?: string;
  assetPath?: string;
}

interface RpcResult {
  outcome?: string;
  draft_id?: string | null;
  revision?: number | null;
}

interface DraftRow {
  local_id?: string;
  name?: string;
  revision?: number;
}

const STATE_KEY = 'unmatched-labs-phase1-draft-policy-v1';
const SCHEMA_VERSION = 31;
const OWNER_A_NAME = 'Phase 1 owner A — revision 2';
const INITIAL_ASSET = 'phase-1-owner-a-v1';
const UPDATED_ASSET = 'phase-1-owner-a-v2';

const sessionLine = requiredElement('session');
const instruction = requiredElement('instruction');
const result = requiredElement('result');
const actions = requiredElement('actions');
const anonymousProgress = requiredElement('anonymous-progress');
const ownerAProgress = requiredElement('owner-a-progress');
const ownerBProgress = requiredElement('owner-b-progress');
const cleanupProgress = requiredElement('cleanup-progress');

let state = loadState();
let busy = false;

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Verifier element is missing: ${id}`);
  return element;
}

function loadState(): ProbeState {
  const raw = sessionStorage.getItem(STATE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ProbeState>;
      if (typeof parsed.localId === 'string' && typeof parsed.stage === 'string') {
        return parsed as ProbeState;
      }
    } catch {
      // A damaged probe state is disposable; no production document uses this key.
    }
  }

  return {
    stage: 'start',
    localId: `phase1-policy-${crypto.randomUUID()}`
  };
}

function saveState(): void {
  sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function button(label: string, action: () => Promise<void> | void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.disabled = busy;
  element.addEventListener('click', () => {
    void run(action);
  });
  return element;
}

async function run(action: () => Promise<void> | void): Promise<void> {
  if (busy) return;
  busy = true;
  result.textContent = 'Running…';
  render();

  try {
    await action();
  } catch (cause) {
    result.textContent = `FAIL — ${cause instanceof Error ? cause.message : 'Unexpected verifier error.'}`;
  } finally {
    busy = false;
    render();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function fetchResponse(
  path: string,
  init: RequestInit = {},
  extraHeaders: Readonly<Record<string, string>> = {}
): Promise<Response> {
  await auth.ensureFresh();
  return fetch(endpoint(path), {
    ...init,
    headers: headers(extraHeaders)
  });
}

async function jsonResponse<T>(
  path: string,
  init: RequestInit = {},
  extraHeaders: Readonly<Record<string, string>> = {}
): Promise<{ response: Response; body: T | null }> {
  const response = await fetchResponse(path, init, extraHeaders);
  let body: T | null = null;
  try {
    body = (await response.json()) as T;
  } catch {
    // Some denials and successful deletes have no JSON body. Status is authoritative.
  }
  return { response, body };
}

function draftBody(expectedRevision: number | null, name: string): Record<string, unknown> {
  const timestamp = new Date().toISOString();
  return {
    p_local_id: state.localId,
    p_name: name,
    p_subtitle: 'Synthetic Phase 1 policy probe',
    p_kind: 'adventure',
    p_card_count: 0,
    p_character_count: 0,
    p_characters: [],
    p_blockers: 0,
    p_gaps: 0,
    p_issue_count: 0,
    p_origin_author: null,
    p_origin_revision: null,
    p_origin_slug: null,
    p_document_updated_at: timestamp,
    p_schema_version: SCHEMA_VERSION,
    p_document: {
      format: 'adventures-workshop-set',
      schemaVersion: SCHEMA_VERSION,
      set: { id: state.localId, schemaVersion: SCHEMA_VERSION }
    },
    p_expected_revision: expectedRevision
  };
}

async function saveDraft(
  expectedRevision: number | null,
  name: string
): Promise<{ response: Response; row: RpcResult | null }> {
  const { response, body } = await jsonResponse<RpcResult[]>('/rest/v1/rpc/save_set_draft', {
    method: 'POST',
    body: JSON.stringify(draftBody(expectedRevision, name))
  }, { 'Content-Type': 'application/json' });
  return { response, row: Array.isArray(body) ? (body[0] ?? null) : null };
}

async function lifecycleRpc(name: string, revision: number): Promise<RpcResult> {
  const { response, body } = await jsonResponse<RpcResult[]>(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify({ p_local_id: state.localId, p_expected_revision: revision })
  }, { 'Content-Type': 'application/json' });
  assert(response.ok, `${name} returned HTTP ${response.status}.`);
  const row = Array.isArray(body) ? body[0] : null;
  assert(row, `${name} returned no result.`);
  return row;
}

async function readDraft(): Promise<DraftRow[]> {
  const filter = encodeURIComponent(state.localId);
  const { response, body } = await jsonResponse<DraftRow[]>(
    `/rest/v1/set_drafts?select=local_id,name,revision&local_id=eq.${filter}`
  );
  assert(response.ok, `Draft read returned HTTP ${response.status}.`);
  assert(Array.isArray(body), 'Draft read returned an unexpected shape.');
  return body;
}

async function recoverOwnerAProbe(): Promise<void> {
  assert(auth.signedIn && !auth.isAnonymous && auth.user, 'Sign in with the original Account A first.');

  const { response, body } = await jsonResponse<DraftRow[]>(
    '/rest/v1/set_drafts?select=local_id,name,revision&local_id=like.phase1-policy-*'
  );
  assert(response.ok, `Probe recovery returned HTTP ${response.status}.`);
  assert(Array.isArray(body), 'Probe recovery returned an unexpected shape.');

  const candidates = body.filter(
    (row) =>
      typeof row.local_id === 'string' &&
      row.name === OWNER_A_NAME &&
      row.revision === 2
  );
  assert(candidates.length === 1, `Expected one recoverable probe; found ${candidates.length}.`);
  const localId = candidates[0]?.local_id;
  assert(localId, 'The recoverable probe has no local ID.');

  state = {
    stage: 'owner-b-passed',
    localId,
    ownerAId: auth.user.id,
    assetPath: `${auth.user.id}/${localId}/probe.txt`
  };
  saveState();
  result.textContent = 'Recovered the completed Account A probe. The confirmed cleanup action is ready.';
}

async function uploadAsset(path: string, contents: string, upsert: boolean): Promise<Response> {
  return fetchResponse(
    `/storage/v1/object/draft-assets/${path}`,
    { method: 'POST', body: new Blob([contents], { type: 'text/plain' }) },
    { 'Content-Type': 'text/plain', 'x-upsert': String(upsert) }
  );
}

async function readAsset(path: string): Promise<{ response: Response; text: string }> {
  // The authenticated object route may return a cached pre-upsert body even
  // after Storage has accepted the replacement. A unique query and no-store
  // make this check observe the object generation just written.
  const response = await fetchResponse(
    `/storage/v1/object/authenticated/draft-assets/${path}?probe=${crypto.randomUUID()}`,
    { cache: 'no-store' }
  );
  return { response, text: response.ok ? await response.text() : '' };
}

async function createAndTestAnonymous(): Promise<void> {
  assert(!auth.signedIn, 'Sign out before creating the temporary anonymous session.');
  await auth.signInAnonymously();
  assert(auth.signedIn && auth.isAnonymous && auth.user, 'Supabase did not create an anonymous session.');

  const table = await readDraft();
  assert(table.length === 0, 'An anonymous session could see a draft row.');

  const save = await saveDraft(null, 'Anonymous policy probe');
  assert(!save.response.ok, `Anonymous draft save unexpectedly returned HTTP ${save.response.status}.`);

  const anonymousPath = `${auth.user.id}/${state.localId}/anonymous.txt`;
  const upload = await uploadAsset(anonymousPath, 'anonymous-policy-probe', false);
  assert(!upload.ok, `Anonymous asset upload unexpectedly returned HTTP ${upload.status}.`);

  state.stage = 'anonymous-passed';
  saveState();
  await auth.signOut();
  result.textContent =
    'PASS — authenticated-anonymous reads, draft saves, and private asset uploads were denied.';
}

async function testOwnerA(): Promise<void> {
  assert(auth.signedIn && !auth.isAnonymous && auth.user, 'Sign in with permanent Account A first.');
  if (state.ownerAId) assert(state.ownerAId === auth.user.id, 'This is not the recorded Account A.');
  state.ownerAId = auth.user.id;
  state.assetPath = `${auth.user.id}/${state.localId}/probe.txt`;
  saveState();

  const created = await saveDraft(null, 'Phase 1 owner A — revision 1');
  assert(created.response.ok, `Initial draft save returned HTTP ${created.response.status}.`);
  assert(created.row?.outcome === 'saved' && created.row.revision === 1, 'Initial save was not revision 1.');

  const updated = await saveDraft(1, OWNER_A_NAME);
  assert(updated.response.ok, `Draft update returned HTTP ${updated.response.status}.`);
  assert(updated.row?.outcome === 'saved' && updated.row.revision === 2, 'Update was not revision 2.');

  const stale = await saveDraft(1, 'This stale write must not win');
  assert(stale.response.ok, `Stale write returned HTTP ${stale.response.status}.`);
  assert(stale.row?.outcome === 'conflict' && stale.row.revision === 2, 'Stale write did not conflict.');

  const rows = await readDraft();
  assert(
    rows.length === 1 && rows[0]?.name === OWNER_A_NAME && rows[0]?.revision === 2,
    'The stale write changed the stored draft.'
  );

  const upload = await uploadAsset(state.assetPath, INITIAL_ASSET, false);
  assert(upload.ok, `Owner asset create returned HTTP ${upload.status}.`);
  const downloaded = await readAsset(state.assetPath);
  assert(downloaded.response.ok && downloaded.text === INITIAL_ASSET, 'Owner could not read the new asset.');

  state.stage = 'owner-a-passed';
  saveState();
  result.textContent = 'PASS — Account A can create/read/update its draft and asset; stale revision 1 lost to revision 2.';
}

async function testOwnerB(): Promise<void> {
  assert(auth.signedIn && !auth.isAnonymous && auth.user, 'Sign in with permanent Account B first.');
  assert(state.ownerAId && auth.user.id !== state.ownerAId, 'Account B must be a different Supabase user.');
  assert(state.assetPath, 'Account A asset state is missing.');

  const rows = await readDraft();
  assert(rows.length === 0, 'Account B could read Account A’s draft.');

  const overwrite = await saveDraft(2, 'Account B must not overwrite this');
  assert(overwrite.response.ok, `Cross-owner draft write returned HTTP ${overwrite.response.status}.`);
  assert(
    overwrite.row?.outcome === 'conflict' && overwrite.row.draft_id === null,
    'Account B’s cross-owner write did not return an owner-scoped conflict.'
  );

  const download = await readAsset(state.assetPath);
  assert(!download.response.ok, `Account B read Account A’s asset with HTTP ${download.response.status}.`);

  const overwriteAsset = await uploadAsset(state.assetPath, 'Account B must not write this', true);
  assert(!overwriteAsset.ok, `Account B overwrote Account A’s asset with HTTP ${overwriteAsset.status}.`);

  state.stage = 'owner-b-passed';
  saveState();
  result.textContent = 'PASS — Account B cannot see or overwrite Account A’s draft or private asset.';
}

async function testLifecycleAndCleanup(): Promise<void> {
  assert(auth.signedIn && !auth.isAnonymous && auth.user, 'Sign back in with Account A first.');
  assert(state.ownerAId === auth.user.id, 'Cleanup must be performed by the recorded Account A.');
  assert(state.assetPath, 'Account A asset state is missing.');

  const rows = await readDraft();
  assert(
    rows.length === 1 && rows[0]?.name === OWNER_A_NAME && rows[0]?.revision === 2,
    'Account A’s draft changed during the Account B checks.'
  );

  const originalAsset = await readAsset(state.assetPath);
  assert(
    originalAsset.response.ok &&
      (originalAsset.text === INITIAL_ASSET || originalAsset.text === UPDATED_ASSET),
    'Account A’s asset changed during the Account B checks.'
  );

  const updateAsset = await uploadAsset(state.assetPath, UPDATED_ASSET, true);
  assert(updateAsset.ok, `Owner asset update returned HTTP ${updateAsset.status}.`);
  const updatedAsset = await readAsset(state.assetPath);
  assert(updatedAsset.response.ok && updatedAsset.text === UPDATED_ASSET, 'Owner asset update did not persist.');

  const deleted = await lifecycleRpc('soft_delete_set_draft', 2);
  assert(deleted.outcome === 'deleted' && deleted.revision === 3, 'Soft delete did not produce revision 3.');
  const restored = await lifecycleRpc('restore_set_draft', 3);
  assert(restored.outcome === 'restored' && restored.revision === 4, 'Restore did not produce revision 4.');
  const deletedAgain = await lifecycleRpc('soft_delete_set_draft', 4);
  assert(deletedAgain.outcome === 'deleted' && deletedAgain.revision === 5, 'Final soft delete did not produce revision 5.');
  const purged = await lifecycleRpc('purge_set_draft', 5);
  assert(purged.outcome === 'purged', 'Permanent purge did not remove the synthetic draft.');

  const deleteAsset = await fetchResponse(`/storage/v1/object/draft-assets/${state.assetPath}`, {
    method: 'DELETE'
  });
  assert(deleteAsset.ok, `Owner asset delete returned HTTP ${deleteAsset.status}.`);
  const missingAsset = await readAsset(state.assetPath);
  assert(!missingAsset.response.ok, 'Deleted synthetic asset is still readable.');
  assert((await readDraft()).length === 0, 'Purged synthetic draft is still readable.');

  state.stage = 'complete';
  saveState();
  result.textContent =
    'PASS — Account A retained control, asset update/delete worked, and draft delete/restore/purge completed. Synthetic draft and asset are gone.';
}

async function signOut(): Promise<void> {
  await auth.signOut();
  result.textContent = 'Signed out locally. The next account can now sign in.';
}

function signIn(provider: 'google' | 'discord'): void {
  auth.signInWithProvider(provider);
}

function render(): void {
  sessionLine.textContent = !auth.signedIn
    ? 'Session: signed out'
    : auth.isAnonymous
      ? 'Session: temporary anonymous user'
      : 'Session: permanent account';

  anonymousProgress.textContent = `Anonymous-authenticated boundary: ${state.stage === 'start' ? 'pending' : 'passed'}`;
  ownerAProgress.textContent = `Owner A create/read/update/conflict checks: ${
    state.stage === 'start' || state.stage === 'anonymous-passed' ? 'pending' : 'passed'
  }`;
  ownerBProgress.textContent = `Owner B isolation checks: ${
    state.stage === 'owner-b-passed' || state.stage === 'complete' ? 'passed' : 'pending'
  }`;
  cleanupProgress.textContent = `Owner A lifecycle and cleanup checks: ${state.stage === 'complete' ? 'passed' : 'pending'}`;

  actions.replaceChildren();

  if (state.stage === 'start') {
    if (auth.signedIn && !auth.isAnonymous) {
      instruction.textContent =
        'The previous tab closed. Recover Account A’s uniquely named synthetic probe and resume at cleanup.';
      actions.append(button('Recover completed Account A probe', recoverOwnerAProbe));
    } else {
      instruction.textContent = 'Create the authorised temporary anonymous user, run its denial checks, and sign it out.';
      if (auth.signedIn) actions.append(button('Sign out current session', signOut));
      else actions.append(button('Create temporary user and run anonymous checks', createAndTestAnonymous));
    }
    return;
  }

  if (state.stage === 'anonymous-passed') {
    instruction.textContent = 'Sign in with the first permanent account, then run the Account A checks.';
    if (!auth.signedIn) {
      actions.append(button('Continue with Google', () => signIn('google')));
      actions.append(button('Continue with Discord', () => signIn('discord')));
    } else {
      actions.append(button('Run Account A checks', testOwnerA));
      actions.append(button('Sign out current session', signOut));
    }
    return;
  }

  if (state.stage === 'owner-a-passed') {
    instruction.textContent = 'Sign out Account A, sign in with a different permanent account, then run Account B isolation checks.';
    if (auth.signedIn) actions.append(button('Sign out Account A', signOut));
    else {
      actions.append(button('Continue with Google', () => signIn('google')));
      actions.append(button('Continue with Discord', () => signIn('discord')));
    }
    if (auth.signedIn) actions.append(button('Run Account B isolation checks', testOwnerB));
    return;
  }

  if (state.stage === 'owner-b-passed') {
    instruction.textContent =
      'Sign out Account B and sign back in with Account A. Cleanup remains disabled until its explicit final action is chosen.';
    if (auth.signedIn && auth.user?.id === state.ownerAId) {
      actions.append(button('Run lifecycle checks and delete synthetic data', testLifecycleAndCleanup));
    } else if (auth.signedIn) {
      actions.append(button('Sign out Account B', signOut));
    } else {
      actions.append(button('Continue with Google', () => signIn('google')));
      actions.append(button('Continue with Discord', () => signIn('discord')));
    }
    return;
  }

  instruction.textContent = 'All Phase 1 HTTP policy checks passed. No synthetic draft or asset remains.';
}

auth.restore();
auth.captureRedirect();
void auth.ensureFresh().catch(() => undefined).finally(render);
render();
