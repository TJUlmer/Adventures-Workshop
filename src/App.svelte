<script lang="ts">
  /**
   * Routing.
   *
   * Everything lives inside a set: Home is the only screen outside one, and
   * every other page assumes a set is open. That assumption is what lets the
   * rest of the app read `workshop.adventure` without guarding it.
   */
  import SetHome from '$lib/components/home/SetHome.svelte';
  import AppShell from '$lib/components/layout/AppShell.svelte';
  import EditorPanes from '$lib/components/layout/EditorPanes.svelte';
  import SetNav from '$lib/components/layout/SetNav.svelte';
  import StatusBar from '$lib/components/layout/StatusBar.svelte';
  import TitleBar from '$lib/components/layout/TitleBar.svelte';
  import GuideModal from '$lib/components/guides/GuideModal.svelte';
  import ContributionsScreen from '$lib/components/cloud/ContributionsScreen.svelte';
  import AuthorProfileScreen from '$lib/components/cloud/AuthorProfileScreen.svelte';
  import CollectionScreen from '$lib/components/cloud/CollectionScreen.svelte';
  import GalleryScreen from '$lib/components/cloud/GalleryScreen.svelte';
  import SharedSetScreen from '$lib/components/cloud/SharedSetScreen.svelte';
  import HomeScreen from '$lib/components/library/HomeScreen.svelte';
  import PrintScreen from '$lib/print/PrintScreen.svelte';
  import { auth } from '$lib/cloud/auth.svelte';
  import { readCollectionSlug, readSharedSlug } from '$lib/state/navigation.svelte';
  import PreviewPanel from '$lib/components/preview/PreviewPanel.svelte';
  import SetSidebar from '$lib/components/sidebar/SetSidebar.svelte';
  import AssetsOverview from '$lib/components/tools/AssetsOverview.svelte';
  import FiguresPanel from '$lib/components/tools/FiguresPanel.svelte';
  import MapEditor from '$lib/components/tools/MapEditor.svelte';
  import SetSettings from '$lib/components/tools/SetSettings.svelte';
  import SymbolsPanel from '$lib/components/tools/SymbolsPanel.svelte';
  import ThreatTracker from '$lib/components/tools/ThreatTracker.svelte';
  import Workspace from '$lib/components/workspace/Workspace.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { restoreSession, useAutosave } from '$lib/state/persistence.svelte';
  import { workshop } from '$lib/state/workshop.svelte';

  /*
   * Local-first: the last session is picked back up before the first paint,
   * and every edit from here on is written back on a debounce.
   *
   * `restoreSession` is async now that it reads IndexedDB, where this used to
   * resolve before Svelte ever rendered. `navigation.view` defaults to Home,
   * so rendering the routes below unconditionally while this is still in
   * flight would show Home and then jump to whatever set was actually open —
   * `sessionReady` gates the first paint on it instead.
   *
   * `openDeepLink` (below) now has to run inside this `.then` rather than
   * straight after, for the same reason: it used to follow a *synchronous*
   * `restoreSession` and so was guaranteed to run after it. Calling it
   * unconditionally here would race the restore instead, and could have the
   * restored "last open" set clobber the very share link it is meant to lose
   * to.
   */
  let sessionReady = $state(false);
  void restoreSession(workshop).then(() => {
    openDeepLink();
    sessionReady = true;
  });
  useAutosave(workshop);

  // Any session from a previous visit, before anything asks whether we have one.
  auth.restore();

  /*
   * And repair it now rather than at first use.
   *
   * `restore` reads a session back from storage without checking the clock, so
   * a tab opened after a long absence shows "signed in" while holding a token
   * the server will refuse. Refreshing here either renews it or drops it, so
   * the account line tells the truth before anyone acts on it. Failures are
   * swallowed on purpose: offline must not sign anyone out, and the sign-in
   * panel is already the right answer to everything else.
   */
  void auth.ensureFresh().catch(() => {});

  /*
   * A provider redirect, before the restored session and before the deep link.
   *
   * Supabase comes back with the tokens in the URL *fragment* — which never
   * reaches a server, that being the point — so only the page can read them.
   * `captureRedirect` also strips them from the address bar, because an access
   * token sitting in a URL is one shared link away from being someone else's.
   */
  auth.captureRedirect();

  // Which sign-in buttons to show. Fire and forget: the panel starts with none.
  void auth.loadProviders();

  /*
   * A share link wins over the restored session.
   *
   * Someone arriving on `#/shared/…` clicked a link to see a *particular* set,
   * and `restoreSession` has just reopened whatever they were last editing. The
   * link is the more recent intent, so it is applied after — from inside
   * `restoreSession`'s `.then`, above, rather than here.
   */
  const openDeepLink = (): void => {
    /* A collection link is checked first only because the two patterns cannot
       both match one URL — either order works, and this one reads in the
       order the paths were added. */
    const collection = readCollectionSlug();
    if (collection) {
      navigation.openCollection(collection);
      return;
    }
    const slug = readSharedSlug();
    if (slug) navigation.openShared(slug);
  };

  /**
   * Put the view back in step with whatever the address bar now says.
   *
   * Shared by the two listeners below because they are the same question
   * asked after two different events, and answering it twice is how they
   * would drift.
   */
  const syncFromUrl = (): void => {
    const collection = readCollectionSlug();
    if (collection) {
      navigation.openCollection(collection);
      return;
    }
    const slug = readSharedSlug();
    if (slug) {
      navigation.openShared(slug);
      return;
    }
    // The URL no longer names either, so neither view may stay on screen.
    if (navigation.view.kind === 'shared') navigation.leaveShared();
    else if (navigation.view.kind === 'collection') navigation.leaveCollection();
  };

  $effect(() => {
    /*
     * Back and forward, and paste-into-bar.
     *
     * **Two events, not one.** `hashchange` covers the hash forms and an
     * in-app `#/shared/…` link; it does *not* fire for the two real paths,
     * which move through `pushState` and come back through `popstate`. Until
     * this listener existed, Back out of a shared set restored the URL to `/`
     * and left the set itself on screen — a pre-existing gap, invisible while
     * `/shared/` was the only real path and nobody had reason to test Back on
     * it, and confirmed here by driving the shared route rather than assumed
     * from reading. Adding the collection route is what made it worth fixing:
     * one broken Back is a curiosity, two is the routing being wrong.
     */
    window.addEventListener('hashchange', syncFromUrl);
    window.addEventListener('popstate', syncFromUrl);
    return () => {
      window.removeEventListener('hashchange', syncFromUrl);
      window.removeEventListener('popstate', syncFromUrl);
    };
  });

  const currentPage = $derived(navigation.page);
</script>

{#if sessionReady}
  <!--
    Gated on `restoreSession` resolving — see the comment beside it above.
    Nothing here reads `navigation.view` correctly until the restore (and,
    where it applies, the deep link it defers to) has actually run.
  -->
  {#if navigation.view.kind === 'shared'}
    <!--
      Outside the shell: this is very often someone's first sight of the app, and
      they have not entered a workshop yet. Chrome for a set they do not have
      would be answering a question they have not asked.
    -->
    <SharedSetScreen slug={navigation.view.slug} characterHint={navigation.view.characterHint} />
  {:else if navigation.view.kind === 'collection'}
    <!-- Outside the shell, for the same reason a shared set is. -->
    <CollectionScreen slug={navigation.view.slug} />
  {:else if navigation.view.kind === 'gallery'}
    <GalleryScreen />
  {:else if navigation.view.kind === 'author'}
    <AuthorProfileScreen id={navigation.view.id} />
  {:else if navigation.view.kind === 'home'}
    <HomeScreen />
  {:else if currentPage === 'print'}
    <!--
      Outside the shell on purpose: printing is the one thing the app does where
      the chrome is not merely irrelevant but harmful, because anything laid out
      around the sheet can move it. See `PrintScreen`.
    -->
    <PrintScreen />
  {:else}
    <AppShell>
      {#snippet titlebar()}
        <TitleBar />
      {/snippet}

      {#snippet subnav()}
        <SetNav />
      {/snippet}

      {#snippet page()}
        {#if currentPage === 'editor'}
          <EditorPanes>
            {#snippet sidebar()}
              <SetSidebar />
            {/snippet}
            {#snippet workspace()}
              <Workspace />
            {/snippet}
            {#snippet preview()}
              <PreviewPanel />
            {/snippet}
          </EditorPanes>
        {:else if currentPage === 'threat'}
          <ThreatTracker />
        {:else if currentPage === 'map'}
          <MapEditor />
        {:else if currentPage === 'figures'}
          <FiguresPanel />
        {:else if currentPage === 'symbols'}
          <SymbolsPanel />
        {:else if currentPage === 'assets'}
          <AssetsOverview />
        {:else if currentPage === 'contributions'}
          <ContributionsScreen />
        {:else if currentPage === 'settings'}
          <SetSettings />
        {:else}
          <SetHome />
        {/if}
      {/snippet}

      {#snippet statusbar()}
        <StatusBar />
      {/snippet}
    </AppShell>
  {/if}

  <!--
    Mounted once, outside the view switch, because a guide is an overlay on
    wherever you already are rather than a place of its own — see
    `state/guides.svelte.ts`. It renders nothing at all until something calls
    `guides.open(id)`, so the cost of it being here on every screen is a
    closed `<dialog>` element.
  -->
  <GuideModal />
{/if}
