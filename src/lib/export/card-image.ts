/**
 * Rasterising a single card.
 *
 * The card face is DOM, so the export path is: clone the live node, inline the
 * computed styles and every referenced asset as a data URI, wrap the result in
 * an SVG `foreignObject`, and draw that to a canvas at print resolution.
 *
 * Everything happens locally — the canvas never leaves the page.
 */
import type { Card } from '$lib/cards/types';
import { cardLabel } from '$lib/cards/factory';
import { CARD_FORMATS, THREAT_TRACK, trimBox } from '$lib/renderer/geometry';
import type { CardFormat } from '$lib/renderer/geometry';
import { slugify } from './json';
import type { ExportResult } from './types';

export function formatForCard(card: Card): CardFormat {
  if (card.type === 'initiative') return CARD_FORMATS.initiative;
  if (card.type === 'rules') return CARD_FORMATS.rules;
  if (card.type === 'event') return CARD_FORMATS.event;
  return CARD_FORMATS.action;
}

const dataUrlCache = new Map<string, string>();

/** Fetch a same-origin asset and inline it, so the SVG has no external refs. */
async function toDataUrl(url: string): Promise<string> {
  const cached = dataUrlCache.get(url);
  if (cached) return cached;

  const response = await fetch(url);
  const blob = await response.blob();
  const encoded = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${url}`));
    reader.readAsDataURL(blob);
  });

  dataUrlCache.set(url, encoded);
  return encoded;
}

/**
 * Every asset a `url(...)` in a CSS string still points at.
 *
 * A *computed* `mask-image` comes back absolute — `http://host/assets/…` —
 * where the property was authored root-relative, so both forms have to match.
 * Missing them left every mask pointing outside the SVG, where it cannot load,
 * and an unmasked frame floods the whole card.
 */
const ASSET_URL = String.raw`(?:https?://[^"')]*?)?/assets/[^"')]+`;

function collectUrls(css: string): string[] {
  const found = new Set<string>();
  for (const match of css.matchAll(new RegExp(String.raw`url\((["']?)(${ASSET_URL})\1\)`, 'g'))) {
    const url = match[2];
    if (url) found.add(url);
  }
  return [...found];
}

/** Settles either way: a picture that will not load must not hang an export. */
function settled(image: HTMLImageElement): Promise<void> {
  if (image.complete) return Promise.resolve();
  return new Promise<void>((resolve) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => resolve(), { once: true });
  });
}

/**
 * Inline every `<img>` on the **live** element, before anything is cloned.
 *
 * This has to happen here and not on the clone, and the reason is worth the
 * paragraph. An SVG loaded as an image is its own document: it may not fetch
 * anything, which is why the assets are inlined at all, and — the part that
 * bites — its pictures do not reliably arrive before the browser paints it.
 * Neither `load` nor `decode()` on the wrapper waits for them.
 *
 * What *does* work is the picture already being loaded when the markup is
 * serialised. A card's own artwork never showed the fault, and that is the
 * clue: artwork is a data URI from the moment the card mounts, so it is loaded
 * long before the clone is made. Our assets were not — they were swapped in
 * moments before serialising — so the first two cards of a cold export came out
 * with holes where their attack and defense symbols should be, and every card
 * after them was right, because by then the browser had the files.
 *
 * Swapping on the live node gives them the same head start artwork has always
 * had. Measured: with this, the first card of a cold export carries its symbols;
 * without it, the first two do not.
 *
 * It leaves the on-screen card holding data URIs, which is the same picture by
 * the same bytes — and one fewer thing it needs the network for.
 */
async function inlineLiveImages(root: Element): Promise<void> {
  const images = [root, ...Array.from(root.querySelectorAll('*'))].filter(
    (element): element is HTMLImageElement =>
      element instanceof HTMLImageElement && element.getAttribute('src')?.includes('/assets/') === true
  );

  for (const image of images) {
    image.setAttribute('src', await toDataUrl(image.src));
  }

  await Promise.all(images.map(settled));
}

/**
 * Swap every asset a *style* still points at for a data URI.
 *
 * Done on the DOM rather than on the serialised markup: serialising escapes the
 * quotes in `url("…")` to `&quot;`, so a pattern written against CSS never
 * matches once the tree is a string. And on the clone rather than the live
 * node, because these are the values `freezeStyles` has just written.
 *
 * Masks never had the loading fault that `inlineLiveImages` exists for — a mask
 * resolves as part of style, before the draw — so this stays where it is.
 */
async function inlineStyleAssets(root: Element): Promise<void> {
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const style = element.getAttribute('style');
    if (!style) continue;

    let next = style;
    for (const url of collectUrls(style)) next = next.split(url).join(await toDataUrl(url));
    if (next !== style) element.setAttribute('style', next);
  }
}

/**
 * Bake every computed style onto the tree in place. `foreignObject` gets no
 * stylesheet, so the styles have to travel with the markup.
 *
 * This must run on a tree that is *already laid out at print size*. Computed
 * values are used values: `left` on the interior reads 35.98px against a 411px
 * preview and 143px against the 1632px plate. Freezing the preview's numbers
 * and then widening the card was what rendered the whole face at a quarter
 * scale in one corner.
 */
function freezeStyles(root: Element): void {
  const nodes: Element[] = [];
  const collect = (element: Element): void => {
    nodes.push(element);
    for (const child of Array.from(element.children)) collect(child);
  };
  collect(root);

  /*
   * Read every node before writing any. Setting `style` on a parent can change
   * what its children compute to — an explicit width where one was inherited,
   * say — and a half-frozen tree would bake in the disturbance.
   */
  const frozen = nodes.map((element) => {
    const computed = getComputedStyle(element);
    const declarations: string[] = [];
    for (const property of computed) {
      const value = computed.getPropertyValue(property);
      if (value) declarations.push(`${property}:${value}`);
    }
    return declarations.join(';');
  });

  nodes.forEach((element, index) => element.setAttribute('style', frozen[index] ?? ''));
}

/**
 * The card faces, as `@font-face` rules with the files inlined.
 *
 * The SVG is loaded as an image, which makes it its own document with no access
 * to the page's stylesheets — so without this the card sets in a fallback face
 * and every measured cap-height position is wrong. Read off the live sheets
 * rather than listed here, so adding a face to `card-fonts.css` is enough.
 */
async function fontFaceCss(): Promise<string> {
  const rules: string[] = [];

  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      // Cross-origin sheet; nothing of ours lives there.
      continue;
    }

    for (const rule of Array.from(cssRules)) {
      if (rule.constructor.name !== 'CSSFontFaceRule' && !(rule instanceof CSSFontFaceRule)) {
        continue;
      }
      let text = rule.cssText;
      for (const url of collectUrls(text)) {
        text = text.split(url).join(await toDataUrl(url));
      }
      rules.push(text);
    }
  }

  return rules.join('\n');
}

/**
 * Photograph a live element at a given size.
 *
 * The size is imposed on the clone *before* anything is read off it, which is
 * what makes `cqw` resolve to print pixels and every percentage resolve against
 * the real thing. Freezing a preview's numbers and then widening the result was
 * what once rendered a whole card at quarter scale in one corner.
 */
async function rasterise(
  element: HTMLElement,
  width: number,
  height: number
): Promise<HTMLImageElement> {
  // Before the clone exists, so the pictures are loaded by the time it is text.
  await inlineLiveImages(element);

  const clone = element.cloneNode(true) as HTMLElement;
  clone.style.position = 'static';
  clone.style.left = '0';
  clone.style.top = '0';
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;

  const holder = document.createElement('div');
  holder.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px`;
  holder.append(clone);
  document.body.append(holder);

  let markup: string;
  try {
    freezeStyles(clone);
    await inlineStyleAssets(clone);
    markup = new XMLSerializer().serializeToString(clone);
  } finally {
    document.body.removeChild(holder);
  }

  const fonts = await fontFaceCss();

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<style>${fonts}</style>` +
    `<foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;

  /* `load` rather than `decode()`: an export runs for minutes and is usually
     left to get on with it, and `decode()` waits for a convenient moment that a
     backgrounded tab never offers. */
  const image = new Image();
  const ready = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Could not rasterise the card.'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await ready;
  return image;
}

/** Draw a region of a rasterised image out to a PNG at the asked-for width. */
async function encode(
  image: HTMLImageElement,
  region: { x: number; y: number; width: number; height: number },
  outWidth: number
): Promise<Blob> {
  const scale = outWidth / region.width;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(region.width * scale);
  canvas.height = Math.round(region.height * scale);

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not get a drawing context.');
  context.drawImage(
    image,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the image.');
  return blob;
}

export interface CardImageOptions {
  /** Include the printer's bleed, or crop to the cut line. */
  bleed: boolean;
  /** Output width in pixels. Defaults to the template's own resolution. */
  width?: number;
}

/**
 * Render a live plate to a PNG.
 *
 * `plate` must be the element carrying the print file's aspect ratio — the
 * renderer's `.plate` — so the crop maths matches what is on screen. The format
 * is passed rather than derived, because a deck back has no card to derive it
 * from and rasterising should not need to know what a card is.
 */
export async function renderPlateImage(
  plate: HTMLElement,
  format: CardFormat,
  options: CardImageOptions
): Promise<Blob> {
  const region = options.bleed
    ? { x: 0, y: 0, width: format.bleed.width, height: format.bleed.height }
    : trimBox(format);
  const outWidth = options.width ?? region.width;

  /*
   * Photograph at whatever the caller asked for rather than always at the
   * template's own size. The face is DOM — it re-lays out sharp at any size —
   * but the deck back's template is drawn at 373px, so a back asked for at
   * sheet resolution would be an upscale of a small raster, text and all.
   * Never *below* the template size: that would throw away detail the export
   * is about to be judged on.
   */
  const scale = Math.max(1, outWidth / region.width);
  const image = await rasterise(plate, format.bleed.width * scale, format.bleed.height * scale);

  return encode(
    image,
    {
      x: region.x * scale,
      y: region.y * scale,
      width: region.width * scale,
      height: region.height * scale
    },
    outWidth
  );
}

/**
 * Render the threat board to a PNG at its printed size.
 *
 * The board is a strip rather than a card — no bleed, no cut line — so it is
 * photographed whole at the one size it prints at, unless the caller asks for
 * narrower: Tabletop Simulator will not take a texture over 4096px, well
 * clear of the printed strip's own 1637.
 */
export async function renderThreatTrackImage(
  board: HTMLElement,
  options: { width?: number } = {}
): Promise<Blob> {
  const { width, height } = THREAT_TRACK.bleed;
  const image = await rasterise(board, width, height);
  return encode(image, { x: 0, y: 0, width, height }, options.width ?? width);
}

/**
 * Render the map to a PNG at its printed size.
 *
 * A board rather than a card: no bleed and no cut line, so it is photographed
 * whole. The height follows `aspect` rather than being stored, because the
 * aspect is what the author's chosen `size` sets and a height would be a
 * second copy of it (see `map/types.ts`'s `MAP_SIZES`/`mapPrintWidth`,
 * which `width` here is always called with).
 *
 * `options.width` exists for the same reason it does on the threat track —
 * Tabletop Simulator refuses a texture over 4096px — though every current
 * `MAP_SIZES` preset is already well clear of that on its own.
 */
export async function renderMapImage(
  board: HTMLElement,
  aspect: number,
  width: number,
  options: { width?: number } = {}
): Promise<Blob> {
  const height = Math.round(width / (aspect || 1));
  const image = await rasterise(board, width, height);
  return encode(image, { x: 0, y: 0, width, height }, options.width ?? width);
}

/** The same render, named and wrapped for a single card the author asked for. */
export async function renderCardImage(
  plate: HTMLElement,
  card: Card,
  options: CardImageOptions
): Promise<ExportResult> {
  const blob = await renderPlateImage(plate, formatForCard(card), options);
  const suffix = options.bleed ? '-bleed' : '';
  return {
    filename: `${slugify(cardLabel(card), 'card')}${suffix}.png`,
    mimeType: 'image/png',
    blob
  };
}
