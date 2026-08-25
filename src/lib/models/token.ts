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
  /** The piece's reach on its own X axis. Across the flats for a polygon,
      across the circle for a disc. */
  diameterMm: number;
  /**
   * The piece's reach on its own Z axis, for a polygon stretched into a
   * rectangle (four sides), an elongated hexagon, and so on. Ignored for a
   * circle — there is no elliptical token — and treated as equal to
   * `diameterMm` when absent, which is the regular polygon every existing
   * token already is. See `polygonExtents`.
   */
  lengthMm?: number;
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
 * A regular polygon's corner distance from its across-the-flats radius, at
 * apothem 1 — the *unit* circumradius, scaled per axis by whoever calls this
 * rather than by an apothem already baked in.
 *
 * `diameterMm` is measured across the flats — the distance that matters when
 * pieces sit against each other — so a shape's apothem is half of it, and its
 * corners stand further out by `1 / cos(π / sides)`. At six sides this is
 * exactly the old hex, which is what keeps existing hex tokens the size they
 * were.
 */
const circumFromApothem = (apothem: number, sides: number) => apothem / Math.cos(Math.PI / sides);

/**
 * The piece's reach on X and on Z, in TTS units — equal for a circle or a
 * regular polygon, and the two numbers a rectangle (or an elongated hexagon,
 * or any other stretched polygon) is built from when they are not.
 *
 * A circle has one radius and stays a circle — there is no elliptical token —
 * so only the polygon branch ever reads `lengthMm`. `lengthMm` absent, or
 * equal to `diameterMm`, is every polygon this generator used to be able to
 * make: a shared apothem is exactly what makes a regular polygon regular, and
 * is exactly what made a four-sided one always come out a square.
 */
function faceExtents(spec: TokenSpec): { x: number; z: number } {
  const x = spec.diameterMm / 2 / MM_PER_TTS_UNIT;
  if (spec.shape !== 'polygon') return { x, z: x };
  return { x, z: (spec.lengthMm ?? spec.diameterMm) / 2 / MM_PER_TTS_UNIT };
}

/**
 * The corners of the face, counter-clockwise seen from above, and the frame
 * the art is measured against — which for a polygon is *not* the same reach.
 *
 * A polygon's corners are built at the *unit* circumradius (apothem 1) and
 * then scaled by the X and Z reaches independently: at equal reaches this
 * reproduces the old single-`circumFromApothem` geometry exactly, and at
 * unequal reaches it is what turns a square into a rectangle or a hexagon
 * into an elongated one, rather than the regular-only shape a single shared
 * apothem could ever produce.
 *
 * `artExtent` is the flat-to-flat reach on **each axis separately**, not the
 * corner reach the points are built at. Per-axis is only correct because the
 * texture's art region carries the *same* aspect the face does — see
 * `tokenArtLayout`, which is the other half of this and cannot be changed
 * independently of it. Map a **square** art region onto a rectangular face
 * per-axis and the picture stretches; that was a real bug, and the fix
 * attempted for it (one shared `Math.min(extentX, extentZ)`, mapping the art
 * into the largest square the face inscribes) traded the stretch for a
 * worse one: a wide piece then had rim colour banding its long axis that no
 * `lengthMm`/`diameterMm` could ever trim off, because the art was pinned to
 * a square no matter what shape the piece was. Sizing the art region to the
 * face and mapping it per-axis is what makes both come out right at once —
 * the picture keeps its proportions *and* the piece's own dimensions decide
 * how much of it shows.
 *
 * Using the corner reach instead would tie the art's scale to side count: a
 * triangle's corners sit 2× its apothem, a dodecagon's barely 3.5% further,
 * so the same flat-edge point would sample a different fraction of the
 * texture for every `sides`, and changing shape alone would read as the
 * picture zooming. So a polygon's corners deliberately reach *past* this
 * frame, and sample the art's own edge pixel when they do — see `artUv` for
 * why that clamp belongs to the texture's wrap mode and never to the mesh.
 */
function faceGeometry(spec: TokenSpec): {
  points: { x: number; z: number }[];
  artExtent: { x: number; z: number };
} {
  const { x: extentX, z: extentZ } = faceExtents(spec);

  if (spec.shape === 'polygon') {
    const sides = polygonSides(spec);
    const unitRadius = circumFromApothem(1, sides);
    const points: { x: number; z: number }[] = [];
    /*
     * The `π / sides` offset sets a flat edge at the bottom and, at four
     * sides, an axis-aligned square (or rectangle) rather than a diamond. At
     * six it reproduces the old hex exactly — vertex up, flats to the sides.
     */
    for (let i = 0; i < sides; i += 1) {
      const angle = (Math.PI * 2 * i) / sides + Math.PI / sides;
      points.push({
        x: Math.cos(angle) * unitRadius * extentX,
        z: Math.sin(angle) * unitRadius * extentZ
      });
    }
    return { points, artExtent: { x: extentX, z: extentZ } };
  }

  const points: { x: number; z: number }[] = [];
  const segments = Math.max(12, spec.segments ?? DEFAULT_SEGMENTS);
  for (let i = 0; i < segments; i += 1) {
    const angle = (Math.PI * 2 * i) / segments;
    points.push({ x: Math.cos(angle) * extentX, z: Math.sin(angle) * extentX });
  }
  return { points, artExtent: { x: extentX, z: extentX } };
}

/**
 * The face's own proportions — its X reach over its Z reach.
 *
 * 1 for a circle, which has no second axis to differ on, and for any polygon
 * whose `lengthMm` matches its `diameterMm`. Anything else is a rectangle, an
 * elongated hexagon, and so on.
 */
export function tokenFaceAspect(spec: TokenSpec): number {
  const { x, z } = faceExtents(spec);
  return z > 0 ? x / z : 1;
}

/**
 * How much taller than its art a one-sided texture is: the art, plus a strip
 * of rim colour under it for the prism's edge to sample.
 *
 * A ratio rather than a pixel count, so the strip stays proportional however
 * `tokenArtLayout` sizes the art — which is what keeps `ART_V`/`RIM_V` below
 * fixed numbers the mesh can use without knowing the piece's shape.
 */
export const TOKEN_TEXTURE_RATIO = 1.25;
const ART_V = { top: 1, bottom: 1 - 1 / TOKEN_TEXTURE_RATIO } as const;
const RIM_V = ART_V.bottom / 2;

/** Where the art sits in the texture, in pixels. See `tokenArtLayout`. */
export interface TokenArtLayout {
  /** The whole texture. */
  canvasWidth: number;
  canvasHeight: number;
  /** One face's worth of art, at the top left of the canvas. */
  artWidth: number;
  artHeight: number;
}

/**
 * The texture's shape for a given piece — **the other half of `artExtent`**,
 * and the reason the mesh may map its art per-axis without stretching it.
 *
 * The art region carries the *face's* own aspect (`tokenFaceAspect`), sized
 * to the largest such rectangle inside a `size` × `size` box. That is the
 * whole fix for a rectangular piece: a square art region on a 2:1 face can
 * only ever be letterboxed, and no `diameterMm`/`lengthMm` an author types
 * will trim that letterbox off, because the letterbox is a property of the
 * *texture* rather than of the piece. Give the region the face's shape and
 * the two agree by construction — a 2:1 picture on a 2:1 piece reaches every
 * edge, and a picture whose own aspect differs is fitted inside (never
 * stretched), with the rim colour showing where it does not reach.
 *
 * `ART_V`/`RIM_V` stay fixed constants through all of this because the rim
 * strip is a *ratio* of the art's height — the art region changes shape, but
 * its share of the canvas does not. A two-sided texture is two of these side
 * by side and has no rim strip at all; its edge samples the seam between the
 * faces instead.
 */
export function tokenArtLayout(spec: TokenSpec, size = 1024): TokenArtLayout {
  const aspect = tokenFaceAspect(spec);
  const artWidth = Math.max(1, Math.round(aspect >= 1 ? size : size * aspect));
  const artHeight = Math.max(1, Math.round(aspect >= 1 ? size / aspect : size));

  if (spec.twoSided === true) {
    return { canvasWidth: artWidth * 2, canvasHeight: artHeight, artWidth, artHeight };
  }
  return {
    canvasWidth: artWidth,
    canvasHeight: Math.max(1, Math.round(artHeight * TOKEN_TEXTURE_RATIO)),
    artWidth,
    artHeight
  };
}

export interface TokenMesh extends Mesh {
  /** Where each face samples the texture, for whoever writes the file. */
  readonly spec: TokenSpec;
}

export function buildTokenMesh(spec: TokenSpec): TokenMesh {
  const { points, artExtent } = faceGeometry(spec);
  const half = spec.thicknessMm / 2 / MM_PER_TTS_UNIT;
  const twoSided = spec.twoSided === true;

  const positions: number[] = [];
  const uvs: number[] = [];

  /**
   * Face position to a point on the art, with the token's *flat-to-flat*
   * reach as the frame — each axis to its own reach, not the corner reach
   * `points` themselves are built at. That is a uniform mapping rather than
   * a stretch only because the art region carries the face's own aspect;
   * `faceGeometry` and `tokenArtLayout` are one decision in two places and
   * changing either alone reintroduces a distortion.
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
   *
   * Deliberately *not* clamped to `[0, 1]` here, even though a polygon with
   * few enough sides reaches past this fixed frame at its corners — a
   * triangle's corners sit 2× its apothem — and an elongated piece reaches
   * past it along its own longer axis. A vertex's UV is a value baked into
   * the mesh once and then *linearly interpolated* across every triangle
   * that touches it; clamping it here, before that interpolation happens, is
   * what actually caused the warping this whole file has been chasing. A
   * square's four corners all sit exactly on the diagonal, so all four clamp
   * on *both* axes to a different one of the texture's own four corners —
   * and a rasteriser handed four vertices that each claim to be a different
   * corner of the full [0,1] texture stretches the whole texture across the
   * whole face to satisfy them, which is indistinguishable from the original
   * stretching bug, just produced one stage later. The correct place to clamp
   * is per *fragment*, after interpolation, which is what a texture's own
   * wrap mode does — `models/gl.ts` already sets `CLAMP_TO_EDGE` on both
   * axes, so every point past this frame samples the art's true edge pixel on
   * its own, without a hard boundary ever being baked into the geometry. For
   * a non-square photo (already sitting on the rim colour past its own
   * shorter edge, see `buildTokenTexture`) that reads as the rim colour
   * showing through past the frame, not as a smear — the intended fallback,
   * not a bug. A source image that does not yet reach the shape it is going
   * on is the thing to fix.
   */
  const artUv = (x: number, z: number, face: 'top' | 'bottom'): [number, number] => {
    const u = (x / artExtent.x + 1) / 2;
    const t = ((face === 'top' ? -z : z) / artExtent.z + 1) / 2;
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
  const lengthMm = mesh.spec.lengthMm;
  const size =
    lengthMm !== undefined && lengthMm !== mesh.spec.diameterMm
      ? `${mesh.spec.diameterMm}mm × ${lengthMm}mm`
      : `${mesh.spec.diameterMm}mm across`;

  const lines: string[] = [
    '# Unmatched Labs — generated token',
    `# ${mesh.spec.shape} · ${size} · ${mesh.spec.thicknessMm}mm thick`,
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
    '# Unmatched Labs — generated token',
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
