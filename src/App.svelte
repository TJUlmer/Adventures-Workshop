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
  import DraftConflictDialog from '$lib/components/cloud/DraftConflictDialog.svelte';
  import AuthorProfileScreen from '$lib/components/cloud/AuthorProfileScreen.svelte';
  import CollectionScreen from '$lib/components/cloud/CollectionScreen.svelte';
  import GalleryScreen from '$lib/components/cloud/GalleryScreen.svelte';
  import SharedSetScreen from '$lib/components/cloud/SharedSetScreen.svelte';
  import HomeScreen from '$lib/components/library/HomeScreen.svelte';
  import PrintScreen from '$lib/print/PrintScreen.svelte';
  import { auth } from '$lib/cloud/auth.svelte';
  import { createId } from '$lib/core/id';
  import { useBrowserNavigation } from '$lib/state/browser-navigation.svelte';
  import { readBrowserRoute } from '$lib/state/browser-route';
  import PreviewPanel from '$lib/components/preview/PreviewPanel.svelte';
  import SetSidebar from '$lib/components/sidebar/SetSidebar.svelte';
  import FiguresPanel from '$lib/components/tools/FiguresPanel.svelte';
  import MapEditor from '$lib/components/tools/MapEditor.svelte';
  import AnalysisScreen from '$lib/components/tools/AnalysisScreen.svelte';
  import OverviewScreen from '$lib/components/tools/OverviewScreen.svelte';
  import type { AdventureSet } from '$lib/sets/types';
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
   * The browser location is applied after the library is ready, so a draft
   * URL can resolve its set and selection in the same startup pass.
   */
  // Any session from a previous visit, before anything asks whether we have one.
  auth.restore();

  /* And repair it now rather than at first use.
   *
   * `restore` reads a session back from storage without checking the clock, so
   * a tab opened after a long absence shows "signed in" while holding a token
   * the server will refuse. Refreshing here either renews it or drops it, so
   * the account line tells the truth before anyone acts on it. Failures are
   * swallowed on purpose: offline must not sign anyone out, and the sign-in
   * panel is already the right answer to everything else.
   */
  /*
   * A provider redirect, before the restored session and before the deep link.
   *
   * Supabase comes back with the tokens in the URL *fragment* — which never
   * reaches a server, that being the point — so only the page can read them.
   * `captureRedirect` also strips them from the address bar, because an access
   * token sitting in a URL is one shared link away from being someone else's.
   */
  const openAccountAfterSignIn = auth.captureRedirect();

  // Which sign-in buttons to show. Fire and forget: the panel starts with none.
  void auth.loadProviders();

  const initialRoute = readBrowserRoute(new URL(window.location.href));
  const printSelections = new Map<string, AdventureSet>();
  const browserNavigation = useBrowserNavigation((key) => printSelections.has(key));
  let sessionReady = $state(false);

  void (async () => {
    await auth.ensureFresh().catch(() => {});
    await restoreSession(workshop, initialRoute === null);
    await browserNavigation.start(initialRoute);
    sessionReady = true;
  })();
  useAutosave(workshop);

  const currentPage = $derived(navigation.page);
  const printSet = $derived(navigation.view.kind === 'set' && navigation.view.printKey
    ? printSelections.get(navigation.view.printKey) : undefined);

  function openPrint(set: AdventureSet): void {
    // A browser history entry needs the exact selection that was sent to print.
    const key = createId('print');
    printSelections.set(key, set);
    navigation.go('print', key);
  }
</script>

{#if sessionReady}
  <!--
    Gated on `restoreSession` resolving — see the comment beside it above.
    Nothing here reads `navigation.view` correctly until the restore (and,
    where it applies, the deep link it defers to) has actually run.
  -->
  <div class="app-frame" inert={browserNavigation.restoring} aria-busy={browserNavigation.restoring}>
    <header class="global-banner"><GlobalHeader openAccountOnStart={openAccountAfterSignIn} /></header>

    <div class="app-view">
      {#if navigation.view.kind === 'shared'}
        <SharedSetScreen slug={navigation.view.slug} characterHint={navigation.view.characterHint} />
      {:else if navigation.view.kind === 'collection'}
        <!--
          Outside `AppShell`, like a shared set and for the same reason: this
          is very often somebody's first sight of the app, and chrome for a set
          they do not have would answer a question they have not asked. It
          keeps the global banner above it, which every view now does.
        -->
        <CollectionScreen slug={navigation.view.slug} startInWorkspace={navigation.view.workspace} />
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
        <PrintScreen set={printSet ?? workshop.adventure} />
      {:else}
        <AppShell showStatusbar={currentPage !== 'editor'}>
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
                {#snippet status()}
                  <StatusBar />
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
              <OverviewScreen onprint={openPrint} />
            {:else if currentPage === 'analysis'}
              <AnalysisScreen />
            {:else if currentPage === 'contributions'}
              <ContributionsScreen />
            {:else if currentPage === 'settings'}
              <SetSettings />
            {:else}
              <SetHome onprint={openPrint} />
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
  <DraftConflictDialog />
{/if}

<style>
  .app-frame {
    display: grid;
    grid-template-rows:
      calc(var(--global-banner-height, 72px) + env(safe-area-inset-top))
      minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    background: var(--surface-canvas);
  }

  .global-banner {
    min-width: 0;
    padding-block-start: env(safe-area-inset-top);
    padding-inline: env(safe-area-inset-left) env(safe-area-inset-right);
    border-bottom: 1px solid var(--border-subtle);
    background: linear-gradient(180deg, var(--surface-base), var(--surface-sunken));
  }

  .app-view {
    min-width: 0;
    min-height: 0;
    padding-inline: env(safe-area-inset-left) env(safe-area-inset-right);
    padding-block-end: env(safe-area-inset-bottom);
  }

  /* The phone controls already use 44px targets; the former 72px row left
     unused air around them and took nearly a fifth of a short landscape
     viewport before the set workspace began. */
  @media (max-width: 760px) {
    .app-frame {
      --global-banner-height: 56px;
    }
  }

  @media (max-height: 500px) {
    .app-frame {
      --global-banner-height: 48px;
    }
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
      padding: 0;
    }
  }
</style>
