/**
 * The Tabletop Simulator export, end to end.
 *
 * `tabletop-simulator.ts` decides what the piles are and writes the object
 * graph; `tts-sheets.ts` draws the images it asks for. This puts the two
 * together and lands the result somewhere TTS can read it, which is the part
 * that decides whether any of it is any use.
 *
 * A TTS save refers to its art by URL and will not read a data URI, so an
 * export is only finished once the images have an address. The author chooses
 * one hosting target, while every renderer and object builder stays shared:
 *
 *   - Online: generated files go to a permanent public host and the downloaded
 *     JSON works for both single-player and multiplayer.
 *   - Local: the existing folder/ZIP flow writes `file://` addresses for one
 *     machine, with a dev server still allowed to land the folder directly.
 */
import { characterLabel } from '$lib/characters/factory';
import { figureLabel, tokenSpecOf } from '$lib/figures/types';
import type { Figure } from '$lib/figures/types';
import {
  HEALTH_DIAL_MATERIAL,
  HEALTH_DIAL_SAVE_URL,
  healthDialMeshPath,
  healthDialSpec
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
import { buildTokenArt, resolvedTokenSpec } from './token-model';
import { imageCount, MAX_SHEET_PIXELS, renderDeckSheets, renderSharedBack } from './tts-sheets';
import type { ExportResult } from './types';
import { createZip } from './zip';

export interface TtsHostedAsset {
  /** Path under the export's own folder. Forward slashes make the folders. */
  path: string;
  contentType: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface TtsUploadProgress extends TtsUploadResult {
  done: number;
  total: number;
}

export interface TtsUploadResult {
  uploaded: number;
  reused: number;
}

/** Supplied by the cloud layer so this exporter stays storage-provider agnostic. */
export interface TtsOnlineAssetHost {
  /** Deterministic before upload, so object URLs can be built during rendering. */
  urlFor(path: string): string;
  /** Resolve only after every referenced file is present at its public URL. */
  upload(
    assets: readonly TtsHostedAsset[],
    onProgress?: (progress: TtsUploadProgress) => void
  ): Promise<TtsUploadResult>;
}

export type TtsHosting =
  | { kind: 'online'; host: TtsOnlineAssetHost }
  | { kind: 'local'; savedObjectsPath: string };

export interface TtsBundleOptions {
  /** Called as images are drawn, so a long export can say where it has got to. */
  onProgress?: (done: number, total: number, label: string) => void;
  hosting: TtsHosting;
}

/**
 * A path exactly as the author typed it, minus one trailing slash or
 * backslash — the form every other piece of text here builds on, so that a
 * path copied from a file manager (which may or may not end in one) reads
 * the same in the instructions whichever way it arrived.
 *
 * `fileUrlFromPath` and `howToImport`'s prose both go through this rather
 * than each stripping the slash their own way, which is what an earlier pass
 * at this got wrong: the *URL* trimmed it and came out correct while the
 * *sentence beside it* concatenated the untrimmed path straight onto `root`,
 * printing a doubled backslash the moment someone's path happened to end in
 * one — invisible in testing with a path that did not, and wrong the first
 * time a real one did.
 */
function trimTrailingSlash(raw: string): string {
  return raw.trim().replace(/[/\\]+$/, '');
}

/**
 * A filesystem path, as the `file://` address Tabletop Simulator actually
 * wants — which turned out not to be a URL at all in the sense either
 * `encodeURI` or Node's own `pathToFileURL` produce, and cost a real, failed
 * import to learn.
 *
 * `FaceURL`/`DiffuseURL`/`MeshURL` are read straight into an OS file call
 * without being decoded first — TTS does not treat `file:///` as the start
 * of a URI whose `%20` means a space and whose `/` means "next folder"
 * regardless of platform; it treats whatever follows as the literal path,
 * backslashes and spaces included. So the correct transformation from a
 * typed path to what TTS wants is closer to *none at all* than to proper URI
 * encoding: this only ever strips the one trailing separator and prepends
 * `file:///` (or `file://` + the path's own leading `/` on a Unix path,
 * which already supplies one of the three).
 *
 * This is also why `urlFor`, below, cannot simply join every path onto this
 * with `/` the way a real URL would be joined — the segments it appends are
 * always `/`-separated internally (`models/health-dial.obj`), and gluing
 * that straight onto a `\`-separated Windows path would read to TTS as one
 * long filename containing a literal slash, not as a folder split. See
 * `exportTabletopSimulator`'s own construction of `urlFor` for the join.
 */
function fileUrlFromPath(raw: string): string {
  const trimmed = trimTrailingSlash(raw);
  const rooted = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `file://${rooted}`;
}

/**
 * Append a relative path onto a `file:///`-wrapped raw OS path, in whichever
 * separator that path itself already uses.
 *
 * Every relative path this app builds internally (`models/health-dial.obj`,
 * `sheets/…`) is `/`-separated, because that is the one separator that means
 * the same thing in a ZIP entry, on every OS, and in a real URL — it is only
 * once it lands next to a *raw* Windows path, which `fileUrlFromPath` and the
 * dev server's own answer both are, that gluing it on with a bare `/` stops
 * being correct: Tabletop Simulator does not decode this address, so a `/`
 * next to `\`-separated segments reads as one filename containing a literal
 * slash rather than as another folder down. Converting the relative path's
 * own separators to match is what keeps every segment, typed and generated
 * alike, in the one form the whole path is being read as.
 */
function joinFileUrl(base: string, relative: string): string {
  const sep = base.includes('\\') ? '\\' : '/';
  return `${base}${sep}${relative.split('/').join(sep)}`;
}

export interface TtsBundleResult {
  hosting: TtsHosting['kind'];
  /** Absolute folder the files landed in, when the dev server wrote them. */
  directory: string | null;
  /** The archive, when nothing could write to disk. */
  download: ExportResult | null;
  fileCount: number;
  /** Superseded files cleared out of the bundle folder. Zero for a ZIP. */
  removedCount: number;
  /** Things the author will want to know, none of which stopped the export. */
  warnings: string[];
  /** Online files newly written versus already present under the same hash. */
  uploadedCount: number;
  reusedCount: number;
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
  files: TtsHostedAsset[],
  taken: Set<string>,
  base: string,
  extension: string,
  contentType: string,
  bytes: Uint8Array<ArrayBuffer>
): Promise<string> {
  const path = `${base}-${await shortHash(bytes)}.${extension}`;
  if (taken.has(path)) return path;
  taken.add(path);
  files.push({ path, contentType, bytes });
  return path;
}

/** The same, for the blobs the renderers hand back. */
async function writeAsset(
  files: TtsHostedAsset[],
  taken: Set<string>,
  base: string,
  extension: string,
  blob: Blob
): Promise<string> {
  const contentType = blob.type || (extension === 'png' ? 'image/png' : 'application/octet-stream');
  return writeBytes(files, taken, base, extension, contentType, await bytesOf(blob));
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
 * A saved object can carry dependencies the workshop never received — its JSON
 * names a local texture or mesh, but contains none of that file's bytes. Those
 * references cannot be made multiplayer-ready by uploading the JSON itself, so
 * find them before an online export claims the whole object is portable.
 */
function localAssetReferences(value: unknown): string[] {
  const found = new Set<string>();
  const isLocal = (text: string): boolean =>
    /^(?:file:\/{2,3}|[a-z]:[\\/]|\\\\|PASTE_THE_FOLDER_URL_HERE)/i.test(text.trim());

  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      if (isLocal(node)) found.add(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node && typeof node === 'object') {
      for (const item of Object.values(node)) walk(item);
    }
  };

  walk(value);
  return [...found];
}

/**
 * The dial's mesh, written once per *variant* — one-sided, two-sided, or both
 * — however many dials of each a set has.
 *
 * `healthDialSpec(twoSided)` is fixed for a given `twoSided`, so every dial
 * sharing that setting has the same mesh bytes as each other. The two variants
 * cannot share a file with one another, though: their UV layouts genuinely
 * differ (`buildTokenMesh`'s `twoSided` branch), so a set with both kinds of
 * dial writes exactly two mesh files rather than either one dial file or one
 * per dial.
 */
async function dialMeshUrl(
  twoSided: boolean,
  urlFor: (path: string) => string,
  files: TtsHostedAsset[],
  taken: Set<string>
): Promise<string> {
  /* The old fixed filename was harmless on disk but unsafe on a public host:
     TTS caches by URL, so a later mesh correction would keep drawing the old
     geometry. Hash it through the same writer as every other generated file. */
  const path = await writeBytes(
    files,
    taken,
    healthDialMeshPath(twoSided).replace(/\.obj$/i, ''),
    'obj',
    'model/obj',
    encoder.encode(tokenObj(buildTokenMesh(healthDialSpec(twoSided)), HEALTH_DIAL_MATERIAL))
  );
  return urlFor(path);
}

/**
 * The health dial: the app's own saved object, wearing the author's face.
 *
 * The counter script and the material come from the shipped template and are
 * left exactly as they are; the mesh and the diffuse are filled in here, because
 * neither has an address until the export knows where it is writing. What the
 * author brings is the face, whether it wraps to the back, and the range — the
 * things that change from one dial to the next. Whether it wraps decides which
 * of the two mesh variants `dialMeshUrl` hands back, same as it decides which
 * texture `buildTokenArt` builds.
 */
async function dialObjects(
  figure: Figure,
  name: string,
  index: number,
  urlFor: (path: string) => string,
  files: TtsHostedAsset[],
  taken: Set<string>,
  warnings: string[]
): Promise<object[]> {
  const states = await readObjectStates(HEALTH_DIAL_SAVE_URL);
  if (!states) {
    warnings.push(`${name}: the health dial template could not be read.`);
    return [];
  }

  const meshUrl = await dialMeshUrl(figure.token.twoSided, urlFor, files, taken);

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
  files: TtsHostedAsset[],
  taken: Set<string>,
  warnings: string[],
  online: boolean
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

      if (Array.isArray(states) && states.length > 0) {
        const localReferences = online ? localAssetReferences(states) : [];
        if (localReferences.length > 0) {
          warnings.push(
            `${name}: its imported TTS object still contains ${localReferences.length} local ` +
              `${localReferences.length === 1 ? 'asset reference' : 'asset references'}. ` +
              'Those files were not attached to this set, so other players may not see them; ' +
              'open the object in TTS and use Cloud Manager → Upload All.'
          );
        }
        return placeSavedObjects(states, index);
      }
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
    const spec = await resolvedTokenSpec(figure, tokenSpecOf(figure.token));
    const mesh = buildTokenMesh(spec);
    const meshPath = await writeBytes(
      files,
      taken,
      `models/${slug}`,
      'obj',
      'model/obj',
      encoder.encode(tokenObj(mesh, slug))
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
          diffuseUrl: urlFor(texturePath),
          convex: spec.shape !== 'silhouette'
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

/**
 * Where a local-only export landed, and what is still owed before TTS can read
 * it — one of two states, in the order they are preferred.
 *
 *  1. `directory` — a dev server wrote the files for real, to a real path on
 *     disk. Nothing about the images is left to do.
 *  2. `savedObjectsPath` — no dev server, but the author has told the
 *     workshop where their Saved Objects folder is (see
 *     `storage/settings.ts`), so the URLs baked into the JSON already point
 *     there. The archive still has to be extracted and placed, but nothing
 *     in it has to be *edited*.
 */
function howToImport(
  set: AdventureSet,
  root: string,
  info: { directory: string | null; savedObjectsPath: string }
): string {
  const decks = planTabletopDecks(set);
  const piles = decks
    .map((plan) => {
      const count = plan.cards.length;
      return `  ${plan.nickname} — ${count} ${count === 1 ? 'card' : 'cards'}, ${plan.format.label}`;
    })
    .join('\n');

  /*
   * One rule regardless of which local state applies, and it is
   * worth having only one: **the whole `${root}` folder — the .json beside
   * models/, sheets/ and the rest — belongs inside Saved Objects, not just
   * the .json on its own.** Every image in it is addressed relative to that
   * folder, so splitting it up (say, leaving the pictures wherever a zip
   * happened to land while only the .json moves) works only for as long as
   * that other location is never tidied, renamed or cleared — which
   * Downloads folders do not reliably promise. One habit, always right, is
   * easier to keep than "it depends which export path you happened to get."
   */
  let placement: string;
  let installing: string;

  if (info.directory) {
    placement = `The files are already on disk, here:

  ${info.directory}

The save refers to them by that full path, so it works as it stands — moving
the folder anywhere else would break it. Leave it where it is.`;
    installing = `In short: move the whole folder above — not just the .json inside it —
into your Saved Objects folder. Nothing to unzip; it is already unpacked.

  1. Move (or copy) that whole folder into:
     Documents/My Games/Tabletop Simulator/Saves/Saved Objects/
  2. In TTS: Objects → Saved Objects → spawn it once.
     Everything appears at once, laid out in a row.`;
  } else {
    /*
     * Trimmed once, here, and read from nowhere else — every mention of this
     * path below (and the URL `base` computed from the same raw setting up
     * in `exportTabletopSimulator`) has to agree on where it ends, or a path
     * that happened to arrive with a trailing separator prints one sentence
     * that is right and another sitting right next to it that is not.
     */
    const savedObjectsPath = trimTrailingSlash(info.savedObjectsPath);
    // Whichever kind of slash is already in the typed path, rather than
    // assuming Windows — the app is not.
    const slash = savedObjectsPath.includes('\\') ? '\\' : '/';

    placement = `Every FaceURL and BackURL already points at:

  ${savedObjectsPath}${slash}${root}

— the Saved Objects folder set in the workshop's export panel — so nothing in
this JSON needs editing. It only has to end up where the URLs already expect
it, which is what "Installing it" below does.`;
    installing = `In short: unzip this archive, then copy the entire unzipped folder into
your Saved Objects folder. Not the .zip itself, and not just the .json —
the whole folder, models/sheets/map and all.

  1. Extract this archive. Unzipping tools that create a folder named after
     the zip do the right thing here for free — this one is named
     "${root}", which is also the name the folder needs once it lands
     in step 2.
  2. Put that folder — the one holding the .json, not the .zip itself —
     directly inside:
     ${savedObjectsPath}
  3. In TTS: Objects → Saved Objects → spawn it once.
     Everything appears at once, laid out in a row.`;
  }

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
${installing}

Making this local export multiplayer-ready later
-------------------------------------------------
In TTS, open Upload → Cloud Manager and choose Upload All (the black up arrow).
Wait for the local and cached assets to finish uploading, then save the object
again. TTS rewrites those asset sources to its Steam Cloud so other players can
download them; saving afterwards is what keeps the rewritten URLs.

Running the workshop from its own dev server
----------------------------------------------
"npm run dev", then open the app at the address it prints instead of wherever
you normally do. While that page is open, an export writes straight to a real
folder on disk and needs neither the Saved Objects setting above nor any
editing — see the app's own README for what a dev server is, if that is new.

Notes
-----
  Card quantities are expanded: a card with ×3 is three cards in the pile.
  A pile over 70 cards is split across several sheets and is still one pile.
  Each card carries its ID from the workshop in GMNotes, which players do not
  see — that is how a later export can tell what it is looking at.

Generated by Unmatched Labs.
`;
}

export async function exportTabletopSimulator(
  set: AdventureSet,
  options: TtsBundleOptions
): Promise<TtsBundleResult> {
  const root = `${slugify(set.name, 'adventure-set')}-tts`;
  const online = options.hosting.kind === 'online';
  /* A development server is a local-output convenience. It must never win
     over an explicit online choice and quietly put file URLs in a save that
     was promised to work for the rest of the table. */
  const folder = online ? null : await findExportsFolder();
  const savedObjectsPath =
    options.hosting.kind === 'local' ? options.hosting.savedObjectsPath.trim() : '';
  if (!online && !savedObjectsPath) {
    throw new Error('A Tabletop Simulator Saved Objects folder is required for local hosting.');
  }

  let urlFor: (path: string) => string;
  if (options.hosting.kind === 'online') {
    urlFor = options.hosting.host.urlFor;
  } else {
    const rawRoot = folder?.url ?? fileUrlFromPath(savedObjectsPath);
    const base = joinFileUrl(rawRoot, root);
    urlFor = (path) => joinFileUrl(base, path);
  }

  /* JSON and instructions are added only for the local archive. Until then
     this is exactly the list the online host must make publicly available. */
  const files: TtsHostedAsset[] = [];
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
    const board = await photographMapBoard(set.map, {
      width: MAX_SHEET_PIXELS,
      customSymbols: set.customSymbols
    });
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
      ...(await componentFor(
        figure,
        ownerName,
        components.length,
        urlFor,
        files,
        taken,
        warnings,
        online
      ))
    );
  }

  const saveName = `${slugify(set.name, 'adventure-set')}.json`;
  const saveText = buildTabletopSimulatorSave({ set, decks, threat, map, components });

  if (options.hosting.kind === 'online') {
    const uploaded = await options.hosting.host.upload(files, (progress) => {
      options.onProgress?.(progress.done, progress.total, 'Uploading assets');
    });

    return {
      hosting: 'online',
      directory: null,
      removedCount: 0,
      download: {
        filename: saveName,
        mimeType: 'application/json',
        blob: new Blob([saveText], { type: 'application/json' })
      },
      fileCount: files.length + 1,
      warnings,
      uploadedCount: uploaded.uploaded,
      reusedCount: uploaded.reused
    };
  }

  files.push({
    path: saveName,
    contentType: 'application/json',
    bytes: encoder.encode(saveText)
  });

  const directory = folder ? `${folder.directory}\\${root}` : null;
  files.push({
    path: 'HOW_TO_IMPORT.txt',
    contentType: 'text/plain',
    bytes: encoder.encode(howToImport(set, root, { directory, savedObjectsPath }))
  });

  if (folder) {
    for (const file of files) await writeToExportsFolder(`${root}/${file.path}`, file.bytes);

    /* Only now that every file is on disk: the folder holds a superseded copy
       of each image whose contents changed, because they are named after those
       contents so TTS cannot cache a stale one. Pruning last means a failed
       export leaves the previous good one intact. */
    const removed = await pruneExportsBundle(root, files.map((file) => file.path));

    return {
      hosting: 'local',
      directory,
      download: null,
      fileCount: files.length,
      removedCount: removed,
      warnings,
      uploadedCount: 0,
      reusedCount: 0
    };
  }

  return {
    hosting: 'local',
    directory: null,
    removedCount: 0,
    download: {
      filename: `${root}.zip`,
      mimeType: 'application/zip',
      /*
       * No `${root}/` prefix on the entries, deliberately — the archive's own
       * *name* already is `${root}.zip`, and an unzip tool that creates a
       * folder to extract into (Windows' "Extract All", macOS's Archive
       * Utility — the default on both platforms) names that folder after the
       * archive. Entries also prefixed with the same name would double it:
       * `${root}/${root}/…`, one folder for the tool's own wrapping and one
       * baked into the zip, indistinguishable from each other and both
       * carrying the very folder name the import instructions tell someone
       * to look for — which is exactly the "off by one level" this produced
       * before. Writing entries at the zip's own root means the *one*
       * wrapping folder most tools create for free is already correctly
       * named and already holds everything at the right depth.
       */
      blob: createZip(files)
    },
    fileCount: files.length,
    warnings,
    uploadedCount: 0,
    reusedCount: 0
  };
}

/** Named for the export UI, which lists what a run produced. */
export function tabletopDeckSummary(set: AdventureSet): string[] {
  return planTabletopDecks(set).map(
    (plan) => `${plan.nickname} (${plan.cards.length}${plan.back.kind === 'character' ? `, ${characterLabel(plan.back.character)} back` : ''})`
  );
}
