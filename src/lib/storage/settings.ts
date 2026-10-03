/**
 * App preferences that belong to this browser, not to any one set.
 *
 * The library's `meta` store already holds exactly this shape of thing —
 * `readLastOpen`/`rememberLastOpen` in `library.ts` — so this reuses it
 * rather than inventing a second small-values store beside it. Kept apart
 * from `library.ts` itself because these are not library facts: they have
 * nothing to do with which sets exist or which one was open last, and a
 * reader of that file should not have to skim past them to find what does.
 */
import { idbDelete, idbGet, idbPut, META_STORE } from './indexeddb';

const TTS_SAVED_OBJECTS_PATH_KEY = 'tts-saved-objects-path';
const CLOUD_DRAFT_OPT_IN_PREFIX = 'cloud-draft-opt-in:';
const BONUS_ABILITY_INK_PRESETS_KEY = 'bonus-ability-ink-presets';

export type BonusAbilityInkPresets = [string | null, string | null, string | null];

function emptyBonusAbilityInkPresets(): BonusAbilityInkPresets {
  return [null, null, null];
}

/** Only concrete six-digit inks can be handed back to a native colour input. */
function savedInk(value: unknown): string | null {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return null;
  return value.toLowerCase();
}

/** Three browser-level swatches, reusable in every set edited on this device. */
export async function readBonusAbilityInkPresets(): Promise<BonusAbilityInkPresets> {
  const value = await idbGet<unknown>(META_STORE, BONUS_ABILITY_INK_PRESETS_KEY);
  if (!Array.isArray(value)) return emptyBonusAbilityInkPresets();
  return [savedInk(value[0]), savedInk(value[1]), savedInk(value[2])];
}

export function writeBonusAbilityInkPresets(
  presets: BonusAbilityInkPresets
): Promise<boolean> {
  return idbPut(META_STORE, BONUS_ABILITY_INK_PRESETS_KEY, [
    savedInk(presets[0]),
    savedInk(presets[1]),
    savedInk(presets[2])
  ]);
}

/**
 * Where this machine's Tabletop Simulator looks for Saved Objects — typed in
 * once, by the author, because a browser page cannot ask the operating
 * system for it.
 *
 * This is what lets `exportTabletopSimulator` bake real `file://` URLs into
 * the exported JSON without a dev server: the URL a running dev server would
 * have answered with is instead the path remembered here. See
 * `export/tts-bundle.ts`'s `fileUrlFromPath`.
 *
 * A path, not a `file://` URL — the author is expected to paste it straight
 * out of their file manager's own address bar, which shows a path.
 */
export async function readTtsSavedObjectsPath(): Promise<string> {
  return (await idbGet<string>(META_STORE, TTS_SAVED_OBJECTS_PATH_KEY)) ?? '';
}

export async function writeTtsSavedObjectsPath(path: string): Promise<void> {
  const trimmed = path.trim();
  if (trimmed.length === 0) await idbDelete(META_STORE, TTS_SAVED_OBJECTS_PATH_KEY);
  else await idbPut(META_STORE, TTS_SAVED_OBJECTS_PATH_KEY, trimmed);
}

/**
 * One account's explicit cloud-draft choice on this browser.
 *
 * `null` is materially different from `false` once automatic cohorts begin:
 * it means the author has never chosen, so the rollout policy may decide for
 * them. `false` is an opt-out and must continue winning over a cohort or the
 * eventual default-on build.
 */
export async function readCloudDraftPreference(userId: string): Promise<boolean | null> {
  const value = await idbGet<unknown>(META_STORE, `${CLOUD_DRAFT_OPT_IN_PREFIX}${userId}`);
  return typeof value === 'boolean' ? value : null;
}

/** Kept as the narrow yes/no reader used by older callers and support probes. */
export async function readCloudDraftOptIn(userId: string): Promise<boolean> {
  return (await readCloudDraftPreference(userId)) === true;
}

export function writeCloudDraftOptIn(userId: string, enabled: boolean): Promise<boolean> {
  return idbPut(META_STORE, `${CLOUD_DRAFT_OPT_IN_PREFIX}${userId}`, enabled);
}

/** Used by scoped verification and account-removal support without touching other preferences. */
export function clearCloudDraftOptIn(userId: string): Promise<void> {
  return idbDelete(META_STORE, `${CLOUD_DRAFT_OPT_IN_PREFIX}${userId}`);
}
