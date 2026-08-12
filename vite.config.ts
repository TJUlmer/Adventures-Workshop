import { mkdir, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const EXPORTS_DIR = fileURLToPath(new URL('./exports', import.meta.url));

/** Where the page asks about, and posts to. */
const ENDPOINT = '/__workshop/export';

/**
 * A segment of an export path. Deliberately narrower than what a filesystem
 * would accept: everything the exporter writes is named from `slugify`, so
 * anything outside this alphabet is a bug or an attempt at something else.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function resolveExportPath(value: string | null): string | null {
  if (!value) return null;
  const segments = value.split('/');
  if (segments.length === 0 || segments.length > 4) return null;
  if (!segments.every((segment) => SEGMENT.test(segment))) return null;
  return join(EXPORTS_DIR, ...segments);
}

/**
 * Is `target` genuinely inside `root`?
 *
 * `SEGMENT` already makes `..` unrepresentable, so this can only ever agree
 * with it. It is here because deleting is the one operation whose blast radius
 * is worth a second, independent check — one that reasons about the resolved
 * path rather than about the string it was built from.
 */
function inside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel.length > 0 && !rel.startsWith('..') && !rel.startsWith(sep);
}

/** Every file under `dir`, as paths relative to it, using forward slashes. */
async function filesUnder(dir: string, base = ''): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // No such folder yet: nothing to prune, which is not an error.
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    /* Symlinks are skipped rather than followed. A link inside the bundle could
       point anywhere on disk, and walking it would put deletion outside the one
       directory this is allowed to touch. */
    if (entry.isSymbolicLink()) continue;

    const full = join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await filesUnder(full, rel)));
    else if (entry.isFile()) found.push(rel);
  }
  return found;
}

/**
 * Delete everything in a bundle folder the manifest does not claim.
 *
 * Images are named after their contents so Tabletop Simulator's URL cache
 * cannot serve a stale one, which means every edit leaves the previous file
 * behind. Left alone, a folder accumulates a copy of the board per iteration;
 * asking the author to empty it by hand is not automation.
 *
 * Pruning happens *after* the new files are written, never before. A clear-then-
 * write would leave a window with no usable export, and an export that failed
 * halfway through would take the previous good one with it.
 *
 * Only files are removed, and only ones directly accounted for by the walk
 * above — nothing is deleted by pattern. Directories go only once empty, and
 * the bundle folder itself always stays.
 */
async function pruneBundle(root: string, keep: Set<string>): Promise<string[]> {
  const removed: string[] = [];

  for (const rel of await filesUnder(root)) {
    if (keep.has(rel)) continue;
    const full = join(root, rel);
    if (!inside(root, full)) continue;
    await rm(full, { force: true });
    removed.push(rel);
  }

  // Deepest first, so a directory emptied by the pass above can go too.
  const directories = new Set<string>();
  for (const rel of removed) {
    const parts = rel.split('/');
    for (let depth = parts.length - 1; depth > 0; depth -= 1) {
      directories.add(parts.slice(0, depth).join('/'));
    }
  }
  for (const rel of [...directories].sort((a, b) => b.length - a.length)) {
    const full = join(root, rel);
    if (!inside(root, full)) continue;
    // Fails when the directory still holds something, which is the guard.
    await rmdir(full).catch(() => undefined);
  }

  return removed;
}

/**
 * Lets the page write an export into `exports/`, and tells it where that is.
 *
 * Tabletop Simulator will not read a data URI: a deck's face sheet has to be a
 * URL it can fetch, and the only one available with no server and no hosting is
 * `file:///…`. A page cannot know its own absolute path on disk — this can, so
 * the writing happens here and the answer comes back as the `file://` URL the
 * exporter bakes into the save. That is the whole reason this exists; without
 * it a TTS export is a file with blanks in it for the author to fill in.
 *
 * Dev only, and deliberately narrow: one fixed directory, at most four path
 * segments, and every segment matched against `SEGMENT`. `..` cannot pass, so
 * nothing here can address a path outside `exports/`.
 */
function exportsFolder(): Plugin {
  return {
    name: 'adventures-workshop:exports-folder',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(ENDPOINT, (request, response) => {
        const send = (status: number, body: unknown): void => {
          response.statusCode = status;
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify(body));
        };

        // The probe: "is there somewhere to write, and what is it called?"
        if (request.method === 'GET') {
          send(200, { directory: EXPORTS_DIR, url: pathToFileURL(EXPORTS_DIR).href });
          return;
        }

        if (request.method !== 'POST' && request.method !== 'DELETE') {
          send(405, {
            error: 'GET locates the exports folder, POST writes a file, DELETE prunes a bundle.'
          });
          return;
        }

        const query = new URL(request.url ?? '/', 'http://localhost').searchParams;
        const target = resolveExportPath(query.get('path'));
        if (!target) {
          send(400, { error: 'That export path is not one this can write.' });
          return;
        }

        /*
         * Pruning takes a bundle *folder*, so it is restricted to a single
         * segment directly under `exports/`. Allowing the four `resolveExportPath`
         * permits would let a request aim deletion at a subfolder of someone
         * else's export, and there is no reason to.
         */
        if (request.method === 'DELETE') {
          const bundle = query.get('path') ?? '';
          if (bundle.includes('/') || !inside(EXPORTS_DIR, target)) {
            send(400, { error: 'Pruning takes one bundle folder inside exports/.' });
            return;
          }

          const body: Buffer[] = [];
          request.on('data', (chunk: Buffer) => body.push(chunk));
          request.on('error', () => send(400, { error: 'The request did not finish.' }));
          request.on('end', () => {
            let keep: string[];
            try {
              const parsed: unknown = JSON.parse(Buffer.concat(body).toString('utf8') || '{}');
              const list =
                typeof parsed === 'object' && parsed !== null
                  ? (parsed as Record<string, unknown>)['keep']
                  : null;
              if (!Array.isArray(list) || !list.every((item) => typeof item === 'string')) {
                send(400, { error: 'Send { keep: string[] } — the files that should survive.' });
                return;
              }
              keep = list;
            } catch {
              send(400, { error: 'The keep list was not JSON.' });
              return;
            }

            /* An empty manifest would mean "delete everything", which is never
               what a finished export wants and is exactly what a bug would ask
               for. Refused rather than obeyed. */
            if (keep.length === 0) {
              send(400, { error: 'Refusing to prune against an empty manifest.' });
              return;
            }

            void pruneBundle(target, new Set(keep))
              .then((removed) => send(200, { removed }))
              .catch((error: unknown) =>
                send(500, { error: error instanceof Error ? error.message : 'Could not prune.' })
              );
          });
          return;
        }

        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('error', () => send(400, { error: 'The upload did not finish.' }));
        request.on('end', () => {
          void mkdir(dirname(target), { recursive: true })
            .then(() => writeFile(target, Buffer.concat(chunks)))
            .then(() => send(200, { path: target, url: pathToFileURL(target).href }))
            .catch((error: unknown) =>
              send(500, { error: error instanceof Error ? error.message : 'Could not write it.' })
            );
        });
      });
    }
  };
}

export default defineConfig({
  plugins: [svelte(), exportsFolder()],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url))
    }
  },
  server: {
    // Honour PORT so a second dev server can run alongside one on 5173.
    port: Number(process.env['PORT']) || 5173,
    strictPort: false
  },
  build: {
    target: 'esnext',
    sourcemap: true
  }
});
