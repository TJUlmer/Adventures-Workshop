/** The UV atlas, its matching mesh, and the default box-art texture. */
import type { AdventureSet } from '$lib/sets/types';
import { renderGeneratedBoxArt } from './box-art';
import layout from './box-skin-layout.json';

type Point = readonly [number, number, number];
type Rect = readonly [number, number, number, number];
type Pixel = readonly [number, number];

export const BOX_SKIN_WIDTH = layout.width;
export const BOX_SKIN_HEIGHT = layout.height;

const width = 1.7;
const height = 0.35;
const depth = 2.35;

const rectangle = (values: readonly number[]): Rect => {
  if (values.length !== 4) throw new Error('Invalid box skin layout.');
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0];
};
const front = rectangle(layout.front);
const corners = (rect: Rect): readonly [Pixel, Pixel, Pixel, Pixel] => {
  const [x, y, w, h] = rect;
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
};
const [frontTL, frontTR, frontBR, frontBL] = corners(front);
const [backTL, backTR, backBR, backBL] = corners(rectangle(layout.back));
const [topTL, topTR, topBR, topBL] = corners(rectangle(layout.sideTop));
const [bottomTL, bottomTR, bottomBR, bottomBL] = corners(rectangle(layout.sideBottom));
const [leftTL, leftTR, leftBR, leftBL] = corners(rectangle(layout.sideLeft));
const [rightTL, rightTR, rightBR, rightBL] = corners(rectangle(layout.sideRight));

const faces: readonly { normal: Point; vertices: readonly Point[]; uv: readonly Pixel[] }[] = [
  { normal: [0, 1, 0], vertices: [[-width, height, -depth], [-width, height, depth], [width, height, depth], [width, height, -depth]], uv: [frontTL, frontBL, frontBR, frontTR] },
  { normal: [0, -1, 0], vertices: [[-width, -height, -depth], [width, -height, -depth], [width, -height, depth], [-width, -height, depth]], uv: [backTL, backTR, backBR, backBL] },
  { normal: [0, 0, 1], vertices: [[-width, -height, depth], [width, -height, depth], [width, height, depth], [-width, height, depth]], uv: [bottomBL, bottomBR, bottomTR, bottomTL] },
  { normal: [0, 0, -1], vertices: [[width, -height, -depth], [-width, -height, -depth], [-width, height, -depth], [width, height, -depth]], uv: [topBL, topBR, topTR, topTL] },
  { normal: [-1, 0, 0], vertices: [[-width, -height, -depth], [-width, -height, depth], [-width, height, depth], [-width, height, -depth]], uv: [leftTL, leftBL, leftBR, leftTR] },
  { normal: [1, 0, 0], vertices: [[width, -height, depth], [width, -height, -depth], [width, height, -depth], [width, height, depth]], uv: [rightBR, rightTR, rightTL, rightBL] }
];

export const BOX_OBJ = [
  'o PresentationBox',
  ...faces.flatMap((face) => face.vertices.map(([x, y, z]) => `v ${x} ${y} ${z}`)),
  ...faces.flatMap((face) => face.uv.map(([x, y]) =>
    `vt ${(x / BOX_SKIN_WIDTH).toFixed(8)} ${(1 - y / BOX_SKIN_HEIGHT).toFixed(8)}`
  )),
  ...faces.map(({ normal: [x, y, z] }) => `vn ${x} ${y} ${z}`),
  ...faces.flatMap((_, face) => {
    const first = face * 4 + 1;
    const normal = face + 1;
    const vertex = (offset: number) => `${first + offset}/${first + offset}/${normal}`;
    return [`f ${vertex(0)} ${vertex(1)} ${vertex(2)}`, `f ${vertex(0)} ${vertex(2)} ${vertex(3)}`];
  }),
  ''
].join('\n');

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read the box art image.'));
    image.src = source;
  });
}

function png(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('Could not render the box texture.')),
    'image/png'
  ));
}

/** White sides and underside, with the set's cover fitted to the top/front. */
export async function defaultBoxTexture(set: AdventureSet): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = BOX_SKIN_WIDTH;
  canvas.height = BOX_SKIN_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not render the box texture.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  let source = set.boxArt.source;
  let temporaryUrl: string | null = null;
  if (!source) {
    const generated = await renderGeneratedBoxArt(set);
    if (generated) source = temporaryUrl = URL.createObjectURL(generated);
  }
  try {
    if (source) {
      const image = await loadImage(source);
      const [x, y, w, h] = front;
      const cover = Math.max(w / image.naturalWidth, h / image.naturalHeight);
      const sourceW = w / cover;
      const sourceH = h / cover;
      context.drawImage(
        image,
        (image.naturalWidth - sourceW) / 2,
        (image.naturalHeight - sourceH) / 2,
        sourceW,
        sourceH,
        x, y, w, h
      );
    }
    return await png(canvas);
  } finally {
    if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
  }
}
