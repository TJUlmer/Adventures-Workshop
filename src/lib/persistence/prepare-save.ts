/** CPU-heavy preparation for one durable draft generation. */
import { serializeSet } from '$lib/export/json';
import {
  currentPublicationFingerprints,
  withCurrentPublicationFingerprints
} from '$lib/sets/publication-fingerprint';
import type { AdventureSet } from '$lib/sets/types';
import { draftContentHash } from './content-hash';

export interface PreparedDraftSave {
  currentPublicationFingerprints: Record<string, string>;
  hash: string;
  json: string;
  jsonByteCount: number;
}

export interface DraftPreparationRequest {
  id: number;
  set: AdventureSet;
}

export type DraftPreparationResponse =
  | { id: number; ok: true; prepared: PreparedDraftSave }
  | { id: number; ok: false; message: string };

export async function prepareDraftSave(set: AdventureSet): Promise<PreparedDraftSave> {
  const current = currentPublicationFingerprints(set);
  const preparedSet = withCurrentPublicationFingerprints(set, current);
  const json = serializeSet(preparedSet);
  return {
    currentPublicationFingerprints: current,
    hash: await draftContentHash(preparedSet),
    json,
    jsonByteCount: new TextEncoder().encode(json).byteLength
  };
}
