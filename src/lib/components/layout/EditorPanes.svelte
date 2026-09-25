<script lang="ts">
  /**
   * The card and character workspace: hierarchy on the left, the editor in the
   * middle, the live card on the right.
   *
   * This used to be the whole application; it is now one page of a set. The
   * three-pane arrangement is exactly what it was, because for the work it does
   * — picking a card, editing it, watching it change — it was right.
   */
  import { onMount, type Snippet } from 'svelte';

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

  let panes = $state<HTMLDivElement | null>(null);
  let sidebarPane = $state<HTMLElement | null>(null);
  let previewWidth = $state(DEFAULT_PREVIEW_WIDTH);
  let resizeDrag = $state<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  function maximumPreviewWidth(): number {
    if (!panes || !sidebarPane) return MAX_PREVIEW_WIDTH;
    // Below this breakpoint CSS hides the preview entirely. Do not shrink a
    // remembered desktop preference merely because the window is temporarily
    // narrow enough that the pane is not on screen.
    if (panes.clientWidth <= 1180) return MAX_PREVIEW_WIDTH;
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

  onMount(() => {
    try {
      const stored = Number(window.localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(stored) && stored > 0) previewWidth = clampPreviewWidth(stored);
    } catch {
      // Keep the default when browser storage is unavailable.
    }

    const observer = new ResizeObserver(() => {
      previewWidth = clampPreviewWidth(previewWidth);
    });
    if (panes) observer.observe(panes);
    return () => observer.disconnect();
  });
</script>

<div class="panes" bind:this={panes} style:--preview-width="{previewWidth}px">
  <aside class="sidebar" aria-label="Set contents" bind:this={sidebarPane}>{@render sidebar()}</aside>
  <main class="workspace" aria-label="Editor">{@render workspace()}</main>
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
  <aside class="preview" aria-label="Card preview">{@render preview()}</aside>
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

  /* Below this width the preview pane stops earning its keep. */
  @media (max-width: 1180px) {
    .panes {
      grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
    }

    .preview-divider,
    .preview {
      display: none;
    }
  }
</style>
