<script lang="ts">
  /**
   * The application frame.
   *
   * The contextual frame inside an open set. The application-level banner is
   * owned by `App.svelte`; this shell adds the set toolbar, section nav, page,
   * and save status beneath it. The Cards page is the one that opens out into
   * the three-pane workspace.
   */
  import type { Snippet } from 'svelte';

  interface Props {
    titlebar: Snippet;
    /** Section nav. Absent on the library screen. */
    subnav?: Snippet;
    /** The page. Either a full-width tool or the three-pane workspace. */
    page: Snippet;
    statusbar?: Snippet;
  }

  let { titlebar, subnav, page, statusbar }: Props = $props();
</script>

<div class="shell" class:with-subnav={Boolean(subnav)}>
  <header class="titlebar">{@render titlebar()}</header>

  {#if subnav}
    <div class="subnav">{@render subnav()}</div>
  {/if}

  <div class="page">{@render page()}</div>

  {#if statusbar}
    <footer class="statusbar">{@render statusbar()}</footer>
  {/if}
</div>

<style>
  .shell {
    display: grid;
    /* An implicit grid column uses its children's min-content width. At 320px
       the title controls made that column 347px wide even though SetNav owns
       its own horizontal scrolling, so the document itself overflowed. */
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: var(--titlebar-height) minmax(0, 1fr) auto;
    height: 100%;
    min-width: 0;
    background: var(--surface-canvas);
  }

  .shell.with-subnav {
    grid-template-rows: var(--titlebar-height) 38px minmax(0, 1fr) auto;
  }

  .titlebar {
    border-bottom: 1px solid var(--border-subtle);
    background: linear-gradient(180deg, var(--surface-base), var(--surface-sunken));
  }

  .subnav {
    border-bottom: 1px solid var(--border-subtle);
    background: var(--surface-sunken);
    min-width: 0;
  }

  .page {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    container-type: inline-size;
    container-name: home;
  }

  .statusbar {
    height: var(--statusbar-height);
    border-top: 1px solid var(--border-subtle);
    background: var(--surface-sunken);
  }
</style>
