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

  const VERTEX_SHADER = `
    attribute vec3 position;
    attribute vec3 normal;
    attribute vec2 uv;
    uniform mat4 modelView;
    uniform mat4 projection;
    varying vec3 vNormal;
    varying vec2 vUv;
    void main() {
      vNormal = mat3(modelView) * normal;
      vUv = uv;
      gl_Position = projection * modelView * vec4(position, 1.0);
    }
  `;

  /*
   * Two lights and a floor bounce, which is enough to read a shape by: a key
   * from over the viewer's shoulder, a dim fill from the opposite side so the
   * dark side is not a silhouette, and a little ambient so nothing is black.
   */
  const FRAGMENT_SHADER = `
    precision mediump float;
    varying vec3 vNormal;
    varying vec2 vUv;
    uniform sampler2D map;
    uniform bool useMap;
    void main() {
      vec3 n = normalize(vNormal);
      float key = max(dot(n, normalize(vec3(0.4, 0.7, 0.8))), 0.0);
      float fill = max(dot(n, normalize(vec3(-0.6, 0.2, -0.4))), 0.0) * 0.35;
      float light = 0.25 + key * 0.75 + fill;
      vec3 base = useMap ? texture2D(map, vUv).rgb : vec3(0.72, 0.74, 0.78);
      gl_FragColor = vec4(base * light, 1.0);
    }
  `;

  function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Could not create a shader.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader failed to compile.');
    }
    return shader;
  }

  function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
    const f = 1 / Math.tan(fov / 2);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) / (near - far), -1,
      0, 0, (2 * far * near) / (near - far), 0
    ]);
  }

  /**
   * The model's own transform, as one matrix: centre it on the origin, turn it
   * to the current orbit, then push it away from the camera. Composed by hand
   * because it is always these three steps in this order.
   */
  function modelView(bounds: Mesh['bounds'], distance: number): Float32Array {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);

    // Yaw about Y, then pitch about X, in column-major order.
    const m00 = cy;
    const m01 = sp * sy;
    const m02 = -cp * sy;
    const m10 = 0;
    const m11 = cp;
    const m12 = sp;
    const m20 = sy;
    const m21 = -sp * cy;
    const m22 = cp * cy;

    const tx = bounds.center[0];
    const ty = bounds.center[1];
    const tz = bounds.center[2];

    // The centring translation runs *before* the rotation, so it is rotated too.
    const ox = -(m00 * tx + m10 * ty + m20 * tz);
    const oy = -(m01 * tx + m11 * ty + m21 * tz);
    const oz = -(m02 * tx + m12 * ty + m22 * tz);

    return new Float32Array([
      m00, m01, m02, 0,
      m10, m11, m12, 0,
      m20, m21, m22, 0,
      ox, oy, oz - distance, 1
    ]);
  }

  /**
   * One draw. Everything is rebuilt each frame — buffers, program, the lot.
   *
   * That is wasteful for an animation and exactly right here: the viewer redraws
   * only when the model or the camera changes, and rebuilding means there is no
   * GL state to leak when the component is swapped out from under it.
   */
  function draw(): void {
    if (!canvas || !mesh || mesh.triangles === 0) return;

    /*
     * `preserveDrawingBuffer` because this draws on demand rather than every
     * frame: without it the buffer is cleared after each composite and the
     * canvas can come back blank when the browser repaints it for reasons of
     * its own — a tab returning to the foreground, say.
     */
    const gl = canvas.getContext('webgl', {
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    if (!gl) {
      failure = 'This browser will not give the page a 3D context.';
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || 1;
    const displayHeight = canvas.clientHeight || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(displayHeight * dpr);

    try {
      const program = gl.createProgram();
      if (!program) throw new Error('Could not create a program.');
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) ?? 'Program failed to link.');
      }
      gl.useProgram(program);

      const attach = (name: string, data: Float32Array, size: number): void => {
        const location = gl.getAttribLocation(program, name);
        if (location < 0) return;
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
      };

      attach('position', mesh.positions, 3);
      attach('normal', mesh.normals, 3);
      attach('uv', mesh.uvs ?? new Float32Array((mesh.positions.length / 3) * 2), 2);

      const useMap = Boolean(mesh.uvs && textureImage);
      gl.uniform1i(gl.getUniformLocation(program, 'useMap'), useMap ? 1 : 0);
      if (useMap && textureImage) {
        const map = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, map);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textureImage);
        // Arbitrary sizes are allowed as long as the mode does not need mipmaps.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.uniform1i(gl.getUniformLocation(program, 'map'), 0);
      }

      const distance = (mesh.bounds.radius / zoom) * 3.2;
      gl.uniformMatrix4fv(
        gl.getUniformLocation(program, 'projection'),
        false,
        perspective(Math.PI / 5, canvas.width / canvas.height, distance / 100, distance * 10)
      );
      gl.uniformMatrix4fv(
        gl.getUniformLocation(program, 'modelView'),
        false,
        modelView(mesh.bounds, distance)
      );

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.DEPTH_TEST);
      /*
       * No back-face culling. Printed models are not reliably wound, and a
       * hole where a triangle faces the wrong way reads as a broken file
       * rather than as the viewer being strict.
       */
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.positions.length / 3);
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
