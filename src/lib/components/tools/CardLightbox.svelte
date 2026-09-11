<script lang="ts">
  /**
   * A reading view over one semantic pile of card designs.
   *
   * The native dialog supplies the focus trap, Escape handling and inert
   * background. A shared publication supplies the lossless image approved at
   * publish time; `CardRenderer` remains the compatibility fallback for an old
   * row or a failed image request.
   */
  import { CARD_TYPE_META } from '$lib/cards/types';
  import { CardRenderer } from '$lib/renderer';
  import { initiativeSubjectForCard, resolveStyleForCard } from '$lib/sets/queries';
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
    onclose,
    onprevious,
    onnext,
    onsidechange
  }: Props = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let swipe = $state<{ x: number; y: number; id: number } | null>(null);
  let failedPreviewUrl = $state('');

  const item = $derived(items[index] ?? null);
  const first = $derived(index <= 0);
  const last = $derived(index >= items.length - 1);
  const event = $derived(item?.kind === 'card' && item.card.type === 'event');
  const landscape = $derived(
    item?.kind === 'card' &&
      (item.card.type === 'event' || (item.card.type === 'rules' && item.card.landscape))
  );
  const miniature = $derived(item?.kind === 'card' && item.card.type === 'initiative');
  const previewSrc = $derived(item?.previews?.[event && side === 'back' ? 'back' : 'front'] ?? '');
  const usePublishedPreview = $derived(Boolean(previewSrc && previewSrc !== failedPreviewUrl));
  const faceMeta = $derived(
    event && side === 'back'
      ? 'Reverse'
      : item?.kind === 'card'
        ? CARD_TYPE_META[item.card.type].label
        : item?.meta ?? ''
  );

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
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
    if (event.pointerType !== 'touch') return;
    const target = event.target;
    if (target instanceof Element && target.closest('button')) return;
    swipe = { x: event.clientX, y: event.clientY, id: event.pointerId };
    const current = event.currentTarget;
    if (current instanceof HTMLElement) current.setPointerCapture(event.pointerId);
  }

  function finishSwipe(event: PointerEvent): void {
    if (!swipe || swipe.id !== event.pointerId) return;
    const deltaX = event.clientX - swipe.x;
    const deltaY = event.clientY - swipe.y;
    const current = event.currentTarget;
    if (current instanceof HTMLElement && current.hasPointerCapture(event.pointerId)) {
      current.releasePointerCapture(event.pointerId);
    }
    swipe = null;
    if (Math.abs(deltaX) < 54 || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) return;
    if (deltaX > 0 && !first) onprevious();
    if (deltaX < 0 && !last) onnext();
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
  class="lightbox"
  aria-labelledby="card-lightbox-title"
  onclose={onclose}
  onclick={onbackdrop}
  {onkeydown}
>
  {#if item}
    <div class="inner">
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

      <p class="sr-only" aria-live="polite">
        {item.label}, {faceMeta}, {index + 1} of {items.length}
      </p>

      <div
        class="stage"
        role="group"
        aria-label="Card viewer"
        onpointerdown={startSwipe}
        onpointerup={finishSwipe}
        onpointercancel={() => (swipe = null)}
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
          {#key `${item.key}:${event ? side : 'front'}`}
            {#if usePublishedPreview}
              <img
                class="published-card-preview"
                src={previewSrc}
                alt={item.label}
                onerror={() => (failedPreviewUrl = previewSrc)}
              />
            {:else}
              <svelte:boundary onerror={report}>
                {#if item.kind === 'card'}
                  <CardRenderer
                    card={item.card}
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
    width: min(1080px, calc(100vw - var(--space-6) * 2));
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

  .lightbox::backdrop {
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
      width: calc(100vw - var(--space-3) * 2);
      max-height: calc(100dvh - var(--space-3) * 2);
    }

    .inner {
      max-height: calc(100dvh - var(--space-3) * 2);
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
