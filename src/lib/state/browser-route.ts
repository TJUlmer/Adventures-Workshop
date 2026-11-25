import type { CardId } from '$lib/cards/types';
import type { CharacterId } from '$lib/characters/types';
import type { DeckId } from '$lib/decks/types';
import type { SetId } from '$lib/sets/types';
import { GALLERY_MODES, SET_PAGES } from './navigation.svelte';
import type { GalleryMode, SetPage, View } from './navigation.svelte';

export type EditorLocation =
  | { target: 'set' }
  | { target: 'card'; id: CardId; tab: 'content' | 'design' | 'copies'; copy?: number }
  | { target: 'character'; id: CharacterId; tab: string }
  | { target: 'deck'; id: DeckId };

export type BrowserRoute =
  | Exclude<View, { kind: 'set' } | { kind: 'gallery' }>
  | { kind: 'gallery'; mode: GalleryMode }
  | { kind: 'set'; setId: SetId; page: SetPage; editor?: EditorLocation; printKey?: string };

const PUBLIC_PATH = /(?:^|\/)(shared|collection)\/([A-Za-z0-9_-]+)\/?$/;
const PUBLIC_SLUG = /^[A-Za-z0-9_-]+$/;

function readEditor([target, id, tab, copy]: string[]): EditorLocation {
  if (target === 'card' && id) {
    const cardTab = tab === 'copies' || tab === 'design' ? tab : 'content';
    const copyNumber = copy && /^[1-9][0-9]*$/.test(copy) ? Number(copy) : 1;
    return {
      target,
      id: id as CardId,
      tab: cardTab,
      ...(cardTab === 'copies' ? { copy: Number.isSafeInteger(copyNumber) ? copyNumber : 1 } : {})
    };
  }
  if (target === 'character' && id) return { target, id: id as CharacterId, tab: tab || 'identity' };
  if (target === 'deck' && id) return { target, id: id as DeckId };
  return { target: 'set' };
}

function publicRoute(kind: string | undefined, slug: string | undefined, url: URL): BrowserRoute | null {
  if (!slug || !PUBLIC_SLUG.test(slug)) return null;
  if (kind === 'shared') {
    const characterHint = url.searchParams.get('character')?.trim() || undefined;
    return { kind, slug, characterHint };
  }
  if (kind === 'collection') return { kind, slug, workspace: url.searchParams.get('workspace') === '1' };
  return null;
}

export function readBrowserRoute(url: URL): BrowserRoute | null {
  const path = PUBLIC_PATH.exec(url.pathname);
  if (path) return publicRoute(path[1], path[2], url);
  if (!url.hash.startsWith('#/')) return null;

  let segments: string[];
  try {
    segments = url.hash.slice(2).split('/').map(decodeURIComponent);
  } catch {
    return { kind: 'home' };
  }
  const [kind, first, second, ...tail] = segments;
  if (kind === 'shared' || kind === 'collection') return publicRoute(kind, first, url);
  if (kind === 'welcome') return { kind };
  if (kind === 'gallery') return { kind, mode: GALLERY_MODES.find((mode) => mode === first) ?? 'characters' };
  if (kind === 'author' && first) return { kind, id: first };
  if (kind === 'set' && first) {
    const page = SET_PAGES.find((entry) => entry === second) ?? 'home';
    if (page === 'editor') return { kind, setId: first as SetId, page, editor: readEditor(tail) };
    return { kind, setId: first as SetId, page, ...(page === 'print' && tail[0] ? { printKey: tail[0] } : {}) };
  }
  return { kind: 'home' };
}

function editorSegments(editor: EditorLocation | undefined): string[] {
  switch (editor?.target) {
    case 'character': return ['character', editor.id, editor.tab];
    case 'deck': return ['deck', editor.id];
    case 'card': return [
      'card', editor.id, editor.tab, ...(editor.tab === 'copies' ? [String(editor.copy ?? 1)] : [])
    ];
    default: return [];
  }
}

/** App locations travel as fragments. Published links need a real HTTP path for previews. */
export function browserRouteUrl(route: BrowserRoute, current: URL): URL {
  const url = new URL(current);
  const publicPath = PUBLIC_PATH.exec(current.pathname);
  const base = publicPath ? current.pathname.slice(0, publicPath.index + 1) : current.pathname;
  url.pathname = base;

  if (route.kind === 'shared' && route.characterHint) url.searchParams.set('character', route.characterHint);
  else url.searchParams.delete('character');
  if (route.kind === 'collection' && route.workspace) url.searchParams.set('workspace', '1');
  else url.searchParams.delete('workspace');
  const currentRoute = readBrowserRoute(current);
  if (route.kind !== 'collection' || currentRoute?.kind !== 'collection' || currentRoute.slug !== route.slug) {
    url.searchParams.delete('join');
  }

  if (route.kind === 'shared' || route.kind === 'collection') {
    const directory = base.endsWith('.html') ? base.slice(0, base.lastIndexOf('/') + 1) : base.replace(/\/?$/, '/');
    url.pathname = `${directory}${route.kind}/${encodeURIComponent(route.slug)}`;
    url.hash = '';
    return url;
  }

  const segments = route.kind === 'set'
    ? ['set', route.setId, route.page, ...editorSegments(route.editor), ...(route.printKey ? [route.printKey] : [])]
    : route.kind === 'gallery' ? [route.kind, route.mode]
    : route.kind === 'author' ? [route.kind, route.id]
    : [route.kind];
  url.hash = `/${segments.map(encodeURIComponent).join('/')}`;
  return url;
}
