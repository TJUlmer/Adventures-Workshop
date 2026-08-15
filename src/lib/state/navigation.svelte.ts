/**
 * Where the app is.
 *
 * Two levels, mirroring the mental model: outside a set there is the library;
 * inside one there is a set of pages. Everything else — which card is selected,
 * what the preview shows — hangs off the store, not off navigation.
 */

/** Pages available while a set is open. */
export const SET_PAGES = [
  'home',
  'editor',
  'threat',
  'map',
  'figures',
  'assets',
  'settings',
  'print',
  'contributions'
] as const;
export type SetPage = (typeof SET_PAGES)[number];

export interface SetPageMeta {
  readonly label: string;
  readonly hint: string;
  /** Icon name from the UI icon set. */
  readonly icon: string;
  /** Pages reached by selecting something, not from the nav bar. */
  readonly hidden?: boolean;
}

export const SET_PAGE_META: Readonly<Record<SetPage, SetPageMeta>> = {
  home: { label: 'Home', hint: 'What this set is and how complete it is', icon: 'grid' },
  editor: { label: 'Cards', hint: 'Edit a card or a character', icon: 'card' },
  threat: { label: 'Threat track', hint: 'The villain’s threat track', icon: 'skull' },
  map: { label: 'Map', hint: 'The board the adventure is played on', icon: 'grid' },
  figures: { label: 'Components', hint: 'Figures, tokens and game pieces', icon: 'users' },
  assets: { label: 'Overview', hint: 'Every component in one place', icon: 'layers' },
  settings: { label: 'Settings', hint: 'Theme defaults, notes and version', icon: 'settings' },
  /*
   * Reached from Export rather than from the nav bar, and rendered outside the
   * app shell — a print view with a title bar above it has three things to hide
   * at print time and three chances to shift the sheet. See `PrintScreen`.
   */
  print: {
    label: 'Print sheets',
    hint: 'Cards laid out at true size for printing',
    icon: 'printer',
    hidden: true
  },
  /*
   * Reached from Set Home, and hidden for a reason worth stating: this page is
   * empty and meaningless for every set that has not been published and copied
   * by somebody else, which is nearly all of them. A permanent nav entry would
   * advertise a feature most authors have no use for.
   */
  contributions: {
    label: 'Contributions',
    hint: 'Changes other people have offered for this set',
    icon: 'users',
    hidden: true
  }
} as const;

export type View =
  | { kind: 'library' }
  /** The community gallery. Outside a set, like the library. */
  | { kind: 'gallery' }
  | { kind: 'set'; page: SetPage }
  /** Someone else's published set, reached by a share link. */
  | { kind: 'shared'; slug: string };

/**
 * The one URL this app has.
 *
 * Everything else is state, deliberately — the workshop is a single document
 * being edited and back-button-per-panel would be a nuisance rather than a
 * feature. A share link is different: it is handed to another person, so it has
 * to survive being pasted, and that means it has to live in the address bar.
 *
 * A hash rather than a path, because the app is served as static files from
 * wherever someone drops it. A path would need a server rewriting unknown URLs
 * to `index.html`; a hash needs nothing and works from `file://`.
 *
 * A shared set's link is the one exception, and reads a real path
 * (`…/shared/{slug}`) as well as the old hash form. A path is the only thing
 * an HTTP request ever carries to a server — a fragment never leaves the
 * browser, by the URL spec, so a link unfurler (Discord, Slack, Twitter…)
 * reading `#/shared/…` cannot know which set is being asked for. `shareUrl`
 * is the only place that *writes* the path form; every in-app navigation
 * still writes the hash, unchanged, and this only *reads* the path so a
 * freshly-opened share link is recognised regardless of which shape it
 * arrived in. See `middleware.ts` for the server side of this.
 *
 * Unanchored at the front and anchored at the end, so this matches the tail
 * of whatever the app's own base path happens to be (`/shared/…` at the
 * root, `/some/base/shared/…` for a sub-path deploy) without needing to know
 * it in advance — the same reason `shareUrl` builds off `location.pathname`
 * rather than assuming root.
 */
const SHARED_PATH_PATTERN = /shared\/([A-Za-z0-9_-]+)\/?$/;
const SHARED_HASH_PATTERN = /^#\/shared\/([A-Za-z0-9_-]+)$/;

export function readSharedSlug(): string | null {
  return (
    SHARED_PATH_PATTERN.exec(window.location.pathname)?.[1] ??
    SHARED_HASH_PATTERN.exec(window.location.hash)?.[1] ??
    null
  );
}

class Navigation {
  view = $state<View>({ kind: 'library' });

  readonly inSet = $derived(this.view.kind === 'set');
  readonly page = $derived(this.view.kind === 'set' ? this.view.page : null);

  openLibrary(): void {
    this.view = { kind: 'library' };
  }

  openGallery(): void {
    this.view = { kind: 'gallery' };
  }

  openSet(page: SetPage = 'home'): void {
    this.view = { kind: 'set', page };
  }

  go(page: SetPage): void {
    this.view = { kind: 'set', page };
  }

  /**
   * Open a published set, and put it in the address bar.
   *
   * The URL matters here and nowhere else in the app: a shared set is the one
   * thing a person hands to someone else, so arriving at one from the gallery
   * has to leave a page that can be reloaded, bookmarked and sent on. Without
   * this a tile opened the set and a refresh threw it away.
   *
   * `pushState` rather than `replaceState`, so Back returns to the gallery.
   * Skipped when the address bar already names this slug — the case when
   * this is being called *by* the hashchange listener, or by the initial
   * deep link off a path-form share URL — or every deep link would push a
   * duplicate entry and Back would appear not to work.
   *
   * Always writes the hash form here, even though `shareUrl` now hands out
   * the path form. A page that arrived via `…/shared/{slug}` already names
   * the right set (`readSharedSlug` reads both), so the `slug` check below
   * leaves it alone rather than decorating it with a redundant hash; every
   * *other* caller — the gallery, a "Based on…" link, re-opening a shared
   * view from within the running app — never touched the path form in the
   * first place and has no reason to start.
   */
  openShared(slug: string): void {
    /*
     * Remember where this was opened from, so leaving goes back there rather
     * than to a fixed screen. Someone who reached a set from the gallery is
     * mid-browse and expects to land back in the grid; someone who pasted a
     * link has nowhere to go but the library. Only recorded on the way *in*,
     * or re-entering a shared view from a shared view would overwrite it.
     */
    if (this.view.kind !== 'shared') this.#returnTo = this.view;

    this.view = { kind: 'shared', slug };
    if (readSharedSlug() === slug) return;

    /*
     * Strips a stale `/shared/{otherSlug}` tail before writing the hash, the
     * same as `leaveShared` does — otherwise navigating from one shared view
     * reached by path to a *different* one from within the app would leave
     * both a path and a hash naming two different slugs at once.
     */
    const base = window.location.pathname.replace(SHARED_PATH_PATTERN, '');
    history.pushState(null, '', `${base}#/shared/${slug}`);
  }

  /** Wherever `openShared` was called from. The library if it was nowhere. */
  #returnTo: View = { kind: 'library' };

  /**
   * Leave a share link.
   *
   * The hash is cleared as well as the view, or the link would reassert itself
   * on the next reload and the viewer could never get out of it.
   *
   * `to` overrides where it lands. Without it the viewer goes back where they
   * came from, which is right for "Done" and wrong for anything that names its
   * destination: "Go to my library" after taking a copy sent people to the
   * gallery, because that is where they had opened the set from. A button that
   * says where it goes has to go there.
   *
   * The `/shared/{slug}` tail is stripped from `pathname` rather than the
   * whole path being reset to `/` — a sub-path deploy's own base path is
   * everything ahead of that tail, and hardcoding root would drop it. A
   * hash-only arrival has no such tail to strip, so this is a no-op on the
   * path and the hash still goes, same as before.
   */
  leaveShared(to?: View): void {
    if (readSharedSlug() !== null) {
      const base = window.location.pathname.replace(SHARED_PATH_PATTERN, '');
      history.replaceState(null, '', base + window.location.search);
    }
    this.view = to ?? this.#returnTo;
  }
}

export const navigation = new Navigation();
