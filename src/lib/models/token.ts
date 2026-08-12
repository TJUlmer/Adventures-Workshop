/**
 * Tokens: a flat prism with a picture on it.
 *
 * A disc or a hex a couple of millimetres thick is the commonest component in
 * the box after the cards, and it is the one thing here that can be *generated*
 * rather than sculpted — so it is, and the same geometry serves the preview and
 * the file Tabletop Simulator loads.
 *
 * The mesh is built lying flat in X/Z with thickness in Y, which is the way up
 * Tabletop Simulator expects a model to arrive.
 */
import type { Mesh } from './mesh';
import { createMesh } from './mesh';

/**
 * A round token, or one with straight sides.
 *
 * `hex` was its own shape until a `polygon` with a side count subsumed it: six
 * sides *is* the hex, and the same generator now makes a triangle, a square or
 * anything up to a dodecagon. Old documents saying `hex` are mapped to a
 * six-sided polygon on load — see `sets/normalize.ts`.
 */
export const TOKEN_SHAPES = ['circle', 'polygon'] as const;
export type TokenShape = (typeof TOKEN_SHAPES)[number];

export const TOKEN_SHAPE_LABELS: Readonly<Record<TokenShape, string>> = {
  circle: 'Circle',
  polygon: 'Polygon'
} as const;

/** Three sides is the fewest that has an inside; more than twelve reads round. */
export const MIN_POLYGON_SIDES = 3;
export const MAX_POLYGON_SIDES = 12;
export const DEFAULT_POLYGON_SIDES = 6;

export interface TokenSpec {
  shape: TokenShape;
  /** Sides when `shape` is `polygon`; ignored for a circle. */
  sides?: number;
  /** Across the flats for a polygon, across the circle for a disc. */
  diameterMm: number;
  thicknessMm: number;
  /** Sides on the disc. Enough to read as round, few enough to stay small. */
  segments?: number;
  /**
   * Art laid out as two faces side by side — front on the left, back on the
   * right — mapped one to each face so a piece can differ front to back. Off,
   * the one picture is shown on both faces.
   */
  twoSided?: boolean;
}

/** A polygon's side count, clamped to what the generator will make. */
export function polygonSides(spec: TokenSpec): number {
  return Math.min(
    MAX_POLYGON_SIDES,
    Math.max(MIN_POLYGON_SIDES, Math.round(spec.sides ?? DEFAULT_POLYGON_SIDES))
  );
}

/**
 * Tabletop Simulator's world unit. Its grid, its snap points and every stock
 * component are built around the inch, so a model authored in inches drops in
 * at the size it was drawn rather than needing to be scaled by eye.
 */
export const MM_PER_TTS_UNIT = 25.4;

const DEFAULT_SEGMENTS = 64;

/**
 * A regular polygon's corner distance from its across-the-flats radius.
 *
 * `diameterMm` is measured across the flats — the distance that matters when
 * pieces sit against each other — so the apothem is half of it, and the corners
 * stand further out by `1 / cos(π / sides)`. At six sides this is exactly the
 * old hex, which is what keeps existing hex tokens the size they were.
 */
const circumFromApothem = (apothem: number, sides: number) => apothem / Math.cos(Math.PI / sides);

/** The corners of the face, counter-clockwise seen from above. */
function outline(spec: TokenSpec): { x: number; z: number }[] {
  const apothem = spec.diameterMm / 2 / MM_PER_TTS_UNIT;
  const points: { x: number; z: number }[] = [];

  if (spec.shape === 'polygon') {
    const sides = polygonSides(spec);
    const radius = circumFromApothem(apothem, sides);
    /*
     * The `π / sides` offset sets a flat edge at the bottom and, at four sides,
     * an axis-aligned square rather than a diamond. At six it reproduces the
     * old hex exactly — vertex up, flats to the sides.
     */
    for (let i = 0; i < sides; i += 1) {
      const angle = (Math.PI * 2 * i) / sides + Math.PI / sides;
      points.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
    }
    return points;
  }

  const segments = Math.max(12, spec.segments ?? DEFAULT_SEGMENTS);
  for (let i = 0; i < segments; i += 1) {
    const angle = (Math.PI * 2 * i) / segments;
    points.push({ x: Math.cos(angle) * apothem, z: Math.sin(angle) * apothem });
  }
  return points;
}

/**
 * The texture is the artwork over a band of rim colour.
 *
 * The art's region is *square*, because the face maps a square patch of it onto
 * a round or six-sided token — give the art a wide band and the token samples
 * the empty ends of it and wears them as stripes. The rim needs one colour, so
 * it gets a quarter-height strip underneath.
 */
export const TOKEN_TEXTURE_RATIO = 1.25;
const ART_V = { top: 1, bottom: 1 - 1 / TOKEN_TEXTURE_RATIO } as const;
const RIM_V = ART_V.bottom / 2;

export interface TokenMesh extends Mesh {
  /** Where each face samples the texture, for whoever writes the file. */
  readonly spec: TokenSpec;
}

export function buildTokenMesh(spec: TokenSpec): TokenMesh {
  const points = outline(spec);
  const half = spec.thicknessMm / 2 / MM_PER_TTS_UNIT;
  const apothem = spec.diameterMm / 2 / MM_PER_TTS_UNIT;

  /*
   * How far the shape actually reaches, which for a polygon is its corners
   * rather than its flats. Mapping the art against this keeps every coordinate
   * inside the texture and keeps the picture's own proportions — a hexagon crops
   * a sliver off its flats rather than stretching to fill a box it does not fill.
   */
  const extent = spec.shape === 'polygon' ? circumFromApothem(apothem, polygonSides(spec)) : apothem;
  const twoSided = spec.twoSided === true;

  const positions: number[] = [];
  const uvs: number[] = [];

  /**
   * Face position to a point on the art, with the token's reach as the frame.
   *
   * Seen from above, the board's +Z runs *down* the picture while the texture's
   * V runs up it, so the top face reads its rows backwards. The underside is
   * turned over about the token's X axis — which is how a piece gets flipped on
   * a table — so its rows run the other way again and its columns do not.
   *
   * Two-sided art is one image split down the middle — front on the left half,
   * back on the right — so each face maps into its own half and its V spans the
   * whole height. One-sided art is the top square of a taller texture, a band of
   * rim colour beneath it, and both faces share it.
   */
  const artUv = (x: number, z: number, face: 'top' | 'bottom'): [number, number] => {
    const u = (x / extent + 1) / 2;
    const t = ((face === 'top' ? -z : z) / extent + 1) / 2;
    if (twoSided) {
      return [face === 'top' ? u * 0.5 : 0.5 + u * 0.5, t];
    }
    return [u, ART_V.bottom + t * (ART_V.top - ART_V.bottom)];
  };

  const push = (
    a: { x: number; z: number },
    b: { x: number; z: number },
    c: { x: number; z: number },
    y: [number, number, number],
    uv: [number, number][]
  ): void => {
    positions.push(a.x, y[0], a.z, b.x, y[1], b.z, c.x, y[2], c.z);
    for (const [u, v] of uv) uvs.push(u, v);
  };

  // Top and bottom, as fans from the first corner.
  for (let i = 1; i + 1 < points.length; i += 1) {
    const a = points[0] as { x: number; z: number };
    const b = points[i] as { x: number; z: number };
    const c = points[i + 1] as { x: number; z: number };

    // Wound so the top faces up and the bottom faces down.
    push(a, c, b, [half, half, half], [
      artUv(a.x, a.z, 'top'),
      artUv(c.x, c.z, 'top'),
      artUv(b.x, b.z, 'top')
    ]);
    push(a, b, c, [-half, -half, -half], [
      artUv(a.x, a.z, 'bottom'),
      artUv(b.x, b.z, 'bottom'),
      artUv(c.x, c.z, 'bottom')
    ]);
  }

  /*
   * The rim: one quad per edge, both triangles sampling the flat band.
   *
   * Wound so the faces point away from the axis. Getting this backwards makes
   * a mesh that renders as a hollow shell and measures a negative volume —
   * which is what a slicer or an engine will tell you about it, eventually.
   */
  /* One-sided art keeps a band of rim colour at the foot of the texture; a
     two-sided image has none, so the rim samples the seam between the two
     faces, which on a framed piece is its background. */
  const rim: [number, number] = twoSided ? [0.5, 0.5] : [0.5, RIM_V];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i] as { x: number; z: number };
    const b = points[(i + 1) % points.length] as { x: number; z: number };

    positions.push(a.x, -half, a.z, b.x, half, b.z, b.x, -half, b.z);
    uvs.push(...rim, ...rim, ...rim);
    positions.push(a.x, -half, a.z, a.x, half, a.z, b.x, half, b.z);
    uvs.push(...rim, ...rim, ...rim);
  }

  const mesh = createMesh(new Float32Array(positions), null, new Float32Array(uvs));
  return { ...mesh, spec };
}

/** A number, short enough to keep the file small and exact enough to print. */
const fixed = (value: number) => value.toFixed(5).replace(/\.?0+$/, '') || '0';

/**
 * The mesh as a Wavefront OBJ.
 *
 * Written unindexed, one `f` per triangle, because that is what the mesh
 * already is — building a shared-vertex index would only have to be undone by
 * anything that flat-shades it.
 */
export function tokenObj(mesh: TokenMesh, materialName: string): string {
  const lines: string[] = [
    '# Unmatched Adventures Workshop — generated token',
    `# ${mesh.spec.shape} · ${mesh.spec.diameterMm}mm across · ${mesh.spec.thicknessMm}mm thick`,
    `# 1 unit = 1 inch (${MM_PER_TTS_UNIT}mm)`,
    `mtllib ${materialName}.mtl`,
    `o token`
  ];

  const { positions, normals, uvs } = mesh;
  const count = positions.length / 3;

  for (let i = 0; i < count; i += 1) {
    lines.push(
      `v ${fixed(positions[i * 3] as number)} ${fixed(positions[i * 3 + 1] as number)} ${fixed(positions[i * 3 + 2] as number)}`
    );
  }
  if (uvs) {
    for (let i = 0; i < count; i += 1) {
      lines.push(`vt ${fixed(uvs[i * 2] as number)} ${fixed(uvs[i * 2 + 1] as number)}`);
    }
  }
  for (let i = 0; i < count; i += 1) {
    lines.push(
      `vn ${fixed(normals[i * 3] as number)} ${fixed(normals[i * 3 + 1] as number)} ${fixed(normals[i * 3 + 2] as number)}`
    );
  }

  lines.push(`usemtl ${materialName}`);
  for (let i = 0; i < count; i += 3) {
    const a = i + 1;
    const b = i + 2;
    const c = i + 3;
    lines.push(uvs ? `f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}` : `f ${a}//${a} ${b}//${b} ${c}//${c}`);
  }

  return `${lines.join('\n')}\n`;
}

export function tokenMtl(materialName: string, textureFile: string): string {
  return [
    '# Unmatched Adventures Workshop — generated token',
    `newmtl ${materialName}`,
    'Ka 1.000 1.000 1.000',
    'Kd 1.000 1.000 1.000',
    'Ks 0.000 0.000 0.000',
    'd 1.0',
    'illum 1',
    `map_Kd ${textureFile}`,
    ''
  ].join('\n');
}
