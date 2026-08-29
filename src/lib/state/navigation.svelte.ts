/**
 * Where the app is.
 *
 * Two levels, mirroring the mental model: outside a set there is Home; inside
 * one there is a set of pages. Everything else — which card is selected, what
 * the preview shows — hangs off the store, not off navigation.
 */

/** Pages available while a set is open. */
export const SET_PAGES = [
  'home',
  'editor',
  'threat',
  'map',
  'figures',
  'symbols',
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
  home: { label: 'Edit', hint: 'What this set is and how complete it is', icon: 'grid' },
  editor: { label: 'Cards', hint: 'Edit a card or a character', icon: 'card' },
  threat: { label: 'Threat track', hint: 'The villain’s threat track', icon: 'skull' },
  map: { label: 'Map', hint: 'The board the adventure is played on', icon: 'grid' },
  figures: { label: 'Components', hint: 'Figures, tokens and game pieces', icon: 'users' },
  symbols: {
    label: 'Symbols',
    hint: 'Custom glyphs, insertable anywhere the built-in combat symbols are',
    icon: 'sparkle'
  },
  assets: { label: 'Overview', hint: 'Every component in one place', icon: 'layers' },
  settings: { label: 'Settings', hint: 'Identity, theme defaults and notes', icon: 'settings' },
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
  | { kind: 'home' }
  /** The community gallery. Outside a set, like Home. */
  | { kind: 'gallery' }
  | { kind: 'set'; page: SetPage }
  /**
   * Someone else's published set, reached by a share link.
   *
   * `characterHint` is not part of the link — only `openShared`'s own URL
   * writes are, unchanged — it is a same-navigation nudge for a visitor who
   * clicked one specific character inside a box that has no listing of its
   * own: `ExportPanel` reads it to default its scope picker to that hero
   * instead of the whole set, without a screen the visitor did not ask for. A
   * reload loses it, the same as it loses any other browse state that is not
   * the address bar.
   */
  | { kind: 'shared'; slug: string; characterHint?: string }
  /** Someone's public profile — what they have published, and helped build. */
  | { kind: 'author'; id: string }
  /**
   * A themed box of decks several people each own, reached by its own link.
   *
   * Like `shared`, and unlike everything above it, this one lives in the
   * address bar — see the slug readers below for why it has to.
   */
  | { kind: 'collection'; slug: string };

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

/**
 * A collection's link — the **second** real path in this app, and the only
 * other one that will ever be justified the same way.
 *
 * It earns the exception for exactly the reason a shared set's does and for
 * no other: a collection link is the thing an organizer pastes into a Discord
 * to announce a project, so it has to unfurl, and an unfurler reads a plain
 * HTTP request in which a fragment never appears. Everything else in this app
 * stays a hash on purpose. **Do not read this as a precedent for a third**
 * without the same argument.
 *
 * Matched unanchored at the front for the same reason as the shared pattern:
 * a sub-path deploy's base path sits ahead of the tail and is not known here.
 */
const COLLECTION_PATH_PATTERN = /collection\/([A-Za-z0-9_-]+)\/?$/;
const COLLECTION_HASH_PATTERN = /^#\/collection\/([A-Za-z0-9_-]+)$/;

/**
 * **Either** real path's tail, and the only thing that may compute a `base`.
 *
 * `openShared` and `openCollection` both work out where the app's own base
 * path ends by stripping their tail off `location.pathname` — and while there
 * was only one real path, stripping *its own* tail was the same thing as
 * stripping whichever tail was there. With two, it stops being: going from
 * `/collection/abc` to a shared set stripped nothing (no `shared/` tail to
 * find) and concatenated, producing `/collection/abcshared/xyz`, and the same
 * in reverse. Measured, not reasoned about — a one-path app has no way to
 * show this and the code reads correct either way.
 *
 * So both directions strip through this instead. A third real path, if one
 * is ever justified, joins the alternation here rather than adding a third
 * private pattern.
 */
const ROUTE_TAIL_PATTERN = /(?:shared|collection)\/([A-Za-z0-9_-]+)\/?$/;

export function readCollectionSlug(): string | null {
  return (
    COLLECTION_PATH_PATTERN.exec(window.location.pathname)?.[1] ??
    COLLECTION_HASH_PATTERN.exec(window.location.hash)?.[1] ??
    null
  );
}

class Navigation {
  view = $state<View>({ kind: 'home' });

  readonly inSet = $derived(this.view.kind === 'set');
  readonly page = $derived(this.view.kind === 'set' ? this.view.page : null);

  openHome(): void {
    this.view = { kind: 'home' };
  }

  openGallery(): void {
    this.view = { kind: 'gallery' };
  }

  /**
   * Someone's public profile, by their profile id.
   *
   * Plain state, like `openGallery` — not a URL, unlike `openShared`. Nobody
   * has asked for a profile page to survive a paste the way a share link
   * must, and giving every one an address-bar entry would mean solving the
   * same unfurler problem `openShared`/`middleware.ts` solve for a second
   * kind of link nobody requested yet.
   */
  openAuthor(id: string): void {
    // Same "remember where this came from" as `openShared`, so the profile
    // page's own back button has somewhere real to go — the gallery for a
    // browsing visitor, the shared set they came from for anyone who followed
    // a credit line, and so on.
    if (this.view.kind !== 'author') this.#returnTo = this.view;
    this.view = { kind: 'author', id };
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
   * Always writes the **path** form, matching `shareUrl` — a gallery tile
   * used to open a shared set under the old hash form while `shareUrl`'s copy
   * button had already moved to the path form, so the address bar and the
   * text someone actually copied disagreed about the one thing that has to
   * survive being pasted. There is now exactly one URL shape for "viewing a
   * shared set," everywhere it can be reached from.
   *
   * Two different address-bar writes, depending on how this was reached:
   *
   * `replaceState`, causing no new history entry, when the address bar
   * already names this slug — in *either* form. Covers the initial deep link
   * off a path-form share URL (nothing to normalize, so this is a no-op) and
   * a stale hash-form bookmark (upgraded to the path form in place). Also
   * covers the hashchange listener catching a native click on an in-app
   * `#/shared/…` link (`SetHome`'s "Based on…" line): the browser has
   * already added its own history entry for that click by the time this
   * runs, so a `pushState` here would double it up — Back would need
   * pressing twice to actually leave.
   *
   * `pushState` otherwise — the gallery, or a "Based on…" link to a
   * *different* shared set than the one already open — because that *is* a
   * fresh navigation and wants a fresh, back-button-reachable entry.
   *
   * `characterHint` — see `View`'s own doc — never touches any of the URL
   * logic below; it rides along on `this.view` only.
   */
  openShared(slug: string, characterHint?: string): void {
    /*
     * Remember where this was opened from, so leaving goes back there rather
     * than to a fixed screen. Someone who reached a set from the gallery is
     * mid-browse and expects to land back in the grid; someone who pasted a
     * link has nowhere to go but Home. Only recorded on the way *in*,
     * or re-entering a shared view from a shared view would overwrite it.
     */
    if (this.view.kind !== 'shared') this.#returnTo = this.view;
    this.view = { kind: 'shared', slug, characterHint };

    // Strips a stale `/shared/{otherSlug}` *or* `/collection/{slug}` tail
    // rather than assuming root, so a sub-path deploy's own base path
    // survives — see `ROUTE_TAIL_PATTERN` for why it must be either.
    const base = window.location.pathname.replace(ROUTE_TAIL_PATTERN, '');
    const wanted = `${base}shared/${slug}${window.location.search}`;

    if (readSharedSlug() === slug) {
      if (window.location.pathname !== `${base}shared/${slug}` || window.location.hash !== '') {
        history.replaceState(null, '', wanted);
      }
      return;
    }

    history.pushState(null, '', wanted);
  }

  /** Wherever `openShared` was called from. Home if it was nowhere. */
  #returnTo: View = { kind: 'home' };

  /**
   * Leave a share link.
   *
   * The hash is cleared as well as the view, or the link would reassert itself
   * on the next reload and the viewer could never get out of it.
   *
   * `to` overrides where it lands. Without it the viewer goes back where they
   * came from, which is right for "Done" and wrong for anything that names its
   * destination: "Go to Home" after taking a copy sent people to the gallery,
   * because that is where they had opened the set from. A button that says
   * where it goes has to go there.
   *
   * The `/shared/{slug}` tail is stripped from `pathname` rather than the
   * whole path being reset to `/` — a sub-path deploy's own base path is
   * everything ahead of that tail, and hardcoding root would drop it. A
   * hash-only arrival has no such tail to strip, so this is a no-op on the
   * path and the hash still goes, same as before.
   */
  leaveShared(to?: View): void {
    if (readSharedSlug() !== null) {
      const base = window.location.pathname.replace(ROUTE_TAIL_PATTERN, '');
      history.replaceState(null, '', base + window.location.search);
    }
    this.view = to ?? this.#returnTo;
  }

  /**
   * Open a collection by its link.
   *
   * The same three-way decision `openShared` makes, for the same reasons:
   * `replaceState` when the URL already names this collection (a first load,
   * a reload, or a hash-form link upgraded to the path form in place), so a
   * click the browser has already pushed its own entry for is not doubled up;
   * `pushState` otherwise, because arriving from Home or the gallery *is* a
   * fresh navigation and wants a back-button-reachable entry.
   */
  openCollection(slug: string): void {
    if (this.view.kind !== 'collection') this.#returnTo = this.view;
    this.view = { kind: 'collection', slug };

    const base = window.location.pathname.replace(ROUTE_TAIL_PATTERN, '');
    const wanted = `${base}collection/${slug}${window.location.search}`;

    if (readCollectionSlug() === slug) {
      if (window.location.pathname !== `${base}collection/${slug}` || window.location.hash !== '') {
        history.replaceState(null, '', wanted);
      }
      return;
    }

    history.pushState(null, '', wanted);
  }

  /**
   * Leave a collection.
   *
   * **This, not a bare `openHome()`.** Only this clears the
   * `/collection/{slug}` tail, and a view change that leaves the path behind
   * puts the link back in the address bar to reassert itself on the next
   * reload — the viewer could never get out. Exactly the trap `leaveShared`
   * already documents, and the reason every Home/Gallery button on a
   * collection page has to come through here.
   */
  leaveCollection(to?: View): void {
    if (readCollectionSlug() !== null) {
      const base = window.location.pathname.replace(ROUTE_TAIL_PATTERN, '');
      history.replaceState(null, '', base + window.location.search);
    }
    this.view = to ?? this.#returnTo;
  }
}

export const navigation = new Navigation();
