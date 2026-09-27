<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { CardArtworkLayer, CardId } from '$lib/cards/types';
  import type { ArtTransform } from '$lib/core/artwork';
  import {
    clampArtworkOffset,
    clampArtworkScale,
    clampArtworkStretch,
    normalizeArtworkRotation,
    snapshotArtworkTransform
  } from '$lib/interaction/artwork-transform';
  import { startPointerSession } from '$lib/interaction/pointer-session';
  import type { PointerSession, PointerSessionMovement } from '$lib/interaction/pointer-session';
  import type { EntityRef } from '$lib/state/workshop.svelte';
  import { workshop } from '$lib/state/workshop.svelte';

  interface Props {
    cardId: CardId;
    layer: CardArtworkLayer;
  }

  interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
  }

  type InteractionSnapshot = (
    | {
        kind: 'drag';
      }
    | {
        kind: 'scale';
        centerX: number;
        centerY: number;
        distance: number;
      }
    | {
        kind: 'stretch-x' | 'stretch-y';
        direction: -1 | 1;
        size: number;
        rotation: number;
      }
    | {
        kind: 'rotate';
        centerX: number;
        centerY: number;
        angle: number;
      }
  ) & {
    target: EntityRef;
    transform: ArtTransform;
  };

  let { cardId, layer }: Props = $props();
  let surface = $state<HTMLDivElement | null>(null);
  let plateBox = $state<Box>({ left: 0, top: 0, width: 1, height: 1 });
  let sourceWidth = $state(1);
  let sourceHeight = $state(1);
  let manipulating = $state(false);
  let pointerSession: PointerSession | null = null;

  const target = $derived({ entity: 'cardArtworkLayer' as const, id: cardId, layerId: layer.id });

  /** The visible image rectangle before the author's transform is applied. */
  const baseSize = $derived.by(() => {
    const imageAspect = sourceWidth / sourceHeight;
    const plateAspect = plateBox.width / plateBox.height;
    if (imageAspect >= plateAspect) {
      return { width: plateBox.width, height: plateBox.width / imageAspect };
    }
    return { width: plateBox.height * imageAspect, height: plateBox.height };
  });

  const bounds = $derived.by(() => {
    const transform = layer.artwork.transform;
    return {
      centerX: plateBox.left + plateBox.width / 2 + transform.offsetX * plateBox.width,
      centerY: plateBox.top + plateBox.height / 2 + transform.offsetY * plateBox.height,
      width: baseSize.width * transform.scale * transform.stretchX,
      height: baseSize.height * transform.scale * transform.stretchY,
      rotation: transform.rotation
    };
  });

  function measure(): void {
    if (!surface) return;
    const plate = surface.parentElement?.querySelector<HTMLElement>('.plate');
    if (!plate) return;
    const surfaceRect = surface.getBoundingClientRect();
    const plateRect = plate.getBoundingClientRect();
    plateBox = {
      left: plateRect.left - surfaceRect.left,
      top: plateRect.top - surfaceRect.top,
      width: plateRect.width,
      height: plateRect.height
    };
  }

  onMount(() => {
    measure();
    const frame = surface?.parentElement?.querySelector<HTMLElement>('.frame');
    const plate = surface?.parentElement?.querySelector<HTMLElement>('.plate');
    const observer = new ResizeObserver(measure);
    if (surface) observer.observe(surface);
    if (frame) observer.observe(frame);
    if (plate) observer.observe(plate);
    return () => observer.disconnect();
  });

  onDestroy(() => pointerSession?.dispose());

  function beginInteraction(event: PointerEvent, snapshot: InteractionSnapshot): void {
    event.preventDefault();
    event.stopPropagation();
    pointerSession?.cancel('superseded');
    pointerSession = startPointerSession<InteractionSnapshot>(event, {
      snapshot,
      onMove: (movement, _moveEvent, start) => {
        manipulating = true;
        applyInteraction(start, movement);
      },
      onCommit: () => {
        pointerSession = null;
        manipulating = false;
      },
      onCancel: (_reason, movement, start) => {
        if (movement.activated) workshop.setTransform(start.target, start.transform);
        pointerSession = null;
        manipulating = false;
      },
      onTap: () => {
        pointerSession = null;
        manipulating = false;
      }
    });
  }

  function beginDrag(event: PointerEvent): void {
    beginInteraction(event, {
      kind: 'drag',
      target,
      transform: snapshotArtworkTransform(layer.artwork.transform)
    });
  }

  function beginScale(event: PointerEvent): void {
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const centerX = rect.left + bounds.centerX;
    const centerY = rect.top + bounds.centerY;
    beginInteraction(event, {
      kind: 'scale',
      target,
      centerX,
      centerY,
      distance: Math.max(1, Math.hypot(event.clientX - centerX, event.clientY - centerY)),
      transform: snapshotArtworkTransform(layer.artwork.transform)
    });
  }

  function beginStretch(event: PointerEvent, axis: 'x' | 'y', direction: -1 | 1): void {
    beginInteraction(event, {
      kind: axis === 'x' ? 'stretch-x' : 'stretch-y',
      target,
      direction,
      size: axis === 'x' ? bounds.width : bounds.height,
      rotation: (bounds.rotation * Math.PI) / 180,
      transform: snapshotArtworkTransform(layer.artwork.transform)
    });
  }

  function beginRotate(event: PointerEvent): void {
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const centerX = rect.left + bounds.centerX;
    const centerY = rect.top + bounds.centerY;
    beginInteraction(event, {
      kind: 'rotate',
      target,
      centerX,
      centerY,
      angle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
      transform: snapshotArtworkTransform(layer.artwork.transform)
    });
  }

  function applyInteraction(
    interaction: Readonly<InteractionSnapshot>,
    movement: PointerSessionMovement
  ): void {
    if (interaction.kind === 'drag') {
      workshop.setTransform(interaction.target, {
        offsetX: clampArtworkOffset(
          interaction.transform.offsetX + movement.deltaX / plateBox.width
        ),
        offsetY: clampArtworkOffset(
          interaction.transform.offsetY + movement.deltaY / plateBox.height
        )
      });
      return;
    }

    if (interaction.kind === 'scale') {
      const distance = Math.hypot(
        movement.clientX - interaction.centerX,
        movement.clientY - interaction.centerY
      );
      workshop.setTransform(interaction.target, {
        scale: clampArtworkScale(
          interaction.transform.scale * (distance / interaction.distance)
        )
      });
      return;
    }

    if (interaction.kind === 'stretch-x' || interaction.kind === 'stretch-y') {
      const localDelta =
        interaction.kind === 'stretch-x'
          ? movement.deltaX * Math.cos(interaction.rotation) +
            movement.deltaY * Math.sin(interaction.rotation)
          : -movement.deltaX * Math.sin(interaction.rotation) +
            movement.deltaY * Math.cos(interaction.rotation);
      const ratio = Math.max(
        0.025,
        (interaction.size + localDelta * interaction.direction) / interaction.size
      );
      const originalStretch =
        interaction.kind === 'stretch-x'
          ? interaction.transform.stretchX
          : interaction.transform.stretchY;
      const value = clampArtworkStretch(originalStretch * ratio);
      const sizeDelta = interaction.size * (value / originalStretch - 1);
      /*
       * An edge handle behaves like a physical bounding box: its opposite
       * edge stays put. Half the size change therefore also moves the centre,
       * projected through the layer's rotation before being converted back to
       * the plate-relative offsets the artwork model stores.
       */
      const centerShift = (sizeDelta * interaction.direction) / 2;
      const shiftX =
        interaction.kind === 'stretch-x'
          ? centerShift * Math.cos(interaction.rotation)
          : centerShift * -Math.sin(interaction.rotation);
      const shiftY =
        interaction.kind === 'stretch-x'
          ? centerShift * Math.sin(interaction.rotation)
          : centerShift * Math.cos(interaction.rotation);
      workshop.setTransform(
        interaction.target,
        interaction.kind === 'stretch-x'
          ? {
              stretchX: value,
              offsetX: clampArtworkOffset(
                interaction.transform.offsetX + shiftX / plateBox.width
              ),
              offsetY: clampArtworkOffset(
                interaction.transform.offsetY + shiftY / plateBox.height
              )
            }
          : {
              stretchY: value,
              offsetX: clampArtworkOffset(
                interaction.transform.offsetX + shiftX / plateBox.width
              ),
              offsetY: clampArtworkOffset(
                interaction.transform.offsetY + shiftY / plateBox.height
              )
            }
      );
      return;
    }

    if (interaction.kind !== 'rotate') return;
    const angle = Math.atan2(
      movement.clientY - interaction.centerY,
      movement.clientX - interaction.centerX
    );
    const delta = normalizeArtworkRotation(((angle - interaction.angle) * 180) / Math.PI);
    const rotation = normalizeArtworkRotation(interaction.transform.rotation + delta);
    workshop.setTransform(interaction.target, { rotation: Math.round(rotation) });
  }

  function nudge(event: KeyboardEvent): void {
    const distance = event.shiftKey ? 0.025 : 0.005;
    const transform = layer.artwork.transform;
    const patch =
      event.key === 'ArrowLeft'
        ? { offsetX: clampArtworkOffset(transform.offsetX - distance) }
        : event.key === 'ArrowRight'
          ? { offsetX: clampArtworkOffset(transform.offsetX + distance) }
          : event.key === 'ArrowUp'
            ? { offsetY: clampArtworkOffset(transform.offsetY - distance) }
            : event.key === 'ArrowDown'
              ? { offsetY: clampArtworkOffset(transform.offsetY + distance) }
              : null;
    if (!patch) return;
    event.preventDefault();
    workshop.setTransform(target, patch);
  }

  function readSourceSize(event: Event): void {
    const image = event.currentTarget as HTMLImageElement;
    sourceWidth = image.naturalWidth || 1;
    sourceHeight = image.naturalHeight || 1;
    measure();
  }
</script>

{#if layer.artwork.source}
  <div
    class="transform-surface"
    bind:this={surface}
    role="presentation"
  >
    <img
      class="source-probe"
      src={layer.artwork.source}
      alt=""
      onload={readSourceSize}
    />

    <div
      class="bounds"
      class:active={manipulating}
      style:left="{bounds.centerX}px"
      style:top="{bounds.centerY}px"
      style:width="{bounds.width}px"
      style:height="{bounds.height}px"
      style:transform="translate(-50%, -50%) rotate({bounds.rotation}deg)"
      role="button"
      aria-label="Adjusting selected artwork. Drag to move, use the handles to resize or rotate, or use the arrow keys to nudge."
      tabindex="0"
      onpointerdown={beginDrag}
      onkeydown={nudge}
    >
      <span class="rotation-stem" aria-hidden="true"></span>
      <button
        class="handle rotate"
        type="button"
        aria-label="Rotate artwork"
        title="Drag to rotate"
        onpointerdown={beginRotate}
      ></button>

      {#each ['nw', 'ne', 'se', 'sw'] as corner}
        <button
          class="handle corner {corner}"
          type="button"
          aria-label="Resize artwork"
          title="Drag to resize"
          onpointerdown={beginScale}
        ></button>
      {/each}

      <button
        class="handle edge n"
        type="button"
        aria-label="Change artwork height"
        title="Drag to change height"
        onpointerdown={(event) => beginStretch(event, 'y', -1)}
      ></button>
      <button
        class="handle edge e"
        type="button"
        aria-label="Change artwork width"
        title="Drag to change width"
        onpointerdown={(event) => beginStretch(event, 'x', 1)}
      ></button>
      <button
        class="handle edge s"
        type="button"
        aria-label="Change artwork height"
        title="Drag to change height"
        onpointerdown={(event) => beginStretch(event, 'y', 1)}
      ></button>
      <button
        class="handle edge w"
        type="button"
        aria-label="Change artwork width"
        title="Drag to change width"
        onpointerdown={(event) => beginStretch(event, 'x', -1)}
      ></button>
    </div>
  </div>
{/if}

<style>
  .transform-surface {
    position: absolute;
    inset: 0;
    z-index: 20;
    overflow: visible;
    pointer-events: none;
  }

  .source-probe {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0;
    pointer-events: none;
  }

  .bounds {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid var(--accent);
    outline: 1px solid color-mix(in oklab, var(--surface-raised) 75%, transparent);
    outline-offset: 1px;
    cursor: move;
    pointer-events: auto;
    touch-action: none;
  }

  .bounds:hover,
  .bounds:focus-visible,
  .bounds.active {
    background: color-mix(in oklab, var(--accent) 6%, transparent);
  }

  .bounds:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .handle {
    position: absolute;
    z-index: 2;
    box-sizing: border-box;
    width: 11px;
    height: 11px;
    padding: 0;
    border: 2px solid var(--surface-raised);
    border-radius: 2px;
    background: var(--accent);
    box-shadow: var(--shadow-sm);
    touch-action: none;
  }

  .corner.nw {
    top: 0;
    left: 0;
    translate: -50% -50%;
    cursor: nwse-resize;
  }

  .corner.ne {
    top: 0;
    right: 0;
    translate: 50% -50%;
    cursor: nesw-resize;
  }

  .corner.se {
    right: 0;
    bottom: 0;
    translate: 50% 50%;
    cursor: nwse-resize;
  }

  .corner.sw {
    bottom: 0;
    left: 0;
    translate: -50% 50%;
    cursor: nesw-resize;
  }

  .edge.n,
  .edge.s {
    left: 50%;
    translate: -50% -50%;
    cursor: ns-resize;
  }

  .edge.n {
    top: 0;
  }

  .edge.s {
    top: 100%;
  }

  .edge.e,
  .edge.w {
    top: 50%;
    translate: -50% -50%;
    cursor: ew-resize;
  }

  .edge.e {
    left: 100%;
  }

  .edge.w {
    left: 0;
  }

  .rotation-stem {
    position: absolute;
    bottom: 100%;
    left: 50%;
    width: 1px;
    height: 24px;
    background: var(--accent);
    translate: -50% 0;
    pointer-events: none;
  }

  .handle.rotate {
    bottom: calc(100% + 24px);
    left: 50%;
    border-radius: var(--radius-full);
    translate: -50% 50%;
    cursor: grab;
  }

  .handle.rotate:active {
    cursor: grabbing;
  }

  @media (hover: none), (any-pointer: coarse) {
    /* The button owns a finger-sized target while its pseudo-element keeps
       the selection mark visually precise. */
    .handle {
      width: var(--touch-target);
      height: var(--touch-target);
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
    }

    .handle::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      box-sizing: border-box;
      width: 11px;
      height: 11px;
      border: 2px solid var(--surface-raised);
      border-radius: 2px;
      background: var(--accent);
      box-shadow: var(--shadow-sm);
      translate: -50% -50%;
    }

    .handle.rotate::after {
      border-radius: var(--radius-full);
    }
  }
</style>
