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
  'analysis',
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
  map: { label: 'Map', hint: 'The boards this set can be played on', icon: 'grid' },
  figures: { label: 'Components', hint: 'Figures, tokens and game pieces', icon: 'users' },
  symbols: {
    label: 'Symbols',
    hint: 'Custom glyphs, insertable anywhere the built-in combat symbols are',
    icon: 'sparkle'
  },
  assets: { label: 'Overview', hint: 'Every component in one place', icon: 'layers' },
  analysis: {
    label: 'Analysis',
    hint: 'Deck statistics and descriptive official context',
    icon: 'chart'
  },
  settings: { label: 'Settings', hint: 'Identity, theme defaults and notes', icon: 'settings' },
  /*
   * Reached from Export rather than from the set nav and rendered outside the
   * set shell. The application banner remains on screen for orientation, but
   * `App.svelte` removes it entirely in print media. See `PrintScreen`.
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

export const GALLERY_MODES = ['sets', 'characters', 'collections'] as const;
export type GalleryMode = (typeof GALLERY_MODES)[number];

export type View =
  | { kind: 'home' }
  | { kind: 'welcome' }
  | { kind: 'gallery' }
  | { kind: 'set'; page: SetPage; printKey?: string }
  | { kind: 'shared'; slug: string; characterHint?: string }
  | { kind: 'author'; id: string }
  | { kind: 'collection'; slug: string; workspace?: boolean };

class Navigation {
  view = $state<View>({ kind: 'home' });

  /** Keep the browse section when a set or collection is opened and closed. */
  galleryMode = $state<GalleryMode>('characters');

  readonly inSet = $derived(this.view.kind === 'set');
  readonly page = $derived(this.view.kind === 'set' ? this.view.page : null);

  #returnTo: View = { kind: 'home' };

  openHome(): void {
    this.view = { kind: 'home' };
  }

  openWelcome(): void {
    this.view = { kind: 'welcome' };
  }

  openGallery(): void {
    this.view = { kind: 'gallery' };
  }

  openAuthor(id: string): void {
    if (this.view.kind !== 'author') this.#returnTo = this.view;
    this.view = { kind: 'author', id };
  }

  openSet(page: SetPage = 'home'): void {
    this.go(page);
  }

  go(page: SetPage, printKey?: string): void {
    this.view = { kind: 'set', page, ...(printKey ? { printKey } : {}) };
  }

  openShared(slug: string, characterHint?: string): void {
    if (this.view.kind !== 'shared') this.#returnTo = this.view;
    this.view = { kind: 'shared', slug, characterHint };
  }

  leaveShared(to?: View): void {
    this.view = to ?? this.#returnTo;
  }

  openCollection(slug: string, workspace = false): void {
    if (this.view.kind !== 'collection') this.#returnTo = this.view;
    this.view = { kind: 'collection', slug, workspace };
  }

  leaveCollection(to?: View): void {
    this.view = to ?? this.#returnTo;
  }
}

export const navigation = new Navigation();
