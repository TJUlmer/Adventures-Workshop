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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
