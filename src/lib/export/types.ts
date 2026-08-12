import type { AdventureSet } from '$lib/sets/types';

export const EXPORT_FORMATS = ['json', 'png', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportResult {
  filename: string;
  mimeType: string;
  blob: Blob;
}

/**
 * A pluggable output. Everything runs in the browser — no export ever leaves
 * the machine.
 *
 * `available: false` marks a slot that is declared but not built yet; the UI
 * shows it disabled rather than hiding it, so the roadmap stays visible.
 */
export interface Exporter {
  readonly id: string;
  readonly label: string;
  readonly format: ExportFormat;
  readonly description: string;
  readonly available: boolean;
  run(set: AdventureSet): Promise<ExportResult>;
}

export class ExporterNotImplementedError extends Error {
  constructor(exporterId: string) {
    super(`Exporter "${exporterId}" is not implemented yet.`);
    this.name = 'ExporterNotImplementedError';
  }
}
