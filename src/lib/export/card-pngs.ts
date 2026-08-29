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
import type { Character, HeroCharacterCard } from '$lib/characters/types';
import { hasArtwork } from '$lib/core/artwork';
import { CARD_FORMATS } from '$lib/renderer/geometry';
import {
  characterForCard,
  initiativeSubjectForCard,
  outline,
  resolveStyleForCard
} from '$lib/sets/queries';
import type { AdventureSet, CharacterEntry } from '$lib/sets/types';
import { formatForCard } from './card-image';
import { photographThreatBoard, withCardStage } from './card-stage';
import { slugify } from './json';
import type { ExportResult } from './types';
import { createZip } from './zip';
import type { ZipEntry } from './zip';

/**
 * The folders the archive unpacks into.
 *
 * Named for what a person would look for rather than for how the document is
 * organised — someone opening this zip has never read the data model, and
 * "Heroes" tells them where a hero's cards are in a way "Characters" did not.
 * Heroes and the villain side are separated for the same reason: they are the
 * two halves of a box and are printed, sleeved and stored apart.
 */
const FOLDERS = {
  heroes: 'Heroes',
  villainSide: 'Villain and minions',
  initiative: 'Initiative cards',
  rules: 'Rule cards',
  events: 'Event cards',
  threat: 'Threat track',
  components: 'Components',
  /** Decks whose owner was deleted. Named so nobody thinks they are missing. */
  unfiled: 'Unfiled cards'
} as const;

interface CardJob {
  folder: string;
  name: string;
  card: Card | null;
  character: Character | null;
  cardback: Character | null;
  /**
   * Draw this hero's character card — the stat sheet, which is not in
   * `set.cards` and so cannot be reached through `card` above. Same shape the
   * renderer and the card stage already take.
   */
  statCard?: Character | null;
  /** Which of `statCard`'s identities. Absent draws their own. */
  statCardEntry?: HeroCharacterCard | null;
  /** Event cards print two designed faces; everything else prints one. */
  side?: 'front' | 'back';
}

export interface CardPngOptions {
  /** Include the printer's bleed, or crop every card to its cut line. */
  bleed: boolean;
  /** Called after each image, so a long run can show where it has got to. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Everything one character owns, as jobs: their cards, their deck back, and —
 * for a hero — their character card and any further identity sheets.
 *
 * Shared by heroes and the villain side rather than written twice, because
 * the only thing that actually differs between them is the folder and whether
 * `characterCardJobs` finds anything. Heroes went unexported for a whole
 * release precisely because they were left out of a hand-written list of the
 * other roles; one function nobody has to remember to update is the fix.
 */
function characterJobs(folder: string, entry: CharacterEntry): CardJob[] {
  const character = entry.character;
  const jobs: CardJob[] = [];

  for (const deck of entry.decks) {
    for (const card of deck.cards) {
      jobs.push({
        folder,
        name: `${characterLabel(character)} ${cardLabel(card)}`,
        card,
        character,
        cardback: null
      });
    }
  }

  jobs.push({
    folder,
    name: `${characterLabel(character)} deck back`,
    card: null,
    character: null,
    cardback: character
  });

  jobs.push(...characterCardJobs(folder, character));
  return jobs;
}

/**
 * A hero's character card, plus one per extra identity.
 *
 * Heroes only, because the stat sheet is a hero-only face — `CardRenderer`
 * draws `statCard` through `HeroCharacterCardFace` and nothing else has one.
 * The same enumeration `AssetsOverview` uses for its own tiles: the primary
 * identity first, then `additionalCards` in order, which is how a duo's two
 * sheets are printed.
 */
function characterCardJobs(folder: string, character: Character): CardJob[] {
  if (character.role !== 'hero') return [];

  const jobs: CardJob[] = [
    {
      folder,
      name: `${characterLabel(character)} character card`,
      card: null,
      character: null,
      cardback: null,
      statCard: character
    }
  ];

  for (const extra of character.additionalCards) {
    jobs.push({
      folder,
      name: `${characterLabel(character)} character card ${extra.name.trim() || 'extra'}`,
      card: null,
      character: null,
      cardback: null,
      statCard: character,
      statCardEntry: extra
    });
  }

  return jobs;
}

/** Everything printable in the set, in the order it should appear. */
function planJobs(set: AdventureSet): CardJob[] {
  const jobs: CardJob[] = [];
  const view = outline(set);

  /* Heroes first, matching the roster order the sidebar and every other
     listing already use — a hero is who the set is played *as*. */
  for (const entry of view.heroes) jobs.push(...characterJobs(FOLDERS.heroes, entry));
  for (const entry of [...view.villains, ...view.minions, ...view.others]) {
    jobs.push(...characterJobs(FOLDERS.villainSide, entry));
  }

  const setLevel: [string, typeof view.initiative][] = [
    [FOLDERS.initiative, view.initiative],
    [FOLDERS.rules, view.rules],
    [FOLDERS.events, view.events],
    // A figure's deck outlives it; its cards still print.
    [FOLDERS.unfiled, view.loose]
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

/**
 * A plain-text guide, written into the archive beside the pictures.
 *
 * Someone unzipping this has a few hundred PNGs in folders and no idea which
 * are printed at what size, whether the bleed is on, or why some cards have no
 * back. None of that is guessable from the files, all of it changes what they
 * do next, and there is nowhere else to put it — the archive leaves the app
 * and the app cannot follow it.
 *
 * Only lists folders the export actually wrote, so a box of heroes is not told
 * about a threat track it does not have.
 */
function readme(set: AdventureSet, options: CardPngOptions, folders: Set<string>): string {
  const lines = [
    `${set.name || 'Untitled Adventure'} — card images`,
    '',
    options.bleed
      ? 'These images INCLUDE the printer’s bleed: about 3mm of extra artwork'
      : 'These images are TRIMMED to the cut line — no bleed.',
    options.bleed
      ? 'runs past every edge, to be trimmed off. Send these to a print shop.'
      : 'Print these at home and cut on the edge of the picture.',
    '',
    'Cards are 63 × 88 mm unless noted. Initiative cards are 44 × 67 mm and',
    'event cards 67 × 44 mm, so keep each folder to its own paper size.',
    '',
    'What is in here',
    '---------------'
  ];

  const describe: [string, string][] = [
    [FOLDERS.heroes, 'Each hero’s cards, their deck back, and their character card.'],
    [FOLDERS.villainSide, 'The villain and every minion: their cards and deck backs.'],
    [FOLDERS.initiative, 'The initiative deck that drives the villain’s turn.'],
    [FOLDERS.rules, 'Reference cards. These have no printed back.'],
    [FOLDERS.events, 'Event cards. Designed on both sides — look for “ back”.'],
    [FOLDERS.threat, 'The threat track, as one long strip rather than a card.'],
    [FOLDERS.components, 'Figure and token reference art, exactly as uploaded.'],
    [FOLDERS.unfiled, 'Cards whose deck lost its owner. Nothing is lost — file them in the app.']
  ];

  for (const [folder, blurb] of describe) {
    if (folders.has(folder)) lines.push(`${folder}/`, `    ${blurb}`);
  }

  lines.push(
    '',
    'A card back is one image for a whole deck — print as many as that deck',
    'has cards. Character cards and rule cards are single-sided by design.'
  );

  return `${lines.join('\n')}\n`;
}

export async function exportCardPngs(
  set: AdventureSet,
  options: CardPngOptions
): Promise<ExportResult> {
  const jobs = planJobs(set);
  const root = slugify(set.name, 'adventure-set');
  const taken = new Set<string>();
  const entries: ZipEntry[] = [];
  /* Collected as the export runs rather than predicted, so the guide can only
     ever describe folders that were actually written. */
  const folders = new Set<string>();

  await withCardStage(async (photograph) => {
    for (const [index, job] of jobs.entries()) {
      /*
       * Which canvas to photograph on, and it has to agree with `CardRenderer`
       * exactly — the renderer picks the format, and asking for a different
       * one here does not resize the card, it photographs the wrong rectangle.
       *
       * The trap is the deck back. A *hero's* back is supplied on the action
       * card's own 1632×2222 bleed canvas; a villain's or minion's uses the
       * `cardback` template, which is drawn at trim size and is 373×520. Take
       * the small one for a hero and their back exports as a 373px thumbnail
       * of a card designed at four times that — which is exactly what it did
       * the first time heroes were exported at all.
       *
       * A character card is the action sheet too (see `CHARACTER_CARD`), and
       * only a real card can derive its format from itself.
       */
      const format = job.card
        ? formatForCard(job.card)
        : job.statCard
          ? CARD_FORMATS.action
          : job.cardback?.role === 'hero'
            ? CARD_FORMATS.action
            : CARD_FORMATS.cardback;

      const blob = await photograph(
        {
          card: job.card,
          character: job.character,
          cardback: job.cardback,
          statCard: job.statCard ?? null,
          statCardEntry: job.statCardEntry ?? null,
          theme: job.card ? resolveStyleForCard(set, job.card) : undefined,
          side: job.side ?? 'front',
          initiativeSubject: job.card ? initiativeSubjectForCard(set, job.card) : null,
          customSymbols: set.customSymbols
        },
        format,
        { bleed: options.bleed }
      );

      if (blob) {
        folders.add(job.folder);
        entries.push({
          path: uniquePath(taken, job.folder, job.name),
          bytes: await toBytes(blob)
        });
      }

      options.onProgress?.(index + 1, jobs.length);
    }
  });

  if (set.threat.enabled) {
    const board = await photographThreatBoard(set);
    if (board) {
      folders.add(FOLDERS.threat);
      entries.push({
        path: `${FOLDERS.threat}/${slugify(set.name, 'adventure-set')}-threat-track.png`,
        bytes: await toBytes(board)
      });
    }
  }

  const figures = await figureEntries(set, taken);
  if (figures.length > 0) folders.add(FOLDERS.components);
  entries.push(...figures);

  entries.push({
    path: 'README.txt',
    bytes: new TextEncoder().encode(readme(set, options, folders))
  });

  return {
    filename: `${root}-cards.zip`,
    mimeType: 'application/zip',
    /*
     * No `${root}/` prefix on the entries — see the identical fix and the
     * reasoning behind it in `tts-bundle.ts`'s own `exportTabletopSimulator`.
     * This archive had the milder version of that bug: its filename is
     * `${root}-cards.zip` while its entries were prefixed with the plain
     * `${root}/`, two different names rather than one doubled — but a tool
     * that creates a folder named after the archive (Windows' "Extract All",
     * macOS's Archive Utility, both by default) still lands the contents one
     * level deeper than intended either way. Entries at the zip's own root
     * mean the one wrapping folder such a tool creates for free is already
     * the only level there is.
     */
    blob: createZip(entries)
  };
}
