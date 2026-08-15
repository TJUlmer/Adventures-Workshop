/**
 * The Tabletop Simulator export, end to end.
 *
 * `tabletop-simulator.ts` decides what the piles are and writes the object
 * graph; `tts-sheets.ts` draws the images it asks for. This puts the two
 * together and lands the result somewhere TTS can read it, which is the part
 * that decides whether any of it is any use.
 *
 * A TTS save refers to its art by URL and will not read a data URI, so an
 * export is only finished once the images have an address. Where there is a dev
 * server there is an `exports/` folder and an absolute `file://` URL to go with
 * it, and the save comes out complete. Where there is not, the same files come
 * out as an archive with the URLs left as a marked blank — honest about the one
 * thing that cannot be derived rather than guessing at it.
 */
import { characterLabel } from '$lib/characters/factory';
import { figureLabel, tokenSpecOf } from '$lib/figures/types';
import type { Figure } from '$lib/figures/types';
import {
  HEALTH_DIAL_MATERIAL,
  HEALTH_DIAL_MESH_PATH,
  HEALTH_DIAL_SAVE_URL,
  HEALTH_DIAL_SPEC
} from '$lib/figures/health-dial';
import { buildTokenMesh, tokenObj } from '$lib/models/token';
import { readLuaConfig, writeLuaConfig } from '$lib/models/tts';
import type { AdventureSet } from '$lib/sets/types';
import { photographMapBoard, photographThreatBoard, withCardStage } from './card-stage';
import { findExportsFolder, pruneExportsBundle, writeToExportsFolder } from './exports-folder';
import { MAP_WIDTH_MM, mapHeightMm } from '$lib/map/types';
import { shortHash } from '$lib/core/hash';
import { slugify } from './json';
import {
  buildTabletopSimulatorSave,
  modelObject,
  placeSavedObjects,
  planTabletopDecks,
  THREAT_CARD_MM
} from './tabletop-simulator';
import type { TtsDeckImages, TtsMapImage, TtsSheet, TtsThreatImage } from './tabletop-simulator';
import { buildTokenArt } from './token-model';
import { imageCount, MAX_SHEET_PIXELS, renderDeckSheets, renderSharedBack } from './tts-sheets';
import type { ExportResult } from './types';
import { createZip } from './zip';

/** What goes in the URLs when there is nowhere to write the images. */
export const PLACEHOLDER_BASE = 'PASTE_THE_FOLDER_URL_HERE';

interface OutputFile {
  /** Path under the export's own folder. Forward slashes make the folders. */
  path: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface TtsBundleOptions {
  /** Called as images are drawn, so a long export can say where it has got to. */
  onProgress?: (done: number, total: number, label: string) => void;
}

export interface TtsBundleResult {
  /** Absolute folder the files landed in, when the dev server wrote them. */
  directory: string | null;
  /** The archive, when nothing could write to disk. */
  download: ExportResult | null;
  fileCount: number;
  /** Superseded files cleared out of the bundle folder. Zero for a ZIP. */
  removedCount: number;
  /** Things the author will want to know, none of which stopped the export. */
  warnings: string[];
}

const encoder = new TextEncoder();

async function bytesOf(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Write an asset, named after its own contents.
 *
 * Tabletop Simulator caches textures **by URL**. Re-export a set with new
 * artwork under the same filename and TTS keeps drawing the old bitmap — the
 * save points at the right path, the file on disk is correct, and the table
 * shows a previous version with nothing to say it is stale. Renaming the file
 * when its bytes change is the only thing that cache reliably respects.
 *
 * The name is also a free de-duplicator: an identical image under the same base
 * hashes to the same path, so a shared card back is written once rather than
 * once per pile. Reused rather than suffixed, because a matching name here
 * *means* matching bytes.
 *
 * The cost is that superseded files stay in the bundle folder — the exporter
 * writes, it does not delete. Clearing the folder between exports is the tidy
 * habit; leaving them costs disk and nothing else.
 */
async function writeBytes(
  files: OutputFile[],
  taken: Set<string>,
  base: string,
  extension: string,
  bytes: Uint8Array<ArrayBuffer>
): Promise<string> {
  const path = `${base}-${await shortHash(bytes)}.${extension}`;
  if (taken.has(path)) return path;
  taken.add(path);
  files.push({ path, bytes });
  return path;
}

/** The same, for the blobs the renderers hand back. */
async function writeAsset(
  files: OutputFile[],
  taken: Set<string>,
  base: string,
  extension: string,
  blob: Blob
): Promise<string> {
  return writeBytes(files, taken, base, extension, await bytesOf(blob));
}

/** Read the ObjectStates out of a saved-object file, or `null` if it has none. */
async function readObjectStates(url: string): Promise<unknown[] | null> {
  try {
    const raw = (await (await fetch(url)).text()).replace(/^﻿/, '');
    const parsed: unknown = JSON.parse(raw);
    const states =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)['ObjectStates']
        : null;
    return Array.isArray(states) && states.length > 0 ? states : null;
  } catch {
    return null;
  }
}

/**
 * The dial's mesh, written once however many dials a set has.
 *
 * `HEALTH_DIAL_SPEC` is fixed, so every dial's mesh is the same bytes — only the
 * face differs. Writing one file and pointing every dial at it keeps a set of
 * five dials from carrying five identical copies of it.
 */
function dialMeshUrl(
  urlFor: (path: string) => string,
  files: OutputFile[],
  taken: Set<string>
): string {
  if (!taken.has(HEALTH_DIAL_MESH_PATH)) {
    taken.add(HEALTH_DIAL_MESH_PATH);
    files.push({
      path: HEALTH_DIAL_MESH_PATH,
      bytes: encoder.encode(
        tokenObj(buildTokenMesh(HEALTH_DIAL_SPEC), HEALTH_DIAL_MATERIAL)
      )
    });
  }
  return urlFor(HEALTH_DIAL_MESH_PATH);
}

/**
 * The health dial: the app's own saved object, wearing the author's face.
 *
 * The counter script and the material come from the shipped template and are
 * left exactly as they are; the mesh and the diffuse are filled in here, because
 * neither has an address until the export knows where it is writing. What the
 * author brings is the face and the range, so those are the two things that
 * change from one dial to the next.
 */
async function dialObjects(
  figure: Figure,
  name: string,
  index: number,
  urlFor: (path: string) => string,
  files: OutputFile[],
  taken: Set<string>,
  warnings: string[]
): Promise<object[]> {
  const states = await readObjectStates(HEALTH_DIAL_SAVE_URL);
  if (!states) {
    warnings.push(`${name}: the health dial template could not be read.`);
    return [];
  }

  const meshUrl = dialMeshUrl(urlFor, files, taken);

  let diffuseUrl = '';
  if (figure.reference.source) {
    /* Through the token texture builder, not straight out of the document: the
       disc samples a *square* of its texture and wears a band of rim colour
       round its edge, and a picture handed over raw would be stretched into the
       one and would leave the other unpainted. */
    const texturePath = await writeAsset(
      files, taken, `models/${slugify(name, 'dial')}`, 'png', await buildTokenArt(figure)
    );
    diffuseUrl = urlFor(texturePath);
  } else {
    warnings.push(`${name}: no dial face, so the dial arrives blank.`);
  }

  return placeSavedObjects(states, index).map((state) => {
    const dial: Record<string, unknown> = { ...(state as Record<string, unknown>), Nickname: name };

    const mesh = dial['CustomMesh'];
    if (typeof mesh === 'object' && mesh !== null) {
      dial['CustomMesh'] = {
        ...(mesh as Record<string, unknown>),
        MeshURL: meshUrl,
        DiffuseURL: diffuseUrl
      };
    }

    /* The dial's range lives in its script's `CONFIG` table. Read the entries,
       set the two that matter, and write them back in place — the same in-place
       edit `models/tts.ts` does, so nothing else in the Lua is disturbed. */
    if (typeof dial['LuaScript'] === 'string') {
      const config = readLuaConfig(dial['LuaScript']);
      const set = (key: string, value: number): void => {
        const entry = config.find((candidate) => candidate.key === key);
        if (entry) entry.value = value;
      };
      set('MIN_VALUE', figure.dialRange.min);
      set('MAX_VALUE', figure.dialRange.max);
      set('VALUE', figure.dialRange.max);
      dial['LuaScript'] = writeLuaConfig(dial['LuaScript'], config);
    }

    return dial;
  });
}

/**
 * Everything a figure contributes to the table.
 *
 * In precedence order, because they are answers to the same question and only
 * one can be right: a health dial is the app's own fixed component; a saved
 * object the author attached is a finished TTS component; a generated token is
 * next; an attached mesh last. An STL is skipped with a note — TTS loads OBJ,
 * and silently dropping the model would look like the export had lost it.
 */
async function componentFor(
  figure: Figure,
  ownerName: string | null,
  index: number,
  urlFor: (path: string) => string,
  files: OutputFile[],
  taken: Set<string>,
  warnings: string[]
): Promise<object[]> {
  const name = figureLabel(figure, ownerName);

  if (figure.kind === 'dial') {
    return dialObjects(figure, name, index, urlFor, files, taken, warnings);
  }

  const slug = slugify(name, 'component');

  if (figure.ttsSave?.source) {
    try {
      const text = await (await fetch(figure.ttsSave.source)).text();
      const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
      const states =
        typeof parsed === 'object' && parsed !== null
          ? (parsed as Record<string, unknown>)['ObjectStates']
          : null;

      if (Array.isArray(states) && states.length > 0) return placeSavedObjects(states, index);
      warnings.push(`${name}: its Tabletop Simulator file holds no objects.`);
    } catch {
      warnings.push(`${name}: its Tabletop Simulator file could not be read.`);
    }
  }

  /*
   * No `&& figure.reference.source` guard here — `buildTokenArt` already
   * falls back to a flat fill of the token's rim colour when there is no
   * reference image (see `token-model.ts`), so a plain marker with a colour
   * and no picture still gets a properly textured `Custom_Model` rather than
   * silently falling through to the "attached mesh" branch below and being
   * skipped for having neither a model nor an image.
   */
  if (figure.token.enabled) {
    const mesh = buildTokenMesh(tokenSpecOf(figure.token));
    const meshPath = await writeBytes(
      files, taken, `models/${slug}`, 'obj', encoder.encode(tokenObj(mesh, slug))
    );
    const texturePath = await writeAsset(
      files, taken, `models/${slug}`, 'png', await buildTokenArt(figure)
    );

    return [
      modelObject(
        {
          nickname: name,
          description: figure.notes,
          meshUrl: urlFor(meshPath),
          diffuseUrl: urlFor(texturePath)
        },
        index
      )
    ];
  }

  const model = figure.model;
  if (!model?.source) return [];

  if (!model.name.toLowerCase().endsWith('.obj')) {
    warnings.push(`${name}: ${model.name} is not an OBJ, so Tabletop Simulator cannot load it.`);
    return [];
  }

  const meshPath = await writeAsset(
    files, taken, `models/${slug}`, 'obj', await (await fetch(model.source)).blob()
  );

  let diffuseUrl = '';
  if (figure.reference.source) {
    const texturePath = await writeAsset(
      files, taken, `models/${slug}`, 'png', await (await fetch(figure.reference.source)).blob()
    );
    diffuseUrl = urlFor(texturePath);
  } else {
    warnings.push(`${name}: no reference image, so its model arrives untextured.`);
  }

  return [
    modelObject(
      { nickname: name, description: figure.notes, meshUrl: urlFor(meshPath), diffuseUrl },
      index
    )
  ];
}

function howToImport(set: AdventureSet, root: string, directory: string | null): string {
  const decks = planTabletopDecks(set);
  const piles = decks
    .map((plan) => {
      const count = plan.cards.length;
      return `  ${plan.nickname} — ${count} ${count === 1 ? 'card' : 'cards'}, ${plan.format.label}`;
    })
    .join('\n');

  const placement = directory
    ? `The files are already on disk, here:

  ${directory}

The save refers to them by their full path, so it works as it stands. Leave
this folder where it is, or move it and re-export — the paths are baked in.`
    : `The images have no address yet, so every FaceURL and BackURL in the JSON
reads ${PLACEHOLDER_BASE}.

  1. Unpack this archive somewhere it can stay.
  2. Replace ${PLACEHOLDER_BASE} throughout the JSON with the
     folder's own URL — "file:///C:/path/to/${root}" for a local copy, or an
     https:// address if you have hosted it. One find-and-replace does it.

Running the workshop from its own dev server skips all of this: it writes the
files into "exports/" and fills the URLs in for you.`;

  return `Tabletop Simulator import — ${set.name}
${'='.repeat(30 + set.name.length)}

What is in the save
-------------------
One Saved Object holding everything, as a flat list of ObjectStates:

${piles || '  (no cards yet)'}
${set.threat.enabled ? '  The threat track, as a single wide card.\n' : ''}${
    set.figures.length > 0
      ? `  ${set.figures.length} ${set.figures.length === 1 ? 'component' : 'components'}, behind the piles.\n`
      : ''
  }
One pile per figure, rather than one pile of everything: an Adventures figure's
cards are authored in separate decks but played as one. Initiative and event
cards are their own piles because they are a different size — Tabletop
Simulator lays a deck out as a single sheet of one cell size, so a pile can only
ever hold one card format.

Sizes are set by each object's Transform rather than by image resolution, which
TTS mostly ignores. A poker card is scale 1; a mini-euro initiative card is
44/63 across and 67/88 down, so it arrives the right size *and* the right shape.

Where the images are
--------------------
${placement}

Installing it
-------------
  1. Copy the .json into:
     Documents/My Games/Tabletop Simulator/Saves/Saved Objects/
  2. In TTS: Objects → Saved Objects → spawn it once.
     Everything appears at once, laid out in a row.

Notes
-----
  Card quantities are expanded: a card with ×3 is three cards in the pile.
  A pile over 70 cards is split across several sheets and is still one pile.
  Each card carries its ID from the workshop in GMNotes, which players do not
  see — that is how a later export can tell what it is looking at.

Generated by Adventures Workshop.
`;
}

export async function exportTabletopSimulator(
  set: AdventureSet,
  options: TtsBundleOptions = {}
): Promise<TtsBundleResult> {
  const folder = await findExportsFolder();
  const root = `${slugify(set.name, 'adventure-set')}-tts`;
  const base = folder ? `${folder.url}/${root}` : PLACEHOLDER_BASE;
  const urlFor = (path: string): string => `${base}/${path}`;

  const files: OutputFile[] = [];
  const taken = new Set<string>();
  const warnings: string[] = [];

  const plans = planTabletopDecks(set);
  const total = plans.reduce((count, plan) => count + imageCount(plan), 0) +
    (set.threat.enabled ? 1 : 0) + (set.map.enabled ? 1 : 0);
  let done = 0;

  const decks: TtsDeckImages[] = [];

  await withCardStage(async (photograph) => {
    for (const plan of plans) {
      const context = {
        set,
        photograph,
        onImage: () => {
          done += 1;
          options.onProgress?.(done, total, plan.nickname);
        }
      };

      const rendered = await renderDeckSheets(plan, context);
      const cell = rendered[0]?.grid ?? { cellWidth: 512, cellHeight: 715 };
      const shared = await renderSharedBack(plan, context, {
        width: cell.cellWidth,
        height: cell.cellHeight
      });

      let sharedUrl = '';
      if (shared) {
        const path = await writeAsset(files, taken, `sheets/${plan.id}-back`, 'png', shared);
        sharedUrl = urlFor(path);
      }

      const sheets: TtsSheet[] = [];
      for (const [page, sheet] of rendered.entries()) {
        /* Numbered only when there is more than one, so the common case is a
           file named after the pile and nothing else. */
        const stem = rendered.length > 1 ? `sheets/${plan.id}-${page + 1}` : `sheets/${plan.id}`;

        const facePath = await writeAsset(files, taken, stem, 'png', sheet.face);

        let backUrl = sharedUrl;
        if (sheet.back) {
          const backPath = await writeAsset(files, taken, `${stem}-back`, 'png', sheet.back);
          backUrl = urlFor(backPath);
        }

        sheets.push({
          faceUrl: urlFor(facePath),
          backUrl,
          uniqueBack: sheet.back !== null,
          columns: sheet.grid.columns,
          rows: sheet.grid.rows,
          cards: sheet.cards
        });
      }

      decks.push({ plan, sheets });
    }
  });

  let threat: TtsThreatImage | null = null;
  if (set.threat.enabled) {
    /* The printed strip is 5846px across and TTS refuses a texture over 4096,
       so the board is photographed narrower rather than at print size. */
    const board = await photographThreatBoard(set, { width: MAX_SHEET_PIXELS });
    done += 1;
    options.onProgress?.(done, total, 'Threat track');

    if (board) {
      const path = await writeAsset(
        files, taken, `threat/${slugify(set.name, 'adventure-set')}-threat-track`, 'png', board
      );
      threat = { url: urlFor(path), mm: THREAT_CARD_MM };
    }
  }

  let map: TtsMapImage | null = null;
  if (set.map.enabled) {
    /* Same ceiling as the threat strip: the printed board is 5846px across and
       TTS refuses a texture over 4096, so it is photographed narrower. */
    const board = await photographMapBoard(set.map, { width: MAX_SHEET_PIXELS });
    done += 1;
    options.onProgress?.(done, total, 'Map');

    if (board) {
      const path = await writeAsset(
        files, taken, `map/${slugify(set.name, 'adventure-set')}-map`, 'png', board
      );
      map = {
        url: urlFor(path),
        /* Height from the aspect the author set, so the card is scaled to the
           board's real proportions rather than to the image's rounded pixels. */
        mm: { width: MAP_WIDTH_MM, height: mapHeightMm(set.map) }
      };
    }
  }

  const components: object[] = [];
  for (const figure of set.figures) {
    const owner = figure.characterId
      ? set.characters.find((character) => character.id === figure.characterId)
      : null;
    const ownerName = owner ? characterLabel(owner) : null;
    components.push(
      ...(await componentFor(figure, ownerName, components.length, urlFor, files, taken, warnings))
    );
  }

  files.push({
    path: `${slugify(set.name, 'adventure-set')}.json`,
    bytes: encoder.encode(buildTabletopSimulatorSave({ set, decks, threat, map, components }))
  });

  const directory = folder ? `${folder.directory}\\${root}` : null;
  files.push({
    path: 'HOW_TO_IMPORT.txt',
    bytes: encoder.encode(howToImport(set, root, directory))
  });

  if (folder) {
    for (const file of files) await writeToExportsFolder(`${root}/${file.path}`, file.bytes);

    /* Only now that every file is on disk: the folder holds a superseded copy
       of each image whose contents changed, because they are named after those
       contents so TTS cannot cache a stale one. Pruning last means a failed
       export leaves the previous good one intact. */
    const removed = await pruneExportsBundle(root, files.map((file) => file.path));

    return { directory, download: null, fileCount: files.length, removedCount: removed, warnings };
  }

  return {
    directory: null,
    removedCount: 0,
    download: {
      filename: `${root}.zip`,
      mimeType: 'application/zip',
      blob: createZip(files.map((file) => ({ path: `${root}/${file.path}`, bytes: file.bytes })))
    },
    fileCount: files.length,
    warnings
  };
}

/** Named for the export UI, which lists what a run produced. */
export function tabletopDeckSummary(set: AdventureSet): string[] {
  return planTabletopDecks(set).map(
    (plan) => `${plan.nickname} (${plan.cards.length}${plan.back.kind === 'character' ? `, ${characterLabel(plan.back.character)} back` : ''})`
  );
}
