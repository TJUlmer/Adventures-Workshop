/**
 * An author-requested preview of the hosted assets named by a TTS object.
 *
 * Nothing here runs while a shared set is merely being viewed. A saved object
 * may name any URL, so the Components editor calls this only after its author
 * explicitly asks to load the preview. Fetched bytes remain an in-memory
 * cache; the set still stores the original JSON and export still passes it
 * through unchanged.
 */
import { buildTokenTexture } from '$lib/export/token-model';
import { TOKEN_RIM_COLOR } from '$lib/figures/types';
import type { Mesh } from './mesh';
import { createMesh } from './mesh';
import { parseObj } from './obj';
import {
  DEFAULT_OUTLINE_DETAIL,
  MAX_OUTLINE_DETAIL,
  MIN_OUTLINE_DETAIL,
  traceSilhouette
} from './silhouette';
import type { TokenOutline } from './silhouette';
import { buildTokenMesh, MM_PER_TTS_UNIT, tokenArtLayout } from './token';
import type { TokenSpec } from './token';
import type { TtsPreviewAsset, TtsPreviewScale } from './tts';

const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_CACHED_ASSETS = 8;
const MAX_OBJ_PREVIEW_TRIANGLES = 50_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** TTS builds every Custom Token face at this constant world-space area. */
const TOKEN_FACE_AREA_TTS_UNITS_SQUARED = 14;
const TOKEN_TRACE_SIZE = 256;
const MAX_IMAGE_DIMENSION = 8192;
const MAX_IMAGE_PIXELS = 40_000_000;

export interface LoadedTtsPreview {
  mesh: Mesh;
  /** An owned blob URL; release it with `releaseTtsPreview`. */
  texture: string | null;
  warning: string | null;
  /** TTS model coordinates are inches after the object's scale is applied. */
  millimetresPerUnit: number;
  /** TTS calls each world unit about an inch, rather than a production measurement. */
  approximateScale: true;
}

export class TtsPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TtsPreviewError';
  }
}

/** Cache bytes, not object URLs: every preview owns and can revoke its URL.
    Insertion order is the LRU order; combined with the per-asset byte cap this
    keeps the cache's retained remote data below a predictable ceiling. */
const fetchedAssets = new Map<string, Promise<Blob>>();

function rememberAsset(url: string, pending: Promise<Blob>): void {
  fetchedAssets.delete(url);
  fetchedAssets.set(url, pending);
  while (fetchedAssets.size > MAX_CACHED_ASSETS) {
    const oldest = fetchedAssets.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    fetchedAssets.delete(oldest);
  }
}

function normaliseUrl(raw: string, label: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new TtsPreviewError(`This TTS object has no ${label} URL.`);

  let url: URL;
  try {
    url = new URL(trimmed, location.href);
  } catch {
    throw new TtsPreviewError(`The TTS ${label} URL is not valid.`);
  }

  if (!['https:', 'http:', 'data:'].includes(url.protocol)) {
    const local = url.protocol === 'file:' || /^[a-z]:$/i.test(url.protocol);
    throw new TtsPreviewError(
      local
        ? `The TTS ${label} uses a local file path. Attach that asset directly to preview it here.`
        : `The TTS ${label} uses an unsupported ${url.protocol} address.`
    );
  }

  if (location.protocol === 'https:' && url.protocol === 'http:') {
    throw new TtsPreviewError(
      `The TTS ${label} uses HTTP, which a secure page cannot load. Use an HTTPS URL or attach the asset directly.`
    );
  }

  return url.href;
}

async function cappedBlob(response: Response, label: string): Promise<Blob> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_ASSET_BYTES) {
    throw new TtsPreviewError(`The TTS ${label} is larger than the 8 MB preview limit.`);
  }

  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > MAX_ASSET_BYTES) {
      throw new TtsPreviewError(`The TTS ${label} is larger than the 8 MB preview limit.`);
    }
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_ASSET_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new TtsPreviewError(`The TTS ${label} is larger than the 8 MB preview limit.`);
    }
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    chunks.push(copy.buffer);
  }

  return new Blob(chunks, {
    type: response.headers.get('content-type') ?? 'application/octet-stream'
  });
}

async function fetchAsset(rawUrl: string, label: string): Promise<Blob> {
  const url = normaliseUrl(rawUrl, label);
  const cached = fetchedAssets.get(url);
  if (cached) {
    rememberAsset(url, cached);
    return cached;
  }

  const pending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        credentials: 'omit',
        mode: 'cors',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      });
      if (!response.ok) {
        throw new TtsPreviewError(`The TTS ${label} URL returned ${response.status}.`);
      }
      return await cappedBlob(response, label);
    } catch (cause) {
      if (cause instanceof TtsPreviewError) throw cause;
      if (cause instanceof Error && cause.name === 'AbortError') {
        throw new TtsPreviewError(`The TTS ${label} took too long to respond.`);
      }
      throw new TtsPreviewError(
        `The TTS ${label} could not be downloaded. Its host may block browser access; attach the asset directly instead.`
      );
    } finally {
      clearTimeout(timeout);
    }
  })();

  rememberAsset(url, pending);
  void pending.catch(() => {
    if (fetchedAssets.get(url) === pending) fetchedAssets.delete(url);
  });
  return pending;
}

function urlsOf(asset: TtsPreviewAsset): string[] {
  return asset.type === 'obj'
    ? [asset.meshUrl, asset.textureUrl]
    : [asset.imageUrl, asset.secondaryImageUrl];
}

/** Reloads, retries and removals discard bytes even when decoding, rather than
    fetching, was what failed the previous attempt. */
export function clearTtsPreviewCache(asset: TtsPreviewAsset): void {
  for (const raw of urlsOf(asset)) {
    if (!raw.trim()) continue;
    try {
      fetchedAssets.delete(normaliseUrl(raw, 'asset'));
    } catch {
      // The next load reports the useful URL error; there is no cache key to clear.
    }
  }
}

function loadImage(source: string, label: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (
        image.naturalWidth < 1 ||
        image.naturalHeight < 1 ||
        image.naturalWidth > MAX_IMAGE_DIMENSION ||
        image.naturalHeight > MAX_IMAGE_DIMENSION ||
        image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS
      ) {
        reject(new TtsPreviewError(`The TTS ${label} has dimensions too large to preview safely.`));
        return;
      }
      resolve(image);
    };
    image.onerror = () => reject(new TtsPreviewError(`The TTS ${label} is not a readable image.`));
    image.src = source;
  });
}

async function textureUrl(blob: Blob, label: string): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    await loadImage(url, label);
    return url;
  } catch (cause) {
    URL.revokeObjectURL(url);
    throw cause;
  }
}

function safeScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(100, Math.max(0.001, Math.abs(value)));
}

/** Scale positions and inverse-scale normals so a non-uniform TTS Transform
    changes both the size and the lighting truthfully. */
function applyScale(mesh: Mesh, scale: TtsPreviewScale): Mesh {
  const sx = safeScale(scale.x);
  const sy = safeScale(scale.y);
  const sz = safeScale(scale.z);
  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);

  for (let i = 0; i < mesh.positions.length; i += 3) {
    positions[i] = (mesh.positions[i] as number) * sx;
    positions[i + 1] = (mesh.positions[i + 1] as number) * sy;
    positions[i + 2] = (mesh.positions[i + 2] as number) * sz;

    let nx = (mesh.normals[i] as number) / sx;
    let ny = (mesh.normals[i + 1] as number) / sy;
    let nz = (mesh.normals[i + 2] as number) / sz;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    normals[i] = nx;
    normals[i + 1] = ny;
    normals[i + 2] = nz;
  }

  return createMesh(positions, normals, mesh.uvs);
}

/** TTS's Stand Up option parents the token mesh under a quarter-turn anchor. */
function standTokenUp(mesh: Mesh): Mesh {
  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);

  for (let i = 0; i < mesh.positions.length; i += 3) {
    positions[i] = mesh.positions[i] as number;
    positions[i + 1] = mesh.positions[i + 2] as number;
    positions[i + 2] = -(mesh.positions[i + 1] as number);

    normals[i] = mesh.normals[i] as number;
    normals[i + 1] = mesh.normals[i + 2] as number;
    normals[i + 2] = -(mesh.normals[i + 1] as number);
  }

  return createMesh(positions, normals, mesh.uvs);
}

function validateMesh(mesh: Mesh): void {
  if (mesh.triangles === 0) throw new TtsPreviewError('The TTS model contains no triangles.');
  for (const coordinate of mesh.positions) {
    if (!Number.isFinite(coordinate)) {
      throw new TtsPreviewError('The TTS model contains invalid vertex coordinates.');
    }
  }
}

async function loadObjPreview(asset: Extract<TtsPreviewAsset, { type: 'obj' }>): Promise<LoadedTtsPreview> {
  const model = await fetchAsset(asset.meshUrl, 'model');
  const mesh = applyScale(
    parseObj(await model.text(), { maxTriangles: MAX_OBJ_PREVIEW_TRIANGLES }),
    asset.scale
  );
  validateMesh(mesh);

  let texture: string | null = null;
  let warning: string | null = null;
  if (asset.textureUrl.trim()) {
    try {
      texture = await textureUrl(await fetchAsset(asset.textureUrl, 'texture'), 'texture');
    } catch (cause) {
      warning = cause instanceof Error ? cause.message : 'The TTS texture could not be loaded.';
    }
  }

  return {
    mesh,
    texture,
    warning,
    millimetresPerUnit: MM_PER_TTS_UNIT,
    approximateScale: true
  };
}

function traceToken(image: HTMLImageElement, mergeDistancePixels: number): TokenOutline | null {
  const scale = Math.min(1, TOKEN_TRACE_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width + 2;
  canvas.height = height + 2;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(image, 1, 1, width, height);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = pixels[i * 4 + 3] as number;

  /* TTS's merge distance and this tracer's simplification tolerance are not
     identical operations. Scaling its familiar 5–40 range into this tracer's
     0.5–4 range preserves the useful intent without claiming byte parity. */
  const detail = Number.isFinite(mergeDistancePixels)
    ? Math.min(MAX_OUTLINE_DETAIL, Math.max(MIN_OUTLINE_DETAIL, mergeDistancePixels / 10))
    : DEFAULT_OUTLINE_DETAIL;
  const traced = traceSilhouette(alpha, canvas.width, canvas.height, { detail });
  return traced ? { points: traced.points, key: 'tts-preview' } : null;
}

async function loadTokenPreview(
  asset: Extract<TtsPreviewAsset, { type: 'token' }>
): Promise<LoadedTtsPreview> {
  const imageBlob = await fetchAsset(asset.imageUrl, 'token image');
  const source = URL.createObjectURL(imageBlob);

  try {
    const image = await loadImage(source, 'token image');
    const aspect = image.naturalWidth / image.naturalHeight;
    const lengthTts = Math.sqrt(TOKEN_FACE_AREA_TTS_UNITS_SQUARED / aspect);
    const widthTts = lengthTts * aspect;
    const widthMm = widthTts * MM_PER_TTS_UNIT;
    const lengthMm = lengthTts * MM_PER_TTS_UNIT;
    const thicknessTts = Number.isFinite(asset.thickness)
      ? Math.min(10, Math.max(0.001, Math.abs(asset.thickness)))
      : 0.2;

    const baseSpec: TokenSpec = {
      shape: 'silhouette',
      diameterMm: widthMm,
      lengthMm,
      thicknessMm: thicknessTts * MM_PER_TTS_UNIT,
      twoSided: false,
      outline: null
    };
    const outline = traceToken(image, asset.mergeDistancePixels);
    const spec: TokenSpec = outline
      ? { ...baseSpec, outline }
      : { ...baseSpec, shape: 'polygon', sides: 4 };
    const tokenMesh = buildTokenMesh(spec);
    // The anchor rotation happens inside the object's saved Transform, so a
    // non-uniform outer scale must be applied after this quarter turn.
    const mesh = applyScale(asset.standUp ? standTokenUp(tokenMesh) : tokenMesh, asset.scale);
    validateMesh(mesh);

    const painted = await buildTokenTexture(source, TOKEN_RIM_COLOR, tokenArtLayout(spec, 512));
    return {
      mesh,
      texture: await textureUrl(painted, 'token image'),
      warning: outline
        ? null
        : 'The token outline could not be traced, so this approximation uses its image bounds.',
      millimetresPerUnit: MM_PER_TTS_UNIT,
      approximateScale: true
    };
  } finally {
    URL.revokeObjectURL(source);
  }
}

export function ttsPreviewAssetKey(asset: TtsPreviewAsset): string {
  return JSON.stringify(asset);
}

export function loadTtsPreview(asset: TtsPreviewAsset): Promise<LoadedTtsPreview> {
  return asset.type === 'obj' ? loadObjPreview(asset) : loadTokenPreview(asset);
}

export function releaseTtsPreview(preview: LoadedTtsPreview | null): void {
  if (preview?.texture?.startsWith('blob:')) URL.revokeObjectURL(preview.texture);
}
