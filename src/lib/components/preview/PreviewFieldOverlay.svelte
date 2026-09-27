<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import {
    cardEditAddressFromTarget,
    cardEditAddressLabel,
    cardEditTargetForAddress,
    previewDirectField,
    writePreviewDirectField,
    type CardEditAddress,
    type PreviewDirectField,
    type PreviewEditInvalidationReason,
    type PreviewEditSession,
    type PreviewEditValue
  } from '$lib/cards/edit-targets';
  import type { ActionCard, CardId } from '$lib/cards/types';
  import { findCard } from '$lib/sets/queries';
  import { cardEditorView } from '$lib/state/card-editor-view.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import PreviewFieldEditor from './PreviewFieldEditor.svelte';

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
  let session = $state<PreviewEditSession>({ status: 'inactive' });

  const direct = $derived(canvasWidth >= MIN_DIRECT_WIDTH);
  const activeBox = $derived.by(() => {
    if (
      session.status !== 'editing' &&
      session.status !== 'committing' &&
      session.status !== 'cancelling'
    ) {
      return null;
    }
    const marker = cardEditTargetForAddress(session.address);
    return boxes.find((box) => box.marker === marker) ?? null;
  });
  const activeField = $derived.by((): PreviewDirectField | null => {
    if (session.status !== 'editing') return null;
    return sourceFor(session.address);
  });

  function selectedActionCard(address: CardEditAddress): ActionCard | null {
    const card = findCard(workshop.adventure, address.cardId);
    return card?.type === 'action' ? card : null;
  }

  function sourceFor(address: CardEditAddress): PreviewDirectField | null {
    const card = selectedActionCard(address);
    return card ? previewDirectField(card, address) : null;
  }

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

  function restoreTargetFocus(address: CardEditAddress): void {
    void tick().then(() => {
      scheduleMeasure();
      const marker = cardEditTargetForAddress(address);
      overlay
        ?.querySelector<HTMLButtonElement>(`.hotspot[data-card-edit-target="${CSS.escape(marker)}"]`)
        ?.focus({ preventScroll: true });
    });
  }

  function finishInactive(address: CardEditAddress, returnFocus: boolean): void {
    session = { status: 'inactive' };
    cardEditorView.endPreviewEdit(address);
    if (returnFocus) restoreTargetFocus(address);
    else scheduleMeasure();
  }

  function invalidate(reason: PreviewEditInvalidationReason): void {
    if (session.status !== 'editing') return;
    const address = session.address;
    session = { status: 'invalidated', address, reason };
    finishInactive(address, false);
  }

  function commitSession(returnFocus: boolean): void {
    if (session.status !== 'editing' || !session.valid) return;
    const current = session;
    const card = selectedActionCard(current.address);
    const source = card ? previewDirectField(card, current.address) : null;
    if (!card || !source || source.value !== current.original) {
      invalidate(card ? 'target-hidden' : 'card-deleted');
      return;
    }

    session = { ...current, status: 'committing' };
    if (current.draft !== current.original) {
      workshop.editCard(current.address.cardId, (candidate) => {
        if (candidate.type === 'action') {
          writePreviewDirectField(candidate, current.address, current.draft);
        }
      });
    }
    finishInactive(current.address, returnFocus);
  }

  function cancelSession(returnFocus: boolean): void {
    if (session.status !== 'editing') return;
    const current = session;
    session = { ...current, status: 'cancelling' };
    finishInactive(current.address, returnFocus);
  }

  function updateDraft(draft: PreviewEditValue, valid: boolean): void {
    if (session.status !== 'editing') return;
    session = { ...session, draft, valid };
  }

  function beginDirect(address: CardEditAddress, field: PreviewDirectField): void {
    session = { status: 'targeting', address };
    session = {
      status: 'editing',
      address,
      original: field.value,
      draft: field.value,
      valid: true
    };
    cardEditorView.beginPreviewEdit(address);
  }

  function activate(address: CardEditAddress): void {
    if (session.status === 'editing') {
      if (session.valid) commitSession(false);
      else cancelSession(false);
    }

    const field = direct ? sourceFor(address) : null;
    if (field) beginDirect(address, field);
    else cardEditorView.requestTarget(address);
  }

  $effect(() => {
    void cardId;
    void zoom;
    void showBleed;
    void showGuides;
    void disabled;
    void tick().then(scheduleMeasure);
  });

  $effect(() => {
    const current = session;
    if (current.status !== 'editing') return;

    if (current.address.cardId !== cardId) {
      invalidate('card-changed');
      return;
    }

    const card = selectedActionCard(current.address);
    if (!card) {
      invalidate('card-deleted');
      return;
    }
    if (card.useReplacement) {
      invalidate('replacement-enabled');
      return;
    }

    if (disabled || !direct) {
      if (current.valid) commitSession(false);
      else cancelSession(false);
      return;
    }

    const source = previewDirectField(card, current.address);
    if (!source || source.value !== current.original) invalidate('target-hidden');
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

  onDestroy(() => {
    cardEditorView.endPreviewEdit();
  });
</script>

<div bind:this={overlay} class="field-overlay" aria-hidden={boxes.length ? undefined : 'true'}>
  {#each boxes as box (box.marker)}
    {@const label = cardEditAddressLabel(box.address)}
    {@const directField = direct ? sourceFor(box.address) : null}
    {#if activeBox?.marker !== box.marker}
      <button
        type="button"
        class="hotspot"
        class:direct={directField !== null}
        class:fallback={!direct}
        data-card-edit-target={box.marker}
        aria-label={directField ? `Edit ${label} on card` : `Edit ${label} in the full editor`}
        title={directField ? `Edit ${label} on card` : `Edit ${label} in the full editor`}
        style:left="{box.left}px"
        style:top="{box.top}px"
        style:width="{box.width}px"
        style:height="{box.height}px"
        onclick={() => activate(box.address)}
      ></button>
    {/if}
  {/each}

  {#if session.status === 'editing' && activeBox && activeField}
    <PreviewFieldEditor
      field={activeField}
      label={cardEditAddressLabel(session.address)}
      left={activeBox.left}
      top={activeBox.top}
      width={activeBox.width}
      height={activeBox.height}
      {canvasWidth}
      customSymbols={workshop.adventure.customSymbols}
      ondraft={updateDraft}
      oncommit={commitSession}
      oncancel={cancelSession}
    />
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
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out);
  }

  .hotspot.direct {
    cursor: text;
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
