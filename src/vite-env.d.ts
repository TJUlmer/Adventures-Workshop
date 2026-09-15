/// <reference types="svelte" />
/// <reference types="vite/client" />

/**
 * Cloud sharing configuration. Both are optional — the app is local-first and
 * runs with neither, so `cloud/config.ts` treats their absence as "sharing is
 * switched off" rather than as an error.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Private-draft rollout is independent of public sharing. Defaults to off. */
  readonly VITE_CLOUD_DRAFTS_ROLLOUT?: 'off' | 'opt-in' | 'cohort' | 'on';
  /** Comma-separated permanent Supabase user ids included in cohort mode. */
  readonly VITE_CLOUD_DRAFTS_INTERNAL_USER_IDS?: string;
  /** Stable percentage of remaining permanent accounts included in cohort mode. */
  readonly VITE_CLOUD_DRAFTS_COHORT_PERCENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
