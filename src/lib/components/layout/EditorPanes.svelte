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
  import { workshop } from '$lib/state/workshop.svelte';

  interface Props {
    sidebar: Snippet;
    workspace: Snippet;
    preview: Snippet;
  }

  let { sidebar, workspace, preview }: Props = $props();

  const DEFAULT_PREVIEW_WIDTH = 424;
  const MIN_PREVIEW_WIDTH = 320;
  const MAX_PREVIEW_WIDTH = 900;
  const MIN_WORKSPACE_WIDTH = 360;
  const DIVIDER_WIDTH = 8;
  const STORAGE_KEY = 'unmatched-labs.preview-width';
  const PHONE_MAX_WIDTH = 760;
  const TABLET_MAX_WIDTH = 1180;

  type LayoutMode = 'phone' | 'tablet' | 'desktop';
  type ActivePane = 'contents' | 'edit' | 'preview';

  function modeForWidth(width: number): LayoutMode {
    if (width <= PHONE_MAX_WIDTH) return 'phone';
    if (width <= TABLET_MAX_WIDTH) return 'tablet';
    return 'desktop';
  }

  function initialMode(): LayoutMode {
    return typeof window === 'undefined' ? 'desktop' : modeForWidth(window.innerWidth);
  }

  let panes = $state<HTMLDivElement | null>(null);
  let sidebarPane = $state<HTMLElement | null>(null);
  let workspacePane = $state<HTMLElement | null>(null);
  let layoutMode = $state<LayoutMode>(initialMode());
  // This is view state, not document state. Re-entering Cards deliberately
  // starts on Edit so the current desktop behaviour remains the default.
  let activePane = $state<ActivePane>('edit');
  let previewWidth = $state(DEFAULT_PREVIEW_WIDTH);
  let resizeDrag = $state<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  function maximumPreviewWidth(): number {
    if (!panes || !sidebarPane) return MAX_PREVIEW_WIDTH;
    // Below this breakpoint the resizable desktop preview becomes a selectable
    // surface. Do not shrink a remembered desktop preference merely because
    // the window is temporarily too narrow to show the divider.
    if (panes.clientWidth <= TABLET_MAX_WIDTH) return MAX_PREVIEW_WIDTH;
    return Math.max(
      MIN_PREVIEW_WIDTH,
      Math.min(
        MAX_PREVIEW_WIDTH,
        panes.clientWidth - sidebarPane.clientWidth - MIN_WORKSPACE_WIDTH - DIVIDER_WIDTH
      )
    );
  }

  function clampPreviewWidth(value: number): number {
    return Math.min(maximumPreviewWidth(), Math.max(MIN_PREVIEW_WIDTH, value));
  }

  function rememberPreviewWidth(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(Math.round(previewWidth)));
    } catch {
      // A disabled localStorage only makes this a session preference.
    }
  }

  function setPreviewWidth(value: number, remember = true): void {
    previewWidth = clampPreviewWidth(value);
    if (remember) rememberPreviewWidth();
  }

  function beginResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    resizeDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: previewWidth
    };
    event.preventDefault();
  }

  function resize(event: PointerEvent): void {
    if (!resizeDrag || resizeDrag.pointerId !== event.pointerId) return;
    // The divider is the preview's left edge: moving it left makes the pane wider.
    setPreviewWidth(resizeDrag.startWidth - (event.clientX - resizeDrag.startX), false);
  }

  function finishResize(event: PointerEvent): void {
    if (!resizeDrag || resizeDrag.pointerId !== event.pointerId) return;
    resizeDrag = null;
    rememberPreviewWidth();
  }

  function resizeWithKeyboard(event: KeyboardEvent): void {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === 'ArrowLeft') setPreviewWidth(previewWidth + step);
    else if (event.key === 'ArrowRight') setPreviewWidth(previewWidth - step);
    else if (event.key === 'Home') setPreviewWidth(MIN_PREVIEW_WIDTH);
    else if (event.key === 'End') setPreviewWidth(maximumPreviewWidth());
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
    activePane = pane;
  }

  function recoverFocusAfterResize(): void {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !panes?.contains(focused)) return;
    const hiddenPane = focused.closest<HTMLElement>('[data-workspace-pane]');
    if (!hiddenPane || hiddenPane.getAttribute('aria-hidden') !== 'true') return;
    panes
      .querySelector<HTMLButtonElement>('.pane-switcher [aria-pressed="true"]')
      ?.focus({ preventScroll: true });
  }

  /*
   * A selection made in Contents is an instruction to edit that entity. The
   * store assigns a fresh selection object even when the same row is picked
   * again, so identity is the event signal and no pane state leaks into the
   * document or browser history.
   */
  let observedSelection = workshop.selection;
  $effect(() => {
    const selection = workshop.selection;
    if (selection === observedSelection) return;
    observedSelection = selection;
    if (selection.target === 'set') return;

    activePane = 'edit';
    if (layoutMode !== 'desktop') {
      void tick().then(() => workspacePane?.focus({ preventScroll: true }));
    }
  });

  onMount(() => {
    try {
      const stored = Number(window.localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(stored) && stored > 0) previewWidth = clampPreviewWidth(stored);
    } catch {
      // Keep the default when browser storage is unavailable.
    }

    const observer = new ResizeObserver(() => {
      const nextMode = modeForWidth(panes?.clientWidth ?? window.innerWidth);
      if (nextMode !== layoutMode) {
        layoutMode = nextMode;
        void tick().then(recoverFocusAfterResize);
      }
      previewWidth = clampPreviewWidth(previewWidth);
    });
    if (panes) observer.observe(panes);
    return () => observer.disconnect();
  });
</script>

<div
  class="panes"
  bind:this={panes}
  data-layout={layoutMode}
  style:--preview-width="{previewWidth}px"
>
  <aside
    class="sidebar"
    class:pane-hidden={!paneIsVisible('contents')}
    aria-label="Set contents"
    aria-hidden={paneIsVisible('contents') ? undefined : 'true'}
    inert={!paneIsVisible('contents')}
    data-workspace-pane="contents"
    bind:this={sidebarPane}
  >
    {@render sidebar()}
  </aside>
  <main
    class="workspace"
    class:pane-hidden={!paneIsVisible('edit')}
    aria-label="Editor"
    aria-hidden={paneIsVisible('edit') ? undefined : 'true'}
    inert={!paneIsVisible('edit')}
    data-workspace-pane="edit"
    tabindex="-1"
    bind:this={workspacePane}
  >
    {@render workspace()}
  </main>
  <div
    class="preview-divider"
    class:dragging={resizeDrag !== null}
    role="slider"
    aria-label="Resize card preview"
    aria-orientation="vertical"
    aria-valuemin={MIN_PREVIEW_WIDTH}
    aria-valuemax={Math.round(maximumPreviewWidth())}
    aria-valuenow={Math.round(previewWidth)}
    aria-valuetext="{Math.round(previewWidth)} pixels wide"
    tabindex="0"
    title="Drag to resize the card preview. Double-click to reset."
    onpointerdown={beginResize}
    onpointermove={resize}
    onpointerup={finishResize}
    onpointercancel={finishResize}
    onkeydown={resizeWithKeyboard}
    ondblclick={() => setPreviewWidth(DEFAULT_PREVIEW_WIDTH)}
  ></div>
  <aside
    class="preview"
    class:pane-hidden={!paneIsVisible('preview')}
    aria-label="Card preview"
    aria-hidden={paneIsVisible('preview') ? undefined : 'true'}
    inert={!paneIsVisible('preview')}
    data-workspace-pane="preview"
  >
    {@render preview()}
  </aside>

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
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr) 8px var(--preview-width);
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
    border-right: 1px solid var(--border-subtle);
  }

  .workspace {
    background: var(--surface-canvas);
  }

  .preview {
    background: var(--surface-sunken);
  }

  .preview-divider {
    position: relative;
    z-index: 2;
    cursor: col-resize;
    touch-action: none;
    background: var(--surface-sunken);
  }

  .preview-divider::after {
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

  .preview-divider:hover::after,
  .preview-divider:focus-visible::after,
  .preview-divider.dragging::after {
    width: 3px;
    background: var(--accent);
  }

  .preview-divider:focus-visible {
    outline: none;
  }

  .pane-hidden {
    display: none;
  }

  .pane-switcher {
    display: flex;
    gap: var(--space-1);
    min-width: 0;
    padding: var(--space-1) var(--space-2) max(var(--space-1), env(safe-area-inset-bottom));
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
    grid-template-rows: minmax(0, 1fr) auto;
  }

  .panes[data-layout='tablet'] .sidebar {
    grid-column: 1;
    grid-row: 1 / 3;
  }

  .panes[data-layout='tablet'] .workspace,
  .panes[data-layout='tablet'] .preview {
    grid-column: 2;
    grid-row: 1;
  }

  .panes[data-layout='tablet'] .pane-switcher {
    grid-column: 2;
    grid-row: 2;
  }

  .panes[data-layout='tablet'] .preview-divider,
  .panes[data-layout='phone'] .preview-divider {
    display: none;
  }

  .panes[data-layout='phone'] {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
  }

  .panes[data-layout='phone'] .sidebar,
  .panes[data-layout='phone'] .workspace,
  .panes[data-layout='phone'] .preview {
    grid-column: 1;
    grid-row: 1;
  }

  .panes[data-layout='phone'] .pane-switcher {
    grid-column: 1;
    grid-row: 2;
  }
</style>
