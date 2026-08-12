/**
 * Triangle meshes, in the one shape the viewer draws.
 *
 * Everything is unindexed — three vertices per triangle, no shared corners.
 * That costs memory a renderer would rather keep, and buys the two things this
 * app actually needs: STL has no concept of a shared vertex, and a flat-shaded
 * prism *wants* its faces to disagree about their normals at the seam.
 */

export interface MeshBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly center: readonly [number, number, number];
  /** Half the longest side, which is what a camera distance is derived from. */
  readonly radius: number;
}

export interface Mesh {
  /** 3 floats per vertex, 9 per triangle. */
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** 2 floats per vertex, or `null` for an untextured mesh. */
  readonly uvs: Float32Array | null;
  readonly triangles: number;
  readonly bounds: MeshBounds;
}

export function measure(positions: Float32Array): MeshBounds {
  if (positions.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 1 };
  }

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[i + axis] as number;
      if (value < (min[axis] as number)) min[axis] = value;
      if (value > (max[axis] as number)) max[axis] = value;
    }
  }

  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2
  ];
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);

  return { min, max, center, radius: span > 0 ? span / 2 : 1 };
}

/**
 * Face normals, one per triangle, repeated across its three vertices.
 *
 * Flat shading rather than smooth: these are printed parts and generated
 * prisms, where a hard edge is the truth about the object. Smoothing them
 * would round off exactly the facets a miniature is judged by.
 */
export function faceNormals(positions: Float32Array): Float32Array {
  const normals = new Float32Array(positions.length);

  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i] as number;
    const ay = positions[i + 1] as number;
    const az = positions[i + 2] as number;
    const ux = (positions[i + 3] as number) - ax;
    const uy = (positions[i + 4] as number) - ay;
    const uz = (positions[i + 5] as number) - az;
    const vx = (positions[i + 6] as number) - ax;
    const vy = (positions[i + 7] as number) - ay;
    const vz = (positions[i + 8] as number) - az;

    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;

    const length = Math.hypot(nx, ny, nz);
    if (length > 0) {
      nx /= length;
      ny /= length;
      nz /= length;
    }

    for (let corner = 0; corner < 3; corner += 1) {
      normals[i + corner * 3] = nx;
      normals[i + corner * 3 + 1] = ny;
      normals[i + corner * 3 + 2] = nz;
    }
  }

  return normals;
}

export function createMesh(
  positions: Float32Array,
  normals?: Float32Array | null,
  uvs?: Float32Array | null
): Mesh {
  return {
    positions,
    normals: normals && normals.length === positions.length ? normals : faceNormals(positions),
    uvs: uvs && uvs.length === (positions.length / 3) * 2 ? uvs : null,
    triangles: positions.length / 9,
    bounds: measure(positions)
  };
}
