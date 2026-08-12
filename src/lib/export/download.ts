import type { ExportResult } from './types';

/**
 * Hand an export to the browser's download machinery. Stays entirely local:
 * the blob never leaves the page.
 */
export function saveExport(result: ExportResult): void {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a tick to start the download before the URL is dropped.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Read a user-picked file as text, for the import side of the same door. */
export function readFileAsText(file: File): Promise<string> {
  return file.text();
}
