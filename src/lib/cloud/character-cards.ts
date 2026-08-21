/**
 * A picture of each hero's character card, made at publish time.
 *
 * This is the one thing the gallery shows that is *rendered* rather than
 * downscaled from something an author already drew, and it is worth being
 * clear about why it has to be.
 *
 * A character card is composed DOM — a stat sheet read straight off the
 * `Character`, with no entry in `set.cards` and no finished image behind it
 * (unless its author chose one). So there are exactly two ways the gallery
 * could show one: fetch the whole `document` and render it live, or photograph
 * it once when the set is published. The first is what the gallery exists to
 * avoid — `document` is the entire set, several megabytes, and hovering a tile
 * is not a reason to download one. So: photographed once, here.
 *
 * The cost is honest and worth stating. Photographing a card costs about a
 * second, it needs the whole card stage mounted, and a set with five heroes
 * pays that five times on every publish. It is also the reason
 * `cloud/thumbnail.ts` is *not* a render — that one had a picture to downscale
 * and this one does not.
 *
 * Heroes only, because they are the only role with a character card at all:
 * `CardRenderer` draws `statCard` through `HeroCharacterCardFace`, and
 * `PreviewPanel` offers the sheet for `role === 'hero'` and nothing else. A
 * set with no heroes never mounts the stage.
 */
import { characterLabel } from '$lib/characters/factory';
import type { CharacterId } from '$lib/characters/types';
import { withCardStage } from '$lib/export/card-stage';
import { CARD_FORMATS } from '$lib/renderer/geometry';
import type { AdventureSet } from '$lib/sets/types';

/**
 * Width of a rendered character card, in pixels.
 *
 * Sized for a hover preview on a dense grid at two-times pixel density. The
 * card is 63×88mm, so this comes out around 980px tall — big enough that the
 * ability text is readable, which is the whole point of showing the sheet
 * rather than another portrait, and far below the 1632px the print file uses.
 */
export const CHARACTER_CARD_PREVIEW_WIDTH = 700;

/** WebP quality. Matches `thumbnail.ts` — where the artefacts stop showing. */
const QUALITY = 0.82;

/**
 * Re-encode a rendered PNG as WebP.
 *
 * `renderPlateImage` only ever writes PNG, which is right for an export
 * destined for a printer and wrong for something every visitor to the gallery
 * downloads: a full-colour card comes out several times larger than it needs
 * to be. Falls back to the PNG it was given where WebP is not supported —
 * `toBlob` answers `null` for a format it cannot write rather than throwing,
 * which is the only signal there is.
 */
async function toWebp(png: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(png);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const context = canvas.getContext('2d');
    if (!context) return png;
    context.drawImage(bitmap, 0, 0);

    const webp = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', QUALITY)
    );
    return webp ?? png;
  } finally {
    bitmap.close();
  }
}

/**
 * Photograph every hero's character card.
 *
 * Keyed by character id, which is what survives a re-publish and what
 * `set_characters` is keyed by in turn. A hero whose card fails to render is
 * simply absent from the map rather than failing the publish — a missing
 * preview is a tile without a hover, and a failed publish is a set nobody can
 * read. Same reasoning as the thumbnail's own `try`.
 *
 * Only ever draws a hero's *primary* sheet. A duo publishes one preview, not
 * one per identity: this is a glance at who they are, and `additionalCards`
 * are all reachable by opening the set.
 */
export async function renderCharacterCards(
  set: AdventureSet
): Promise<Map<CharacterId, Blob>> {
  const heroes = set.characters.filter((character) => character.role === 'hero');
  const rendered = new Map<CharacterId, Blob>();
  if (heroes.length === 0) return rendered;

  await withCardStage(async (photograph) => {
    for (const hero of heroes) {
      try {
        /* Trimmed to the cut line, not the bleed: this is looked at, never
           printed, and a preview wearing its bleed shows a margin no reader
           would understand. */
        const png = await photograph({ card: null, statCard: hero }, CARD_FORMATS.action, {
          bleed: false,
          width: CHARACTER_CARD_PREVIEW_WIDTH
        });
        if (png) rendered.set(hero.id, await toWebp(png));
      } catch (cause) {
        console.warn(`Could not render ${characterLabel(hero)}'s character card.`, cause);
      }
    }
  });

  return rendered;
}
