import type { AdventureSet } from '$lib/sets/types';
import { serializeSet, slugify } from './json';
import type { Exporter, ExportResult } from './types';

const jsonExporter: Exporter = {
  id: 'set-json',
  label: 'Set file (.json)',
  format: 'json',
  description: 'The complete, re-importable document. The format to keep backups in.',
  available: true,
  async run(set: AdventureSet): Promise<ExportResult> {
    const contents = serializeSet(set);
    return {
      filename: `${slugify(set.name)}.awset.json`,
      mimeType: 'application/json',
      blob: new Blob([contents], { type: 'application/json' })
    };
  }
};

/**
 * The Tabletop Simulator export is deliberately not here.
 *
 * An `Exporter` hands back one blob for the browser to save, and that export's
 * whole point is that it does not: it writes a folder of images and a save that
 * names them by path. Squeezing it into this shape would mean it could only
 * produce the archive-with-blanks fallback. See `tts-bundle.ts`.
 *
 * Print sheets are not here either, and for a related reason. There was a
 * `print-pdf` slot declared here for a long time, and building it revealed that
 * a PDF was the wrong answer: with no compression in the app beyond what a
 * stored ZIP entry needs, every card would have had to go into the file as a
 * JPEG, which is the worst possible treatment of the one mode — black line on
 * white — that print sheets exist for. Printed from the DOM the type stays
 * vector, and the browser's own dialogue writes a better PDF than we could.
 * So it is a screen: `print/PrintScreen.svelte`.
 */
export const EXPORTERS: readonly Exporter[] = [jsonExporter];

export function getExporter(id: string): Exporter | null {
  return EXPORTERS.find((exporter) => exporter.id === id) ?? null;
}
