/** Privacy-safe, device-local diagnostics for the private draft save pipeline. */
import { cloudDraftRolloutConfig } from '$lib/cloud/config';
import { now } from '$lib/core/id';
import type { ExportResult } from '$lib/export/types';
import type { SetId } from '$lib/sets/types';
import { idbDelete, idbGet, idbPut, META_STORE } from '$lib/storage/indexeddb';

// v1 existed only during the uncommitted verifier pass and may contain
// synthetic events. Starting the shipped preview at a fresh key keeps those
// fixtures out of an author's first support report without deleting data.
const DIAGNOSTICS_KEY = 'cloud-draft-diagnostics-v2';
const MAX_ENTRIES = 100;

export type DraftDiagnosticStage = 'local-cache' | 'assets' | 'document' | 'acknowledgement';
export type DraftDiagnosticOutcome = 'succeeded' | 'failed' | 'conflict';

export interface DraftDiagnosticEvent {
  at: string;
  draftKey: string;
  operation: 'draft-save';
  stage: DraftDiagnosticStage;
  outcome: DraftDiagnosticOutcome;
  statusCode: number | null;
  durationMs: number;
  byteCount: number;
  revision: number | null;
  retryCount: number;
}

export interface DraftDiagnosticInput {
  localId: SetId;
  stage: DraftDiagnosticStage;
  outcome: DraftDiagnosticOutcome;
  statusCode?: number | null;
  durationMs: number;
  byteCount: number;
  revision?: number | null;
  retryCount: number;
}

export interface DraftDiagnosticsReport {
  format: 'unmatched-labs-cloud-diagnostics';
  version: 1;
  generatedAt: string;
  rolloutMode: string;
  online: boolean | null;
  eventCount: number;
  events: DraftDiagnosticEvent[];
}

/** An opaque correlation key is useful to support without exporting a real set id. */
export function diagnosticDraftKey(localId: string): string {
  let hash = 2166136261;
  for (let index = 0; index < localId.length; index += 1) {
    hash ^= localId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function finite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function createDiagnosticEvent(
  input: DraftDiagnosticInput,
  at = now()
): DraftDiagnosticEvent {
  return {
    at,
    draftKey: diagnosticDraftKey(input.localId),
    operation: 'draft-save',
    stage: input.stage,
    outcome: input.outcome,
    statusCode: input.statusCode ?? null,
    durationMs: finite(input.durationMs),
    byteCount: finite(input.byteCount),
    revision: input.revision ?? null,
    retryCount: finite(input.retryCount)
  };
}

export function createDiagnosticsReport(
  events: readonly DraftDiagnosticEvent[],
  rolloutMode: string,
  online: boolean | null,
  generatedAt = now()
): DraftDiagnosticsReport {
  return {
    format: 'unmatched-labs-cloud-diagnostics',
    version: 1,
    generatedAt,
    rolloutMode,
    online,
    eventCount: events.length,
    events: events.map((entry) => ({ ...entry }))
  };
}

function validEvent(value: unknown): value is DraftDiagnosticEvent {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<DraftDiagnosticEvent>;
  return (
    typeof row.at === 'string' &&
    typeof row.draftKey === 'string' &&
    row.operation === 'draft-save' &&
    (row.stage === 'local-cache' ||
      row.stage === 'assets' ||
      row.stage === 'document' ||
      row.stage === 'acknowledgement') &&
    (row.outcome === 'succeeded' || row.outcome === 'failed' || row.outcome === 'conflict') &&
    (row.statusCode === null || typeof row.statusCode === 'number') &&
    typeof row.durationMs === 'number' &&
    typeof row.byteCount === 'number' &&
    (row.revision === null || typeof row.revision === 'number') &&
    typeof row.retryCount === 'number'
  );
}

class DraftDiagnostics {
  entries = $state<DraftDiagnosticEvent[]>([]);
  loaded = $state(false);
  #writeTail: Promise<unknown> = Promise.resolve();

  async load(): Promise<void> {
    const stored = await idbGet<unknown[]>(META_STORE, DIAGNOSTICS_KEY);
    this.entries = (stored ?? []).filter(validEvent).slice(-MAX_ENTRIES);
    this.loaded = true;
  }

  record(input: DraftDiagnosticInput): void {
    const event = createDiagnosticEvent(input);
    this.entries = [...this.entries, event].slice(-MAX_ENTRIES);
    const snapshot = this.entries.map((entry) => ({ ...entry }));
    // Diagnostics must never sit in front of the save they describe. Writes
    // are best-effort and serialised only so an older snapshot cannot win.
    this.#writeTail = this.#writeTail.then(() => idbPut(META_STORE, DIAGNOSTICS_KEY, snapshot));
  }

  async clear(): Promise<void> {
    this.entries = [];
    await this.#writeTail;
    await idbDelete(META_STORE, DIAGNOSTICS_KEY);
  }

  export(): ExportResult {
    const report = createDiagnosticsReport(
      this.entries,
      cloudDraftRolloutConfig().mode,
      typeof navigator === 'undefined' ? null : navigator.onLine
    );
    const date = new Date().toISOString().slice(0, 10);
    return {
      filename: `unmatched-labs-cloud-diagnostics-${date}.json`,
      mimeType: 'application/json',
      blob: new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    };
  }
}

export const draftDiagnostics = new DraftDiagnostics();
