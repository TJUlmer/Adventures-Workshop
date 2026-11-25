import { tick } from 'svelte';
import { physicalCopyCount } from '$lib/cards/copy-visuals';
import { findCard, findCharacter, findDeck } from '$lib/sets/queries';
import { browserRouteUrl, readBrowserRoute } from './browser-route';
import type { BrowserRoute, EditorLocation } from './browser-route';
import { cardEditorView } from './card-editor-view.svelte';
import { characterEditorView } from './character-editor-view.svelte';
import { navigation } from './navigation.svelte';
import { workshop } from './workshop.svelte';

function editorLocation(): EditorLocation {
  const selected = workshop.selection;
  if (selected.target === 'card' && workshop.selectedCard) {
    if (workshop.selectedCard.type === 'action' && selected.copy) {
      return { target: 'card', id: selected.id, tab: 'copies', copy: selected.copy };
    }
    return { target: 'card', id: selected.id, tab: cardEditorView.tab };
  }
  if (selected.target === 'character' && workshop.selectedCharacter) {
    return { target: 'character', id: selected.id, tab: characterEditorView.tab };
  }
  if (selected.target === 'deck' && workshop.selectedDeck) return { target: 'deck', id: selected.id };
  return { target: 'set' };
}

function currentRoute(): BrowserRoute {
  const view = navigation.view;
  if (view.kind === 'gallery') return { kind: 'gallery', mode: navigation.galleryMode };
  if (view.kind !== 'set') return view;
  return {
    kind: 'set', setId: workshop.adventure.id, page: view.page,
    ...(view.page === 'editor' ? { editor: editorLocation() } : {}),
    ...(view.page === 'print' && view.printKey ? { printKey: view.printKey } : {})
  };
}

function restoreEditor(editor?: EditorLocation): void {
  // A previously handled preview focus request must not reopen Content when
  // Back or Forward restores a different tab for the same card.
  cardEditorView.request = null;
  const set = workshop.adventure;
  if (editor?.target === 'card') {
    const card = findCard(set, editor.id);
    if (card) {
      const copy = editor.tab === 'copies' && card.type === 'action'
        ? Math.min(editor.copy ?? 1, physicalCopyCount(card)) : 0;
      workshop.selectCard(card.id, copy);
      cardEditorView.tab = editor.tab === 'design' ? 'design' : 'content';
      return;
    }
  } else if (editor?.target === 'character' && findCharacter(set, editor.id)) {
    workshop.selectCharacter(editor.id, editor.tab);
    return;
  } else if (editor?.target === 'deck' && findDeck(set, editor.id)) {
    workshop.selectDeck(editor.id);
    return;
  }
  workshop.selectSet();
}

async function restoreRoute(route: BrowserRoute, hasPrintSelection: (key: string) => boolean): Promise<boolean> {
  if (route.kind === 'set') {
    if (!navigation.inSet || workshop.adventure.id !== route.setId) {
      if (!workshop.library.some((entry) => entry.id === route.setId)) {
        if (navigation.inSet && !(await workshop.saveNow())) return false;
        navigation.openHome();
        return true;
      }
      if (!(await workshop.openSetPage(route.setId, route.page))) return false;
    }
    if (route.page === 'editor') restoreEditor(route.editor);
    else if (route.page === 'threat' && workshop.isHeroesSet) navigation.go('home');
    else if (route.page === 'print' && route.printKey && !hasPrintSelection(route.printKey)) navigation.go('home');
    else navigation.go(route.page, route.printKey);
    return true;
  }

  if (navigation.inSet && !(await workshop.saveNow())) return false;
  switch (route.kind) {
    case 'home': navigation.openHome(); break;
    case 'welcome': navigation.openWelcome(); break;
    case 'gallery':
      navigation.galleryMode = route.mode;
      navigation.openGallery();
      break;
    case 'author': navigation.openAuthor(route.id); break;
    case 'shared': navigation.openShared(route.slug, route.characterHint); break;
    case 'collection': navigation.openCollection(route.slug, route.workspace); break;
  }
  return true;
}

interface BrowserEntry {
  href: string;
  position: number | null;
}

const POSITION = 'unmatchedLabsPosition';

function browserEntry(): BrowserEntry {
  const position = window.history.state?.[POSITION];
  return { href: window.location.href, position: Number.isSafeInteger(position) ? position : null };
}

export function useBrowserNavigation(hasPrintSelection: (key: string) => boolean) {
  let ready = $state(false);
  let restoring = $state(false);
  let settled: BrowserEntry | null = null;
  let queued: BrowserEntry | null = null;
  let inFlight: BrowserEntry | null = null;
  let rollback: { position: number; rejectedHref: string } | null = null;

  function replaceRoute(position: number): void {
    const url = browserRouteUrl(currentRoute(), new URL(window.location.href));
    history.replaceState({ ...history.state, [POSITION]: position }, '', url);
    settled = browserEntry();
  }

  function pushRoute(route: BrowserRoute): void {
    const current = browserEntry();
    const url = browserRouteUrl(route, new URL(current.href));
    if (url.href !== current.href) {
      history.pushState({ [POSITION]: (current.position ?? settled?.position ?? 0) + 1 }, '', url);
    }
    settled = browserEntry();
  }

  async function apply(route: BrowserRoute): Promise<boolean> {
    try {
      return await restoreRoute(route, hasPrintSelection);
    } catch (error) {
      console.error('[navigation] Could not open the browser location', error);
      return false;
    }
  }

  async function drain(): Promise<void> {
    restoring = true;
    try {
      while (queued) {
        const target: BrowserEntry = queued;
        queued = null;
        inFlight = target;
        const matched = await apply(readBrowserRoute(new URL(target.href)) ?? { kind: 'home' });
        await tick();
        if (queued) {
          if (matched) settled = target;
          continue;
        }

        const previous = settled?.position ?? null;
        if (!matched && previous !== null && target.position !== null && previous !== target.position) {
          // A refused save keeps the draft open and restores its exact history
          // entry. The attempted destination stays available for a later retry.
          rollback = { position: previous, rejectedHref: target.href };
          history.go(previous - target.position);
          return;
        }
        replaceRoute(target.position ?? (previous ?? -1) + 1);
      }
    } finally {
      inFlight = null;
      if (rollback === null) restoring = false;
    }
  }

  function onUrlChange(): void {
    if (!ready) return;
    const target = browserEntry();
    if (rollback) {
      // Hash transitions can report the refused destination once again after
      // popstate has already initiated the return trip.
      if (target.href === rollback.rejectedHref) return;
      const returning = target.position === rollback.position;
      rollback = null;
      restoring = false;
      if (returning) {
        replaceRoute(target.position ?? 0);
        return;
      }
    }
    if (target.href === (queued ?? inFlight ?? settled)?.href) return;
    const hash = new URL(target.href).hash;
    if (hash && !hash.startsWith('#/') && !readBrowserRoute(new URL(target.href))) return;
    queued = target;
    if (!restoring) void drain();
  }

  $effect(() => {
    if (ready && !restoring) pushRoute(currentRoute());
  });

  $effect(() => {
    // A native legacy hash link can fire both events for one location.
    window.addEventListener('hashchange', onUrlChange);
    window.addEventListener('popstate', onUrlChange);
    return () => {
      window.removeEventListener('hashchange', onUrlChange);
      window.removeEventListener('popstate', onUrlChange);
    };
  });

  return {
    get restoring() { return restoring; },
    async start(initial: BrowserRoute | null): Promise<void> {
      if (initial && !(await apply(initial))) navigation.openHome();
      replaceRoute(browserEntry().position ?? 0);
      ready = true;
    }
  };
}
