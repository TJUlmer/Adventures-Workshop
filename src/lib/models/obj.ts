/**
 * Wavefront OBJ — the geometry of it, which is all a viewer needs.
 *
 * Materials, groups, smoothing and free-form surfaces are skipped: this reads
 * a model to look at, not to edit. Faces with more than three corners are
 * triangulated as a fan, which is right for the convex faces these files carry
 * and no worse than what most viewers do for the rest.
 */
import type { Mesh } from './mesh';
import { createMesh } from './mesh';

/** OBJ indices are 1-based, and negative ones count back from the end. */
function resolve(token: string, length: number): number {
  const index = Number.parseInt(token, 10);
  if (Number.isNaN(index) || index === 0) return -1;
  return index > 0 ? index - 1 : length + index;
}

export function parseObj(text: string): Mesh {
  const vertices: number[] = [];
  const texcoords: number[] = [];
  const normals: number[] = [];

  const outPositions: number[] = [];
  const outNormals: number[] = [];
  const outUvs: number[] = [];

  /** One `f` corner: push whatever of position, uv and normal it names. */
  const corner = (token: string): boolean => {
    const [v, vt, vn] = token.split('/');
    const vi = resolve(v ?? '', vertices.length / 3);
    if (vi < 0 || vi * 3 + 2 >= vertices.length) return false;

    outPositions.push(
      vertices[vi * 3] as number,
      vertices[vi * 3 + 1] as number,
      vertices[vi * 3 + 2] as number
    );

    const ti = vt ? resolve(vt, texcoords.length / 2) : -1;
    if (ti >= 0 && ti * 2 + 1 < texcoords.length) {
      outUvs.push(texcoords[ti * 2] as number, texcoords[ti * 2 + 1] as number);
    } else {
      outUvs.push(0, 0);
    }

    const ni = vn ? resolve(vn, normals.length / 3) : -1;
    if (ni >= 0 && ni * 3 + 2 < normals.length) {
      outNormals.push(
        normals[ni * 3] as number,
        normals[ni * 3 + 1] as number,
        normals[ni * 3 + 2] as number
      );
    } else {
      outNormals.push(0, 0, 0);
    }
    return true;
  };

  let sawUv = false;
  let sawNormal = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const keyword = parts[0];

    if (keyword === 'v') {
      vertices.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    } else if (keyword === 'vt') {
      texcoords.push(Number(parts[1]), Number(parts[2]));
      sawUv = true;
    } else if (keyword === 'vn') {
      normals.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
      sawNormal = true;
    } else if (keyword === 'f') {
      const face = parts.slice(1).filter(Boolean);
      // Fan from the first corner: 4 corners become 2 triangles, 5 become 3.
      for (let i = 1; i + 1 < face.length; i += 1) {
        const before = outPositions.length;
        const ok =
          corner(face[0] as string) && corner(face[i] as string) && corner(face[i + 1] as string);
        if (!ok) {
          outPositions.length = before;
          outUvs.length = (before / 3) * 2;
          outNormals.length = before;
        }
      }
    }
  }

  return createMesh(
    new Float32Array(outPositions),
    sawNormal ? new Float32Array(outNormals) : null,
    sawUv ? new Float32Array(outUvs) : null
  );
}
