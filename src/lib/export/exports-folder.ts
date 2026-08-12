/**
 * Writing an export to disk rather than through the download bar.
 *
 * Every other export here is a blob the browser saves wherever the author's
 * downloads go, and that is the right shape for all of them — except this one.
 * A Tabletop Simulator save refers to its images by URL, and TTS will not read
 * a data URI, so the save is only useful once its images are somewhere with an
 * address. `file:///…` is the only such address that needs no hosting, and the
 * page cannot know its own absolute path — the dev server can, and answers
 * here. See the `exports-folder` plugin in `vite.config.ts`.
 *
 * Absent — a built copy served from anywhere else — this returns `null` and the
 * caller falls back to an archive with the URLs left blank. Nothing else in the
 * app depends on the dev server, and this must not become the first thing that
 * does.
 */

const ENDPOINT = '/__workshop/export';

export interface ExportsFolder {
  /** Absolute path on disk, for telling the author where the files went. */
  directory: string;
  /** `file://` URL of that directory. No trailing slash. */
  url: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The folder, or `null` when there is nothing listening. */
export async function findExportsFolder(): Promise<ExportsFolder | null> {
  let payload: unknown;
  try {
    const response = await fetch(ENDPOINT);
    if (!response.ok) return null;
    payload = await response.json();
  } catch {
    // No dev server, or it answered with the app's HTML. Either way: no folder.
    return null;
  }

  if (!isRecord(payload)) return null;
  const { directory, url } = payload;
  if (typeof directory !== 'string' || typeof url !== 'string') return null;

  return { directory, url: url.replace(/\/$/, '') };
}

export class ExportWriteError extends Error {
  constructor(path: string, reason: string) {
    super(`Could not write ${path}: ${reason}`);
    this.name = 'ExportWriteError';
  }
}

/**
 * Write one file, at a path relative to the exports folder.
 *
 * Forward slashes make the folders, as they do in the ZIP writer. The server
 * refuses anything it does not like the look of rather than trusting this.
 */
export async function writeToExportsFolder(path: string, bytes: Uint8Array): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      /* A fresh buffer: `fetch` will not take a view onto memory it cannot
         prove is exclusively ours. */
      body: new Blob([new Uint8Array(bytes)])
    });
  } catch (error) {
    throw new ExportWriteError(path, error instanceof Error ? error.message : 'the write failed');
  }

  if (!response.ok) {
    let reason = `the server said ${response.status}`;
    try {
      const payload: unknown = await response.json();
      if (isRecord(payload) && typeof payload['error'] === 'string') reason = payload['error'];
    } catch {
      // Keep the status line; a body that is not JSON says nothing more useful.
    }
    throw new ExportWriteError(path, reason);
  }
}

/**
 * Delete anything left in a bundle folder that this export did not write.
 *
 * Images are named after their contents, so Tabletop Simulator's URL cache
 * cannot hand back a stale one — and so every edit leaves the previous file
 * behind. Without this a folder gathers one copy of the board per iteration,
 * and the alternative is telling the author to empty it themselves, which is
 * not automation.
 *
 * Called *after* every file is written, deliberately. Clearing first would open
 * a window with no usable export, and an export that failed halfway would have
 * destroyed the last good one on its way to failing.
 *
 * Best-effort: a folder that will not tidy itself is untidy, not broken, so the
 * count comes back and nothing throws. `paths` are relative to the bundle.
 */
export async function pruneExportsBundle(
  bundle: string,
  paths: readonly string[]
): Promise<number> {
  // An empty manifest would ask the server to delete everything. It refuses,
  // but there is no reason to make the round trip and find out.
  if (paths.length === 0) return 0;

  try {
    const response = await fetch(`${ENDPOINT}?path=${encodeURIComponent(bundle)}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keep: paths })
    });
    if (!response.ok) return 0;

    const payload: unknown = await response.json();
    return isRecord(payload) && Array.isArray(payload['removed']) ? payload['removed'].length : 0;
  } catch {
    return 0;
  }
}
