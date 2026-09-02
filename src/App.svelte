<script lang="ts">
  /**
   * Routing.
   *
   * Authoring pages live inside a set; Home and the public browsing views do
   * not. `GlobalHeader` sits above both levels so moving between them no
   * longer replaces the application's identity and primary navigation.
   */
  import SetHome from '$lib/components/home/SetHome.svelte';
  import AppShell from '$lib/components/layout/AppShell.svelte';
  import EditorPanes from '$lib/components/layout/EditorPanes.svelte';
  import GlobalHeader from '$lib/components/layout/GlobalHeader.svelte';
  import SetNav from '$lib/components/layout/SetNav.svelte';
  import StatusBar from '$lib/components/layout/StatusBar.svelte';
  import TitleBar from '$lib/components/layout/TitleBar.svelte';
  import GuideModal from '$lib/components/guides/GuideModal.svelte';
  import ContributionsScreen from '$lib/components/cloud/ContributionsScreen.svelte';
  import AuthorProfileScreen from '$lib/components/cloud/AuthorProfileScreen.svelte';
  import GalleryScreen from '$lib/components/cloud/GalleryScreen.svelte';
  import SharedSetScreen from '$lib/components/cloud/SharedSetScreen.svelte';
  import HomeScreen from '$lib/components/library/HomeScreen.svelte';
  import PrintScreen from '$lib/print/PrintScreen.svelte';
  import { auth } from '$lib/cloud/auth.svelte';
  import { readSharedSlug } from '$lib/state/navigation.svelte';
  import PreviewPanel from '$lib/components/preview/PreviewPanel.svelte';
  import SetSidebar from '$lib/components/sidebar/SetSidebar.svelte';
  import FiguresPanel from '$lib/components/tools/FiguresPanel.svelte';
  import MapEditor from '$lib/components/tools/MapEditor.svelte';
  import OverviewScreen from '$lib/components/tools/OverviewScreen.svelte';
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
    const slug = readSharedSlug();
    if (slug) navigation.openShared(slug);
  };

  $effect(() => {
    /*
     * Back and forward between a share link and the app, and paste-into-bar.
     * Leaving the hash entirely means leaving the shared view too, or Back out
     * of a set would clear the URL and leave the set still on screen.
     */
    const onHashChange = (): void => {
      const slug = readSharedSlug();
      if (slug) navigation.openShared(slug);
      else if (navigation.view.kind === 'shared') navigation.leaveShared();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  });

  const currentPage = $derived(navigation.page);
</script>

{#if sessionReady}
  <!--
    Gated on `restoreSession` resolving — see the comment beside it above.
    Nothing here reads `navigation.view` correctly until the restore (and,
    where it applies, the deep link it defers to) has actually run.
  -->
  <div class="app-frame">
    <header class="global-banner"><GlobalHeader /></header>

    <div class="app-view">
      {#if navigation.view.kind === 'shared'}
        <SharedSetScreen slug={navigation.view.slug} characterHint={navigation.view.characterHint} />
      {:else if navigation.view.kind === 'gallery'}
        <GalleryScreen />
      {:else if navigation.view.kind === 'author'}
        <AuthorProfileScreen id={navigation.view.id} />
      {:else if navigation.view.kind === 'welcome'}
        <HomeScreen welcome />
      {:else if navigation.view.kind === 'home'}
        <HomeScreen />
      {:else if currentPage === 'print'}
        <!-- The banner remains on screen, but `@media print` below removes it
             from paper so it cannot shift a sheet. -->
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
              <OverviewScreen />
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
    </div>
  </div>

  <!--
    Mounted once, outside the view switch, because a guide is an overlay on
    wherever you already are rather than a place of its own — see
    `state/guides.svelte.ts`. It renders nothing at all until something calls
    `guides.open(id)`, so the cost of it being here on every screen is a
    closed `<dialog>` element.
  -->
  <GuideModal />
{/if}

<style>
  .app-frame {
    display: grid;
    grid-template-rows: 72px minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    background: var(--surface-canvas);
  }

  .global-banner {
    min-width: 0;
    border-bottom: 1px solid var(--border-subtle);
    background: linear-gradient(180deg, var(--surface-base), var(--surface-sunken));
  }

  .app-view {
    min-width: 0;
    min-height: 0;
  }

  @media print {
    .app-frame {
      display: block;
      height: auto;
    }

    .global-banner {
      display: none;
    }

    .app-view {
      height: auto;
    }
  }
</style>
