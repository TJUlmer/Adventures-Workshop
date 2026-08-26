/**
 * A generated token, as the files Tabletop Simulator wants.
 *
 * Three of them, zipped: the mesh, the material that points at the texture, and
 * the texture itself — plus a note saying what to do with them, because the
 * import dialogue asks for a URL and offers no clue about which file is which.
 */
import { shortHash } from '$lib/core/hash';
import { HEALTH_DIAL_RIM } from '$lib/figures/health-dial';
import type { Figure } from '$lib/figures/types';
import { figureLabel, generatedTokenSpec, tokenSpecOf } from '$lib/figures/types';
import {
  buildTokenMesh,
  MM_PER_TTS_UNIT,
  tokenArtLayout,
  tokenFaceAspect,
  tokenMtl,
  tokenObj
} from '$lib/models/token';
import type { TokenArtLayout, TokenSpec } from '$lib/models/token';
import { outlineKey, traceSilhouette } from '$lib/models/silhouette';
import type { TokenOutline } from '$lib/models/silhouette';
import { slugify } from './json';
import type { ExportResult } from './types';
import { createZip } from './zip';
import type { ZipEntry } from './zip';

/** Load a stored image, settling with `onload` for the reason above. */
function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Could not read that image.'));
    element.src = source;
  });
}

/**
 * Where the art lands inside its region, and how big — the one piece of
 * maths the printed texture and a traced silhouette's outline both have to
 * agree on absolutely. `buildTokenTexture` draws here; `silhouetteAlpha`
 * reads alpha here. Two readers, one function: a silhouette that disagreed
 * with its own picture by a pixel would read as the art having slipped off
 * the token, and there would be no way to see that by reading either
 * function alone.
 */
function artPlacement(
  imageWidth: number,
  imageHeight: number,
  layout: TokenArtLayout,
  zoom: number
): { dx: number; dy: number; width: number; height: number } {
  const fitScale = Math.min(layout.artWidth / imageWidth, layout.artHeight / imageHeight);
  const scale = fitScale * Math.max(0.2, zoom);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { dx: (layout.artWidth - width) / 2, dy: (layout.artHeight - height) / 2, width, height };
}

async function encodePng(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the texture.');
  return blob;
}

/**
 * The texture: the artwork over a strip of rim colour.
 *
 * The art region takes the **piece's own shape**, not a square — see
 * `tokenArtLayout`, which decides it, and `faceGeometry`'s `artExtent`, which
 * is the mesh half of the same decision. A square region is what made a
 * rectangular piece band its long axis with rim colour that no `lengthMm`
 * could trim away.
 *
 * The art is drawn to *fit* that region rather than to fill it, so a picture
 * whose aspect differs from the piece's keeps its proportions and sits on the
 * rim colour rather than being cropped before the token's own outline gets to
 * it. Match the picture's aspect with the piece's and it reaches every edge.
 *
 * `zoom` scales up from that fit baseline — 1 reproduces the fit exactly, so
 * an untouched `Artwork` (the common case, and every document saved before
 * this existed) looks exactly as it always has. It only ever *enlarges*
 * proportionally from there, never stretches one axis — `figures/types.ts`'s
 * `Figure.reference.transform.scale` is what an author actually turns, and it
 * has no separate X/Y to stretch with. Clipped to the art region: past 1 the
 * scaled image overflows the region it used to always fit inside, and without
 * the clip it would bleed into the rim strip below.
 */
export async function buildTokenTexture(
  source: string,
  rimColor: string,
  layout: TokenArtLayout,
  zoom = 1
): Promise<Blob> {
  /*
   * `onload` rather than `decode()`: decoding is allowed to wait for a moment
   * the browser thinks is convenient, and a page in a background tab may never
   * get one — which leaves the token grey with nothing to say why.
   */
  const image = await loadImage(source);

  const canvas = document.createElement('canvas');
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not get a drawing context.');

  // The rim fills everything; the art is laid over the region at the top.
  context.fillStyle = rimColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const { dx, dy, width, height } = artPlacement(image.width, image.height, layout, zoom);

  context.save();
  context.beginPath();
  context.rect(0, 0, layout.artWidth, layout.artHeight);
  context.clip();
  context.drawImage(image, dx, dy, width, height);
  context.restore();

  return encodePng(canvas);
}

/**
 * The two-sided texture: the supplied image laid into two face-shaped
 * regions side by side, front | back.
 *
 * The mesh maps the top face into the left region and the bottom into the
 * right (see `buildTokenMesh`); `tokenArtLayout` gives each region the
 * piece's own aspect, so on a round or square piece this is the two-squares
 * layout the supplied .psd shows, and on a rectangular one it is two
 * rectangles of that shape.
 *
 * Whatever the source's own shape, it is split into a left half and a right
 * half *first* — matching what the mesh does with the finished texture — and
 * each half is fitted into its own region independently, never stretched.
 * Two things went through here before landing on that:
 *
 * 1. Stretching the whole source to force-fill the canvas, unconditionally
 *    — fine for an image already laid out two-up, but a single square photo
 *    (the common case for anyone who has not composed a dual front/back
 *    image) came out squashed to twice its width.
 * 2. Fitting the whole source into the canvas *as one piece*, centred — no
 *    longer stretched, but a single photo does not span both regions, so the
 *    fitted image straddled the seam: the mesh's own left-half/right-half
 *    sampling then put one half of the photo on the front face and the other
 *    half on the back, rather than the same whole photo on both.
 *
 * Splitting first and fitting each half on its own is what a genuine two-up
 * composition already looks like, so treating every source this way costs a
 * real dual composition nothing (each half already matches its region, fits
 * at scale 1, passes through unchanged) while giving a single un-prepared
 * photo a face that shows only half of it, undistorted rather than warped. A
 * whole, undistorted copy on *both* faces is what turning `twoSided` off
 * already does — this is for a piece whose front and back genuinely differ.
 */
export async function buildTwoSidedTexture(
  source: string,
  layout: TokenArtLayout,
  background = '#000000',
  zoom = 1
): Promise<Blob> {
  const image = await loadImage(source);

  const canvas = document.createElement('canvas');
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not get a drawing context.');

  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Both halves share one scale — they are the same size by construction
  // (exactly half the source's width, its full height) — so front and back
  // end up at the same zoom rather than each fitting independently to
  // whatever its own half happens to contain.
  const halfWidth = image.width / 2;
  const fitScale = Math.min(layout.artWidth / halfWidth, layout.artHeight / image.height);
  const scale = fitScale * Math.max(0.2, zoom);
  const width = halfWidth * scale;
  const height = image.height * scale;

  const drawHalf = (sourceX: number, destX: number): void => {
    context.save();
    context.beginPath();
    context.rect(destX, 0, layout.artWidth, layout.artHeight);
    context.clip();
    context.drawImage(
      image,
      sourceX,
      0,
      halfWidth,
      image.height,
      destX + (layout.artWidth - width) / 2,
      (layout.artHeight - height) / 2,
      width,
      height
    );
    context.restore();
  };

  drawHalf(0, 0); // Left half of the source -> the front (left) region.
  drawHalf(halfWidth, layout.artWidth); // Right half -> the back (right) region.

  return encodePng(canvas);
}

/**
 * A texture that is nothing but one flat colour.
 *
 * A generated token's *mesh* never needed art — `buildTokenMesh` builds one
 * from a `TokenSpec` alone — so this is what lets its texture skip art too: a
 * uniform fill reads correctly under any UV layout the mesh uses, one-sided or
 * two, since every coordinate on it samples the same colour regardless of
 * where it lands. "Add a token, pick a colour, export" is a complete path
 * with no picture required anywhere in it.
 */
async function buildSolidTexture(color: string, layout: TokenArtLayout): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not get a drawing context.');
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return encodePng(canvas);
}

/**
 * The texture a build asks for, one-sided or two, at the given size.
 *
 * A health dial comes through here as well, and its `twoSided` reads off the
 * same `figure.token.twoSided` a real token build would — see `health-dial.ts`.
 * It is a disc like any other, but it is the app's component rather than the
 * author's, so a *one-sided* dial's rim is the app's fixed colour rather than
 * one the author picks — there is no rim control on a dial. A two-sided
 * dial's *edge* still has no rim band to fill — like a two-sided token, it
 * samples the seam between the front and back halves of the supplied
 * picture, whatever that happens to be — but its `background` is still the
 * same fixed colour, for the letterbox `buildTwoSidedTexture` now fills
 * around a source that is not already 2:1. Those are two different things a
 * "rim colour" reaches on a two-sided piece: never the edge, sometimes the
 * face.
 *
 * A dial's face is still required — see `tts-bundle.ts`'s `dialObjects`, which
 * never calls this without one — but every other kind falls back to a flat
 * fill of its own rim colour rather than throwing, which is what lets a plain
 * marker (a threat track token, say) ship with no reference image at all.
 */
export function buildTokenArt(figure: Figure, size = 1024): Promise<Blob> {
  const source = figure.reference.source;
  const zoom = figure.reference.transform.scale;
  /*
   * Through `generatedTokenSpec` rather than `tokenSpecOf(figure.token)`, so
   * a dial's fixed disc is what shapes its texture rather than whatever the
   * unused token fields happen to hold. Falls back to that raw spec only for
   * a figure whose build is switched off — nothing renders it, but a texture
   * still has to have *some* shape to be.
   */
  const layout = tokenArtLayout(generatedTokenSpec(figure) ?? tokenSpecOf(figure.token), size);
  if (figure.kind === 'dial') {
    if (!source) throw new Error('Attach a reference image first — it is what goes on the token.');
    return figure.token.twoSided
      ? buildTwoSidedTexture(source, layout, HEALTH_DIAL_RIM, zoom)
      : buildTokenTexture(source, HEALTH_DIAL_RIM, layout, zoom);
  }
  if (!source) return buildSolidTexture(figure.token.rimColor, layout);
  return figure.token.twoSided
    ? buildTwoSidedTexture(source, layout, figure.token.rimColor, zoom)
    : buildTokenTexture(source, figure.token.rimColor, layout, zoom);
}

/**
 * The art region's own size for tracing, well below the 1024 the printed
 * texture uses. `tokenArtLayout` at this size is proportionally identical to
 * `tokenArtLayout` at 1024 — the fit maths is scale-invariant — so this
 * costs the tracer sixteen times fewer pixels for no loss the simplification
 * step wouldn't have thrown away regardless.
 */
const TRACE_SIZE = 256;

/**
 * The artwork alone, composited exactly where `buildTokenTexture` would
 * place it, with alpha read back out. **Not** the rim-filled canvas that
 * function draws — reading alpha off *that* would trace a rectangle, since
 * the rim fill makes it opaque everywhere.
 *
 * Padded by one transparent pixel on every side — see `models/silhouette.ts`
 * for why: it keeps every foreground pixel off the raw canvas edge, so the
 * boundary walk never needs a bounds check, and a shape that reaches the
 * frame still closes correctly.
 *
 * A silhouette's outline is derived from the **front face only** — for
 * two-sided art that is the left half of the source, matching
 * `buildTwoSidedTexture`'s own `drawHalf(0, 0)`; both faces then share the
 * one traced outline.
 */
async function silhouetteAlpha(
  figure: Figure,
  spec: TokenSpec
): Promise<{ alpha: Uint8Array; width: number; height: number } | null> {
  const source = figure.reference.source;
  if (!source) return null;

  const layout = tokenArtLayout(spec, TRACE_SIZE);
  const image = await loadImage(source);

  const twoSided = spec.twoSided === true;
  const sourceWidth = twoSided ? image.width / 2 : image.width;
  const zoom = figure.reference.transform.scale;
  const { dx, dy, width, height } = artPlacement(sourceWidth, image.height, layout, zoom);

  const canvas = document.createElement('canvas');
  canvas.width = layout.artWidth + 2;
  canvas.height = layout.artHeight + 2;
  const context = canvas.getContext('2d');
  if (!context) return null;

  context.save();
  context.beginPath();
  context.rect(1, 1, layout.artWidth, layout.artHeight);
  context.clip();
  if (twoSided) {
    context.drawImage(image, 0, 0, sourceWidth, image.height, 1 + dx, 1 + dy, width, height);
  } else {
    context.drawImage(image, 1 + dx, 1 + dy, width, height);
  }
  context.restore();

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = pixels[i * 4 + 3] as number;
  return { alpha, width: canvas.width, height: canvas.height };
}

/** What a stored outline's own freshness is judged against, for this figure
    right now. */
async function currentOutlineKey(figure: Figure, spec: TokenSpec): Promise<string> {
  const sourceHash = await shortHash(new TextEncoder().encode(figure.reference.source ?? ''));
  return outlineKey({
    sourceHash,
    aspect: tokenFaceAspect(spec).toFixed(4),
    zoom: figure.reference.transform.scale,
    twoSided: spec.twoSided === true,
    detail: figure.token.outlineDetail
  });
}

/**
 * Composite, trace, and key the result — the whole async pipeline in one
 * call. `null` on anything from "no picture yet" to "traced, but did not
 * come out as a simple polygon" — see `models/silhouette.ts`'s own note on
 * why a failure returns nothing rather than a guess.
 */
export async function traceTokenSilhouette(figure: Figure, spec: TokenSpec): Promise<TokenOutline | null> {
  const sampled = await silhouetteAlpha(figure, spec);
  if (!sampled) return null;

  const traced = traceSilhouette(sampled.alpha, sampled.width, sampled.height, {
    detail: figure.token.outlineDetail
  });
  if (!traced) return null;

  return { points: traced.points, key: await currentOutlineKey(figure, spec) };
}

/**
 * `spec` with a freshly traced outline substituted if the stored one is
 * stale — read-only, never writes to the document. Every export/preview
 * *reader* passes its own already-selected spec through this (`tts-bundle.ts`,
 * `exportTokenModel`, `AssetsOverview.svelte`'s snapshot); only the live
 * editor's own debounced effect in `FiguresPanel.svelte` writes a trace back
 * into the document. That split is what keeps an export triggered mid-drag
 * correct: it retraces for itself rather than trusting whatever the
 * document happened to hold at that instant.
 */
export async function resolvedTokenSpec(figure: Figure, spec: TokenSpec): Promise<TokenSpec> {
  if (spec.shape !== 'silhouette') return spec;

  const key = await currentOutlineKey(figure, spec);
  if (spec.outline && spec.outline.key === key) return spec;

  return { ...spec, outline: await traceTokenSilhouette(figure, spec) };
}

/** Whether this piece's width and length differ — a rectangle, or a polygon
    stretched along one axis, rather than the regular shape every token used
    to be. A circle is never this, however its two fields compare. */
function isStretched(token: Figure['token']): boolean {
  return token.shape === 'polygon' && token.lengthMm !== token.diameterMm;
}

/** How the piece's shape reads in prose, for the note that ships with it. */
function shapeLine(figure: Figure): string {
  const { token } = figure;
  if (token.shape === 'circle') return `Circle, across: ${token.diameterMm}mm`;
  if (token.shape === 'silhouette') {
    return `Silhouette traced from the image, fitted to ${token.diameterMm}mm × ${token.lengthMm}mm`;
  }
  if (isStretched(token)) {
    return `${token.sides}-sided polygon, ${token.diameterMm}mm wide by ${token.lengthMm}mm long`;
  }
  return `${token.sides}-sided polygon, across the flats: ${token.diameterMm}mm`;
}

function readme(name: string, figure: Figure, spec: TokenSpec, base: string): string {
  const stretched = isStretched(figure.token);
  const silhouette = spec.shape === 'silhouette';
  const widthInches = (spec.diameterMm / MM_PER_TTS_UNIT).toFixed(3);
  const importLine = stretched || silhouette
    ? `${widthInches} by ${((spec.lengthMm ?? spec.diameterMm) / MM_PER_TTS_UNIT).toFixed(3)} units`
    : `${widthInches} units across`;
  const tileType = spec.shape === 'circle' ? 'Circle' : 'a matching polygon';

  // A traced piece is not convex — TTS would otherwise build it a hull
  // collider, and it would sit and stack as the rectangle it was cut from
  // rather than as its own shape.
  const convexLine = silhouette
    ? 'Turn "Non-Convex" on — a traced piece is not convex, and a convex\n     collider gives it its own hull to sit on, so it would collide and\n     stack as the rectangle it was cut from rather than as its own shape.'
    : 'Leave "Non-Convex" off — a flat prism is convex, and the simple collider\n     is faster and behaves better when stacked.';

  // TTS's own Custom > Tile route needs no model hosting, but it draws only
  // a fixed Circle or polygon Tile — it has no equivalent to a traced
  // outline, so a silhouette gets a pointer to TTS's *own* alpha-tracing
  // feature instead of the usual shortcut. Worth naming explicitly why this
  // app's own route is still worth it even then: the preview, the thickness
  // in millimetres, and the printed part all agree with what a native
  // Custom Token cannot promise, since that traces on its own each time.
  const easierRoute = silhouette
    ? `A note on Tabletop Simulator's own Custom Token
  TTS can trace a shape from a picture's own transparency itself — Objects >
  Components > Custom > Token — which needs no model hosting either. This
  export exists anyway because that route re-traces the picture inside TTS,
  with no guarantee it agrees with what you saw in this app's own preview or
  with the thickness you set in millimetres. The Custom Model route above is
  the one built from the exact outline you approved here.`
    : `The easier route, if you do not need the exact thickness
  TTS can build a Circle or Hex itself: Objects > Components > Custom > Tile,
  Type ${tileType}, and give it the .png as the top image. Its Thickness
  slider is relative rather than in millimetres, so the piece will not be
  exactly ${spec.thicknessMm}mm — but it needs no model hosting at all.${
    stretched
      ? `\n  This piece is stretched (its width and length differ), which a built-in\n  Tile does not do — the Custom Model route above is the one that gets the\n  shape right.`
      : ''
  }`;

  return `${name} — generated token
=======================================

Files
  ${base}.obj   the mesh
  ${base}.mtl   the material, which names the texture
  ${base}.png   the texture

Size
  ${shapeLine(figure)}
  Thickness: ${spec.thicknessMm}mm
  Built at 1 unit = 1 inch (${MM_PER_TTS_UNIT}mm), so it imports at ${importLine}
  and needs no scaling.

Into Tabletop Simulator, as a Custom Model
  1. Host the .obj and the .png somewhere TTS can reach by URL — Steam Cloud
     (Menu > Modding > Steam Cloud) is the least trouble, and keeps the mod
     self-contained for anyone who subscribes to it.
  2. Objects > Components > Custom > Model.
  3. Model / Mesh: the URL of the .obj
     Diffuse / Image: the URL of the .png
     Material: Plastic
     ${convexLine}
  4. The .mtl is not used by TTS. It is there so the pair opens correctly in
     Blender, a slicer, or anything else you might take it to.

${easierRoute}

For printing
  The .obj is in inches. Most slicers assume millimetres, so scale by
  ${MM_PER_TTS_UNIT} on import — or say the file's units are inches if it asks.
`;
}

/** Everything needed to put one generated token on a table. */
export async function exportTokenModel(figure: Figure): Promise<ExportResult> {
  const spec = await resolvedTokenSpec(figure, tokenSpecOf(figure.token));
  const name = figureLabel(figure);
  const base = slugify(name, 'token');
  const mesh = buildTokenMesh(spec);
  const texture = await buildTokenArt(figure);

  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [
    { path: `${base}/${base}.obj`, bytes: encoder.encode(tokenObj(mesh, base)) },
    { path: `${base}/${base}.mtl`, bytes: encoder.encode(tokenMtl(base, `${base}.png`)) },
    { path: `${base}/${base}.png`, bytes: new Uint8Array(await texture.arrayBuffer()) },
    { path: `${base}/README.txt`, bytes: encoder.encode(readme(name, figure, spec, base)) }
  ];

  return {
    filename: `${base}-model.zip`,
    mimeType: 'application/zip',
    blob: createZip(entries)
  };
}

/**
 * The same texture the export writes, for showing the token on screen.
 *
 * Only a dial needs an early exit here — everything else always has *some*
 * texture to show now, an image or a flat fill of its rim colour.
 */
export async function tokenTextureUrl(figure: Figure): Promise<string | null> {
  if (figure.kind === 'dial' && !figure.reference.source) return null;
  const blob = await buildTokenArt(figure, 512);
  return URL.createObjectURL(blob);
}
