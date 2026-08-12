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

export interface TtsObject {
  /** `Custom_Model`, `Custom_Tile`, `Card`… */
  readonly kind: string;
  nickname: string;
  description: string;
  meshUrl: string;
  diffuseUrl: string;
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
 * Whether a URL is one this app could fetch to show the model.
 *
 * It almost never is: TTS hosts on Steam, which serves no CORS header, and the
 * app makes no network calls by design. Downloading the file and attaching it
 * is the way to see one of these — hence the wording where this is used.
 */
export function isLocalUrl(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('/') || url.startsWith(location.origin);
}
