/**
 * STL, in both the forms it comes in.
 *
 * Binary is what slicers and sculpting tools write; ASCII is what a few older
 * exporters still produce. Neither carries texture coordinates or colour — an
 * STL is a bag of triangles and nothing else — so the viewer shades them from
 * their own geometry.
 */
import type { Mesh } from './mesh';
import { createMesh } from './mesh';

/**
 * Binary STL is 84 bytes of preamble and exactly 50 per triangle, so the count
 * in the header can be checked against the file's own length. That is a far
 * better test than sniffing for the word "solid", which binary files have been
 * known to start with too.
 */
function looksBinary(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 84) return false;
  const count = new DataView(buffer).getUint32(80, true);
  return buffer.byteLength === 84 + count * 50;
}

function parseBinary(buffer: ArrayBuffer): Mesh {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  const positions = new Float32Array(count * 9);
  const normals = new Float32Array(count * 9);

  for (let triangle = 0; triangle < count; triangle += 1) {
    const at = 84 + triangle * 50;

    const nx = view.getFloat32(at, true);
    const ny = view.getFloat32(at + 4, true);
    const nz = view.getFloat32(at + 8, true);

    for (let corner = 0; corner < 3; corner += 1) {
      const from = at + 12 + corner * 12;
      const to = triangle * 9 + corner * 3;
      positions[to] = view.getFloat32(from, true);
      positions[to + 1] = view.getFloat32(from + 4, true);
      positions[to + 2] = view.getFloat32(from + 8, true);
      normals[to] = nx;
      normals[to + 1] = ny;
      normals[to + 2] = nz;
    }
  }

  // A zero normal is legal and common; the mesh recomputes those from geometry.
  const stated = normals.some((value) => value !== 0) ? normals : null;
  return createMesh(positions, stated);
}

const VERTEX = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;

function parseAscii(text: string): Mesh {
  const values: number[] = [];
  for (const match of text.matchAll(VERTEX)) {
    values.push(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  // Whole triangles only: a truncated file should not shear the last face.
  const usable = values.length - (values.length % 9);
  return createMesh(new Float32Array(values.slice(0, usable)));
}

export function parseStl(buffer: ArrayBuffer): Mesh {
  if (looksBinary(buffer)) return parseBinary(buffer);
  return parseAscii(new TextDecoder().decode(buffer));
}
