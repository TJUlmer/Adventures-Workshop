<script lang="ts">
  /**
   * The card and character workspace: hierarchy on the left, the editor in the
   * middle, the live card on the right.
   *
   * This used to be the whole application; it is now one page of a set. The
   * three-pane arrangement is exactly what it was, because for the work it does
   * — picking a card, editing it, watching it change — it was right.
  */
  import { onMount, tick, type Snippet } from 'svelte';
  import { startPointerSession, type PointerSession } from '$lib/interaction/pointer-session';
  import { artworkAdjustmentView } from '$lib/state/artwork-adjustment-view.svelte';
  import { cardEditorView } from '$lib/state/card-editor-view.svelte';
  import { workshop } from '$lib/state/workshop.svelte';

  interface Props {
    sidebar: Snippet;
    workspace: Snippet;
    preview: Snippet<[visible: boolean]>;
    status?: Snippet;
  }

  let { sidebar, workspace, preview, status }: Props = $props();

  const paneSizes = {
    contents: { defaultWidth: 272, min: 220, max: 540, storageKey: 'unmatched-labs.contents-width' },
    preview: { defaultWidth: 424, min: 320, max: 900, storageKey: 'unmatched-labs.preview-width' }
  };
  const MIN_WORKSPACE_WIDTH = 360;
  const DIVIDER_WIDTH = 8;
  const PHONE_MAX_WIDTH = 760;
  const TABLET_MAX_WIDTH = 1180;

  type LayoutMode = 'phone' | 'tablet' | 'desktop';
  type ActivePane = 'contents' | 'edit' | 'preview';
  type ResizablePane = keyof typeof paneSizes;

  function modeForWidth(width: number): LayoutMode {
    if (width <= PHONE_MAX_WIDTH) return 'phone';
    if (width <= TABLET_MAX_WIDTH) return 'tablet';
    return 'desktop';
  }

  let panes = $state<HTMLDivElement | null>(null);
  let sidebarPane = $state<HTMLElement | null>(null);
  let workspacePane = $state<HTMLElement | null>(null);
  let layoutWidth = $state(typeof window === 'undefined' ? Infinity : window.innerWidth);
  let layoutMode = $derived(modeForWidth(layoutWidth));
  // This is view state, not document state. Re-entering Cards deliberately
  // starts on Edit so the current desktop behaviour remains the default.
  let activePane = $state<ActivePane>('edit');
  const preferredWidths = {
    contents: paneSizes.contents.defaultWidth,
    preview: paneSizes.preview.defaultWidth
  };
  const widths = $state({ ...preferredWidths });
  let resizeSession = $state.raw<{ pane: ResizablePane; pointer: PointerSession } | null>(null);

  function maximumWidth(
    pane: ResizablePane,
    otherWidth = widths[pane === 'contents' ? 'preview' : 'contents']
  ): number {
    const { min, max } = paneSizes[pane];
    const available = layoutWidth - otherWidth - MIN_WORKSPACE_WIDTH - 2 * DIVIDER_WIDTH;
    return Math.max(min, Math.min(max, available));
  }

  function clampWidth(pane: ResizablePane, value: number, otherWidth?: number): number {
    return Math.min(maximumWidth(pane, otherWidth), Math.max(paneSizes[pane].min, value));
  }

  function setPaneWidth(pane: ResizablePane, value: number, remember = true): void {
    widths[pane] = clampWidth(pane, value);
    if (remember) rememberWidth(pane);
  }

  function rememberWidth(pane: ResizablePane): void {
    const width = Math.round(widths[pane]);
    preferredWidths[pane] = width;
    try {
      window.localStorage.setItem(paneSizes[pane].storageKey, String(width));
    } catch {
      // A disabled localStorage only makes this a session preference.
    }
  }

  function beginResize(pane: ResizablePane, event: PointerEvent): void {
    resizeSession?.pointer.cancel('superseded');
    const direction = pane === 'contents' ? 1 : -1;
    // Keep the last clamped view width even if the drag is interrupted.
    const finish = (): void => {
      resizeSession = null;
      rememberWidth(pane);
    };
    const pointer = startPointerSession(event, {
      snapshot: { width: widths[pane] },
      onMove: (movement, _event, snapshot) => {
        setPaneWidth(pane, snapshot.width + direction * movement.deltaX, false);
      },
      onCommit: finish,
      onCancel: (_reason, movement) => {
        if (movement.activated) finish();
        else resizeSession = null;
      },
      onTap: () => {
        resizeSession = null;
      }
    });
    if (pointer) resizeSession = { pane, pointer };
  }

  function resizeWithKeyboard(pane: ResizablePane, event: KeyboardEvent): void {
    const step = event.shiftKey ? 48 : 16;
    const direction = pane === 'contents' ? 1 : -1;
    if (event.key === 'ArrowLeft') setPaneWidth(pane, widths[pane] - direction * step);
    else if (event.key === 'ArrowRight') setPaneWidth(pane, widths[pane] + direction * step);
    else if (event.key === 'Home') setPaneWidth(pane, paneSizes[pane].min);
    else if (event.key === 'End') setPaneWidth(pane, maximumWidth(pane));
    else return;
    event.preventDefault();
  }

  function paneIsVisible(pane: ActivePane): boolean {
    if (layoutMode === 'desktop') return true;
    if (layoutMode === 'tablet') {
      if (pane === 'contents') return true;
      return pane === (activePane === 'preview' ? 'preview' : 'edit');
    }
    return pane === activePane;
  }

  function choosePane(pane: ActivePane): void {
    if (pane !== activePane) artworkAdjustmentView.end();
    activePane = pane;
  }

  function openDraftForContentsAction(event: Event): void {
    if (cardEditorView.publishedRevision && event.target instanceof Element &&
        event.target.closest('button, select, [draggable="true"]')) {
      cardEditorView.publishedRevision = null;
    }
  }

  function recoverFocusAfterResize(dividerWasFocused = false): void {
    const focused = document.activeElement;
    if (dividerWasFocused && layoutMode !== 'desktop') {
      panes
        ?.querySelector<HTMLButtonElement>('.pane-switcher [aria-pressed="true"]')
        ?.focus({ preventScroll: true });
      return;
    }
    if (!(focused instanceof HTMLElement) || !panes?.contains(focused)) return;
    const hiddenPane = focused.closest<HTMLElement>('[data-workspace-pane]');
    if (!hiddenPane || hiddenPane.getAttribute('aria-hidden') !== 'true') return;
    panes
      .querySelector<HTMLButtonElement>('.pane-switcher [aria-pressed="true"]')
      ?.focus({ preventScroll: true });
  }

  /*
   * A selection made in Contents, or through the set-details control, is an
   * instruction to reveal Edit. The store assigns a fresh selection object
   * even when the same subject is picked again, so identity is the event
   * signal and no pane state leaks into the document or browser history.
   */
  let observedSelection = workshop.selection;
  let observedTargetRevision = 0;
  $effect(() => {
    const selection = workshop.selection;
    if (selection === observedSelection) return;
    observedSelection = selection;
    const cameFromContents =
      activePane === 'contents' || Boolean(sidebarPane?.contains(document.activeElement));
    const shouldFocusEditor = selection.target === 'set' || cameFromContents;
    cardEditorView.publishedRevision = null;
    artworkAdjustmentView.end();
    activePane = 'edit';
    if (layoutMode !== 'desktop' && shouldFocusEditor) {
      void tick().then(() => workspacePane?.focus({ preventScroll: true }));
    }
  });

  /* A preview fallback must reveal Edit before `CardEditor` focuses its target. */
  $effect(() => {
    const request = cardEditorView.request;
    if (!request || request.revision === observedTargetRevision) return;
    if (request.address.cardId !== workshop.selectedCard?.id) return;
    observedTargetRevision = request.revision;
    cardEditorView.publishedRevision = null;
    artworkAdjustmentView.end();
    activePane = 'edit';
  });

  onMount(() => {
    try {
      for (const pane of ['contents', 'preview'] as const) {
        const stored = Number(window.localStorage.getItem(paneSizes[pane].storageKey));
        if (Number.isFinite(stored) && stored > 0) preferredWidths[pane] = stored;
      }
    } catch {
      // Keep the default when browser storage is unavailable.
    }

    function syncLayout(): void {
      const nextWidth = panes?.clientWidth ?? window.innerWidth;
      const nextMode = modeForWidth(nextWidth);
      if (nextMode !== layoutMode) {
        const focused = document.activeElement;
        const dividerWasFocused =
          panes?.contains(focused) === true && focused?.classList.contains('pane-divider') === true;
        if (cardEditorView.publishedRevision) activePane = 'preview';
        artworkAdjustmentView.end();
        void tick().then(() => recoverFocusAfterResize(dividerWasFocused));
      }
      layoutWidth = nextWidth;
      if (nextMode !== 'desktop') return;
      // Keep the Contents width where possible so the tree stays readable.
      // A tighter viewport may temporarily constrain either saved width.
      widths.contents = clampWidth('contents', preferredWidths.contents, paneSizes.preview.min);
      widths.preview = clampWidth('preview', preferredWidths.preview);
    }

    syncLayout();
    const observer = new ResizeObserver(() => {
      if (panes?.clientWidth === layoutWidth) return;
      resizeSession?.pointer.cancel('viewport-change');
      syncLayout();
    });
    if (panes) observer.observe(panes);
    return () => {
      resizeSession?.pointer.dispose();
      observer.disconnect();
    };
  });
</script>

{#snippet divider(pane: ResizablePane, label: string)}
  <div
    class="pane-divider"
    class:dragging={resizeSession?.pane === pane}
    role="slider"
    aria-label="Resize {label}"
    aria-orientation="vertical"
    aria-valuemin={paneSizes[pane].min}
    aria-valuemax={Math.round(maximumWidth(pane))}
    aria-valuenow={Math.round(widths[pane])}
    aria-valuetext="{Math.round(widths[pane])} pixels wide"
    tabindex="0"
    title="Drag to resize the {label}. Double-click to reset."
    onpointerdown={(event) => beginResize(pane, event)}
    onkeydown={(event) => resizeWithKeyboard(pane, event)}
    ondblclick={() => setPaneWidth(pane, paneSizes[pane].defaultWidth)}
  ></div>
{/snippet}

<div
  class="panes"
  bind:this={panes}
  data-layout={layoutMode}
  style:--contents-width="{widths.contents}px"
  style:--preview-width="{widths.preview}px"
  style:--pane-divider-width="{DIVIDER_WIDTH}px"
>
  <aside
    class="sidebar"
    class:pane-hidden={!paneIsVisible('contents')}
    aria-label="Set contents"
    aria-hidden={paneIsVisible('contents') ? undefined : 'true'}
    inert={!paneIsVisible('contents')}
    data-workspace-pane="contents"
    bind:this={sidebarPane}
    onclickcapture={openDraftForContentsAction}
    onchangecapture={openDraftForContentsAction}
    ondragstartcapture={openDraftForContentsAction}
  >
    {@render sidebar()}
  </aside>
  {@render divider('contents', 'Contents pane')}
  <main
    class="workspace"
    class:pane-hidden={!paneIsVisible('edit')}
    class:editor-paused={cardEditorView.publishedRevision !== null}
    aria-label="Editor"
    aria-hidden={paneIsVisible('edit') ? undefined : 'true'}
    inert={!paneIsVisible('edit') || cardEditorView.publishedRevision !== null}
    data-workspace-pane="edit"
    tabindex="-1"
    bind:this={workspacePane}
  >
    {@render workspace()}
  </main>
  {@render divider('preview', 'card preview')}
  <aside
    class="preview"
    class:pane-hidden={!paneIsVisible('preview')}
    aria-label="Card preview"
    aria-hidden={paneIsVisible('preview') ? undefined : 'true'}
    inert={!paneIsVisible('preview')}
    data-workspace-pane="preview"
  >
    {@render preview(paneIsVisible('preview'))}
  </aside>

  {#if status}
    <footer class="pane-status">{@render status()}</footer>
  {/if}

  {#if layoutMode !== 'desktop'}
    <nav class="pane-switcher" aria-label="Cards workspace views">
      {#if layoutMode === 'phone'}
        <button
          type="button"
          aria-pressed={activePane === 'contents'}
          onclick={() => choosePane('contents')}
        >Contents</button>
      {/if}
      <button
        type="button"
        aria-pressed={layoutMode === 'tablet' ? activePane !== 'preview' : activePane === 'edit'}
        onclick={() => choosePane('edit')}
      >Edit</button>
      <button
        type="button"
        aria-pressed={activePane === 'preview'}
        onclick={() => choosePane('preview')}
      >Preview</button>
    </nav>
  {/if}
</div>

<style>
  .panes {
    display: grid;
    grid-template-columns:
      var(--contents-width) var(--pane-divider-width) minmax(0, 1fr)
      var(--pane-divider-width) var(--preview-width);
    grid-template-rows: minmax(0, 1fr) auto;
    flex: 1 1 auto;
    min-height: 0;
  }

  .sidebar,
  .preview,
  .workspace {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .sidebar {
    background: var(--surface-sunken);
  }

  .panes:not([data-layout='desktop']) .sidebar {
    border-right: 1px solid var(--border-subtle);
  }

  .workspace {
    background: var(--surface-canvas);
    --workspace-inline-padding: var(--space-7);
  }

  .editor-paused {
    opacity: 0.65;
  }

  .preview {
    background: var(--surface-sunken);
  }

  .pane-divider {
    position: relative;
    z-index: 2;
    cursor: col-resize;
    touch-action: none;
    background: var(--surface-sunken);
  }

  .pane-divider::after {
    content: '';
    position: absolute;
    inset-block: 0;
    left: 50%;
    width: 1px;
    background: var(--border-subtle);
    translate: -50% 0;
    transition:
      width var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out);
  }

  .pane-divider:hover::after,
  .pane-divider:focus-visible::after,
  .pane-divider.dragging::after {
    width: 3px;
    background: var(--accent);
  }

  .pane-divider:focus-visible {
    outline: none;
  }

  .pane-hidden {
    /* Keep an inactive renderer at its real pane dimensions. Some printable
       faces fit author-length text synchronously and do not re-measure merely
       because a hidden pane became visible; `display: none` mounted them at
       zero width and could therefore leave the first mobile preview stale. */
    visibility: hidden;
    pointer-events: none;
  }

  .pane-status {
    grid-column: 1 / -1;
    grid-row: 2;
    height: var(--statusbar-height);
    border-top: 1px solid var(--border-subtle);
    background: var(--surface-sunken);
  }

  .pane-switcher {
    display: flex;
    gap: var(--space-1);
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    border-top: 1px solid var(--border-subtle);
    background: var(--surface-sunken);
  }

  .pane-switcher button {
    flex: 1 1 0;
    min-width: 0;
    min-height: 44px;
    padding-inline: var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text-tertiary);
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .pane-switcher button:hover {
    background: var(--surface-hover);
    color: var(--text-secondary);
  }

  .pane-switcher button[aria-pressed='true'] {
    background: var(--surface-raised);
    color: var(--text-primary);
    box-shadow: inset 0 0 0 1px var(--border-default), var(--shadow-xs);
  }

  .panes[data-layout='tablet'] {
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto auto;
  }

  .panes[data-layout='tablet'] .sidebar {
    grid-column: 1;
    grid-row: 1 / 4;
  }

  .panes[data-layout='tablet'] .workspace,
  .panes[data-layout='tablet'] .preview {
    grid-column: 2;
    grid-row: 1;
  }

  .panes[data-layout='tablet'] .workspace {
    --workspace-inline-padding: var(--space-5);
  }

  .panes[data-layout='tablet'] .pane-switcher {
    grid-column: 2;
    grid-row: 3;
  }

  .panes[data-layout='tablet'] .pane-status {
    grid-column: 2;
    grid-row: 2;
    height: var(--statusbar-height);
    padding-block-end: 0;
  }

  .panes:not([data-layout='desktop']) .pane-divider {
    display: none;
  }

  .panes[data-layout='phone'] {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto auto;
  }

  .panes[data-layout='phone'] .sidebar,
  .panes[data-layout='phone'] .workspace,
  .panes[data-layout='phone'] .preview {
    grid-column: 1;
    grid-row: 1;
  }

  .panes[data-layout='phone'] .pane-switcher {
    grid-column: 1;
    grid-row: 3;
  }

  .panes[data-layout='phone'] .pane-status {
    grid-column: 1;
    grid-row: 2;
    height: var(--statusbar-height);
    padding-block-end: 0;
  }

  .panes[data-layout='phone'] .workspace {
    --workspace-inline-padding: var(--space-4);
    /* The editor header and tabs used to sit outside the only scroller. On a
       short phone they could leave less than one control's height for the
       form, so the whole pane owns vertical scrolling in phone mode. */
    overflow-y: auto;
    overscroll-behavior-y: contain;
  }

  @media (max-height: 500px) {
    .workspace {
      /* A rotated phone enters tablet mode by width, but it needs the same
         full-pane scroll owner as portrait to keep the form usable. */
      overflow-y: auto;
      overscroll-behavior-y: contain;
    }
  }
</style>
