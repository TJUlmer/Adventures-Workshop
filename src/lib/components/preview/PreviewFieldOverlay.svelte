<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    cardEditAddressFromTarget,
    cardEditAddressLabel,
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
    marker: string;
    address: CardEditAddress;
    left: number;
    top: number;
    width: number;
    height: number;
  }

  let { cardId, zoom, showBleed, showGuides, disabled = false }: Props = $props();

  const MIN_DIRECT_WIDTH = 320;
  const EMPTY_TARGET_HEIGHT = 24;

  let overlay = $state<HTMLDivElement | null>(null);
  let boxes = $state<TargetBox[]>([]);
  let canvasWidth = $state(0);
  let frame = 0;

  const direct = $derived(canvasWidth >= MIN_DIRECT_WIDTH);

  function measure(): void {
    const host = overlay?.parentElement;
    if (!host || disabled) {
      boxes = [];
      return;
    }

    const hostBounds = host.getBoundingClientRect();
    canvasWidth = hostBounds.width;
    boxes = Array.from(host.querySelectorAll<HTMLElement>('.plate [data-card-edit-target]'))
      .map((marker): TargetBox | null => {
        const value = marker.dataset.cardEditTarget;
        const address = value ? cardEditAddressFromTarget(cardId, value) : null;
        if (!value || !address) return null;

        const bounds = marker.getBoundingClientRect();
        const empty = marker.classList.contains('ability') && marker.querySelector('.line') === null;
        return {
          marker: value,
          address,
          left: bounds.left - hostBounds.left,
          top: bounds.top - hostBounds.top - (empty ? EMPTY_TARGET_HEIGHT / 2 : 0),
          width: bounds.width,
          height: empty ? EMPTY_TARGET_HEIGHT : bounds.height
        };
      })
      .filter((box): box is TargetBox => box !== null && box.width > 0);
  }

  function scheduleMeasure(): void {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  }

  function activate(address: CardEditAddress): void {
    cardEditorView.requestTarget(address);
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

<div bind:this={overlay} class="field-overlay" aria-hidden={boxes.length ? undefined : 'true'}>
  {#each boxes as box (box.marker)}
    {@const label = cardEditAddressLabel(box.address)}
    <button
      type="button"
      class="hotspot"
      class:fallback={!direct}
      data-card-edit-target={box.marker}
      aria-label="Edit {label} in the full editor"
      title="Edit {label} in the full editor"
      style:left="{box.left}px"
      style:top="{box.top}px"
      style:width="{box.width}px"
      style:height="{box.height}px"
      onclick={() => activate(box.address)}
    ></button>
  {/each}
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
    cursor: pointer;
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
</style>
