/**
 * The health dial: a fixed component the app supplies, not one the author builds.
 *
 * Every villain and minion needs a dial, and it is always the *same* dial — a
 * disc with the current health on its face and a trigger either side of it. So a
 * `dial` figure carries no model or saved object of its own: the app owns both,
 * and the only thing the author brings is the picture that goes on its face.
 *
 * The mesh is *generated* rather than shipped. It is a plain circle, which is
 * exactly what `models/token.ts` already makes — so the dial is a token spec and
 * nothing more, and the preview, the export and any future print all read the
 * same one. The dial that used to live here was a supplied `.obj`, and it went
 * because the app had no licence to redistribute it.
 *
 * The saved object is still a file, because a TTS component is more than a mesh:
 * `health dial.json` carries the counter's Lua and the material settings, and
 * export splices in the mesh URL, the author's face and the dial's range. Its
 * `LuaScript` is a JSON string, so the readable way to change it is to spawn the
 * object in Tabletop Simulator, edit the script there and save it back out.
 */
import type { TokenSpec } from '$lib/models/token';

/** The Tabletop Simulator saved object, with the dial's Lua and material. */
export const HEALTH_DIAL_SAVE_URL = '/assets/templates/health dial.json';

/**
 * The disc, in the same terms a token is described in.
 *
 * Two inches across, which is what the printed dials are and what the Lua's
 * button positions were laid out against — the triggers sit at ±0.6 of the
 * disc's one-inch radius. Changing the diameter here without moving them there
 * walks them off the face.
 */
export const HEALTH_DIAL_SPEC: TokenSpec = {
  shape: 'circle',
  diameterMm: 50.8,
  thicknessMm: 2,
  twoSided: false
};

/** The disc's edge, where the face art does not reach. Matches a stock token. */
export const HEALTH_DIAL_RIM = '#1a1a1a';

/**
 * The mesh's path within an export.
 *
 * One file for every dial in the set rather than one each: the spec is fixed, so
 * every dial's mesh is the same bytes and only the face differs.
 */
export const HEALTH_DIAL_MESH_PATH = 'models/health-dial.obj';

/** The material name written into the OBJ. */
export const HEALTH_DIAL_MATERIAL = 'health-dial';
