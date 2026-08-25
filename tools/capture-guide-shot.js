/**
 * Capture a guide screenshot from the running app.
 *
 * Paste into the dev server's console (`npm run dev`), then call `shot()` for
 * each picture a guide needs. It writes raw PNGs into `exports/guides-raw/`;
 * `tools/guide-shots.py` trims them and converts them to the WebP files
 * `public/assets/guides/` serves.
 *
 * Not part of the app, and deliberately not: this is a dev-time tool, it
 * depends on the `/__workshop/export` endpoint that only exists under
 * `vite dev` (see `vite.config.ts`), and nothing an author does should be
 * able to reach it.
 *
 * **It photographs the DOM with the app's own rasteriser** rather than a
 * hand-rolled `foreignObject` wrapper. `renderPlateImage` is the same code
 * path that exports cards, and every step in it is there because of a
 * specific failure — the clone has to be sized before styles are read,
 * computed `mask-image` URLs come back absolute, images must already be
 * loaded before the tree is serialised. A second, naiver copy of that would
 * hit all of them again. `format` is synthetic because only `format.bleed` is
 * read on the `bleed: true` path.
 *
 * Guide shots are captured, never drawn over. Annotations are data — see
 * `guides/types.ts` — so a re-shoot after a UI change never means redoing the
 * arrows.
 *
 * Usage:
 *
 *   await shot('.sidebar', 'character-rules-deck/01-shared-deck');
 *   await shot('.sidebar', 'character-rules-deck/03-owned-deck', { height: 400 });
 *
 * `height` (and `width`) override the element's own measurement, which is how
 * a scrolling panel is captured whole: the clone is laid out at the size
 * given, so asking for the content's full height renders all of it rather
 * than the part that fits.
 *
 * **Form controls are mirrored into attributes first.** A `<select>`'s chosen
 * option, an `<input>`'s text and a `<textarea>`'s content are *properties*,
 * and properties do not survive `cloneNode` — the same trap `ThreatBoard`
 * takes its `editable` prop for, written up in CLAUDE.md. Photographed
 * without this, every select in the shot silently shows its **first** option:
 * a deck owned by a character came back reading "Whole set", which is not a
 * blank or an error, it is a confident screenshot of the wrong thing. Undone
 * again as soon as the shot is taken.
 *
 * **Every shot is flattened onto an opaque backdrop before it is written**,
 * and that is not cosmetic. Most panels in this app are tinted rather than
 * painted: a sidebar group's background is a low-alpha wash that only reads
 * as a colour because of the dark surface behind it. Photographed on its own
 * the wash keeps its alpha, and anything downstream that drops the alpha
 * channel — `Image.convert("RGB")`, for one — gets the colour at full
 * strength instead. A dark orange band came back as a slab of pure orange
 * with the text still on it, which looks like a theme bug and is not one. The
 * backdrop is the nearest ancestor that actually paints something, so the
 * shot is flattened against exactly what was behind it on screen.
 */
const { renderPlateImage } = await import('/src/lib/export/card-image.ts');

/**
 * Write every form control's live value into an attribute, and return the
 * undo. See the note above for why.
 */
function mirrorFormValues(root) {
  const undo = [];
  for (const select of root.querySelectorAll('select')) {
    for (const option of select.options) {
      const had = option.hasAttribute('selected');
      if (option.selected === had) continue;
      if (option.selected) option.setAttribute('selected', '');
      else option.removeAttribute('selected');
      undo.push(() => (had ? option.setAttribute('selected', '') : option.removeAttribute('selected')));
    }
  }
  for (const input of root.querySelectorAll('input')) {
    const had = input.getAttribute('value');
    input.setAttribute('value', input.value);
    undo.push(() => (had === null ? input.removeAttribute('value') : input.setAttribute('value', had)));
  }
  for (const area of root.querySelectorAll('textarea')) {
    const had = area.textContent;
    area.textContent = area.value;
    undo.push(() => (area.textContent = had));
  }
  return () => undo.forEach((fn) => fn());
}

/** The nearest ancestor colour that is actually painted. */
function backdropOf(element) {
  for (let node = element; node; node = node.parentElement) {
    const colour = getComputedStyle(node).backgroundColor;
    const alpha = /rgba?\([^)]*?,\s*([\d.]+)\s*\)$/.exec(colour);
    if (colour && colour !== 'transparent' && (!alpha || Number(alpha[1]) >= 1)) return colour;
  }
  return getComputedStyle(document.body).backgroundColor || '#000';
}

globalThis.shot = async (selector, name, options = {}) => {
  const element = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (!element) throw new Error(`No element matches ${selector}`);

  const box = element.getBoundingClientRect();
  const width = Math.round(options.width ?? box.width);
  const height = Math.round(options.height ?? box.height);
  /* 2 by default: these are looked at on screens that are very often
     retina, and a UI screenshot at 1x reads as blurred rather than small. */
  const scale = options.scale ?? 2;

  const restore = mirrorFormValues(element);
  let shot;
  try {
    shot = await renderPlateImage(
      element,
      { mm: { width, height }, bleed: { width, height } },
      { bleed: true, width: width * scale }
    );
  } finally {
    restore();
  }

  const bitmap = await createImageBitmap(shot);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  context.fillStyle = options.backdrop ?? backdropOf(element.parentElement ?? element);
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  const flat = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

  const path = `guides-raw/${name}.png`;
  const response = await fetch(`/__workshop/export?path=${path}`, { method: 'POST', body: flat });
  if (!response.ok) throw new Error(await response.text());
  return `${path} — ${bitmap.width}x${bitmap.height}`;
};

console.log('shot(selector, name, { width, height, scale }) is ready');
