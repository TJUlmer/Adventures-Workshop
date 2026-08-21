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
 *
 * **Two-sided art** wraps the same way a token's does: one picture, front on the
 * left, back on the right, one to each face of the disc — see `TokenSpec.twoSided`
 * in `models/token.ts`, which the dial shares rather than duplicating. The one
 * thing that does not follow the picture is the counter itself: `health
 * dial.json`'s Lua places the number and its two triggers a fixed distance clear
 * of the disc's *top* face only (`faceY()` in the script), so they read on
 * whichever picture the front happens to be showing and never appear on the
 * back — a two-sided dial's underside is art with no overlay, same as a
 * one-sided dial's is not the number's business at all.
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
 *
 * The base spec — always one-sided. Read through `healthDialSpec()` rather than
 * directly wherever whether the *art* wraps to the back actually matters, since
 * that is a per-figure choice (`figure.token.twoSided`) and this constant has no
 * figure to ask.
 */
export const HEALTH_DIAL_SPEC: TokenSpec = {
  shape: 'circle',
  diameterMm: 50.8,
  thicknessMm: 2,
  twoSided: false
};

/**
 * The dial's spec for one figure, art wrap included.
 *
 * `twoSided` is the only thing that ever varies — every other measurement is
 * the fixed disc every dial shares — so this is the one place that reads
 * `figure.token.twoSided` and turns it into a real `TokenSpec`. Everything that
 * builds a dial's mesh or texture goes through this rather than
 * `HEALTH_DIAL_SPEC` directly, which is what keeps a two-sided dial's mesh (its
 * UV layout genuinely differs — see `buildTokenMesh`) in step with its texture.
 */
export function healthDialSpec(twoSided: boolean): TokenSpec {
  return { ...HEALTH_DIAL_SPEC, twoSided };
}

/** The disc's edge, where the face art does not reach. Matches a stock token. */
export const HEALTH_DIAL_RIM = '#1a1a1a';

/**
 * The mesh's path within an export, one-sided or two.
 *
 * One file per *variant* rather than one each — the spec is fixed either way,
 * so every one-sided dial's mesh is the same bytes and every two-sided dial's
 * is the same bytes as each other, and a set mixing both writes exactly two
 * files rather than one per dial. The two variants need separate files at all
 * because their UV layouts genuinely differ (see `buildTokenMesh`'s `twoSided`
 * branch) — this is not the same mesh wearing a different picture.
 */
export function healthDialMeshPath(twoSided: boolean): string {
  return twoSided ? 'models/health-dial-two-sided.obj' : 'models/health-dial.obj';
}

/** The material name written into the OBJ. */
export const HEALTH_DIAL_MATERIAL = 'health-dial';
