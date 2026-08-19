/**
 * Lifting embedded assets out of a document, and putting them back.
 *
 * A set carries every picture as a data URL, which is what lets one file be
 * handed to someone else and still work. It is also why a set cannot go into a
 * database row as it stands: base64 costs a third again over the bytes it
 * encodes, and a set with a dozen pieces of artwork is megabytes of it.
 *
 * So publishing swaps them for Storage URLs and fetching swaps them back. The
 * local document is never touched — it keeps its data URLs, offline keeps
 * working, and the export paths keep working too. That last one is not a nicety:
 * `card-image.ts` inlines `/assets/` URLs only, and a remote image drawn to a
 * canvas taints it, so a document holding https artwork would break PNG and
 * Tabletop Simulator export in a way that would be blamed on the exporter.
 *
 * ## Why this walks the document instead of naming the fields
 *
 * There are eleven `Artwork` fields across cards, characters, figures, the
 * threat board and the set itself, plus a figure's mesh `source`, which is not
 * an `Artwork` at all. A list of eleven is a list that is wrong the day someone
 * adds a twelfth — and the failure is silent and expensive: a multi-megabyte
 * blob quietly left in a database row. Walking for anything shaped like a data
 * URL cannot miss one, and treats a mesh exactly like a picture, which is what
 * we want anyway.
 */

import { hashHex } from '$lib/core/hash';
import { requestBlob } from './http';

/** How many assets `fetchAndEmbedAssets` downloads at once. */
const FETCH_CONCURRENCY = 6;

/** A data URL found in a document, and what it decodes to. */
export interface EmbeddedAsset {
  /** The original `data:…` string, which is also its key in the document. */
  dataUrl: string;
  /** Content hash, hex. Names the object and de-duplicates repeated artwork. */
  hash: string;
  contentType: string;
  bytes: Uint8Array<ArrayBuffer>;
}

const DATA_URL = /^data:([^;,]*)(;base64)?,/i;

/**
 * File extension for a content type.
 *
 * Storage serves the `Content-Type` we upload with, so the extension is for
 * humans looking at a bucket rather than for correctness. Unknown types keep
 * `bin` rather than guessing.
 */
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'model/obj': 'obj',
  'text/plain': 'txt',
  'application/json': 'json'
};

export function extensionFor(contentType: string): string {
  return EXTENSIONS[contentType.toLowerCase()] ?? 'bin';
}

export function isDataUrl(value: string): boolean {
  return DATA_URL.test(value);
}

/** Decode a data URL to its bytes and declared type. */
export function decodeDataUrl(dataUrl: string): { contentType: string; bytes: Uint8Array<ArrayBuffer> } {
  const match = DATA_URL.exec(dataUrl);
  if (!match) throw new Error('Not a data URL.');

  const contentType = (match[1] ?? '').trim() || 'application/octet-stream';
  const payload = dataUrl.slice(match[0].length);

  if (match[2]) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return { contentType, bytes };
  }

  // Percent-encoded rather than base64 — how the texture SVGs are written.
  return { contentType, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
}

export function toDataUrl(contentType: string, bytes: Uint8Array): string {
  let binary = '';
  // Chunked: spreading a multi-megabyte array into `apply` overflows the stack,
  // which shows up only once someone publishes a set with real artwork in it.
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

/**
 * Every distinct string in a document that matches a predicate.
 *
 * Deliberately structural: objects and arrays are walked, everything else is
 * looked at and left alone. A `Set` because the same picture appearing on four
 * cards is one upload, not four.
 */
function collectStrings(value: unknown, matches: (text: string) => boolean): Set<string> {
  const found = new Set<string>();

  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      if (matches(node)) found.add(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node && typeof node === 'object') {
      for (const item of Object.values(node)) walk(item);
    }
  };

  walk(value);
  return found;
}

/**
 * A deep copy with strings substituted from a mapping.
 *
 * A copy rather than an edit in place, because the document being rewritten is
 * the *live* one the author is looking at. Publishing must not reach into it —
 * that would swap the artwork out from under the editor and, worse, leave the
 * set unopenable offline.
 */
export function substituteStrings<T>(value: T, mapping: ReadonlyMap<string, string>): T {
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return mapping.get(node) ?? node;
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(node)) out[key] = walk(item);
      return out;
    }
    return node;
  };

  return walk(value) as T;
}

/** Every embedded asset in a document, de-duplicated and hashed. */
export async function collectEmbeddedAssets(document: unknown): Promise<EmbeddedAsset[]> {
  const urls = collectStrings(document, isDataUrl);
  const assets: EmbeddedAsset[] = [];

  for (const dataUrl of urls) {
    const { contentType, bytes } = decodeDataUrl(dataUrl);
    assets.push({ dataUrl, contentType, bytes, hash: await hashHex(bytes) });
  }

  return assets;
}

/** Every string in a document that points at the given public bucket prefix. */
export function collectPublishedAssets(document: unknown, prefix: string): string[] {
  return [...collectStrings(document, (text) => text.startsWith(prefix))];
}

/** Total bytes a set of assets will occupy, for showing before an upload. */
export function totalBytes(assets: readonly EmbeddedAsset[]): number {
  return assets.reduce((sum, asset) => sum + asset.bytes.length, 0);
}

/**
 * Re-embed every published asset in a document as a data URL, replacing the
 * Storage references `publishSet`/`uploadAsset` left behind.
 *
 * Downloaded with bounded concurrency rather than one at a time: a set with a
 * few dozen pieces of artwork was previously a few dozen sequential round
 * trips, which is most of what made opening a shared set or a contribution
 * feel slow. `FETCH_CONCURRENCY` workers pull from one shared cursor, so the
 * total stays bounded whatever the document's own size.
 *
 * One missing picture must never cost the whole document, here exactly as it
 * did in the sequential version: a failed fetch simply leaves that URL in
 * place, which `hasArtwork` treats as present and shows as broken art —
 * better than a set or an offer that refuses to open at all.
 */
export async function fetchAndEmbedAssets<T>(
  document: T,
  prefix: string,
  onProgress?: (done: number, total: number) => void
): Promise<T> {
  const urls = prefix ? collectPublishedAssets(document, prefix) : [];
  const mapping = new Map<string, string>();
  let done = 0;
  let cursor = 0;
  onProgress?.(0, urls.length);

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      const url = urls[index];
      if (url === undefined) return;
      try {
        const blob = await requestBlob(url);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        mapping.set(url, toDataUrl(blob.type || 'application/octet-stream', bytes));
      } catch {
        // See doc comment above.
      }
      done += 1;
      onProgress?.(done, urls.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, urls.length) }, () => worker())
  );

  return substituteStrings(document, mapping);
}
