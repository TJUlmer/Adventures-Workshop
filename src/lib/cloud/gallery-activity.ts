/** Private, best-effort activity on published gallery content. */
import { auth } from './auth.svelte';
import { cloudEnabled } from './config';
import { request } from './http';
import { readGalleryVisitorKey } from '$lib/storage/settings';
import type { PublishScope } from '$lib/sets/scope';

export interface GalleryActivitySource {
  slug: string;
  owner_id: string;
  scope: string;
  character_id?: string | null;
}

export interface GalleryExportActivity {
  format: 'png' | 'tts' | 'project';
  scope: PublishScope;
  customized: boolean;
}

// Avoid repeated network calls while a visitor switches scopes. Server receipts
// are still authoritative across reloads and concurrent tabs.
let recordedDay = '';
const recorded = new Set<string>();
const pending = new Set<string>();

async function record(
  source: GalleryActivitySource,
  activity: 'view' | 'export',
  characterId: string | null,
  scope: string,
  format: GalleryExportActivity['format'] | null
): Promise<void> {
  if (!cloudEnabled() || auth.user?.id === source.owner_id) return;
  const day = new Date().toISOString().slice(0, 10);
  if (recordedDay !== day) {
    recordedDay = day;
    recorded.clear();
  }
  const key = JSON.stringify([day, source.slug, activity, characterId, scope, format]);
  if (recorded.has(key) || pending.has(key)) return;
  pending.add(key);
  try {
    const visitor = await readGalleryVisitorKey(day);
    await request('/rest/v1/rpc/record_gallery_activity', {
      method: 'POST',
      anonymous: true,
      body: {
        share_slug: source.slug,
        visitor_key: visitor,
        activity,
        character_key: characterId,
        output_format: format,
        output_scope: scope
      }
    });
    if (recordedDay === day) recorded.add(key);
  } catch {
    // Counting must never delay or turn a successful export into a failure.
  } finally {
    pending.delete(key);
  }
}

export function recordGalleryView(
  source: GalleryActivitySource,
  scope: PublishScope,
  characterHint?: string
): void {
  const character = scope.kind === 'hero' ? scope.characterId : characterHint ?? source.character_id ?? null;
  void record(source, 'view', character, scope.kind, null);
}

export function recordGalleryExport(
  source: GalleryActivitySource,
  output: GalleryExportActivity
): void {
  const character = output.scope.kind === 'hero' ? output.scope.characterId : source.character_id ?? null;
  void record(source, 'export', character, output.customized ? 'custom' : output.scope.kind, output.format);
}
