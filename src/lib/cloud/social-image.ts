/**
 * The picture attached to a shared set's link preview — what Discord, Slack,
 * Twitter and every other unfurler read as `og:image` (see `middleware.ts`).
 *
 * Deliberately separate from `thumbnail.ts`'s `renderThumbnail`. That one is
 * a plain downscale of whatever artwork already exists, sized and cropped for
 * a small square gallery tile — right for that job, and wrong for this one: a
 * link preview is read much larger, has no tile to crop into, and an author's
 * raw deck-back replacement file (drawn at full bleed, margin and all) reads
 * as an unfinished picture at that size. This renders the set's own cards
 * instead — trimmed to the cut line, the same rasteriser the gallery's
 * character-card hover preview already uses (`cloud/character-cards.ts`) —
 * and composes more than one where there is more than one hero worth
 * showing. `renderThumbnail` keeps doing the gallery-tile job alone; this is
 * only ever read by `social_image_url`.
 */
import { characterLabel } from '$lib/characters/factory';
import type { Character } from '$lib/characters/types';
import { hasArtwork } from '$lib/core/artwork';
import type { Photograph } from '$lib/export/card-stage';
import { withCardStage } from '$lib/export/card-stage';
import { CARD_FORMATS } from '$lib/renderer/geometry';
import { charactersByRole } from '$lib/sets/queries';
import type { AdventureSet } from '$lib/sets/types';
import { renderThumbnail } from './thumbnail';

/** Width of one card in the composed picture, in pixels. */
const CARD_WIDTH = 480;
/** Gap between cards, on both axes. */
const GAP = 24;
/** WebP quality. Matches `thumbnail.ts` and `character-cards.ts`. */
const QUALITY = 0.85;

const CARD_HEIGHT = Math.round(
  CARD_WIDTH * (CARD_FORMATS.action.mm.height / CARD_FORMATS.action.mm.width)
);

/**
 * More heroes than this stop reading as one picture and start reading as a
 * contact sheet — a two-column grid five or six deep is not a link preview
 * anyone can take in at a glance. Every Unmatched box so far ships four or
 * fewer, so this is a ceiling nothing has hit yet rather than a compromise.
 */
const MAX_GRID_HEROES = 4;

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY));
}

async function drawBlobAt(
  context: CanvasRenderingContext2D,
  blob: Blob,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  const bitmap = await createImageBitmap(blob);
  try {
    context.drawImage(bitmap, x, y, width, height);
  } finally {
    bitmap.close();
  }
}

/** One hero's deck back, trimmed, at the composition's own card size. */
function heroBack(photograph: Photograph, hero: Character): Promise<Blob | null> {
  return photograph({ card: null, cardback: hero }, CARD_FORMATS.action, {
    bleed: false,
    width: CARD_WIDTH
  });
}

/** One hero's character card, trimmed, at the composition's own card size. */
function heroCard(photograph: Photograph, hero: Character): Promise<Blob | null> {
  return photograph({ card: null, statCard: hero }, CARD_FORMATS.action, {
    bleed: false,
    width: CARD_WIDTH
  });
}

/** Lay pictures left to right in one row, sized to fit them exactly. */
async function composeRow(pictures: Blob[]): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = pictures.length * CARD_WIDTH + (pictures.length - 1) * GAP;
  canvas.height = CARD_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return null;

  for (const [index, picture] of pictures.entries()) {
    await drawBlobAt(context, picture, index * (CARD_WIDTH + GAP), 0, CARD_WIDTH, CARD_HEIGHT);
  }
  return toBlob(canvas);
}

/** Lay pictures out two to a row, as many rows as it takes. */
async function composeGrid(pictures: Blob[]): Promise<Blob | null> {
  const columns = Math.min(2, pictures.length);
  const rows = Math.ceil(pictures.length / columns);
  const canvas = document.createElement('canvas');
  canvas.width = columns * CARD_WIDTH + (columns - 1) * GAP;
  canvas.height = rows * CARD_HEIGHT + (rows - 1) * GAP;
  const context = canvas.getContext('2d');
  if (!context) return null;

  for (const [index, picture] of pictures.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    await drawBlobAt(
      context,
      picture,
      column * (CARD_WIDTH + GAP),
      row * (CARD_HEIGHT + GAP),
      CARD_WIDTH,
      CARD_HEIGHT
    );
  }
  return toBlob(canvas);
}

/**
 * Compose the link-preview picture for a set, or fall back to the plain
 * artwork downscale where there is nothing of the set's own worth composing.
 *
 * Box art wins outright — an author who supplied one chose it to represent
 * the whole set, and a generated collage would be answering a question
 * nobody asked. A set with no heroes (villain-only, or still early) has
 * nothing this function knows how to compose either, so both cases fall
 * through to the same downscale `renderThumbnail` already does — deliberately
 * checked *before* opening a card stage, so neither case pays for one.
 */
export async function renderSocialImage(set: AdventureSet): Promise<Blob | null> {
  const heroes = charactersByRole(set, 'hero');
  if (hasArtwork(set.boxArt) || heroes.length === 0) {
    return renderThumbnail(set);
  }

  return withCardStage(async (photograph) => {
    if (heroes.length === 1) {
      const hero = heroes[0];
      if (!hero) return renderThumbnail(set);

      try {
        const [back, card] = await Promise.all([heroBack(photograph, hero), heroCard(photograph, hero)]);
        const pictures = [back, card].filter((blob): blob is Blob => blob !== null);
        if (pictures.length === 0) return renderThumbnail(set);
        return (await composeRow(pictures)) ?? renderThumbnail(set);
      } catch (cause) {
        console.warn(`Could not render a social image for ${characterLabel(hero)}.`, cause);
        return renderThumbnail(set);
      }
    }

    try {
      const shown = heroes.slice(0, MAX_GRID_HEROES);
      const backs = (await Promise.all(shown.map((hero) => heroBack(photograph, hero)))).filter(
        (blob): blob is Blob => blob !== null
      );
      if (backs.length === 0) return renderThumbnail(set);
      return (await composeGrid(backs)) ?? renderThumbnail(set);
    } catch (cause) {
      console.warn('Could not render a social image for the set.', cause);
      return renderThumbnail(set);
    }
  });
}
