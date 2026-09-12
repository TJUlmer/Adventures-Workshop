/**
 * Lossless card pictures stored beside one published revision.
 *
 * These are not a second renderer or a parallel export plan. Publication runs
 * the same canonical jobs as "All cards as PNGs", then the shared gallery
 * displays those resulting pixels without reconstructing the card.
 */
import { withCardStage } from '$lib/export/card-stage';
import { cardPngRenderJob, planCardPngJobs } from '$lib/export/card-pngs';
import type { CardPngJob } from '$lib/export/card-pngs';
import type { AdventureSet } from '$lib/sets/types';

/** Bump whenever a renderer change makes the stored pixels stale. */
export const CARD_PREVIEW_RENDERER_VERSION = 4;

export type CardPreviewSide = 'front' | 'back';
export type CardPreviewManifest = Record<string, string>;

export function printedCardPreviewKey(cardId: string, side: CardPreviewSide = 'front'): string {
  return `card:${cardId}:${side}`;
}

export function deckBackPreviewKey(characterId: string): string {
  return `deck-back:${characterId}:front`;
}

export function characterCardPreviewKey(identityId: string): string {
  return `character-card:${identityId}:front`;
}

/** An absent or malformed value is shown as unavailable, never reconstructed. */
export function cardPreviewUrl(manifest: CardPreviewManifest | null | undefined, key: string): string {
  const value = manifest?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function previewKey(job: CardPngJob): string {
  if (job.card) return printedCardPreviewKey(job.card.id, job.side ?? 'front');
  if (job.cardback) return deckBackPreviewKey(job.cardback.id);
  if (job.statCard) return characterCardPreviewKey(job.statCardEntry?.id ?? job.statCard.id);
  throw new Error(`The card PNG job “${job.name}” has no publishable face.`);
}

/**
 * Render a complete publication manifest.
 *
 * A single missing face rejects the operation. Published previews are the
 * approved visual snapshot, so a partial manifest must never replace the
 * previous revision's complete one.
 */
export async function renderCardPreviews(
  set: AdventureSet,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, Blob>> {
  const jobs = planCardPngJobs(set);
  const rendered = new Map<string, Blob>();
  onProgress?.(0, jobs.length);

  await withCardStage(async (photograph) => {
    for (const [index, job] of jobs.entries()) {
      const renderJob = cardPngRenderJob(set, job);
      const image = await photograph(renderJob.stage, renderJob.format, {
        bleed: false
      });
      if (!image) throw new Error(`Could not render ${job.name} for the published gallery.`);
      rendered.set(previewKey(job), image);
      onProgress?.(index + 1, jobs.length);
    }
  });

  return rendered;
}
