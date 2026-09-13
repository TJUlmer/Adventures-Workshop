/** Photograph the same generated cover that the author sees on screen. */
import { mount, tick, unmount } from 'svelte';
import GeneratedBoxArt from '$lib/renderer/GeneratedBoxArt.svelte';
import { usesAutomaticBoxArt } from '$lib/sets/box-art';
import type { AdventureSet } from '$lib/sets/types';
import { renderElementImage } from './card-image';

export const GENERATED_BOX_ART_SIZE = 512;
const GENERATED_BOX_ART_QUALITY = 0.84;

/** A failed picture must settle rather than hold a local shelf or publish open. */
function settled(image: HTMLImageElement): Promise<void> {
  if (image.complete) return Promise.resolve();
  return new Promise((resolve) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => resolve(), { once: true });
  });
}

async function readyForCapture(root: HTMLElement): Promise<void> {
  await Promise.all(Array.from(root.querySelectorAll('img'), settled));

  /* `document.fonts.ready` does not request an unused face. Reading the live
     title's resolved stack and explicitly loading it gives the off-screen
     cover the same first-render guarantee as the card stage. */
  const title = root.querySelector<HTMLElement>('.box-title');
  if (title) {
    const family = getComputedStyle(title).fontFamily;
    await document.fonts.load(`100px ${family}`).catch(() => []);
  }
  await document.fonts.ready;
}

/**
 * Render a square, bleed-free automatic cover, or `null` for an ineligible set.
 *
 * A caller publishing a scoped document must additionally restrict this to a
 * full-set scope; a villain slice deliberately retains `kind: 'adventure'`.
 */
export async function renderGeneratedBoxArt(set: AdventureSet): Promise<Blob | null> {
  if (!usesAutomaticBoxArt(set)) return null;

  const host = document.createElement('div');
  host.style.cssText =
    `position:fixed;left:-99999px;top:0;width:${GENERATED_BOX_ART_SIZE}px;` +
    `height:${GENERATED_BOX_ART_SIZE}px;pointer-events:none`;
  document.body.append(host);

  const view = mount(GeneratedBoxArt, { target: host, props: { set } });
  try {
    await tick();
    const cover = host.querySelector<HTMLElement>('[data-generated-box-art]');
    if (!cover) return null;
    await readyForCapture(cover);

    try {
      return await renderElementImage(
        cover,
        GENERATED_BOX_ART_SIZE,
        GENERATED_BOX_ART_SIZE,
        { mimeType: 'image/webp', quality: GENERATED_BOX_ART_QUALITY }
      );
    } catch {
      // `canvas.toBlob` reports unsupported encoders as `null`; PNG is universal.
      return renderElementImage(cover, GENERATED_BOX_ART_SIZE, GENERATED_BOX_ART_SIZE);
    }
  } finally {
    unmount(view);
    host.remove();
  }
}
