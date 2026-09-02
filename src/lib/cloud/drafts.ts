/**
 * Revision-safe private cloud drafts.
 *
 * This is deliberately a transport boundary, not the autosave coordinator.
 * Callers hand it a complete local document and an expected remote revision;
 * it uploads content-addressed private assets first, then asks the narrow RPC
 * to commit document and shelf summary atomically.
 */
import { characterLabel } from '$lib/characters/factory';
import type { CharacterRole } from '$lib/characters/types';
import { parseSetFile, serializeSet } from '$lib/export/json';
import { assessSet } from '$lib/sets/health';
import { normalizeSet } from '$lib/sets/normalize';
import type { AdventureSet, SetKind } from '$lib/sets/types';
import { SET_SCHEMA_VERSION } from '$lib/sets/types';
import { auth } from './auth.svelte';
import {
  deleteDraftAssets,
  hydrateDraftAssetsWithManifest,
  uploadDraftAssets
} from './draft-assets';
import { CloudError, request } from './http';

export interface DraftCharacterSummary {
  id: string;
  name: string;
  role: CharacterRole;
}

export interface DraftOriginSummary {
  author: string;
  revision: number;
  slug: string;
}

export interface DraftSummary {
  id: string;
  localId: string;
  name: string;
  subtitle: string;
  kind: SetKind;
  cardCount: number;
  characterCount: number;
  characters: DraftCharacterSummary[];
  blockers: number;
  gaps: number;
  issueCount: number;
  origin: DraftOriginSummary | null;
  documentUpdatedAt: string;
  schemaVersion: number;
  revision: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoadedDraft {
  summary: DraftSummary;
  set: AdventureSet;
  assetPaths: string[];
}

export type DraftMutationOutcome =
  | 'saved'
  | 'conflict'
  | 'deleted'
  | 'restored'
  | 'purged'
  | 'not_found';

export interface DraftMutationResult {
  outcome: DraftMutationOutcome;
  draftId: string | null;
  revision: number | null;
  documentUpdatedAt: string | null;
  updatedAt: string | null;
  deletedAt: string | null;
  /** Present only for document saves, not lifecycle mutations. */
  assetPaths?: string[];
  uploadedAssets?: number;
  uploadedBytes?: number;
}

export interface DraftTransferProgress {
  stage: 'assets' | 'document';
  done: number;
  total: number;
}

export interface DraftTransferOptions {
  onProgress?: (progress: DraftTransferProgress) => void;
  /** `null`/absent performs one Storage reconciliation; `[]` is known empty. */
  knownAssetPaths?: readonly string[] | null;
  /** Persist confirmed objects before the revision RPC, so an RPC retry stays reference-only. */
  onAssetsReady?: (assetPaths: readonly string[]) => Promise<void> | void;
}

export type DraftListScope = 'active' | 'deleted' | 'all';

interface DraftRow {
  id: string;
  local_id: string;
  name: string;
  subtitle: string;
  kind: SetKind;
  card_count: number;
  character_count: number;
  characters: unknown;
  blockers: number;
  gaps: number;
  issue_count: number;
  origin_author: string | null;
  origin_revision: number | null;
  origin_slug: string | null;
  document_updated_at: string;
  schema_version: number;
  revision: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DraftDocumentRow extends DraftRow {
  document: unknown;
}

interface DraftMutationRow {
  outcome: DraftMutationOutcome;
  draft_id: string | null;
  revision: number | null;
  document_updated_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
}

const SUMMARY_COLUMNS =
  'id,local_id,name,subtitle,kind,card_count,character_count,characters,blockers,gaps,' +
  'issue_count,origin_author,origin_revision,origin_slug,document_updated_at,schema_version,' +
  'revision,deleted_at,created_at,updated_at';

function requirePermanentUser(): void {
  if (!auth.user || auth.isAnonymous) {
    throw new CloudError('A permanent sign-in is required for cloud drafts.', 401);
  }
}

function characterSummaries(value: unknown): DraftCharacterSummary[] {
  if (!Array.isArray(value)) return [];
  const summaries: DraftCharacterSummary[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const role = row['role'];
    if (
      typeof row['id'] === 'string' &&
      typeof row['name'] === 'string' &&
      (role === 'hero' || role === 'villain' || role === 'minion')
    ) {
      summaries.push({ id: row['id'], name: row['name'], role });
    }
  }
  return summaries;
}

function toSummary(row: DraftRow): DraftSummary {
  const hasOrigin =
    row.origin_author !== null && row.origin_revision !== null && row.origin_slug !== null;
  return {
    id: row.id,
    localId: row.local_id,
    name: row.name,
    subtitle: row.subtitle,
    kind: row.kind,
    cardCount: row.card_count,
    characterCount: row.character_count,
    characters: characterSummaries(row.characters),
    blockers: row.blockers,
    gaps: row.gaps,
    issueCount: row.issue_count,
    origin: hasOrigin
      ? {
          author: row.origin_author as string,
          revision: row.origin_revision as number,
          slug: row.origin_slug as string
        }
      : null,
    documentUpdatedAt: row.document_updated_at,
    schemaVersion: row.schema_version,
    revision: row.revision,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toMutation(row: DraftMutationRow): DraftMutationResult {
  return {
    outcome: row.outcome,
    draftId: row.draft_id,
    revision: row.revision,
    documentUpdatedAt: row.document_updated_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

async function permanentSession(): Promise<void> {
  await auth.ensureFresh();
  requirePermanentUser();
}

/** Shelf summaries only; documents and artwork are never downloaded here. */
export async function listDrafts(scope: DraftListScope = 'active'): Promise<DraftSummary[]> {
  await permanentSession();
  const deletion =
    scope === 'active' ? '&deleted_at=is.null' : scope === 'deleted' ? '&deleted_at=not.is.null' : '';
  const rows = await request<DraftRow[]>(
    `/rest/v1/set_drafts?select=${SUMMARY_COLUMNS}${deletion}&order=document_updated_at.desc`
  );
  return rows.map(toSummary);
}

/** One owner-visible summary without downloading or hydrating its document. */
export async function fetchDraftSummary(localId: string): Promise<DraftSummary | null> {
  await permanentSession();
  const rows = await request<DraftRow[]>(
    `/rest/v1/set_drafts?select=${SUMMARY_COLUMNS}&local_id=eq.${encodeURIComponent(localId)}&limit=1`
  );
  return rows[0] ? toSummary(rows[0]) : null;
}

/** Fetch and fully hydrate one owner-visible draft, or `null` when it is absent. */
export async function fetchDraft(
  localId: string,
  options: DraftTransferOptions = {}
): Promise<LoadedDraft | null> {
  await permanentSession();
  const rows = await request<DraftDocumentRow[]>(
    `/rest/v1/set_drafts?select=${SUMMARY_COLUMNS},document&local_id=eq.${encodeURIComponent(localId)}&limit=1`
  );
  const row = rows[0];
  if (!row) return null;

  // Refuse a future generation before spending bandwidth on its assets. The
  // document may describe references this build cannot safely interpret.
  if (row.schema_version > SET_SCHEMA_VERSION) {
    throw new CloudError(
      `Draft uses schema v${row.schema_version}; this build understands up to v${SET_SCHEMA_VERSION}.`,
      0
    );
  }

  const hydrated = await hydrateDraftAssetsWithManifest(row.document, row.local_id, (progress) => {
    options.onProgress?.({ stage: 'assets', ...progress });
  });
  options.onProgress?.({ stage: 'document', done: 0, total: 1 });
  const parsed = parseSetFile(JSON.stringify(hydrated.document));
  if (!parsed.ok) throw new CloudError(`Could not open cloud draft: ${parsed.error}`, 0);
  options.onProgress?.({ stage: 'document', done: 1, total: 1 });
  return { summary: toSummary(row), set: parsed.set, assetPaths: hydrated.assetPaths };
}

/**
 * Upload assets, then atomically save the reference document and its summary.
 * A `null` expected revision creates revision 1; a number replaces exactly
 * that generation or returns `conflict` without changing the row.
 */
export async function saveDraft(
  set: AdventureSet,
  expectedRevision: number | null,
  options: DraftTransferOptions = {}
): Promise<DraftMutationResult> {
  await permanentSession();
  const normalised: AdventureSet = {
    ...normalizeSet(set),
    schemaVersion: SET_SCHEMA_VERSION
  };
  const envelope: unknown = JSON.parse(serializeSet(normalised));
  const prepared = await uploadDraftAssets(envelope, normalised.id, {
    knownPaths: options.knownAssetPaths,
    onProgress: (progress) => options.onProgress?.({ stage: 'assets', ...progress })
  });
  await options.onAssetsReady?.(prepared.assetPaths);
  const health = assessSet(normalised);

  options.onProgress?.({ stage: 'document', done: 0, total: 1 });
  const rows = await request<DraftMutationRow[]>('/rest/v1/rpc/save_set_draft', {
    method: 'POST',
    body: {
      p_local_id: normalised.id,
      p_name: normalised.name,
      p_subtitle: normalised.subtitle,
      p_kind: normalised.kind,
      p_card_count: normalised.cards.length,
      p_character_count: normalised.characters.length,
      p_characters: normalised.characters.map((character) => ({
        id: character.id,
        name: characterLabel(character),
        role: character.role
      })),
      p_blockers: health.blockers,
      p_gaps: health.gaps,
      p_issue_count: health.issues.length,
      p_origin_author: normalised.origin?.authorName ?? null,
      p_origin_revision: normalised.origin?.revision ?? null,
      p_origin_slug: normalised.origin?.slug ?? null,
      p_document_updated_at: normalised.meta.updatedAt,
      p_schema_version: SET_SCHEMA_VERSION,
      p_document: prepared.document,
      p_expected_revision: expectedRevision
    }
  });
  const row = rows[0];
  if (!row) throw new CloudError('Draft save returned no result.', 0);
  options.onProgress?.({ stage: 'document', done: 1, total: 1 });
  return {
    ...toMutation(row),
    assetPaths: prepared.assetPaths,
    uploadedAssets: prepared.uploadedPaths.length,
    uploadedBytes: prepared.uploadedBytes
  };
}

async function lifecycle(
  operation: 'soft_delete_set_draft' | 'restore_set_draft' | 'purge_set_draft',
  localId: string,
  expectedRevision: number
): Promise<DraftMutationResult> {
  await permanentSession();
  const rows = await request<DraftMutationRow[]>(`/rest/v1/rpc/${operation}`, {
    method: 'POST',
    body: { p_local_id: localId, p_expected_revision: expectedRevision }
  });
  const row = rows[0];
  if (!row) throw new CloudError('Draft lifecycle operation returned no result.', 0);
  return toMutation(row);
}

export function softDeleteDraft(
  localId: string,
  expectedRevision: number
): Promise<DraftMutationResult> {
  return lifecycle('soft_delete_set_draft', localId, expectedRevision);
}

export function restoreDraft(
  localId: string,
  expectedRevision: number
): Promise<DraftMutationResult> {
  return lifecycle('restore_set_draft', localId, expectedRevision);
}

/**
 * Permanently remove an already-soft-deleted row.
 *
 * Content-addressed objects are intentionally left for the later scheduled
 * orphan-cleanup job: deleting them before the row would make a retryable RPC
 * failure destroy the last complete remote copy.
 */
export async function purgeDraft(
  localId: string,
  expectedRevision: number
): Promise<DraftMutationResult> {
  const result = await lifecycle('purge_set_draft', localId, expectedRevision);
  if (result.outcome === 'purged' || result.outcome === 'not_found') {
    // Row first, objects second: a failed RPC must never destroy the last
    // complete copy. A cleanup failure is retryable because `not_found` also
    // re-enters this exact-prefix deletion on the next attempt.
    await deleteDraftAssets(localId);
  }
  return result;
}
