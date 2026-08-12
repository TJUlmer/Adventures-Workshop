/**
 * Where the cloud is, if there is one.
 *
 * Everything here is optional, and that is the design. The app is local-first
 * and has to keep working with no backend configured at all — a clone with no
 * `.env.local`, a build someone else made, an author offline on a train. So
 * this returns `null` rather than throwing, and every caller treats `null` as
 * "sharing is switched off" rather than as an error.
 *
 * The publishable key ships in the built bundle. That is expected and safe: it
 * identifies the project, it does not authorise anything. What protects the
 * data is row level security — see `supabase/migrations/0001_sets.sql`, where
 * the policies are the actual security boundary.
 */

export interface CloudConfig {
  /** Project origin, with no trailing slash. */
  readonly url: string;
  /** The publishable (anon) key. Never a secret key — those bypass RLS. */
  readonly key: string;
}

/**
 * Bucket published artwork is lifted into.
 *
 * Objects are written under `<user-id>/<set-id>/<hash>`, and the storage
 * policies in the migration are what make that first segment mean something.
 */
export const ASSET_BUCKET = 'set-assets';

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

const CONFIG: CloudConfig | null = (() => {
  const url = trimmed(import.meta.env['VITE_SUPABASE_URL']);
  const key = trimmed(import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY']);
  if (!url || !key) return null;

  /*
   * A secret key here would be a full database compromise sitting in a
   * JavaScript bundle, bypassing every policy in the migration. It is worth
   * refusing loudly rather than working perfectly and quietly being a hole:
   * the failure mode of getting this wrong is silent, which is the worst kind.
   */
  if (key.startsWith('sb_secret_') || key.startsWith('service_role')) {
    console.error(
      '[cloud] Refusing to start: VITE_SUPABASE_PUBLISHABLE_KEY looks like a secret key. ' +
        'Secret keys bypass row level security and must never reach the browser. Rotate it.'
    );
    return null;
  }

  return { url: url.replace(/\/+$/, ''), key };
})();

/** The configured project, or `null` when sharing is not set up. */
export function cloudConfig(): CloudConfig | null {
  return CONFIG;
}

/** Whether anything in the app should offer to publish or fetch. */
export function cloudEnabled(): boolean {
  return CONFIG !== null;
}
