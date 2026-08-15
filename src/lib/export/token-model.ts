/**
 * A generated token, as the files Tabletop Simulator wants.
 *
 * Three of them, zipped: the mesh, the material that points at the texture, and
 * the texture itself — plus a note saying what to do with them, because the
 * import dialogue asks for a URL and offers no clue about which file is which.
 */
import { HEALTH_DIAL_RIM } from '$lib/figures/health-dial';
import type { Figure } from '$lib/figures/types';
import { figureLabel, tokenSpecOf } from '$lib/figures/types';
import {
  buildTokenMesh,
  MM_PER_TTS_UNIT,
  TOKEN_TEXTURE_RATIO,
  tokenMtl,
  tokenObj
} from '$lib/models/token';
import type { TokenSpec } from '$lib/models/token';
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

async function encodePng(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the texture.');
  return blob;
}

/**
 * The texture: a square of artwork over a strip of rim colour.
 *
 * The art region is square because that is the shape the token's face samples
 * — see `TOKEN_TEXTURE_RATIO`. The art is drawn to *fit* it rather than to fill
 * it, so a picture that is not square keeps its proportions and sits on the
 * rim colour rather than being cropped before the token's own shape gets to it.
 */
export async function buildTokenTexture(
  source: string,
  rimColor: string,
  size = 1024
): Promise<Blob> {
  /*
   * `onload` rather than `decode()`: decoding is allowed to wait for a moment
   * the browser thinks is convenient, and a page in a background tab may never
   * get one — which leaves the token grey with nothing to say why.
   */
  const image = await loadImage(source);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = Math.round(size * TOKEN_TEXTURE_RATIO);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not get a drawing context.');

  // The rim fills everything; the art is laid over the square at the top.
  context.fillStyle = rimColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const scale = Math.min(size / image.width, size / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);

  return encodePng(canvas);
}

/**
 * The two-sided texture: the supplied image made exactly 2:1, front | back.
 *
 * The mesh maps the top face into the left half and the bottom into the right
 * (see `buildTokenMesh`), each half a pixel-square the token's circle inscribes.
 * The source is drawn to fill a 2:1 canvas so the halves stay square even if it
 * was handed over a little off — an image already laid out two-up, like the
 * sidekick example, passes through untouched.
 */
export async function buildTwoSidedTexture(source: string, size = 1024): Promise<Blob> {
  const image = await loadImage(source);

  const canvas = document.createElement('canvas');
  canvas.width = size * 2;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not get a drawing context.');

  context.drawImage(image, 0, 0, image.width, image.height, 0, 0, canvas.width, canvas.height);
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
async function buildSolidTexture(color: string, size = 1024): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = Math.round(size * TOKEN_TEXTURE_RATIO);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not get a drawing context.');
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return encodePng(canvas);
}

/**
 * The texture a build asks for, one-sided or two, at the given size.
 *
 * A health dial comes through here as well. It is a disc like any other, but it
 * is the app's component rather than the author's, so its rim is the app's too —
 * there is no rim control on a dial to read one from. A dial's face is still
 * required — see `tts-bundle.ts`'s `dialObjects`, which never calls this
 * without one — but every other kind falls back to a flat fill of its own rim
 * colour rather than throwing, which is what lets a plain marker (a threat
 * track token, say) ship with no reference image at all.
 */
export function buildTokenArt(figure: Figure, size = 1024): Promise<Blob> {
  const source = figure.reference.source;
  if (figure.kind === 'dial') {
    if (!source) throw new Error('Attach a reference image first — it is what goes on the token.');
    return buildTokenTexture(source, HEALTH_DIAL_RIM, size);
  }
  if (!source) return buildSolidTexture(figure.token.rimColor, size);
  return figure.token.twoSided
    ? buildTwoSidedTexture(source, size)
    : buildTokenTexture(source, figure.token.rimColor, size);
}

/** How the piece's shape reads in prose, for the note that ships with it. */
function shapeLine(figure: Figure): string {
  const { token } = figure;
  if (token.shape === 'circle') return `Circle, across: ${token.diameterMm}mm`;
  return `${token.sides}-sided polygon, across the flats: ${token.diameterMm}mm`;
}

function readme(name: string, figure: Figure, spec: TokenSpec, base: string): string {
  const inches = (spec.diameterMm / MM_PER_TTS_UNIT).toFixed(3);
  const tileType = spec.shape === 'circle' ? 'Circle' : 'a matching polygon';
  return `${name} — generated token
=======================================

Files
  ${base}.obj   the mesh
  ${base}.mtl   the material, which names the texture
  ${base}.png   the texture

Size
  ${shapeLine(figure)}
  Thickness: ${spec.thicknessMm}mm
  Built at 1 unit = 1 inch (${MM_PER_TTS_UNIT}mm), so it imports at ${inches} units
  across and needs no scaling.

Into Tabletop Simulator, as a Custom Model
  1. Host the .obj and the .png somewhere TTS can reach by URL — Steam Cloud
     (Menu > Modding > Steam Cloud) is the least trouble, and keeps the mod
     self-contained for anyone who subscribes to it.
  2. Objects > Components > Custom > Model.
  3. Model / Mesh: the URL of the .obj
     Diffuse / Image: the URL of the .png
     Material: Plastic
     Leave "Non-Convex" off — a flat prism is convex, and the simple collider
     is faster and behaves better when stacked.
  4. The .mtl is not used by TTS. It is there so the pair opens correctly in
     Blender, a slicer, or anything else you might take it to.

The easier route, if you do not need the exact thickness
  TTS can build a Circle or Hex itself: Objects > Components > Custom > Tile,
  Type ${tileType}, and give it the .png as the top image. Its Thickness
  slider is relative rather than in millimetres, so the piece will not be
  exactly ${spec.thicknessMm}mm — but it needs no model hosting at all.

For printing
  The .obj is in inches. Most slicers assume millimetres, so scale by
  ${MM_PER_TTS_UNIT} on import — or say the file's units are inches if it asks.
`;
}

/** Everything needed to put one generated token on a table. */
export async function exportTokenModel(figure: Figure): Promise<ExportResult> {
  const spec = tokenSpecOf(figure.token);
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
