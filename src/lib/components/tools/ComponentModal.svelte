<script lang="ts">
  /** Full-size inspection for a physical component, with 3D when available. */
  import { hasArtwork } from '$lib/core/artwork';
  import type { Figure } from '$lib/figures/types';
  import { figureLabel, FIGURE_KIND_LABELS } from '$lib/figures/types';
  import type { Mesh } from '$lib/models/mesh';
  import { Icon } from '$lib/ui';
  import type { FigurePreviewModel } from './figure-preview';
  import { figurePreviewKey, loadFigurePreview, releaseFigurePreview } from './figure-preview';
  import ModelViewer from './ModelViewer.svelte';

  interface Props {
    open: boolean;
    figure: Figure | null;
    ownerName?: string | null;
    onclose: () => void;
  }

  let { open, figure, ownerName = null, onclose }: Props = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let closeButton = $state<HTMLButtonElement | null>(null);
  let viewerShell = $state<HTMLDivElement | null>(null);
  let mesh = $state<Mesh | null>(null);
  let texture = $state<string | null>(null);
  let loading = $state(false);
  let failure = $state<string | null>(null);
  let warning = $state<string | null>(null);
  let viewerFailure = $state<string | null>(null);

  const label = $derived(figure ? figureLabel(figure, ownerName) : 'Component');
  const artwork = $derived(
    figure && hasArtwork(figure.reference) ? figure.reference.source : null
  );

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  $effect(() => {
    const current = figure;
    const visible = open;
    let cancelled = false;
    let preview: FigurePreviewModel | null = null;
    mesh = null;
    texture = null;
    failure = null;
    warning = null;
    viewerFailure = null;
    loading = false;
    if (!visible || !current) return;

    try {
      if (!figurePreviewKey(current)) return;
    } catch (error) {
      failure = message(error);
      return;
    }

    loading = true;
    void loadFigurePreview(current)
      .then((result) => {
        preview = result;
        if (cancelled) {
          releaseFigurePreview(preview);
          preview = null;
          return;
        }
        if (!preview) return;
        mesh = preview.mesh;
        texture = preview.texture;
        warning = preview.warning;
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        failure = message(error);
        console.error(`[overview] A 3D inspection of ${label} failed:`, error);
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });

    return () => {
      cancelled = true;
      releaseFigurePreview(preview);
    };
  });

  function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function onbackdrop(event: MouseEvent): void {
    if (event.target === dialog) onclose();
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onclose();
  }

  function onViewerFailure(message: string | null): void {
    viewerFailure = message;
    if (message && viewerShell?.contains(document.activeElement)) closeButton?.focus();
  }
</script>

<dialog
  bind:this={dialog}
  class="component-modal"
  aria-labelledby="component-modal-title"
  onclose={onclose}
  onclick={onbackdrop}
  {onkeydown}
>
  {#if figure}
    <div class="inner">
      <header class="head">
        <div class="heading">
          <span class="kicker">Physical component</span>
          <h2 id="component-modal-title">{label}</h2>
          <span class="meta">
            {FIGURE_KIND_LABELS[figure.kind]}
            {#if figure.quantity > 1}<span class="numeric">×{figure.quantity}</span>{/if}
          </span>
        </div>
        <button
          bind:this={closeButton}
          type="button"
          class="close"
          aria-label="Close component viewer"
          onclick={onclose}
        >
          <Icon name="plus" size={18} />
        </button>
      </header>

      <div class="body">
        {#if loading}
          <div class="loading" aria-live="polite">
            <span class="spinner"></span>
            <span>Building 3D preview…</span>
          </div>
        {:else if mesh}
          <div class="model-stage">
            <div
              bind:this={viewerShell}
              class="viewer-shell"
              inert={Boolean(viewerFailure)}
              aria-hidden={viewerFailure ? 'true' : undefined}
            >
              {#key figure.id}
                <ModelViewer
                  {mesh}
                  {texture}
                  height="min(62dvh, 620px)"
                  onfailure={onViewerFailure}
                />
              {/key}
            </div>
            {#if viewerFailure && artwork}
              <div class="artwork viewer-fallback">
                <img src={artwork} alt="{label} reference" />
              </div>
            {/if}
          </div>
        {:else if artwork}
          <div class="artwork">
            <img src={artwork} alt="{label} reference" />
          </div>
        {:else}
          <div class="empty">
            <Icon name="image" size={28} />
            <strong>No preview is available</strong>
            <span>This component has no reference artwork or viewable STL/OBJ model.</span>
          </div>
        {/if}

        {#if viewerFailure}
          <p class="notice" role="status">
            The interactive view could not be drawn. {artwork ? 'Showing the reference artwork instead.' : viewerFailure}
          </p>
        {:else if warning}
          <p class="notice" role="status">
            The 3D shape is available, but its texture could not be drawn. Showing the untextured model.
          </p>
        {:else if failure}
          <p class="notice" role="status">
            The 3D preview could not be opened. {artwork ? 'Showing the reference artwork instead.' : failure}
          </p>
        {/if}

        {#if figure.notes.trim()}
          <p class="notes">{figure.notes}</p>
        {/if}
      </div>

      <footer class="foot">
        <span>{mesh && !viewerFailure ? 'Drag to rotate · use −/+ or scroll to zoom' : 'Reference view'}</span>
        <button type="button" onclick={onclose}>Done</button>
      </footer>
    </div>
  {/if}
</dialog>

<style>
  .component-modal {
    width: min(920px, calc(100vw - var(--space-6) * 2));
    max-width: none;
    max-height: calc(100dvh - var(--space-6) * 2);
    padding: 0;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--surface-raised);
    color: var(--text-default);
    box-shadow: var(--shadow-lg);
  }

  .component-modal::backdrop {
    background: color-mix(in oklab, var(--grey-1000) 72%, transparent);
    backdrop-filter: blur(3px);
  }

  .inner {
    display: flex;
    flex-direction: column;
    max-height: calc(100dvh - var(--space-6) * 2);
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
  }

  .heading {
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr) auto;
    align-items: baseline;
    gap: var(--space-3);
  }

  .kicker,
  .meta,
  .foot,
  .notice {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .kicker {
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
  }

  h2 {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-family: var(--font-display);
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    display: flex;
    gap: var(--space-2);
  }

  .close {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
  }

  .close :global(svg) {
    rotate: 45deg;
  }

  .close:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .body {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    overflow-y: auto;
    background: var(--surface-sunken);
  }

  .loading,
  .empty,
  .artwork {
    min-height: min(62dvh, 620px);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    overflow: hidden;
    background:
      radial-gradient(ellipse at 50% 30%, var(--grey-800), var(--grey-1000) 70%);
  }

  .model-stage {
    position: relative;
  }

  .viewer-fallback {
    position: absolute;
    inset: 0;
  }

  .loading,
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-6);
    color: var(--text-muted);
    text-align: center;
  }

  .empty strong {
    color: var(--text-secondary);
  }

  .empty span {
    max-width: 42ch;
    font-size: var(--text-xs);
    line-height: var(--leading-relaxed, 1.6);
  }

  .spinner {
    width: 28px;
    height: 28px;
    border: 3px solid var(--border-default);
    border-top-color: var(--accent);
    border-radius: var(--radius-full);
    animation: spin 800ms linear infinite;
  }

  .artwork {
    display: grid;
    place-items: center;
  }

  .artwork img {
    display: block;
    width: 100%;
    height: min(62dvh, 620px);
    object-fit: contain;
  }

  .viewer-fallback {
    min-height: 0;
  }

  .viewer-fallback img {
    height: 100%;
  }

  .notice,
  .notes {
    margin: 0;
    padding: var(--space-3);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--surface-base);
  }

  .notice {
    color: var(--warning);
  }

  .notes {
    white-space: pre-wrap;
    font-size: var(--text-xs);
    line-height: var(--leading-relaxed, 1.6);
    color: var(--text-secondary);
  }

  .foot {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-5);
    border-top: 1px solid var(--border-subtle);
  }

  .foot button {
    min-height: 44px;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .foot button:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  @keyframes spin {
    to { rotate: 360deg; }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }

  @media (max-width: 640px) {
    .component-modal {
      width: calc(100vw - var(--space-3) * 2);
      max-height: calc(100dvh - var(--space-3) * 2);
    }

    .inner {
      max-height: calc(100dvh - var(--space-3) * 2);
    }

    .head,
    .body {
      padding: var(--space-4);
    }

    .heading {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-1) var(--space-2);
    }

    .kicker {
      grid-column: 1 / -1;
    }

    .loading,
    .empty,
    .artwork {
      min-height: 54dvh;
    }

    .artwork img {
      height: 54dvh;
    }
  }
</style>
