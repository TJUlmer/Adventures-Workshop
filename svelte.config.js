import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/vite-plugin-svelte').Config} */
export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Runes-only codebase. Keeps legacy reactive syntax from silently creeping in.
    runes: true
  }
};
