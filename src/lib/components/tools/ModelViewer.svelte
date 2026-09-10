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
  import { drawMeshInto, onContextRestored } from '$lib/models/gl';

  interface Props {
    mesh: Mesh | null;
    /** Painted over the mesh when it carries texture coordinates. */
    texture?: string | null;
    /** A number is pixels; CSS lengths let modal callers follow the viewport. */
    height?: number | string;
    /** Lets a larger inspection surface fall back to reference artwork. */
    onfailure?: (message: string | null) => void;
  }

  let { mesh, texture = null, height = 260, onfailure }: Props = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let failure = $state<string | null>(null);

  /** Camera, in the only two terms an orbit needs. */
  let yaw = $state(0.6);
  let pitch = $state(0.5);
  let zoom = $state(1);
  let dragging = $state(false);

  function setFailure(message: string | null): void {
    if (failure === message) return;
    failure = message;
    const currentCanvas = canvas;
    if (message && currentCanvas && currentCanvas === document.activeElement) currentCanvas.blur();
    onfailure?.(message);
  }

  /**
   * One draw, through the shared 3D context rather than one of this canvas's
   * own — see `drawMeshInto`. This canvas is an ordinary 2D one, which is what
   * lets a panel show a preview per figure: WebGL contexts are capped per page
   * and the browser silently loses the oldest past the cap, so nineteen
   * components meant three previews that were dead before anyone touched them.
   *
   * An earlier note here claimed rebuilding the program and buffers every frame
   * meant "no GL state to leak". That held for this component's lifetime and
   * not for the context's: `orbit` moves the camera on every `pointermove`, so
   * a drag redrew continuously and re-uploaded the token art each time.
   * `gl.ts` caches both now.
   */
  function draw(): void {
    if (!canvas || !mesh || mesh.triangles === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || 1;
    const displayHeight = canvas.clientHeight || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(displayHeight * dpr);

    try {
      drawMeshInto(canvas, mesh, textureImage, { yaw, pitch, zoom });
      setFailure(null);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not draw the model.');
    }
  }

  let textureImage = $state<HTMLImageElement | null>(null);

  $effect(() => {
    const source = texture;
    if (!source) {
      textureImage = null;
      return;
    }
    textureImage = null;
    const image = new Image();
    let current = true;
    image.onload = () => {
      if (current) textureImage = image;
    };
    image.src = source;
    return () => {
      current = false;
      image.onload = null;
    };
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

  /*
   * A lost context is recoverable and used not to be recovered from: the
   * picture stayed broken until the whole component was unmounted and built
   * again, which is what made toggling "build a token from the image" look
   * like a fix. Redrawing on restore is the actual one.
   */
  $effect(() => onContextRestored(() => draw()));

  function orbit(event: PointerEvent): void {
    if (!dragging || !event.isPrimary) return;
    yaw += event.movementX * 0.01;
    // Stopped just short of the poles, where the up vector flips and the
    // model appears to spin on its own.
    pitch = Math.min(1.5, Math.max(-1.5, pitch + event.movementY * 0.01));
  }

  function reset(): void {
    yaw = 0.6;
    pitch = 0.5;
    zoom = 1;
  }

  function changeZoom(factor: number): void {
    zoom = Math.min(6, Math.max(0.3, zoom * factor));
  }

  function control(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') yaw -= 0.12;
    else if (event.key === 'ArrowRight') yaw += 0.12;
    else if (event.key === 'ArrowUp') pitch = Math.max(-1.5, pitch - 0.12);
    else if (event.key === 'ArrowDown') pitch = Math.min(1.5, pitch + 0.12);
    else if (event.key === '+' || event.key === '=') changeZoom(1.12);
    else if (event.key === '-' || event.key === '_') changeZoom(0.89);
    else if (event.key === '0') reset();
    else return;
    event.preventDefault();
  }
</script>

<div class="viewer" style:height={typeof height === 'number' ? `${height}px` : height}>
  {#if mesh && mesh.triangles > 0}
    <!-- The canvas itself takes keyboard focus; the visible buttons mirror zoom/reset for touch. -->
    <canvas
      bind:this={canvas}
      class:dragging
      tabindex={failure ? -1 : 0}
      aria-hidden={failure ? 'true' : undefined}
      aria-label="Interactive 3D preview, {mesh.triangles.toLocaleString()} triangles. Drag or use arrow keys to rotate; plus and minus zoom."
      onpointerdown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        dragging = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onpointermove={orbit}
      onpointerup={(event) => {
        dragging = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onpointercancel={() => (dragging = false)}
      onwheel={(event) => {
        event.preventDefault();
        changeZoom(event.deltaY > 0 ? 0.9 : 1.1);
      }}
      onkeydown={control}
    ></canvas>

    <div class="meta">
      <span class="numeric">{mesh.triangles.toLocaleString()} triangles</span>
      <span class="controls" inert={Boolean(failure)} aria-hidden={failure ? 'true' : undefined}>
        <button type="button" aria-label="Zoom out" onclick={() => changeZoom(0.89)}>−</button>
        <button type="button" class="reset" onclick={reset}>Reset view</button>
        <button type="button" aria-label="Zoom in" onclick={() => changeZoom(1.12)}>+</button>
      </span>
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

  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 2px;
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--grey-1000) 62%, transparent);
    pointer-events: auto;
  }

  .controls button {
    pointer-events: auto;
    min-width: 24px;
    min-height: 24px;
    padding: 2px var(--space-2);
    border-radius: var(--radius-xs);
    font-size: var(--text-2xs);
    color: var(--text-secondary);
  }

  .controls button:hover {
    color: var(--text-primary);
    background: var(--surface-hover);
  }

  @media (pointer: coarse) {
    .controls button {
      min-width: 44px;
      min-height: 44px;
      background: var(--surface-inset);
    }
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
