/**
 * The canonical on-disk format. Every other exporter is a rendering of this;
 * this one is the source of truth and the only one that round-trips.
 */
import type { IsoDateTime } from '$lib/core/id';
import { now } from '$lib/core/id';
import { normalizeSet } from '$lib/sets/normalize';
import type { AdventureSet } from '$lib/sets/types';
import { SET_SCHEMA_VERSION } from '$lib/sets/types';

export const SET_FILE_FORMAT = 'adventures-workshop-set';

export interface SetFile {
  format: typeof SET_FILE_FORMAT;
  schemaVersion: number;
  exportedAt: IsoDateTime;
  set: AdventureSet;
}

export type ParseResult =
  | { readonly ok: true; readonly set: AdventureSet }
  | { readonly ok: false; readonly error: string };

export function serializeSet(set: AdventureSet): string {
  const file: SetFile = {
    format: SET_FILE_FORMAT,
    schemaVersion: SET_SCHEMA_VERSION,
    exportedAt: now(),
    set
  };
  return JSON.stringify(file, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Structural validation only — enough to reject a file that would break the
 * app, not a full schema check. A real validator lands with the importer.
 */
function validateSet(value: unknown): ParseResult {
  if (!isRecord(value)) return { ok: false, error: 'Set is not an object.' };
  if (typeof value['id'] !== 'string') return { ok: false, error: 'Set is missing an id.' };
  if (typeof value['name'] !== 'string') return { ok: false, error: 'Set is missing a name.' };

  for (const collection of ['characters', 'decks', 'cards'] as const) {
    if (!Array.isArray(value[collection])) {
      return { ok: false, error: `Set is missing a ${collection} array.` };
    }
  }

  // Cards address their deck by ID; a dangling reference would leave cards
  // invisible in every view rather than failing loudly later.
  const deckIds = new Set(
    (value['decks'] as unknown[])
      .filter(isRecord)
      .map((deck) => deck['id'])
      .filter((id): id is string => typeof id === 'string')
  );
  const orphan = (value['cards'] as unknown[])
    .filter(isRecord)
    .find((card) => typeof card['deckId'] !== 'string' || !deckIds.has(card['deckId']));

  if (orphan) {
    return { ok: false, error: 'File contains a card that points at a missing deck.' };
  }

  return { ok: true, set: value as unknown as AdventureSet };
}

export function parseSetFile(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'File is not valid JSON.' };
  }

  if (!isRecord(parsed)) return { ok: false, error: 'File is not an object.' };

  if (parsed['format'] !== SET_FILE_FORMAT) {
    return { ok: false, error: 'File was not produced by Unmatched Labs.' };
  }

  const schemaVersion = parsed['schemaVersion'];
  if (typeof schemaVersion !== 'number') {
    return { ok: false, error: 'File is missing a schema version.' };
  }
  if (schemaVersion > SET_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `File uses schema v${schemaVersion}; this build understands up to v${SET_SCHEMA_VERSION}.`
    };
  }

  const result = validateSet(parsed['set']);
  if (!result.ok) return result;

  // Repair rather than reject: a set saved before a field existed is missing
  // it, and dropping the author's work over that would be the wrong trade.
  return { ok: true, set: normalizeSet(result.set) };
}

/** Filesystem-safe slug used for export filenames. */
export function slugify(value: string, fallback = 'adventure'): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : fallback;
}
