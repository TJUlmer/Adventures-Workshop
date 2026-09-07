/**
 * Private draft asset transport.
 *
 * Draft documents keep stable internal references, never signed URLs. The
 * object itself lives under `<owner>/<set>/<sha256>.<extension>` in the private
 * `draft-assets` bucket; Storage RLS makes the first segment an ownership
 * boundary and the digest makes the bytes independently verifiable.
 */
import { hashHex } from '$lib/core/hash';
import {
  collectEmbeddedAssets,
  collectStrings,
  extensionFor,
  substituteStrings,
  toDataUrl
} from './assets';
import type { EmbeddedAsset } from './assets';
import { auth } from './auth.svelte';
import { draftRollout } from '$lib/persistence/rollout.svelte';
import { CloudError, endpoint, headers } from './http';

export const DRAFT_ASSET_BUCKET = 'draft-assets';
export const DRAFT_ASSET_PREFIX = 'draft-asset:';

const TRANSFER_CONCURRENCY = 6;
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;
const HASHED_FILE = /^([0-9a-f]{64})\.([a-z0-9]+)$/;

export interface DraftAssetProgress {
  done: number;
  total: number;
}

export interface DraftAssetUploadResult<T> {
  document: T;
  /** Every private object referenced by this document generation. */
  assetPaths: string[];
  uploadedPaths: string[];
  uploadedBytes: number;
}

export interface HydratedDraftAssets<T> {
  document: T;
  /** Confirmed by the successful, hash-verified downloads above. */
  assetPaths: string[];
}

export interface DraftAssetUploadOptions {
  /** `null`/absent means reconcile Storage once; `[]` means a known-new prefix. */
  knownPaths?: readonly string[] | null;
  onProgress?: (progress: DraftAssetProgress) => void;
}

export interface DraftAssetReference {
  reference: string;
  path: string;
  ownerId: string;
  setId: string;
  hash: string;
  contentType: string;
}

function requirePermanentUser(): { id: string } {
  const user = auth.user;
  if (!user || auth.isAnonymous) {
    throw new CloudError('A permanent sign-in is required for cloud drafts.', 401);
  }
  if (!draftRollout.enabled) {
    throw new CloudError('Private cloud drafts are not enabled for this account.', 403);
  }
  return user;
}

function requireSafeSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT.test(value)) {
    throw new CloudError(`${label} cannot be used in a private asset path.`, 0);
  }
}

function encodedPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function setPrefix(userId: string, setId: string): string {
  requireSafeSegment(userId, 'Account id');
  requireSafeSegment(setId, 'Set id');
  return `${userId}/${setId}`;
}

function objectPath(userId: string, setId: string, asset: EmbeddedAsset): string {
  return `${setPrefix(userId, setId)}/${asset.hash}.${extensionFor(asset.contentType)}`;
}

function referenceFor(path: string, contentType: string): string {
  return `${DRAFT_ASSET_PREFIX}${path}#${encodeURIComponent(contentType)}`;
}

export function parseDraftAssetReference(value: string): DraftAssetReference | null {
  if (!value.startsWith(DRAFT_ASSET_PREFIX)) return null;
  const payload = value.slice(DRAFT_ASSET_PREFIX.length);
  const separator = payload.lastIndexOf('#');
  if (separator < 1) return null;
  const path = payload.slice(0, separator);
  let contentType: string;
  try {
    contentType = decodeURIComponent(payload.slice(separator + 1));
  } catch {
    return null;
  }
  if (!/^[^\s;/]+\/[^\s;]+$/.test(contentType)) return null;
  const parts = path.split('/');
  if (parts.length !== 3) return null;

  const ownerId = parts[0];
  const setId = parts[1];
  const file = parts[2];
  if (!ownerId || !setId || !file) return null;
  if (!SAFE_SEGMENT.test(ownerId) || !SAFE_SEGMENT.test(setId)) return null;

  const match = HASHED_FILE.exec(file);
  if (!match?.[1]) return null;
  return { reference: value, path, ownerId, setId, hash: match[1], contentType };
}

function validKnownPaths(
  paths: readonly string[] | null | undefined,
  userId: string,
  setId: string
): Set<string> | null {
  if (paths === null || paths === undefined) return null;
  const prefix = `${setPrefix(userId, setId)}/`;
  const known = new Set<string>();
  for (const path of paths) {
    if (!path.startsWith(prefix) || !HASHED_FILE.test(path.slice(prefix.length))) return null;
    known.add(path);
  }
  return known;
}

interface StorageObjectRow {
  name?: unknown;
}

/** Owner-visible objects under exactly one draft prefix, with pagination. */
export async function listDraftAssetPaths(setId: string): Promise<string[]> {
  await auth.ensureFresh();
  const user = requirePermanentUser();
  const prefix = setPrefix(user.id, setId);
  const paths: string[] = [];
  const limit = 1000;
  let offset = 0;

  for (;;) {
    const response = await fetch(endpoint(`/storage/v1/object/list/${DRAFT_ASSET_BUCKET}`), {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        prefix,
        limit,
        offset,
        sortBy: { column: 'name', order: 'asc' }
      })
    });
    if (!response.ok) {
      throw new CloudError(
        `Could not reconcile private draft assets (${response.status}).`,
        response.status
      );
    }
    const value: unknown = await response.json();
    if (!Array.isArray(value)) throw new CloudError('Private asset listing was malformed.', 0);

    for (const item of value as StorageObjectRow[]) {
      if (typeof item.name !== 'string') continue;
      const name = item.name.startsWith(`${prefix}/`)
        ? item.name.slice(prefix.length + 1)
        : item.name;
      if (HASHED_FILE.test(name)) paths.push(`${prefix}/${name}`);
    }
    if (value.length < limit) break;
    offset += value.length;
  }

  return [...new Set(paths)].sort();
}

async function runBounded<T>(
  values: readonly T[],
  work: (value: T) => Promise<void>,
  onProgress?: (progress: DraftAssetProgress) => void
): Promise<void> {
  let cursor = 0;
  let done = 0;
  onProgress?.({ done: 0, total: values.length });

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      const value = values[index];
      if (value === undefined) return;
      await work(value);
      done += 1;
      onProgress?.({ done, total: values.length });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(TRANSFER_CONCURRENCY, values.length) }, () => worker())
  );
}

async function uploadAsset(asset: EmbeddedAsset, path: string): Promise<void> {
  const response = await fetch(endpoint(`/storage/v1/object/${DRAFT_ASSET_BUCKET}/${encodedPath(path)}`), {
    method: 'POST',
    headers: headers({
      'Content-Type': asset.contentType,
      'x-upsert': 'true'
    }),
    body: new Blob([asset.bytes], { type: asset.contentType })
  });

  // The object name is its digest, so an upsert can only replace the object
  // with the same bytes. Storage reports duplicate non-upserts as HTTP 400 in
  // production, not consistently as 409, so explicit upsert is the portable
  // content-addressed de-duplication path.
  if (!response.ok) {
    throw new CloudError(`Could not upload a private draft asset (${response.status}).`, response.status);
  }
}

async function deleteAsset(path: string): Promise<void> {
  const response = await fetch(
    endpoint(`/storage/v1/object/${DRAFT_ASSET_BUCKET}/${encodedPath(path)}`),
    { method: 'DELETE', headers: headers() }
  );
  if (!response.ok && response.status !== 404) {
    throw new CloudError(`Could not delete a private draft asset (${response.status}).`, response.status);
  }
}

/** Delete every object beneath one permanently-purged draft prefix. */
export async function deleteDraftAssets(setId: string): Promise<number> {
  const paths = await listDraftAssetPaths(setId);
  await runBounded(paths, deleteAsset);
  return paths.length;
}

/**
 * Upload only missing embedded assets before returning a reference-form copy.
 *
 * A failure rejects before a document RPC can run. Successful earlier uploads
 * may be orphaned, which is harmless; the inverse — a saved document naming a
 * missing object — is never produced by this function.
 */
export async function uploadDraftAssets<T>(
  document: T,
  setId: string,
  options: DraftAssetUploadOptions = {}
): Promise<DraftAssetUploadResult<T>> {
  await auth.ensureFresh();
  const user = requirePermanentUser();
  const assets = await collectEmbeddedAssets(document);
  const mapping = new Map<string, string>();
  const uploads = new Map<string, EmbeddedAsset>();

  for (const asset of assets) {
    const path = objectPath(user.id, setId, asset);
    mapping.set(asset.dataUrl, referenceFor(path, asset.contentType));
    uploads.set(path, asset);
  }

  // A missing legacy manifest is not interpreted as “no objects”. One
  // authenticated prefix listing repairs the knowledge instead, after which
  // the successful revision acknowledgement persists the exact current paths.
  const supplied = validKnownPaths(options.knownPaths, user.id, setId);
  const available = supplied ?? new Set(await listDraftAssetPaths(setId));
  const missing = [...uploads.entries()].filter(([path]) => !available.has(path));
  await runBounded(
    missing,
    async ([path, asset]) => uploadAsset(asset, path),
    options.onProgress
  );
  return {
    document: substituteStrings(document, mapping),
    assetPaths: [...uploads.keys()].sort(),
    uploadedPaths: missing.map(([path]) => path).sort(),
    uploadedBytes: missing.reduce((total, [, asset]) => total + asset.bytes.length, 0)
  };
}

async function downloadAsset(reference: DraftAssetReference): Promise<string> {
  const response = await fetch(
    endpoint(
      `/storage/v1/object/authenticated/${DRAFT_ASSET_BUCKET}/${encodedPath(reference.path)}`
    ),
    {
      headers: headers(),
      cache: 'no-store'
    }
  );
  if (!response.ok) {
    throw new CloudError(`Could not download a private draft asset (${response.status}).`, response.status);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((await hashHex(bytes)) !== reference.hash) {
    throw new CloudError('A private draft asset did not match its content hash.', 0);
  }

  return toDataUrl(reference.contentType, bytes);
}

/**
 * Replace every private reference with an authenticated, hash-verified data URL.
 *
 * Mapping is applied only after all workers resolve. One missing or corrupt
 * object therefore rejects with the untouched reference-form document still
 * outside the editor; a partially hydrated generation can never escape.
 */
export async function hydrateDraftAssets<T>(
  document: T,
  expectedSetId: string,
  onProgress?: (progress: DraftAssetProgress) => void
): Promise<T> {
  return (await hydrateDraftAssetsWithManifest(document, expectedSetId, onProgress)).document;
}

export async function hydrateDraftAssetsWithManifest<T>(
  document: T,
  expectedSetId: string,
  onProgress?: (progress: DraftAssetProgress) => void
): Promise<HydratedDraftAssets<T>> {
  await auth.ensureFresh();
  const user = requirePermanentUser();
  const strings = collectStrings(document, (value) => value.startsWith(DRAFT_ASSET_PREFIX));
  const references: DraftAssetReference[] = [];

  for (const value of strings) {
    const reference = parseDraftAssetReference(value);
    if (!reference) throw new CloudError('A draft contains an invalid private asset reference.', 0);
    if (reference.ownerId !== user.id) {
      throw new CloudError('A draft contains a private asset owned by another account.', 403);
    }
    if (reference.setId !== expectedSetId) {
      throw new CloudError('A draft contains a private asset from another set.', 0);
    }
    references.push(reference);
  }

  const mapping = new Map<string, string>();
  await runBounded(
    references,
    async (reference) => {
      mapping.set(reference.reference, await downloadAsset(reference));
    },
    onProgress
  );
  return {
    document: substituteStrings(document, mapping),
    assetPaths: [...new Set(references.map((reference) => reference.path))].sort()
  };
}
