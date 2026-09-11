/**
 * Lossless card pictures stored beside one published revision.
 *
 * These are not a second renderer. `withCardStage` mounts the same
 * `CardRenderer` that the editor and PNG export use, then photographs it at a
 * fixed reading resolution. The shared gallery displays the resulting pixels
 * instead of asking every visitor's browser to reconstruct the card.
 */
import { cardLabel } from '$lib/cards/factory';
import type { Card } from '$lib/cards/types';
import type { Character, HeroCharacterCard } from '$lib/characters/types';
import type { StageJob } from '$lib/export/card-stage';
import { withCardStage } from '$lib/export/card-stage';
import { formatForCard } from '$lib/export/card-image';
import { CARD_FORMATS } from '$lib/renderer/geometry';
import type { CardFormat } from '$lib/renderer/geometry';
import {
  characterForCard,
  initiativeSubjectForCard,
  resolveStyleForCard
} from '$lib/sets/queries';
import type { AdventureSet } from '$lib/sets/types';

/** Bump whenever a renderer change makes the stored pixels stale. */
export const CARD_PREVIEW_RENDERER_VERSION = 3;

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

/** A malformed legacy row falls back to the live renderer rather than breaking the gallery. */
export function cardPreviewUrl(manifest: CardPreviewManifest | null | undefined, key: string): string {
  const value = manifest?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

interface CardPreviewJob {
  key: string;
  label: string;
  stage: StageJob;
  format: CardFormat;
}

function printedCardJobs(set: AdventureSet, card: Card): CardPreviewJob[] {
  const character = characterForCard(set, card);
  const base: Omit<CardPreviewJob, 'key'> = {
    label: cardLabel(card),
    stage: {
      card,
      character,
      theme: resolveStyleForCard(set, card),
      initiativeSubject: initiativeSubjectForCard(set, card),
      customSymbols: set.customSymbols
    },
    format: formatForCard(card)
  };
  const jobs: CardPreviewJob[] = [
    { ...base, key: printedCardPreviewKey(card.id, 'front') }
  ];

  if (card.type === 'event') {
    jobs.push({
      ...base,
      key: printedCardPreviewKey(card.id, 'back'),
      label: `${base.label} reverse`,
      stage: { ...base.stage, side: 'back' }
    });
  }
  return jobs;
}

function deckBackJob(character: Character): CardPreviewJob {
  return {
    key: deckBackPreviewKey(character.id),
    label: `${character.name.trim() || character.role} deck back`,
    stage: { card: null, cardback: character },
    format: character.role === 'hero' ? CARD_FORMATS.action : CARD_FORMATS.cardback
  };
}

function characterCardJob(
  set: AdventureSet,
  character: Character,
  entry: HeroCharacterCard | null
): CardPreviewJob {
  const identityId = entry?.id ?? character.id;
  return {
    key: characterCardPreviewKey(identityId),
    label: `${entry?.name.trim() || character.name.trim() || 'Untitled'} character card`,
    stage: {
      card: null,
      statCard: character,
      statCardEntry: entry,
      customSymbols: set.customSymbols
    },
    format: CARD_FORMATS.action
  };
}

/** Every card-shaped face shown in a shared Overview, exactly once. */
function previewJobs(set: AdventureSet): CardPreviewJob[] {
  const jobs = set.cards.flatMap((card) => printedCardJobs(set, card));

  for (const character of set.characters) {
    jobs.push(deckBackJob(character));
    if (character.role !== 'hero') continue;
    jobs.push(characterCardJob(set, character, null));
    for (const entry of character.additionalCards) {
      jobs.push(characterCardJob(set, character, entry));
    }
  }

  return jobs;
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
  const jobs = previewJobs(set);
  const rendered = new Map<string, Blob>();
  onProgress?.(0, jobs.length);

  await withCardStage(async (photograph) => {
    for (const [index, job] of jobs.entries()) {
      const image = await photograph(job.stage, job.format, {
        bleed: false
      });
      if (!image) throw new Error(`Could not render ${job.label} for the published gallery.`);
      rendered.set(job.key, image);
      onProgress?.(index + 1, jobs.length);
    }
  });

  return rendered;
}
