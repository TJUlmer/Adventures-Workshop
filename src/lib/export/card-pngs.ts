/**
 * Every card in the set, as separate PNGs in one archive.
 *
 * The photographing itself lives in `card-stage.ts`, which the Tabletop
 * Simulator export shares. What is here is the *plan*: which faces a set owes,
 * and the folders they unpack into.
 */
import { cardLabel } from '$lib/cards/factory';
import type { Card } from '$lib/cards/types';
import { characterLabel } from '$lib/characters/factory';
import type { Character } from '$lib/characters/types';
import { hasArtwork } from '$lib/core/artwork';
import { CARD_FORMATS } from '$lib/renderer/geometry';
import { characterForCard, outline, resolveStyleForCard } from '$lib/sets/queries';
import type { AdventureSet } from '$lib/sets/types';
import { formatForCard } from './card-image';
import { photographThreatBoard, withCardStage } from './card-stage';
import { slugify } from './json';
import type { ExportResult } from './types';
import { createZip } from './zip';
import type { ZipEntry } from './zip';

/** The folders the archive unpacks into. */
const FOLDERS = {
  characters: 'Characters',
  initiative: 'Initiative cards',
  rules: 'Rule cards',
  events: 'Event cards',
  threat: 'Threat track',
  components: 'Components'
} as const;

interface CardJob {
  folder: string;
  name: string;
  card: Card | null;
  character: Character | null;
  cardback: Character | null;
  /** Event cards print two designed faces; everything else prints one. */
  side?: 'front' | 'back';
}

export interface CardPngOptions {
  /** Include the printer's bleed, or crop every card to its cut line. */
  bleed: boolean;
  /** Called after each image, so a long run can show where it has got to. */
  onProgress?: (done: number, total: number) => void;
}

/** Everything printable in the set, in the order it should appear. */
function planJobs(set: AdventureSet): CardJob[] {
  const jobs: CardJob[] = [];
  const view = outline(set);

  for (const entry of [...view.villains, ...view.minions, ...view.others]) {
    const character = entry.character;
    for (const deck of entry.decks) {
      for (const card of deck.cards) {
        jobs.push({
          folder: FOLDERS.characters,
          name: `${characterLabel(character)} ${cardLabel(card)}`,
          card,
          character,
          cardback: null
        });
      }
    }

    jobs.push({
      folder: FOLDERS.characters,
      name: `${characterLabel(character)} deck back`,
      card: null,
      character: null,
      cardback: character
    });
  }

  const setLevel: [string, typeof view.initiative][] = [
    [FOLDERS.initiative, view.initiative],
    [FOLDERS.rules, view.rules],
    [FOLDERS.events, view.events],
    // A figure's deck outlives it; its cards still print.
    [FOLDERS.characters, view.loose]
  ];

  for (const [folder, entries] of setLevel) {
    for (const entry of entries) {
      for (const card of entry.cards) {
        const character = characterForCard(set, card);
        jobs.push({ folder, name: cardLabel(card), card, character, cardback: null });

        // An event card is designed on both sides, so both have to print.
        if (card.type === 'event') {
          jobs.push({
            folder,
            name: `${cardLabel(card)} back`,
            card,
            character,
            cardback: null,
            side: 'back'
          });
        }
      }
    }
  }

  return jobs;
}

/** Filesystem-safe, and never two the same inside one folder. */
function uniquePath(taken: Set<string>, folder: string, name: string): string {
  const base = `${folder}/${slugify(name, 'card')}`;
  let path = `${base}.png`;
  let suffix = 2;
  while (taken.has(path)) {
    path = `${base}-${suffix}.png`;
    suffix += 1;
  }
  taken.add(path);
  return path;
}

async function toBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Figures and tokens are the author's own reference images rather than
 * rendered cards, so they travel as they were supplied.
 */
async function figureEntries(set: AdventureSet, taken: Set<string>): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];

  for (const figure of set.figures) {
    const source = figure.reference.source;
    if (!hasArtwork(figure.reference) || !source) continue;

    const blob = await (await fetch(source)).blob();
    const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
    const base = `${FOLDERS.components}/${slugify(figure.name, 'figure')}`;
    let path = `${base}.${extension}`;
    let suffix = 2;
    while (taken.has(path)) {
      path = `${base}-${suffix}.${extension}`;
      suffix += 1;
    }
    taken.add(path);

    entries.push({ path, bytes: await toBytes(blob) });
  }

  return entries;
}

export async function exportCardPngs(
  set: AdventureSet,
  options: CardPngOptions
): Promise<ExportResult> {
  const jobs = planJobs(set);
  const root = slugify(set.name, 'adventure-set');
  const taken = new Set<string>();
  const entries: ZipEntry[] = [];

  await withCardStage(async (photograph) => {
    for (const [index, job] of jobs.entries()) {
      const format = job.card ? formatForCard(job.card) : CARD_FORMATS.cardback;
      const blob = await photograph(
        {
          card: job.card,
          character: job.character,
          cardback: job.cardback,
          theme: job.card ? resolveStyleForCard(set, job.card) : undefined,
          side: job.side ?? 'front',
          customSymbols: set.customSymbols
        },
        format,
        { bleed: options.bleed }
      );

      if (blob) {
        entries.push({
          path: `${root}/${uniquePath(taken, job.folder, job.name)}`,
          bytes: await toBytes(blob)
        });
      }

      options.onProgress?.(index + 1, jobs.length);
    }
  });

  if (set.threat.enabled) {
    const board = await photographThreatBoard(set);
    if (board) {
      entries.push({
        path: `${root}/${FOLDERS.threat}/${slugify(set.name, 'adventure-set')}-threat-track.png`,
        bytes: await toBytes(board)
      });
    }
  }

  entries.push(
    ...(await figureEntries(set, taken)).map((entry) => ({
      ...entry,
      path: `${root}/${entry.path}`
    }))
  );

  return {
    filename: `${root}-cards.zip`,
    mimeType: 'application/zip',
    blob: createZip(entries)
  };
}
