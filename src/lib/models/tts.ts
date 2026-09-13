/**
 * Tabletop Simulator saved objects, read well enough to edit the parts that
 * matter.
 *
 * A TTS save is a JSON envelope around `ObjectStates`. What makes a component
 * like a health dial *that* component is spread across three places:
 *
 *  - `Nickname` and `Description`, which are what a player sees;
 *  - `CustomMesh.MeshURL` and `DiffuseURL`, which are the model and its skin,
 *    hosted rather than embedded — TTS resolves them at load;
 *  - a `CONFIG` table at the top of `LuaScript`, which is where these objects
 *    conventionally keep their behaviour: a dial's range, the colour of its
 *    number, whether it shows a tooltip.
 *
 * Only that last one needs any cleverness, and not much: the convention is a
 * flat table of scalars, so the values are read out and written back *in
 * place*, leaving every other byte of the script untouched. This is not a Lua
 * parser and must not become one — an object whose config it cannot read is
 * still perfectly editable in TTS itself.
 */

export interface TtsConfigEntry {
  key: string;
  value: string | number | boolean;
  /** Where in the script the value sits, so it can be written back exactly. */
  readonly start: number;
  readonly end: number;
}

/** Object-space scale saved by TTS. Position and rotation only place the
    object on its table; scale changes the thing itself and belongs in a size
    preview. */
export interface TtsPreviewScale {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface TtsObjPreviewAsset {
  readonly type: 'obj';
  meshUrl: string;
  textureUrl: string;
  readonly scale: TtsPreviewScale;
}

export interface TtsTokenPreviewAsset {
  readonly type: 'token';
  readonly imageUrl: string;
  readonly secondaryImageUrl: string;
  /** TTS units, where one unit is approximately one inch. */
  readonly thickness: number;
  readonly mergeDistancePixels: number;
  readonly standUp: boolean;
  readonly scale: TtsPreviewScale;
}

/** The hosted assets the Components editor can turn into a local preview.
    Other TTS kinds remain valid saved objects; they simply have no renderer
    in this app. */
export type TtsPreviewAsset = TtsObjPreviewAsset | TtsTokenPreviewAsset;

export interface TtsObject {
  /** `Custom_Model`, `Custom_Tile`, `Card`… */
  readonly kind: string;
  nickname: string;
  description: string;
  meshUrl: string;
  diffuseUrl: string;
  /** Derived from the first ObjectState; never written as a new JSON field. */
  readonly previewAsset: TtsPreviewAsset | null;
  /** Entries of the Lua `CONFIG` table, empty if the object has no script. */
  config: TtsConfigEntry[];
}

export interface TtsSave {
  /** The whole document, kept so an export can put every untouched field back. */
  readonly raw: unknown;
  readonly objectCount: number;
  object: TtsObject;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function previewScale(first: Record<string, unknown>): TtsPreviewScale {
  const transform = asRecord(first['Transform']);
  return {
    x: finite(transform['scaleX'], 1),
    y: finite(transform['scaleY'], 1),
    z: finite(transform['scaleZ'], 1)
  };
}

/**
 * Find the first object's browser-previewable source by structure, not name.
 *
 * A bag, chip or figurine made through TTS's Custom Model dialogue still
 * carries `CustomMesh`; its behavioural subtype is a TypeIndex rather than a
 * dependable ObjectState name. Custom Tokens are different: TTS generates
 * their mesh from the alpha of `CustomImage.ImageURL`, so there is no MeshURL
 * to find at all.
 */
function readPreviewAsset(first: Record<string, unknown>): TtsPreviewAsset | null {
  const scale = previewScale(first);
  const mesh = asRecord(first['CustomMesh']);
  if (Object.keys(mesh).length > 0) {
    return {
      type: 'obj',
      meshUrl: str(mesh['MeshURL']),
      textureUrl: str(mesh['DiffuseURL']),
      scale
    };
  }

  const image = asRecord(first['CustomImage']);
  const token = asRecord(image['CustomToken']);
  if (Object.keys(token).length > 0) {
    return {
      type: 'token',
      imageUrl: str(image['ImageURL']),
      secondaryImageUrl: str(image['ImageSecondaryURL']),
      thickness: finite(token['Thickness'], 0.2),
      mergeDistancePixels: finite(token['MergeDistancePixels'], 15),
      standUp: token['StandUp'] === true,
      scale
    };
  }

  return null;
}

/**
 * Scalar entries of the leading `CONFIG` table.
 *
 * Tables-within-tables — a colour like `{0,0,0,100}` — are skipped rather than
 * flattened: presenting four unlabelled numbers as an editable field would be
 * worse than leaving them to TTS.
 */
const CONFIG_BLOCK = /CONFIG\s*=\s*\{([\s\S]*?)\n\}/;
const ENTRY = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|true|false|-?\d+(?:\.\d+)?)\s*,?\s*$/;

export function readLuaConfig(script: string): TtsConfigEntry[] {
  const block = CONFIG_BLOCK.exec(script);
  if (!block || block.index === undefined) return [];

  const body = block[1] ?? '';
  const bodyStart = block.index + block[0].indexOf(body);

  const entries: TtsConfigEntry[] = [];
  let offset = 0;
  for (const line of body.split('\n')) {
    const match = ENTRY.exec(line);
    if (match) {
      const key = match[1] as string;
      const literal = match[2] as string;
      const at = bodyStart + offset + line.indexOf(literal);

      const value: string | number | boolean =
        literal === 'true'
          ? true
          : literal === 'false'
            ? false
            : literal.startsWith('"')
              ? literal.slice(1, -1)
              : Number(literal);

      entries.push({ key, value, start: at, end: at + literal.length });
    }
    offset += line.length + 1;
  }
  return entries;
}

/** A value as Lua would write it. */
function toLua(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return `"${value.replace(/["\\]/g, '\\$&')}"`;
}

/**
 * Write edited values back into the script.
 *
 * Applied from the end backwards, so replacing one value cannot move the
 * offsets recorded for the ones before it.
 */
export function writeLuaConfig(script: string, entries: readonly TtsConfigEntry[]): string {
  let out = script;
  for (const entry of [...entries].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, entry.start) + toLua(entry.value) + out.slice(entry.end);
  }
  return out;
}

export class UnreadableTtsSaveError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'UnreadableTtsSaveError';
  }
}

/**
 * Read a save file. Only the first object is surfaced — these files are
 * exported one component at a time, and a whole table's worth is not something
 * this app has any business editing.
 */
export function parseTtsSave(text: string): TtsSave {
  let raw: unknown;
  try {
    // TTS writes a BOM often enough to be worth stripping.
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new UnreadableTtsSaveError('That file is not valid JSON.');
  }

  const states = asRecord(raw)['ObjectStates'];
  if (!Array.isArray(states) || states.length === 0) {
    throw new UnreadableTtsSaveError('No objects in that save — is it a Tabletop Simulator file?');
  }

  const first = asRecord(states[0]);
  const mesh = asRecord(first['CustomMesh']);

  return {
    raw,
    objectCount: states.length,
    object: {
      kind: str(first['Name']) || 'Object',
      nickname: str(first['Nickname']),
      description: str(first['Description']),
      meshUrl: str(mesh['MeshURL']),
      diffuseUrl: str(mesh['DiffuseURL']),
      previewAsset: readPreviewAsset(first),
      config: readLuaConfig(str(first['LuaScript']))
    }
  };
}

/** The save with the edited fields put back, ready to write out. */
export function applyTtsEdits(save: TtsSave): string {
  const raw = JSON.parse(JSON.stringify(save.raw)) as Record<string, unknown>;
  const states = raw['ObjectStates'] as Record<string, unknown>[];
  const first = states[0] as Record<string, unknown>;

  first['Nickname'] = save.object.nickname;
  first['Description'] = save.object.description;

  const mesh = asRecord(first['CustomMesh']);
  if (Object.keys(mesh).length > 0) {
    mesh['MeshURL'] = save.object.meshUrl;
    mesh['DiffuseURL'] = save.object.diffuseUrl;
    first['CustomMesh'] = mesh;
  }

  if (save.object.config.length > 0) {
    first['LuaScript'] = writeLuaConfig(str(first['LuaScript']), save.object.config);
  }

  return JSON.stringify(raw, null, 2);
}

/**
 * The preview source after applying edits held in `TtsObject`.
 *
 * `raw` deliberately stays byte-for-byte source data until export, while the
 * editable mesh fields live beside it. Re-resolving those two URLs here keeps
 * a preview requested after an edit from loading the stale values in `raw`.
 */
export function resolveTtsPreviewAsset(object: TtsObject): TtsPreviewAsset | null {
  const asset = object.previewAsset;
  if (asset?.type !== 'obj') return asset;
  return { ...asset, meshUrl: object.meshUrl, textureUrl: object.diffuseUrl };
}
