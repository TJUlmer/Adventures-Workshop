<script lang="ts">
  /**
   * A model, on screen. View only — orbit, zoom, and nothing else.
   *
   * Hand-rolled WebGL rather than a library, for the same reason the ZIP writer
   * and the card rasteriser are hand-rolled: this app ships as one offline
   * file, and a scene graph, a loader stack and a material system are a lot to
   * carry for "show me the thing I attached".
   */
  import type { Mesh } from '$lib/models/mesh';
  import { renderMeshToCanvas } from '$lib/models/gl';

  interface Props {
    mesh: Mesh | null;
    /** Painted over the mesh when it carries texture coordinates. */
    texture?: string | null;
    height?: number;
  }

  let { mesh, texture = null, height = 260 }: Props = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let failure = $state<string | null>(null);

  /** Camera, in the only two terms an orbit needs. */
  let yaw = $state(0.6);
  let pitch = $state(0.5);
  let zoom = $state(1);
  let dragging = $state(false);

  /**
   * One draw. Everything is rebuilt each frame — buffers, program, the lot.
   *
   * That is wasteful for an animation and exactly right here: the viewer redraws
   * only when the model or the camera changes, and rebuilding means there is no
   * GL state to leak when the component is swapped out from under it.
   */
  function draw(): void {
    if (!canvas || !mesh || mesh.triangles === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || 1;
    const displayHeight = canvas.clientHeight || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(displayHeight * dpr);

    try {
      renderMeshToCanvas(canvas, mesh, textureImage, { yaw, pitch, zoom });
      failure = null;
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : 'Could not draw the model.';
    }
  }

  let textureImage = $state<HTMLImageElement | null>(null);

  $effect(() => {
    const source = texture;
    if (!source) {
      textureImage = null;
      return;
    }
    const image = new Image();
    image.onload = () => (textureImage = image);
    image.src = source;
  });

  // Redraw when anything the picture depends on moves.
  $effect(() => {
    void mesh;
    void textureImage;
    void yaw;
    void pitch;
    void zoom;
    draw();
  });

  $effect(() => {
    if (!canvas) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  function orbit(event: PointerEvent): void {
    if (!dragging) return;
    yaw += event.movementX * 0.01;
    // Stopped just short of the poles, where the up vector flips and the
    // model appears to spin on its own.
    pitch = Math.min(1.5, Math.max(-1.5, pitch + event.movementY * 0.01));
  }
</script>

<div class="viewer" style:height="{height}px">
  {#if mesh && mesh.triangles > 0}
    <!-- Drag to turn it, wheel to zoom. There is nothing here to activate. -->
    <canvas
      bind:this={canvas}
      class:dragging
      aria-label="3D preview, {mesh.triangles.toLocaleString()} triangles"
      onpointerdown={(event) => {
        dragging = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onpointermove={orbit}
      onpointerup={(event) => {
        dragging = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onpointercancel={() => (dragging = false)}
      onwheel={(event) => {
        event.preventDefault();
        zoom = Math.min(6, Math.max(0.3, zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
      }}
    ></canvas>

    <div class="meta">
      <span class="numeric">{mesh.triangles.toLocaleString()} triangles</span>
      <button type="button" class="reset" onclick={() => { yaw = 0.6; pitch = 0.5; zoom = 1; }}>
        Reset view
      </button>
    </div>
  {:else}
    <p class="empty">Nothing to show.</p>
  {/if}

  {#if failure}<p class="failure">{failure}</p>{/if}
</div>

<style>
  .viewer {
    position: relative;
    border-radius: var(--radius-md);
    background:
      radial-gradient(ellipse at 50% 30%, var(--grey-800), var(--grey-1000) 70%);
    border: 1px solid var(--border-subtle);
    overflow: hidden;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    cursor: grab;
    touch-action: none;
  }

  canvas.dragging {
    cursor: grabbing;
  }

  .meta {
    position: absolute;
    left: var(--space-3);
    right: var(--space-3);
    bottom: var(--space-2);
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    pointer-events: none;
  }

  .reset {
    pointer-events: auto;
    padding: 2px var(--space-2);
    border-radius: var(--radius-xs);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .reset:hover {
    color: var(--text-primary);
    background: var(--surface-hover);
  }

  .empty,
  .failure {
    display: grid;
    place-items: center;
    height: 100%;
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .failure {
    position: absolute;
    inset: 0;
    padding: var(--space-4);
    text-align: center;
    background: var(--grey-1000);
    color: var(--danger);
  }
</style>
