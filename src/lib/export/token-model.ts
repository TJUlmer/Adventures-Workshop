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
 *
 * `zoom` scales up from that fit baseline — 1 reproduces the fit exactly, so
 * an untouched `Artwork` (the common case, and every document saved before
 * this existed) looks exactly as it always has. It only ever *enlarges*
 * proportionally from there, never stretches one axis — `figures/types.ts`'s
 * `Figure.reference.transform.scale` is what an author actually turns, and it
 * has no separate X/Y to stretch with. Clipped to the art square: past 1 the
 * scaled image overflows the square it used to always fit inside, and without
 * the clip it would bleed into the rim strip below.
 */
export async function buildTokenTexture(
  source: string,
  rimColor: string,
  size = 1024,
  zoom = 1
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

  const fitScale = Math.min(size / image.width, size / image.height);
  const scale = fitScale * Math.max(0.2, zoom);
  const width = image.width * scale;
  const height = image.height * scale;

  context.save();
  context.beginPath();
  context.rect(0, 0, size, size);
  context.clip();
  context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
  context.restore();

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
 * A health dial comes through here as well, and its `twoSided` reads off the
 * same `figure.token.twoSided` a real token build would — see `health-dial.ts`.
 * It is a disc like any other, but it is the app's component rather than the
 * author's, so a *one-sided* dial's rim is the app's fixed colour rather than
 * one the author picks — there is no rim control on a dial. A two-sided dial
 * has no rim band to fill in the first place: like a two-sided token, its edge
 * samples the seam between the front and back halves of the supplied picture,
 * whatever that happens to be, the same as `buildTwoSidedTexture` already does
 * for a real token.
 *
 * A dial's face is still required — see `tts-bundle.ts`'s `dialObjects`, which
 * never calls this without one — but every other kind falls back to a flat
 * fill of its own rim colour rather than throwing, which is what lets a plain
 * marker (a threat track token, say) ship with no reference image at all.
 */
export function buildTokenArt(figure: Figure, size = 1024): Promise<Blob> {
  const source = figure.reference.source;
  const zoom = figure.reference.transform.scale;
  if (figure.kind === 'dial') {
    if (!source) throw new Error('Attach a reference image first — it is what goes on the token.');
    return figure.token.twoSided
      ? buildTwoSidedTexture(source, size)
      : buildTokenTexture(source, HEALTH_DIAL_RIM, size, zoom);
  }
  if (!source) return buildSolidTexture(figure.token.rimColor, size);
  return figure.token.twoSided
    ? buildTwoSidedTexture(source, size)
    : buildTokenTexture(source, figure.token.rimColor, size, zoom);
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
  if (isStretched(token)) {
    return `${token.sides}-sided polygon, ${token.diameterMm}mm wide by ${token.lengthMm}mm long`;
  }
  return `${token.sides}-sided polygon, across the flats: ${token.diameterMm}mm`;
}

function readme(name: string, figure: Figure, spec: TokenSpec, base: string): string {
  const stretched = isStretched(figure.token);
  const widthInches = (spec.diameterMm / MM_PER_TTS_UNIT).toFixed(3);
  const importLine = stretched
    ? `${widthInches} by ${((spec.lengthMm ?? spec.diameterMm) / MM_PER_TTS_UNIT).toFixed(3)} units`
    : `${widthInches} units across`;
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
     Leave "Non-Convex" off — a flat prism is convex, and the simple collider
     is faster and behaves better when stacked.
  4. The .mtl is not used by TTS. It is there so the pair opens correctly in
     Blender, a slicer, or anything else you might take it to.

The easier route, if you do not need the exact thickness
  TTS can build a Circle or Hex itself: Objects > Components > Custom > Tile,
  Type ${tileType}, and give it the .png as the top image. Its Thickness
  slider is relative rather than in millimetres, so the piece will not be
  exactly ${spec.thicknessMm}mm — but it needs no model hosting at all.${
    stretched
      ? `\n  This piece is stretched (its width and length differ), which a built-in\n  Tile does not do — the Custom Model route above is the one that gets the\n  shape right.`
      : ''
  }

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
