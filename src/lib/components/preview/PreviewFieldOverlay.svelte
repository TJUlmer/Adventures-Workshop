<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    CARD_EDIT_MARKERS,
    type CardEditAddress
  } from '$lib/cards/edit-targets';
  import type { CardId } from '$lib/cards/types';
  import { cardEditorView } from '$lib/state/card-editor-view.svelte';

  interface Props {
    cardId: CardId;
    zoom: number;
    showBleed: boolean;
    showGuides: boolean;
    disabled?: boolean;
  }

  interface TargetBox {
    left: number;
    top: number;
    width: number;
    height: number;
  }

  let { cardId, zoom, showBleed, showGuides, disabled = false }: Props = $props();

  const MIN_DIRECT_WIDTH = 320;
  const POPOVER_WIDTH = 232;
  const POPOVER_GUTTER = 8;

  let overlay = $state<HTMLDivElement | null>(null);
  let hotspot = $state<HTMLButtonElement | null>(null);
  let fullEditor = $state<HTMLButtonElement | null>(null);
  let box = $state<TargetBox | null>(null);
  let canvasWidth = $state(0);
  let prototypeOpen = $state(false);
  let frame = 0;

  const address = $derived({ cardId, region: 'title', field: 'title' } as const satisfies CardEditAddress);
  const direct = $derived(canvasWidth >= MIN_DIRECT_WIDTH);
  const popoverLeft = $derived(
    box
      ? Math.max(
          POPOVER_GUTTER,
          Math.min(box.left, canvasWidth - POPOVER_WIDTH - POPOVER_GUTTER)
        )
      : 0
  );

  function measure(): void {
    const host = overlay?.parentElement;
    const marker = host?.querySelector<HTMLElement>(
      `[data-card-edit-target="${CARD_EDIT_MARKERS.title}"]`
    );
    if (!host || !marker || disabled) {
      box = null;
      prototypeOpen = false;
      return;
    }

    const hostBounds = host.getBoundingClientRect();
    const markerBounds = marker.getBoundingClientRect();
    canvasWidth = hostBounds.width;
    box = {
      left: markerBounds.left - hostBounds.left,
      top: markerBounds.top - hostBounds.top,
      width: markerBounds.width,
      height: markerBounds.height
    };
  }

  function scheduleMeasure(): void {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  }

  function openCentreEditor(): void {
    prototypeOpen = false;
    cardEditorView.requestTarget(address);
  }

  function activate(): void {
    if (!direct) {
      openCentreEditor();
      return;
    }
    prototypeOpen = true;
    void tick().then(() => fullEditor?.focus({ preventScroll: true }));
  }

  function closePrototype(): void {
    prototypeOpen = false;
    void tick().then(() => hotspot?.focus({ preventScroll: true }));
  }

  function handlePrototypeKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closePrototype();
  }

  $effect(() => {
    void cardId;
    void zoom;
    void showBleed;
    void showGuides;
    void disabled;
    void tick().then(scheduleMeasure);
  });

  onMount(() => {
    const host = overlay?.parentElement;
    if (!host) return;

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    const mutationObserver = new MutationObserver(scheduleMeasure);
    resizeObserver.observe(host);
    mutationObserver.observe(host, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', scheduleMeasure);
    scheduleMeasure();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
    };
  });
</script>

<div bind:this={overlay} class="field-overlay" aria-hidden={box ? undefined : 'true'}>
  {#if box}
    <button
      bind:this={hotspot}
      type="button"
      class="hotspot"
      class:fallback={!direct}
      aria-label={direct ? 'Edit card title' : 'Open card title in the full editor'}
      title={direct ? 'Edit card title' : 'Open card title in the full editor'}
      style:left="{box.left}px"
      style:top="{box.top}px"
      style:width="{box.width}px"
      style:height="{box.height}px"
      onclick={activate}
    ></button>

    {#if prototypeOpen}
      <div
        class="prototype"
        role="dialog"
        tabindex="-1"
        aria-label="Card title editing prototype"
        style:left="{popoverLeft}px"
        style:top="{box.top + box.height + POPOVER_GUTTER}px"
        onkeydown={handlePrototypeKeydown}
      >
        <span class="prototype-label">Phase 0 prototype</span>
        <p>The title editor will open here. This prototype does not save changes.</p>
        <div class="prototype-actions">
          <button bind:this={fullEditor} type="button" onclick={openCentreEditor}>Open full editor</button>
          <button type="button" onclick={closePrototype}>Close</button>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .field-overlay {
    position: absolute;
    inset: 0;
    z-index: 5;
    pointer-events: none;
  }

  .hotspot {
    position: absolute;
    pointer-events: auto;
    border: 1px solid transparent;
    border-radius: var(--radius-xs);
    background: transparent;
    transition:
      border-color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out);
  }

  .hotspot:hover,
  .hotspot:focus-visible {
    border-color: var(--accent);
    background: color-mix(in oklab, var(--accent-soft) 38%, transparent);
    outline: none;
    box-shadow: 0 0 0 2px var(--accent-soft);
  }

  .hotspot.fallback:hover,
  .hotspot.fallback:focus-visible {
    border-style: dashed;
  }

  .prototype {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 232px;
    padding: var(--space-4);
    pointer-events: auto;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    box-shadow: var(--shadow-lg);
    color: var(--text-primary);
  }

  .prototype-label {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-accent);
  }

  .prototype p {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-secondary);
  }

  .prototype-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .prototype-actions button {
    min-height: 30px;
    padding-inline: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-hover);
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }

  .prototype-actions button:first-child {
    background: var(--accent);
    color: var(--text-on-accent);
  }

  .prototype-actions button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
