/**
 * Turning a stored model file into something the viewer can draw.
 *
 * Models live in the document as data URLs, so loading one is a fetch against
 * the page itself — no network, no file system, and it works the same whether
 * the set was just imported or has been in the browser for a month.
 */
import type { Mesh } from './mesh';
import { parseObj } from './obj';
import { parseStl } from './stl';

export const VIEWABLE_MODEL_TYPES = ['.stl', '.obj'] as const;

/** Whether the viewer can show this file, judged by its name. */
export function isViewableModel(name: string): boolean {
  const lower = name.toLowerCase();
  return VIEWABLE_MODEL_TYPES.some((extension) => lower.endsWith(extension));
}

export class UnsupportedModelError extends Error {
  constructor(name: string) {
    super(`${name} is not an STL or OBJ, so it cannot be shown here.`);
    this.name = 'UnsupportedModelError';
  }
}

export async function loadMesh(name: string, source: string): Promise<Mesh> {
  const lower = name.toLowerCase();
  const buffer = await (await fetch(source)).arrayBuffer();

  if (lower.endsWith('.stl')) return parseStl(buffer);
  if (lower.endsWith('.obj')) return parseObj(new TextDecoder().decode(buffer));
  throw new UnsupportedModelError(name);
}
