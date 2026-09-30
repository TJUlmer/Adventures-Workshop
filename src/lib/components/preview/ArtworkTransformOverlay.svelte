<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { Artwork, ArtTransform } from '$lib/core/artwork';
  import {
    ARTWORK_TRANSFORM_LIMITS,
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
    target: EntityRef;
    artwork: Artwork;
    /** The renderer window whose coordinate system owns this artwork. */
    windowSelector: string;
    /** How the full native-ratio picture meets its renderer window. */
    fit?: 'cover' | 'contain';
    /** Border breaks use the full source; ordinary artwork retains its crop rectangle. */
    useCrop?: boolean;
    /** Expose independent width and height handles for deliberate reshaping. */
    allowStretch?: boolean;
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
        cornerX: number;
        cornerY: number;
        translateWidth: number;
        translateHeight: number;
        minRatio: number;
        maxRatio: number;
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

  const CORNERS = ['nw', 'ne', 'se', 'sw'] as const;
  type Corner = (typeof CORNERS)[number];

  let {
    target,
    artwork,
    windowSelector,
    fit = 'cover',
    useCrop = true,
    allowStretch = false
  }: Props = $props();
  let surface = $state<HTMLDivElement | null>(null);
  let windowBox = $state<Box>({ left: 0, top: 0, width: 1, height: 1 });
  let sourceWidth = $state(1);
  let sourceHeight = $state(1);
  let manipulating = $state(false);
  let pointerSession: PointerSession | null = null;

  /** The source rectangle and the element dimensions percentage offsets use. */
  const baseBox = $derived.by(() => {
    if (useCrop) {
      const crop = artwork.crop;
      const cropWidth = crop.width > 0 ? crop.width : 1;
      const cropHeight = crop.height > 0 ? crop.height : 1;
      const width = windowBox.width / cropWidth;
      const height = windowBox.height / cropHeight;
      return {
        centerX: windowBox.left - (crop.x / cropWidth) * windowBox.width + width / 2,
        centerY: windowBox.top - (crop.y / cropHeight) * windowBox.height + height / 2,
        width,
        height,
        translateWidth: width,
        translateHeight: height
      };
    }

    const imageAspect = sourceWidth / sourceHeight;
    const windowAspect = windowBox.width / windowBox.height;
    const size = fit === 'cover'
      ? imageAspect >= windowAspect
        ? { width: windowBox.height * imageAspect, height: windowBox.height }
        : { width: windowBox.width, height: windowBox.width / imageAspect }
      : imageAspect >= windowAspect
        ? { width: windowBox.width, height: windowBox.width / imageAspect }
        : { width: windowBox.height * imageAspect, height: windowBox.height };
    return {
      centerX: windowBox.left + windowBox.width / 2,
      centerY: windowBox.top + windowBox.height / 2,
      ...size,
      translateWidth: size.width,
      translateHeight: size.height
    };
  });

  const bounds = $derived.by(() => {
    const transform = artwork.transform;
    return {
      centerX: baseBox.centerX + transform.offsetX * baseBox.translateWidth,
      centerY: baseBox.centerY + transform.offsetY * baseBox.translateHeight,
      width: baseBox.width * transform.scale * transform.stretchX,
      height: baseBox.height * transform.scale * transform.stretchY,
      rotation: transform.rotation
    };
  });

  function rendererWindow(): HTMLElement | null {
    return surface?.parentElement?.querySelector<HTMLElement>(windowSelector) ?? null;
  }

  function measure(): void {
    if (!surface) return;
    const targetWindow = rendererWindow();
    if (!targetWindow) return;
    const surfaceRect = surface.getBoundingClientRect();
    const targetRect = targetWindow.getBoundingClientRect();
    windowBox = {
      left: targetRect.left - surfaceRect.left,
      top: targetRect.top - surfaceRect.top,
      width: targetRect.width,
      height: targetRect.height
    };
  }

  onMount(() => {
    measure();
    const frame = surface?.parentElement?.querySelector<HTMLElement>('.frame');
    const targetWindow = rendererWindow();
    const observer = new ResizeObserver(measure);
    if (surface) observer.observe(surface);
    if (frame) observer.observe(frame);
    if (targetWindow) observer.observe(targetWindow);
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
      transform: snapshotArtworkTransform(artwork.transform)
    });
  }

  function beginScale(event: PointerEvent, corner: Corner): void {
    const transform = snapshotArtworkTransform(artwork.transform);
    const rotation = (bounds.rotation * Math.PI) / 180;
    const halfWidth = (bounds.width / 2) * (corner.endsWith('w') ? -1 : 1);
    const halfHeight = (bounds.height / 2) * (corner.startsWith('n') ? -1 : 1);
    const cornerX = halfWidth * Math.cos(rotation) - halfHeight * Math.sin(rotation);
    const cornerY = halfWidth * Math.sin(rotation) + halfHeight * Math.cos(rotation);
    let minRatio = ARTWORK_TRANSFORM_LIMITS.scale.min / transform.scale;
    let maxRatio = ARTWORK_TRANSFORM_LIMITS.scale.max / transform.scale;

    // Stop the resize at a position limit as well: clamping the centre alone
    // would let the opposite corner drift while the image continued to grow.
    for (const [offset, shift] of [
      [transform.offsetX, cornerX / baseBox.translateWidth],
      [transform.offsetY, cornerY / baseBox.translateHeight]
    ] as const) {
      if (Math.abs(shift) < 1e-10) continue;
      const first = 1 + (ARTWORK_TRANSFORM_LIMITS.offset.min - offset) / shift;
      const second = 1 + (ARTWORK_TRANSFORM_LIMITS.offset.max - offset) / shift;
      minRatio = Math.max(minRatio, Math.min(first, second));
      maxRatio = Math.min(maxRatio, Math.max(first, second));
    }

    beginInteraction(event, {
      kind: 'scale',
      target,
      cornerX,
      cornerY,
      translateWidth: baseBox.translateWidth,
      translateHeight: baseBox.translateHeight,
      minRatio,
      maxRatio,
      transform
    });
  }

  function beginStretch(event: PointerEvent, axis: 'x' | 'y', direction: -1 | 1): void {
    beginInteraction(event, {
      kind: axis === 'x' ? 'stretch-x' : 'stretch-y',
      target,
      direction,
      size: axis === 'x' ? bounds.width : bounds.height,
      rotation: (bounds.rotation * Math.PI) / 180,
      transform: snapshotArtworkTransform(artwork.transform)
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
      transform: snapshotArtworkTransform(artwork.transform)
    });
  }

  function applyInteraction(
    interaction: Readonly<InteractionSnapshot>,
    movement: PointerSessionMovement
  ): void {
    if (interaction.kind === 'drag') {
      workshop.setTransform(interaction.target, {
        offsetX: clampArtworkOffset(
          interaction.transform.offsetX + movement.deltaX / baseBox.translateWidth
        ),
        offsetY: clampArtworkOffset(
          interaction.transform.offsetY + movement.deltaY / baseBox.translateHeight
        )
      });
      return;
    }

    if (interaction.kind === 'scale') {
      // Project the pointer movement onto the diagonal from the fixed corner.
      // Using deltas also avoids a jump when the press is off the handle centre.
      const requestedRatio = 1 +
        (movement.deltaX * interaction.cornerX + movement.deltaY * interaction.cornerY) /
        (2 * (interaction.cornerX ** 2 + interaction.cornerY ** 2));
      const ratio = Math.min(interaction.maxRatio, Math.max(interaction.minRatio, requestedRatio));
      const scale = clampArtworkScale(interaction.transform.scale * ratio);
      const centerShift = scale / interaction.transform.scale - 1;
      workshop.setTransform(interaction.target, {
        scale,
        offsetX: clampArtworkOffset(
          interaction.transform.offsetX +
            (interaction.cornerX * centerShift) / interaction.translateWidth
        ),
        offsetY: clampArtworkOffset(
          interaction.transform.offsetY +
            (interaction.cornerY * centerShift) / interaction.translateHeight
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
                interaction.transform.offsetX + shiftX / baseBox.translateWidth
              ),
              offsetY: clampArtworkOffset(
                interaction.transform.offsetY + shiftY / baseBox.translateHeight
              )
            }
          : {
              stretchY: value,
              offsetX: clampArtworkOffset(
                interaction.transform.offsetX + shiftX / baseBox.translateWidth
              ),
              offsetY: clampArtworkOffset(
                interaction.transform.offsetY + shiftY / baseBox.translateHeight
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
    const transform = artwork.transform;
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

{#if artwork.source}
  <div
    class="transform-surface"
    bind:this={surface}
    role="presentation"
  >
    <img
      class="source-probe"
      src={artwork.source}
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
      aria-label="Selected artwork. Drag to move, use the handles to resize or rotate, or use the arrow keys to nudge."
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

      {#each CORNERS as corner}
        <button
          class="handle corner {corner}"
          type="button"
          aria-label="Resize artwork"
          title="Drag to resize"
          onpointerdown={(event) => beginScale(event, corner)}
        ></button>
      {/each}

      {#if allowStretch}
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
      {/if}
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
