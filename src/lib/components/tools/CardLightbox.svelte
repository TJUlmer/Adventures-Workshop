<script lang="ts">
  /**
   * A reading view over one semantic pile of card designs.
   *
   * The native dialog supplies the focus trap, Escape handling and inert
   * background. A shared publication supplies the lossless image approved at
   * publish time. Missing publication pixels are reported rather than replaced
   * with a live reconstruction that may differ from the author's PNG.
   */
  import { tick } from 'svelte';
  import { CARD_TYPE_META } from '$lib/cards/types';
  import { fetchPublishedCardHistory } from '$lib/cloud/card-history';
  import type { PublishedCardHistory, PublishedCardHistorySource } from '$lib/cloud/card-history';
  import { assetPrefix } from '$lib/cloud/sets';
  import { CardRenderer } from '$lib/renderer';
  import { initiativeSubjectForCard, resolveStyleForCard, cardbackForDeck, findDeck } from '$lib/sets/queries';
  import type { AdventureSet } from '$lib/sets/types';
  import { Icon } from '$lib/ui';
  import type { GalleryCardItem, GalleryCardSide } from './gallery-inspection';

  interface Props {
    open: boolean;
    set: AdventureSet;
    collection: string;
    items: readonly GalleryCardItem[];
    index: number;
    side: GalleryCardSide;
    publishedPngsOnly?: boolean;
    publication?: PublishedCardHistorySource;
    onclose: () => void;
    onprevious: () => void;
    onnext: () => void;
    onsidechange: (side: GalleryCardSide) => void;
  }

  let {
    open,
    set,
    collection,
    items,
    index,
    side,
    publishedPngsOnly = false,
    publication,
    onclose,
    onprevious,
    onnext,
    onsidechange
  }: Props = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let swipe = $state<{ x: number; y: number; id: number } | null>(null);
  let failedPreviewUrl = $state('');
  let history = $state.raw<{ key: string; result: PublishedCardHistory } | null>(null);
  let selectedRevision = $state<{ key: string; revision: number } | null>(null);
  let earlierRevisionButton = $state<HTMLButtonElement | null>(null);

  const item = $derived(items[index] ?? null);
  const first = $derived(index <= 0);
  const last = $derived(index >= items.length - 1);
  const event = $derived(item?.kind === 'card' && item.card.type === 'event');
  const historyKey = $derived(
    open && publication && item?.kind === 'card' ? `${publication.slug}:${publication.revision}:${item.key}` : null
  );
  const cardHistory = $derived(history?.key === historyKey ? history.result : null);
  const viewingRevision = $derived(
    selectedRevision?.key === historyKey ? selectedRevision.revision : publication?.revision
  );
  const latestRevision = $derived(cardHistory?.latest_revision ?? publication?.revision);
  const pageIsOlder = $derived(Boolean(publication && latestRevision && publication.revision < latestRevision));
  const viewingOlder = $derived(Boolean(viewingRevision && latestRevision && viewingRevision < latestRevision));
  const revisions = $derived.by(() => {
    if (!publication || !cardHistory) return [];
    const current = publication.revision;
    const earlier = cardHistory.ranges.flatMap((range) => {
      const last = Math.min(range.last_revision, current - 1);
      return Array.from({ length: Math.max(0, last - range.first_revision + 1) },
        (_, index) => range.first_revision + index);
    });
    return [...earlier, current];
  });
  const revisionIndex = $derived(viewingRevision === undefined ? -1 : revisions.indexOf(viewingRevision));
  const archived = $derived(cardHistory?.ranges.find((range) => viewingRevision !== undefined &&
    range.first_revision <= viewingRevision && viewingRevision <= range.last_revision));
  const deckReverse = $derived.by(() => {
    if (item?.kind !== 'card' || side !== 'back') return null;
    const deck = findDeck(set, item.card.deckId);
    return deck ? cardbackForDeck(set, deck, item.card) : null;
  });
  const landscape = $derived(
    item?.kind === 'card' &&
      (item.card.type === 'event' || (item.card.type === 'rules' && item.card.landscape))
  );
  const miniature = $derived(item?.kind === 'card' && item.card.type === 'initiative');
  const visibleFace = $derived(event && side === 'back' ? 'back' : 'front');
  const previewSrc = $derived.by(() => {
    if (archived && viewingRevision !== publication?.revision) {
      const path = visibleFace === 'back' ? archived.back_path : archived.front_path;
      return path ? `${assetPrefix()}${path}` : '';
    }
    return item?.previews?.[visibleFace] ?? '';
  });
  const usePublishedPreview = $derived(Boolean(previewSrc && previewSrc !== failedPreviewUrl));
  const faceMeta = $derived(
    event && side === 'back'
      ? 'Reverse'
      : item?.kind === 'card'
        ? item.meta || CARD_TYPE_META[item.card.type].label
        : item?.meta ?? ''
  );

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  $effect(() => {
    const key = historyKey;
    const slug = publication?.slug;
    if (!key || !slug || item?.kind !== 'card') return;
    history = null;
    selectedRevision = null;
    const controller = new AbortController();
    void fetchPublishedCardHistory(slug, item.card.id, item.copy ?? 1, controller.signal)
      .then((result) => {
        if (result && !controller.signal.aborted) history = { key, result };
      })
      .catch(() => {
        // The current preview also works against deployments without the history migration.
      });
    return () => controller.abort();
  });

  function stepRevision(delta: number): void {
    const revision = revisions[revisionIndex + delta];
    if (historyKey && revision !== undefined) selectedRevision = { key: historyKey, revision };
  }

  function returnToLatest(): void {
    if (pageIsOlder) {
      window.location.reload();
      return;
    }
    selectedRevision = null;
    void tick().then(() => earlierRevisionButton?.focus());
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
      return;
    }
    if (event.target instanceof Element && event.target.closest('.revision-controls') &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      stepRevision(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (event.key === 'ArrowLeft' && !first) {
      event.preventDefault();
      onprevious();
    }
    if (event.key === 'ArrowRight' && !last) {
      event.preventDefault();
      onnext();
    }
  }

  function onbackdrop(event: MouseEvent): void {
    if (event.target === dialog) onclose();
  }

  function startSwipe(event: PointerEvent): void {
    if (swipe || !event.isPrimary || event.pointerType !== 'touch') return;
    const target = event.target;
    if (target instanceof Element && target.closest('button')) return;
    const current = event.currentTarget;
    if (!(current instanceof HTMLElement)) return;
    try {
      current.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    swipe = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }

  function finishSwipe(event: PointerEvent): void {
    if (!swipe || swipe.id !== event.pointerId) return;
    const deltaX = event.clientX - swipe.x;
    const deltaY = event.clientY - swipe.y;
    const current = event.currentTarget;
    if (current instanceof HTMLElement && current.hasPointerCapture(event.pointerId)) {
      try {
        current.releasePointerCapture(event.pointerId);
      } catch {
        // A browser interruption can release capture between the check and call.
      }
    }
    swipe = null;
    if (Math.abs(deltaX) < 54 || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) return;
    if (deltaX > 0 && !first) onprevious();
    if (deltaX < 0 && !last) onnext();
  }

  function cancelSwipe(event: PointerEvent): void {
    if (swipe?.id === event.pointerId) swipe = null;
  }

  function report(error: unknown): void {
    console.error(`[overview] The card lightbox failed to render ${item?.label ?? 'a card'}:`, error);
  }

  function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
</script>

<dialog
  bind:this={dialog}
  class="lightbox ui-dialog-viewport"
  aria-labelledby="card-lightbox-title"
  onclose={onclose}
  onclick={onbackdrop}
  {onkeydown}
>
  {#if item}
    <div class="inner ui-dialog-frame">
      <header class="head">
        <div class="heading">
          <span class="kicker">{collection}</span>
          <h2 id="card-lightbox-title">{item.label}</h2>
          <span class="meta">{faceMeta}</span>
        </div>
        <button type="button" class="close" aria-label="Close card viewer" onclick={onclose}>
          <Icon name="plus" size={18} />
        </button>
      </header>

      {#if viewingOlder || revisions.length > 1}
        <div class="revision-bar" class:older={viewingOlder}>
          {#if viewingOlder}
            <div class="revision-notice">
              <strong>Viewing an older version · Read-only</strong>
              <span>Published Revision {viewingRevision} · Latest is Revision {latestRevision}</span>
            </div>
            <button type="button" class="return-latest" onclick={returnToLatest}>
              {pageIsOlder ? 'Refresh to latest' : 'Back to latest'}
            </button>
          {/if}
          {#if revisions.length > 1}
            <div class="revision-controls" role="group" aria-label="Card revisions">
              <button type="button" aria-label="Earlier published revision" aria-disabled={revisionIndex <= 0}
                bind:this={earlierRevisionButton}
                onclick={() => stepRevision(-1)}><span aria-hidden="true">‹</span></button>
              <span class="numeric">{viewingOlder ? 'Revision' : 'Latest revision'} {viewingRevision}</span>
              <button type="button" aria-label="Later published revision" aria-disabled={revisionIndex >= revisions.length - 1}
                onclick={() => stepRevision(1)}><span aria-hidden="true">›</span></button>
            </div>
          {/if}
        </div>
      {/if}

      <p class="sr-only" aria-live="polite">
        {item.label}, {faceMeta}, {index + 1} of {items.length}
        {#if viewingOlder}. Viewing published revision {viewingRevision}, read-only. Latest is revision {latestRevision}.{/if}
      </p>

      <div
        class="stage ui-dialog-scroll"
        role="group"
        aria-label="Card viewer"
        onpointerdown={startSwipe}
        onpointerup={finishSwipe}
        onpointercancel={cancelSwipe}
        onlostpointercapture={cancelSwipe}
      >
        <button
          type="button"
          class="step previous"
          aria-label="Previous card"
          aria-disabled={first}
          onclick={onprevious}
        >
          <Icon name="chevronRight" size={24} />
        </button>

        <div class="card-view" class:landscape class:miniature>
          {#key `${item.key}:${visibleFace}:${viewingRevision ?? ''}`}
            {#if usePublishedPreview}
              <img
                class="published-card-preview"
                src={previewSrc}
                alt={item.label}
                onerror={() => (failedPreviewUrl = previewSrc)}
              />
            {:else if viewingOlder}
              <div class="published-unavailable" role="alert">
                <Icon name="image" size={26} />
                <strong>Preview unavailable for Revision {viewingRevision}</strong>
              </div>
            {:else if publishedPngsOnly}
              <div class="published-unavailable" role="alert">
                <Icon name="image" size={26} />
                <strong>Preview temporarily unavailable</strong>
                <span>This published card image needs to be regenerated.</span>
              </div>
            {:else}
              <svelte:boundary onerror={report}>
                {#if item.kind === 'card'}
                  <CardRenderer
                    card={deckReverse ? null : item.card}
                    copy={item.copy}
                    cardback={deckReverse}
                    character={item.character}
                    theme={resolveStyleForCard(set, item.card)}
                    customSymbols={set.customSymbols}
                    initiativeSubject={initiativeSubjectForCard(set, item.card)}
                    side={event ? side : 'front'}
                  />
                {:else if item.kind === 'deck-back'}
                  <CardRenderer card={null} cardback={item.character} />
                {:else}
                  <CardRenderer
                    card={null}
                    statCard={item.character}
                    statCardEntry={item.entry}
                    customSymbols={set.customSymbols}
                  />
                {/if}

                {#snippet failed(error)}
                  <div class="broken" role="alert">
                    <Icon name="skull" size={22} />
                    <strong>This card could not be drawn</strong>
                    <span>{message(error)}</span>
                  </div>
                {/snippet}
              </svelte:boundary>
            {/if}
          {/key}
        </div>

        <button
          type="button"
          class="step next"
          aria-label="Next card"
          aria-disabled={last}
          onclick={onnext}
        >
          <Icon name="chevronRight" size={24} />
        </button>
      </div>

      <footer class="foot">
        <span class="count numeric">{index + 1} of {items.length}</span>

        {#if event}
          <div class="faces" aria-label="Card face">
            <button
              type="button"
              class:active={side === 'front'}
              aria-pressed={side === 'front'}
              onclick={() => onsidechange('front')}
            >Front</button>
            <button
              type="button"
              class:active={side === 'back'}
              aria-pressed={side === 'back'}
              onclick={() => onsidechange('back')}
            >Reverse</button>
          </div>
        {/if}

        <span class="hint">Use arrow keys or swipe</span>
      </footer>
    </div>
  {/if}
</dialog>

<style>
  .lightbox {
    --ui-dialog-inline-size: 1080px;
    --ui-dialog-gutter: var(--space-6);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
    color: var(--text-default);
    box-shadow: var(--shadow-lg);
  }

  .lightbox::backdrop {
    background: color-mix(in oklab, var(--grey-1000) 72%, transparent);
    backdrop-filter: blur(3px);
  }

  .inner {
    max-height: inherit;
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
  }

  .revision-bar {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
    padding: var(--space-2) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
  }

  .revision-bar.older {
    border-inline-start: var(--space-1) solid var(--warning);
    background: color-mix(in oklab, var(--warning) 14%, var(--surface-raised));
  }

  .revision-notice {
    display: grid;
    gap: var(--space-1);
    color: var(--text-primary);
    font-size: var(--text-xs);
  }

  .revision-controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .revision-controls button,
  .return-latest {
    min-height: var(--touch-target);
    min-width: var(--touch-target);
    padding-inline: var(--space-2);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    background: var(--surface-raised);
  }

  .revision-controls button {
    font-size: var(--text-lg);
  }

  .revision-controls button[aria-disabled='true'] {
    opacity: 0.45;
  }

  .return-latest {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
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
  .count,
  .hint {
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

  .stage {
    min-height: 0;
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) 48px;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-5);
    overflow: auto;
    touch-action: pan-y pinch-zoom;
    background:
      radial-gradient(ellipse at center, var(--surface-active), transparent 66%),
      var(--surface-sunken);
  }

  .card-view {
    width: min(500px, 64vw, 51dvh);
    margin: auto;
    flex: none;
    filter: drop-shadow(var(--shadow-lg));
  }

  .card-view.landscape {
    width: min(760px, 72vw, 92dvh);
  }

  .card-view.miniature {
    width: min(430px, 58vw, 47dvh);
  }

  .published-card-preview {
    display: block;
    width: 100%;
    height: auto;
    border-radius: var(--radius-sm);
  }

  .published-unavailable {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: 100%;
    aspect-ratio: 63 / 88;
    padding: var(--space-5);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-inset);
    color: var(--text-muted);
    text-align: center;
  }

  .card-view.landscape .published-unavailable {
    aspect-ratio: 88 / 63;
  }

  .card-view.miniature .published-unavailable {
    aspect-ratio: 44 / 67;
  }

  .published-unavailable span {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .step {
    display: grid;
    place-items: center;
    width: 44px;
    height: 56px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-overlay);
    color: var(--text-secondary);
    box-shadow: var(--shadow-sm);
  }

  .step:hover:not([aria-disabled='true']) {
    border-color: var(--border-strong);
    color: var(--text-primary);
    box-shadow: var(--shadow-md);
  }

  .step[aria-disabled='true'] {
    opacity: 0.28;
  }

  .previous :global(svg) {
    rotate: 180deg;
  }

  .broken {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: 100%;
    aspect-ratio: 63 / 88;
    padding: var(--space-5);
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    background: var(--surface-inset);
    color: var(--danger);
    text-align: center;
  }

  .broken span {
    font-size: var(--text-xs);
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }

  .foot {
    flex: none;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--space-4);
    min-height: 58px;
    padding: var(--space-3) var(--space-5);
    border-top: 1px solid var(--border-subtle);
  }

  .faces {
    display: inline-flex;
    padding: 2px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
  }

  .faces button {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-xs);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .faces button:hover {
    color: var(--text-primary);
  }

  .faces button.active {
    background: var(--surface-active);
    color: var(--text-primary);
    box-shadow: var(--shadow-xs);
  }

  .hint {
    justify-self: end;
  }

  @media (max-width: 640px) {
    .lightbox {
      --ui-dialog-gutter: var(--space-3);
    }

    .head {
      padding: var(--space-3) var(--space-4);
    }

    .heading {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-1) var(--space-2);
    }

    .kicker {
      grid-column: 1 / -1;
    }

    .stage {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: var(--space-2) var(--space-3);
      padding: var(--space-4);
    }

    .card-view,
    .card-view.miniature {
      grid-column: 1 / -1;
      grid-row: 1;
      width: min(100%, 43dvh);
    }

    .card-view.landscape {
      width: 100%;
    }

    .step {
      grid-row: 2;
      width: 100%;
      height: 44px;
    }

    .previous {
      grid-column: 1;
    }

    .next {
      grid-column: 2;
    }

    .faces button {
      min-height: 44px;
    }

    .foot {
      grid-template-columns: 1fr auto;
      min-height: 52px;
      padding: var(--space-2) var(--space-4);
    }

    .hint {
      display: none;
    }
  }
</style>
