/**
 * Light Slate / Twilight Blue — which one is active, and the switch.
 *
 * The actual palettes live in `styles/tokens.css`, keyed off a `data-theme`
 * attribute on `<html>`; this is only the state that decides what that
 * attribute is; and it agrees with `index.html`'s own inline boot script,
 * which sets the same attribute before this module — before Svelte, before
 * anything — ever runs. Two readers of one fact would drift; this module and
 * the boot script both derive `data-theme` the identical way (stored choice,
 * else system preference) for exactly that reason.
 *
 * `localStorage`, not IndexedDB: this is a single small string, not a
 * document — the `localStorage`-is-too-small-for-this problem CLAUDE.md
 * documents at length was about multi-megabyte artwork, and does not apply
 * here. `cloud/auth.svelte.ts` already keeps the Supabase session the same
 * way, for the same reason.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'workshop-theme';

function systemPrefers(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** What `index.html`'s inline script already computed and stamped onto `<html>`. */
function readInitial(): Theme {
  const stamped = document.documentElement.dataset.theme;
  if (stamped === 'light' || stamped === 'dark') return stamped;
  // No inline script ran (a test harness, most likely) — fall back to the
  // same rule it uses, so this module is still correct on its own.
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Private browsing, or `localStorage` disabled — same fallback as below.
  }
  return systemPrefers();
}

class ThemeStore {
  theme = $state<Theme>(readInitial());

  set(value: Theme): void {
    this.theme = value;
    document.documentElement.dataset.theme = value;
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Nothing to fall back to — the attribute above still took effect for
      // this session, only the *next* load will re-derive from scratch.
    }
  }

  toggle(): void {
    this.set(this.theme === 'dark' ? 'light' : 'dark');
  }
}

export const theme = new ThemeStore();
