<script lang="ts">
  import { onMount } from 'svelte';
  import type { CardArtworkLayer, CardId } from '$lib/cards/types';
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

  type Interaction =
    | {
        kind: 'drag';
        pointerId: number;
        startX: number;
        startY: number;
        offsetX: number;
        offsetY: number;
      }
    | {
        kind: 'scale';
        pointerId: number;
        centerX: number;
        centerY: number;
        distance: number;
        scale: number;
      }
    | {
        kind: 'stretch-x' | 'stretch-y';
        pointerId: number;
        startX: number;
        startY: number;
        direction: -1 | 1;
        size: number;
        stretch: number;
        rotation: number;
        offsetX: number;
        offsetY: number;
      }
    | {
        kind: 'rotate';
        pointerId: number;
        centerX: number;
        centerY: number;
        angle: number;
        rotation: number;
      };

  let { cardId, layer }: Props = $props();
  let surface = $state<HTMLDivElement | null>(null);
  let plateBox = $state<Box>({ left: 0, top: 0, width: 1, height: 1 });
  let sourceWidth = $state(1);
  let sourceHeight = $state(1);
  let interaction = $state<Interaction | null>(null);

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

  function capture(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function beginDrag(event: PointerEvent): void {
    if (event.button !== 0) return;
    capture(event);
    interaction = {
      kind: 'drag',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: layer.artwork.transform.offsetX,
      offsetY: layer.artwork.transform.offsetY
    };
  }

  function beginScale(event: PointerEvent): void {
    if (event.button !== 0 || !surface) return;
    capture(event);
    const rect = surface.getBoundingClientRect();
    const centerX = rect.left + bounds.centerX;
    const centerY = rect.top + bounds.centerY;
    interaction = {
      kind: 'scale',
      pointerId: event.pointerId,
      centerX,
      centerY,
      distance: Math.max(1, Math.hypot(event.clientX - centerX, event.clientY - centerY)),
      scale: layer.artwork.transform.scale
    };
  }

  function beginStretch(event: PointerEvent, axis: 'x' | 'y', direction: -1 | 1): void {
    if (event.button !== 0) return;
    capture(event);
    interaction = {
      kind: axis === 'x' ? 'stretch-x' : 'stretch-y',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      direction,
      size: axis === 'x' ? bounds.width : bounds.height,
      stretch:
        axis === 'x' ? layer.artwork.transform.stretchX : layer.artwork.transform.stretchY,
      rotation: (bounds.rotation * Math.PI) / 180,
      offsetX: layer.artwork.transform.offsetX,
      offsetY: layer.artwork.transform.offsetY
    };
  }

  function beginRotate(event: PointerEvent): void {
    if (event.button !== 0 || !surface) return;
    capture(event);
    const rect = surface.getBoundingClientRect();
    const centerX = rect.left + bounds.centerX;
    const centerY = rect.top + bounds.centerY;
    interaction = {
      kind: 'rotate',
      pointerId: event.pointerId,
      centerX,
      centerY,
      angle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
      rotation: layer.artwork.transform.rotation
    };
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function normalizedDegrees(value: number): number {
    return ((value + 180) % 360 + 360) % 360 - 180;
  }

  function move(event: PointerEvent): void {
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (interaction.kind === 'drag') {
      workshop.setTransform(target, {
        offsetX: clamp(
          interaction.offsetX + (event.clientX - interaction.startX) / plateBox.width,
          -1,
          1
        ),
        offsetY: clamp(
          interaction.offsetY + (event.clientY - interaction.startY) / plateBox.height,
          -1,
          1
        )
      });
      return;
    }

    if (interaction.kind === 'scale') {
      const distance = Math.hypot(
        event.clientX - interaction.centerX,
        event.clientY - interaction.centerY
      );
      workshop.setTransform(target, {
        scale: clamp(interaction.scale * (distance / interaction.distance), 0.2, 4)
      });
      return;
    }

    if (interaction.kind === 'stretch-x' || interaction.kind === 'stretch-y') {
      const dx = event.clientX - interaction.startX;
      const dy = event.clientY - interaction.startY;
      const localDelta =
        interaction.kind === 'stretch-x'
          ? dx * Math.cos(interaction.rotation) + dy * Math.sin(interaction.rotation)
          : -dx * Math.sin(interaction.rotation) + dy * Math.cos(interaction.rotation);
      const ratio = Math.max(
        0.025,
        (interaction.size + localDelta * interaction.direction) / interaction.size
      );
      const value = clamp(interaction.stretch * ratio, 0.1, 4);
      const sizeDelta = interaction.size * (value / interaction.stretch - 1);
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
        target,
        interaction.kind === 'stretch-x'
          ? {
              stretchX: value,
              offsetX: clamp(interaction.offsetX + shiftX / plateBox.width, -1, 1),
              offsetY: clamp(interaction.offsetY + shiftY / plateBox.height, -1, 1)
            }
          : {
              stretchY: value,
              offsetX: clamp(interaction.offsetX + shiftX / plateBox.width, -1, 1),
              offsetY: clamp(interaction.offsetY + shiftY / plateBox.height, -1, 1)
            }
      );
      return;
    }

    if (interaction.kind !== 'rotate') return;
    const angle = Math.atan2(
      event.clientY - interaction.centerY,
      event.clientX - interaction.centerX
    );
    const delta = normalizedDegrees(((angle - interaction.angle) * 180) / Math.PI);
    const rotation = normalizedDegrees(interaction.rotation + delta);
    workshop.setTransform(target, { rotation: Math.round(rotation) });
  }

  function end(event: PointerEvent): void {
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    interaction = null;
  }

  function nudge(event: KeyboardEvent): void {
    const distance = event.shiftKey ? 0.025 : 0.005;
    const transform = layer.artwork.transform;
    const patch =
      event.key === 'ArrowLeft'
        ? { offsetX: clamp(transform.offsetX - distance, -1, 1) }
        : event.key === 'ArrowRight'
          ? { offsetX: clamp(transform.offsetX + distance, -1, 1) }
          : event.key === 'ArrowUp'
            ? { offsetY: clamp(transform.offsetY - distance, -1, 1) }
            : event.key === 'ArrowDown'
              ? { offsetY: clamp(transform.offsetY + distance, -1, 1) }
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
    onpointermove={move}
    onpointerup={end}
    onpointercancel={end}
  >
    <img
      class="source-probe"
      src={layer.artwork.source}
      alt=""
      onload={readSourceSize}
    />

    <div
      class="bounds"
      class:active={interaction !== null}
      style:left="{bounds.centerX}px"
      style:top="{bounds.centerY}px"
      style:width="{bounds.width}px"
      style:height="{bounds.height}px"
      style:transform="translate(-50%, -50%) rotate({bounds.rotation}deg)"
      role="button"
      aria-label="Selected artwork layer. Drag to move, use the handles to resize or rotate, or use the arrow keys to nudge."
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
</style>
