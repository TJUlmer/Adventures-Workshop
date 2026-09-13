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
import { hashEntity } from '$lib/sets/fingerprint';
import type { AdventureSet } from '$lib/sets/types';

/** Bump whenever a renderer change makes the stored pixels stale. */
export const CARD_PREVIEW_RENDERER_VERSION = 4;

export type CardPreviewSide = 'front' | 'back';
export type CardPreviewManifest = Record<string, string>;
export type CardPreviewFingerprintManifest = Record<string, string>;

export interface ReusableCardPreviews {
  manifest: CardPreviewManifest;
  fingerprints: CardPreviewFingerprintManifest;
  rendererVersion: number;
}

export interface CardPreviewRenderResult {
  /** Faces whose stored pixels are no longer valid and were photographed. */
  rendered: Map<string, Blob>;
  /** Current faces proven to still match their stored immutable PNG. */
  reused: CardPreviewManifest;
  /** A proof for every current face, including both rendered and reused ones. */
  fingerprints: CardPreviewFingerprintManifest;
  total: number;
}

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
 * Hash the exact payload handed to the canonical card renderer.
 *
 * It is tempting to hash only `job.card`, but a card's pixels also depend on
 * inherited style, its owning character, initiative fallback, custom symbols,
 * which side is showing, and the physical format. A broader proof may
 * occasionally re-render more than strictly necessary; a narrower one can
 * silently reuse the wrong picture, which is not an acceptable trade here.
 */
function dependencyFingerprint(
  value: unknown,
  cache: WeakMap<object, string>
): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value;
  const object = value as object;
  const cached = cache.get(object);
  if (cached) return cached;
  const fingerprint = hashEntity(value);
  cache.set(object, fingerprint);
  return fingerprint;
}

function renderFingerprint(
  set: AdventureSet,
  job: CardPngJob,
  cache: WeakMap<object, string>
): string {
  const renderJob = cardPngRenderJob(set, job);
  return hashEntity({
    stage: {
      card: dependencyFingerprint(renderJob.stage.card, cache),
      character: dependencyFingerprint(renderJob.stage.character, cache),
      cardback: dependencyFingerprint(renderJob.stage.cardback, cache),
      statCard: dependencyFingerprint(renderJob.stage.statCard, cache),
      statCardEntry: dependencyFingerprint(renderJob.stage.statCardEntry, cache),
      theme: dependencyFingerprint(renderJob.stage.theme, cache),
      side: renderJob.stage.side,
      initiativeSubject: renderJob.stage.initiativeSubject,
      customSymbols: dependencyFingerprint(renderJob.stage.customSymbols, cache)
    },
    format: dependencyFingerprint(renderJob.format, cache),
    bleed: false
  });
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
  previous: ReusableCardPreviews | null = null,
  onProgress?: (done: number, total: number) => void
): Promise<CardPreviewRenderResult> {
  const jobs = planCardPngJobs(set);
  const rendered = new Map<string, Blob>();
  const reused: CardPreviewManifest = {};
  const fingerprints: CardPreviewFingerprintManifest = {};
  const pending: Array<{ job: CardPngJob; key: string }> = [];
  const mayReuse = previous?.rendererVersion === CARD_PREVIEW_RENDERER_VERSION;
  /* Character art and the custom-symbol registry are shared by many jobs. Hash
     each object identity once so proving an unchanged hundred-card set does
     not repeatedly walk the same embedded images a hundred times. */
  const dependencyCache = new WeakMap<object, string>();

  for (const job of jobs) {
    const key = previewKey(job);
    const fingerprint = renderFingerprint(set, job, dependencyCache);
    fingerprints[key] = fingerprint;
    const previousUrl = previous?.manifest[key]?.trim() ?? '';

    if (mayReuse && previousUrl && previous?.fingerprints[key] === fingerprint) {
      reused[key] = previousUrl;
    } else {
      pending.push({ job, key });
    }
  }

  let done = Object.keys(reused).length;
  onProgress?.(done, jobs.length);

  /* An unchanged re-publish never mounts the off-screen stage at all. Loading
     fonts and photographing an empty queue would retain much of the cost this
     cache exists to remove. */
  if (pending.length > 0) {
    await withCardStage(async (photograph) => {
      for (const { job, key } of pending) {
        const renderJob = cardPngRenderJob(set, job);
        const image = await photograph(renderJob.stage, renderJob.format, {
          bleed: false
        });
        if (!image) throw new Error(`Could not render ${job.name} for the published gallery.`);
        rendered.set(key, image);
        done += 1;
        onProgress?.(done, jobs.length);
      }
    });
  }

  return { rendered, reused, fingerprints, total: jobs.length };
}
