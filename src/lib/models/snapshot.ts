/**
 * A still picture of a mesh, for a thumbnail — not a viewer.
 *
 * `ModelViewer.svelte` is for looking a figure over; this is for a grid of
 * tiles that each just need to say "here is the shape and skin of this
 * piece" at a glance. One offscreen canvas, reused draw for draw, so a set
 * with many generated figures never opens more than one WebGL context for
 * it — several browsers cap those in the teens per page, and a context per
 * tile would be the kind of thing that works fine in testing and then breaks
 * on someone's real set. The still target is a 2D canvas; `drawMeshInto`
 * borrows the same single WebGL source as interactive viewers before adding
 * any projected labels.
 */
import type { ModelAnnotation } from './gl';
import { drawMeshInto } from './gl';
import type { Mesh } from './mesh';

/** `onload` rather than `decode()` — see `token-model.ts`'s own note on why. */
function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read that image.'));
    image.src = source;
  });
}

let shared: HTMLCanvasElement | null = null;

/**
 * A three-quarter view — the same start `ModelViewer` opens on — so a static
 * snapshot and the interactive viewer someone opens next agree on what the
 * piece "normally" looks like.
 */
const SNAPSHOT_CAMERA = { yaw: 0.6, pitch: 0.5, zoom: 1 } as const;

/**
 * Every call draws to the *same* canvas, so two snapshots asked for at once
 * cannot land on top of each other mid-draw — a grid of tiles each awaiting
 * their own texture image would otherwise race, and whichever finished last
 * would win every tile. Chaining onto this queue serialises them instead;
 * the tail is kept alive through a failure so one bad figure does not wedge
 * every snapshot after it.
 */
let queue: Promise<unknown> = Promise.resolve();

async function renderOnce(
  mesh: Mesh,
  textureSource: string | null,
  size: number,
  annotations: readonly ModelAnnotation[]
): Promise<string | null> {
  if (mesh.triangles === 0) return null;

  try {
    const textureImage = textureSource ? await loadImage(textureSource) : null;
    const canvas = (shared ??= document.createElement('canvas'));
    canvas.width = size;
    canvas.height = size;
    drawMeshInto(canvas, mesh, textureImage, SNAPSHOT_CAMERA, annotations);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * Render `mesh` once and hand back a PNG data URL, or `null` if there is
 * nothing to draw or the browser refuses the context. Never throws — a
 * thumbnail that fails to build is a reason to fall back to something else,
 * not a reason to break the screen it is on.
 */
export function renderMeshSnapshot(
  mesh: Mesh,
  textureSource: string | null,
  size = 160,
  annotations: readonly ModelAnnotation[] = []
): Promise<string | null> {
  const run = queue.then(() => renderOnce(mesh, textureSource, size, annotations));
  queue = run.catch(() => undefined);
  return run;
}
