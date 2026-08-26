/**
 * Tracing a token's outline from its own artwork's alpha channel.
 *
 * Pure, DOM-free geometry — everything here operates on a plain alpha buffer
 * a caller already sampled from a canvas (`export/token-model.ts`'s
 * `silhouetteAlpha`), and returns points normalised to -1..1 on each axis so
 * the result never has to know the physical size of the piece it becomes:
 * `models/token.ts`'s `faceGeometry` scales it by `extentX`/`extentZ`, the
 * same way it already scales a polygon's own unit-circumradius points.
 *
 * v1 deliberately traces only the *largest* connected region of the mask, as
 * one closed loop with no interior holes — see CLAUDE.md's "Generated
 * tokens" section for why: it keeps the result a single ring, so nothing
 * downstream (the rim wall in `token.ts`, in particular, which still walks
 * `i → (i+1) % n` around one loop) has to learn about multiple loops.
 *
 * The pipeline: threshold → one pass of morphological open (destroys
 * antialiasing speckle and one-pixel-wide necks that would otherwise make
 * the traced polygon cross itself) → keep the largest 4-connected region →
 * Moore-neighbour boundary trace → closed-loop Douglas-Peucker simplify,
 * capped to a sane point count → drop duplicate/collinear points → correct
 * winding by signed area → validate it actually ear-clips before ever
 * calling it usable. A trace that fails any step returns `null` rather than
 * a guess — see `traceSilhouette`.
 */

export const TRACER_VERSION = 1;

const ALPHA_THRESHOLD = 128;
const MIN_REGION_FRACTION = 0.001;
const MAX_OUTLINE_POINTS = 220;

export const MIN_OUTLINE_DETAIL = 0.5;
export const MAX_OUTLINE_DETAIL = 4;
export const DEFAULT_OUTLINE_DETAIL = 1.5;

/** A point in mesh space — the same `{x, z}` shape `models/token.ts` builds its own face points in. */
export interface Point {
  readonly x: number;
  readonly z: number;
}

/** A traced, simplified, closed outline — stored on `TokenBuild.outline`. */
export interface TokenOutline {
  /** Flat `[x0,z0,x1,z1,…]`, CCW seen from above, each axis normalised -1..1. */
  readonly points: readonly number[];
  /** What this was traced from — see `outlineKey`. A mismatch means stale. */
  readonly key: string;
}

/** The inputs an outline's own staleness is judged against. */
export interface OutlineKeyParts {
  /** Short content hash of the source image — see `core/hash.ts`. */
  readonly sourceHash: string;
  /** `tokenFaceAspect(spec).toFixed(4)` — the frame the art is fitted into. */
  readonly aspect: string;
  readonly zoom: number;
  readonly twoSided: boolean;
  readonly detail: number;
}

export function outlineKey(parts: OutlineKeyParts): string {
  return [
    parts.sourceHash,
    parts.aspect,
    parts.zoom.toFixed(3),
    parts.twoSided ? '2' : '1',
    parts.detail.toFixed(2),
    TRACER_VERSION
  ].join(':');
}

// -- Raster stage: threshold, open, label -------------------------------

interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

function thresholdAlpha(alpha: Uint8Array, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = (alpha[i] ?? 0) >= ALPHA_THRESHOLD ? 1 : 0;
  }
  return mask;
}

/** True where all nine cells of the 3×3 neighbourhood are foreground. */
function erode3x3(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (mask[i] === 0) continue;
      let keep = true;
      for (let dy = -1; dy <= 1 && keep; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || mask[ny * width + nx] === 0) {
            keep = false;
            break;
          }
        }
      }
      out[i] = keep ? 1 : 0;
    }
  }
  return out;
}

/** True where any of the nine cells of the 3×3 neighbourhood is foreground. */
function dilate3x3(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let found = false;
      for (let dy = -1; dy <= 1 && !found; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[ny * width + nx] === 1) {
            found = true;
            break;
          }
        }
      }
      out[y * width + x] = found ? 1 : 0;
    }
  }
  return out;
}

/**
 * The largest 4-connected foreground region, everything else cleared —
 * v1's "one region, no islands" rule enforced right at the source. 4
 * connectivity for the foreground (paired with 8-connectivity implied for
 * the background by the trace below) is the classical choice that keeps a
 * region's outer boundary a simple closed curve.
 */
function largestRegion(mask: Uint8Array, width: number, height: number): Uint8Array | null {
  const visited = new Uint8Array(mask.length);
  let best: number[] | null = null;
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || visited[start] === 1) continue;

    const region: number[] = [];
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;

    while (stack.length > 0) {
      const i = stack.pop() as number;
      region.push(i);
      const x = i % width;
      const y = (i / width) | 0;
      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1
      ];
      for (const n of neighbours) {
        if (n >= 0 && mask[n] === 1 && visited[n] === 0) {
          visited[n] = 1;
          stack.push(n);
        }
      }
    }

    if (!best || region.length > best.length) best = region;
  }

  if (!best || best.length / mask.length < MIN_REGION_FRACTION) return null;

  const out = new Uint8Array(mask.length);
  for (const i of best) out[i] = 1;
  return out;
}

// -- Boundary trace -------------------------------------------------------

/** Clockwise-ish 8-neighbour rotation. The absolute handedness doesn't
    matter — `ensureCcw` fixes the final winding regardless — only that the
    same order is used consistently within one trace. */
const NEIGHBOUR_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, 0], // W
  [-1, -1], // NW
  [0, -1], // N
  [1, -1], // NE
  [1, 0], // E
  [1, 1], // SE
  [0, 1], // S
  [-1, 1] // SW
];

/**
 * Moore-neighbour boundary tracing with Jacob's stopping criterion.
 *
 * Chosen over marching squares: it yields an already-ordered closed loop of
 * pixel centres directly, in far less code, and marching squares' sub-pixel
 * precision is thrown away by simplification in the very next step anyway.
 *
 * Jacob's criterion — stop when the start pixel is re-entered *from the
 * same direction it was first left* — matters specifically because
 * "stop on position alone" truncates the contour on any shape with a
 * pixel-wide neck: the walk would pass through the start pixel once on its
 * way past the neck without that being the end of the loop.
 */
function traceBoundary(mask: Uint8Array, width: number, height: number): PixelPoint[] | null {
  const at = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;

  let start: PixelPoint | null = null;
  for (let y = 0; y < height && !start; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (at(x, y)) {
        start = { x, y };
        break;
      }
    }
  }
  if (!start) return null;

  const findNext = (
    from: PixelPoint,
    enteredFrom: number
  ): { point: PixelPoint; enteredFrom: number } | null => {
    for (let step = 1; step <= 8; step += 1) {
      const dir = (enteredFrom + step) % 8;
      const [dx, dy] = NEIGHBOUR_OFFSETS[dir] as readonly [number, number];
      const nx = from.x + dx;
      const ny = from.y + dy;
      if (at(nx, ny)) return { point: { x: nx, y: ny }, enteredFrom: (dir + 4) % 8 };
    }
    return null;
  };

  // `start` is the topmost, then leftmost, foreground pixel, so its West
  // neighbour is guaranteed background — a safe anchor for "entered from".
  const first = findNext(start, 0);
  if (!first) return [start]; // an isolated single pixel — no boundary to walk

  const boundary: PixelPoint[] = [start];
  const startNext = first.point;
  let current = first;
  const stepLimit = width * height * 8;
  let guard = 0;

  for (;;) {
    boundary.push(current.point);
    const next = findNext(current.point, current.enteredFrom);
    if (!next) break;
    guard += 1;
    if (guard > stepLimit) break; // safety valve; should be unreachable
    if (
      current.point.x === start.x &&
      current.point.y === start.y &&
      next.point.x === startNext.x &&
      next.point.y === startNext.y
    ) {
      break;
    }
    current = next;
  }

  return boundary;
}

// -- Simplification (closed-loop Douglas-Peucker) -------------------------

function perpendicularDistance(p: PixelPoint, a: PixelPoint, b: PixelPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function simplifyChain(points: readonly PixelPoint[], tolerance: number): PixelPoint[] {
  if (points.length < 3) return [...points];
  const first = points[0] as PixelPoint;
  const last = points[points.length - 1] as PixelPoint;

  let maxDist = 0;
  let maxIndex = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = perpendicularDistance(points[i] as PixelPoint, first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIndex = i;
    }
  }

  if (maxDist <= tolerance) return [first, last];

  const left = simplifyChain(points.slice(0, maxIndex + 1), tolerance);
  const right = simplifyChain(points.slice(maxIndex), tolerance);
  return left.slice(0, -1).concat(right);
}

/**
 * Douglas-Peucker on a closed ring: split into two open chains at the point
 * farthest from the start (a cheap, good-enough split — not the true
 * maximum-mutual-distance pair, which needs an O(n²) search this doesn't
 * bother with), simplify each independently, rejoin without duplicating the
 * two shared endpoints. Plain "cut at index 0" would work too, but risks a
 * poor split if index 0 happens to sit mid-edge on a long straight run.
 */
function simplifyClosed(points: readonly PixelPoint[], tolerance: number): PixelPoint[] {
  if (points.length < 4) return [...points];

  const p0 = points[0] as PixelPoint;
  let farIndex = 0;
  let farDist = 0;
  for (let i = 1; i < points.length; i += 1) {
    const d = Math.hypot((points[i] as PixelPoint).x - p0.x, (points[i] as PixelPoint).y - p0.y);
    if (d > farDist) {
      farDist = d;
      farIndex = i;
    }
  }

  const chainA = simplifyChain(points.slice(0, farIndex + 1), tolerance);
  const chainB = simplifyChain([...points.slice(farIndex), p0], tolerance);
  return chainA.slice(0, -1).concat(chainB.slice(0, -1));
}

/** Re-simplifies at a coarser tolerance until the point count is sane, from
    the original trace each time — not by cascading tolerance onto an
    already-lossy result. */
function simplifyWithCap(
  points: readonly PixelPoint[],
  initialTolerance: number,
  maxPoints: number
): PixelPoint[] {
  let tolerance = initialTolerance;
  let result = simplifyClosed(points, tolerance);
  let guard = 0;
  while (result.length > maxPoints && guard < 12) {
    tolerance *= 1.5;
    result = simplifyClosed(points, tolerance);
    guard += 1;
  }
  return result;
}

/** Drops near-duplicate and collinear points — ear clipping breaks on
    either, treating a near-zero-area ear as ambiguous. */
function cleanPolygon(points: readonly PixelPoint[]): PixelPoint[] {
  const deduped: PixelPoint[] = [];
  for (const p of points) {
    const last = deduped[deduped.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.01) deduped.push(p);
  }
  if (deduped.length > 1) {
    const first = deduped[0] as PixelPoint;
    const last = deduped[deduped.length - 1] as PixelPoint;
    if (Math.hypot(first.x - last.x, first.y - last.y) <= 0.01) deduped.pop();
  }

  let current = deduped;
  let changed = true;
  while (changed && current.length > 3) {
    changed = false;
    const next: PixelPoint[] = [];
    for (let i = 0; i < current.length; i += 1) {
      const prev = current[(i - 1 + current.length) % current.length] as PixelPoint;
      const cur = current[i] as PixelPoint;
      const nxt = current[(i + 1) % current.length] as PixelPoint;
      if (perpendicularDistance(cur, prev, nxt) < 0.1) {
        changed = true;
        continue;
      }
      next.push(cur);
    }
    current = next;
  }
  return current;
}

// -- Mesh-space finishing: winding and triangulation -----------------------

function signedArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i] as Point;
    const b = points[(i + 1) % points.length] as Point;
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
}

/** Matches the winding `models/token.ts`'s circle/polygon points are already
    built in — "counter-clockwise seen from above" reads as a positive
    shoelace sum in `(x, z)`. Never reasoned about in pixel space, where the
    tracer's own arbitrary rotation direction would make it unreliable. */
function ensureCcw(points: readonly Point[]): Point[] {
  return signedArea(points) < 0 ? [...points].reverse() : [...points];
}

/** Signed area × 2 of the ordered triangle `(a, b, c)` — positive for a left
    (CCW) turn at `b`. Every convexity/containment test below reads this one
    way round on purpose: swapping the last two arguments negates it, which
    is exactly the bug a first pass at this function shipped with. */
function turn(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const d1 = turn(a, b, p);
  const d2 = turn(b, c, p);
  const d3 = turn(c, a, p);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Ear-clipping triangulation of a simple (non-self-intersecting) CCW
 * polygon. Standard O(n²): repeatedly find a convex vertex whose ear
 * triangle contains none of the polygon's other vertices, clip it, repeat.
 *
 * Returns `[]` on failure (no ear found in a full pass) rather than
 * guessing — this is what a self-intersecting input looks like, and a
 * fallback fan over a concave polygon would render as visible spikes that
 * read as a bug rather than as the limitation it is. Callers treat an empty
 * result as "this shape did not triangulate," never as "this shape has no
 * triangles."
 */
export function earClip(polygon: readonly Point[]): (readonly [number, number, number])[] {
  if (polygon.length < 3) return [];

  const pts = ensureCcw(polygon);
  const indices = pts.map((_, i) => i);
  const triangles: (readonly [number, number, number])[] = [];
  const guardLimit = indices.length * indices.length + 16;
  let guard = 0;

  while (indices.length > 3) {
    guard += 1;
    if (guard > guardLimit) return [];

    let earFound = false;
    for (let i = 0; i < indices.length; i += 1) {
      const iPrev = indices[(i - 1 + indices.length) % indices.length] as number;
      const iCur = indices[i] as number;
      const iNext = indices[(i + 1) % indices.length] as number;
      const prev = pts[iPrev] as Point;
      const cur = pts[iCur] as Point;
      const next = pts[iNext] as Point;

      // Convex: a left turn, i.e. a positive cross product on a CCW polygon.
      if (turn(prev, cur, next) <= 0) continue;

      let containsOther = false;
      for (const idx of indices) {
        if (idx === iPrev || idx === iCur || idx === iNext) continue;
        if (pointInTriangle(pts[idx] as Point, prev, cur, next)) {
          containsOther = true;
          break;
        }
      }
      if (containsOther) continue;

      triangles.push([iPrev, iCur, iNext]);
      indices.splice(i, 1);
      earFound = true;
      break;
    }
    if (!earFound) return [];
  }

  if (indices.length === 3) {
    triangles.push([indices[0] as number, indices[1] as number, indices[2] as number]);
  }
  return triangles;
}

// -- The whole pipeline -----------------------------------------------------

export interface TraceOptions {
  /** Douglas-Peucker tolerance, in the alpha buffer's own pixel units. */
  readonly detail: number;
}

/**
 * The full pipeline: an alpha buffer in, a normalised closed outline out (or
 * `null` if nothing usable was found, or the result failed to triangulate).
 *
 * `width`/`height` are expected to carry the one-pixel transparent border
 * `export/token-model.ts`'s `silhouetteAlpha` pads its canvas with — see
 * that function for why, and note this file subtracts it back out below
 * when normalising, so the border never leaks into the stored outline.
 */
export function traceSilhouette(
  alpha: Uint8Array,
  width: number,
  height: number,
  options: TraceOptions
): { points: number[] } | null {
  if (width < 3 || height < 3) return null;

  const thresholded = thresholdAlpha(alpha, width, height);
  const opened = dilate3x3(erode3x3(thresholded, width, height), width, height);
  const region = largestRegion(opened, width, height);
  if (!region) return null;

  const traced = traceBoundary(region, width, height);
  if (!traced || traced.length < 3) return null;

  const tolerance = Math.max(0.5, options.detail);
  const simplified = cleanPolygon(simplifyWithCap(traced, tolerance, MAX_OUTLINE_POINTS));
  if (simplified.length < 3) return null;

  // Pixel space -> the -1..1 art-frame `faceGeometry` scales by extentX/
  // extentZ. `innerWidth`/`innerHeight` exclude the one-pixel border, which
  // is what `artUv`'s own frame is measured against.
  const innerWidth = width - 2;
  const innerHeight = height - 2;
  const normalized: Point[] = simplified.map((p) => ({
    x: (2 * (p.x - 1)) / innerWidth - 1,
    z: (2 * (p.y - 1)) / innerHeight - 1
  }));

  const oriented = ensureCcw(normalized);
  if (earClip(oriented).length !== oriented.length - 2) return null;

  const points: number[] = [];
  for (const p of oriented) points.push(Number(p.x.toFixed(4)), Number(p.z.toFixed(4)));
  return { points };
}

/** `TokenOutline.points` back into `Point`s, or `null` if malformed/empty. */
export function outlinePoints(outline: TokenOutline | null | undefined): Point[] | null {
  if (!outline || outline.points.length < 6 || outline.points.length % 2 !== 0) return null;
  const points: Point[] = [];
  for (let i = 0; i < outline.points.length; i += 2) {
    points.push({ x: outline.points[i] as number, z: outline.points[i + 1] as number });
  }
  return points;
}
