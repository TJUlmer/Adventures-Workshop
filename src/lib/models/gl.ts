/**
 * The hand-rolled WebGL draw call `ModelViewer.svelte` and a still snapshot
 * both need — one mesh, one texture, one camera, drawn to whatever canvas the
 * caller hands over. Pulled out from the viewer so a snapshot does not have
 * to fake being interactive to get the same picture.
 */
import type { Mesh } from './mesh';

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

/**
 * Everything a context has already been given, so a redraw does not build it
 * all again.
 *
 * This used to be built per draw — two shaders, a program, three buffers and
 * a full texture upload, every frame, with nothing ever deleted. The comment
 * defending that said rebuilding "means there is no GL state to leak when the
 * component is swapped out", which is true of the *component's* lifetime and
 * false of the *context's*: an orbit drag changes the camera on every
 * `pointermove`, so a few seconds of dragging uploaded hundreds of copies of
 * the same token art and the driver eventually refused to compile anything
 * more. That surfaces as `compileShader` failing with an **empty** info log —
 * the bare "Shader failed to compile." below, with no line number — which
 * reads like a broken shader and is not one.
 *
 * Keyed by the context rather than the canvas because that is what the objects
 * actually belong to, and dropped wholesale on context loss: every name in
 * here is invalid the moment that happens, and the same context object comes
 * back on restore, so the entry has to go or the stale program is reused.
 */
interface Cached {
  program: WebGLProgram;
  buffers: Map<string, WebGLBuffer>;
  /** The mesh whose vertex data is currently uploaded, by identity. */
  mesh: Mesh | null;
  texture: WebGLTexture | null;
  /** The image currently in `texture`, by identity. */
  uploaded: HTMLImageElement | null;
}

const contexts = new WeakMap<WebGLRenderingContext, Cached>();

function programFor(gl: WebGLRenderingContext): Cached {
  const existing = contexts.get(gl);
  if (existing) return existing;

  const program = gl.createProgram();
  if (!program) throw new Error('Could not create a program.');
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'Program failed to link.');
  }

  const cached: Cached = {
    program,
    buffers: new Map(),
    mesh: null,
    texture: null,
    uploaded: null
  };
  contexts.set(gl, cached);
  return cached;
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
 * to the given orbit, then push it away from the camera. Composed by hand
 * because it is always these three steps in this order.
 */
function modelView(bounds: Mesh['bounds'], distance: number, yaw: number, pitch: number): Float32Array {
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

export interface Camera {
  yaw: number;
  pitch: number;
  zoom: number;
}

/**
 * Draw one frame of `mesh` to `canvas`, sized to the canvas's own current
 * width/height. Throws rather than returning a status, so an interactive
 * caller and a one-shot snapshot can each decide what "could not draw"
 * means for them — a message on screen, or simply no picture.
 */
export function renderMeshToCanvas(
  canvas: HTMLCanvasElement,
  mesh: Mesh,
  textureImage: HTMLImageElement | null,
  camera: Camera
): void {
  /*
   * `preserveDrawingBuffer` because a caller may read the canvas back (a
   * snapshot's `toDataURL`, or the viewer's on-demand redraw surviving a
   * repaint) rather than compositing every frame.
   */
  const gl = canvas.getContext('webgl', {
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true
  });
  if (!gl) throw new Error('This browser will not give the page a 3D context.');

  /*
   * A lost context answers every call without complaint and reports failure
   * with no message at all, so the checks below would otherwise surface it as
   * "Shader failed to compile." Said plainly here instead, and said as the
   * temporary condition it is — `drawMeshInto` asks for a redraw on restore.
   */
  if (gl.isContextLost()) {
    throw new Error('The 3D view lost its graphics context. It should come back on its own.');
  }

  const cached = programFor(gl);
  const { program } = cached;
  gl.useProgram(program);

  /*
   * The pointer state is re-established every draw and the *data* only when
   * the mesh itself changes. Attribute bindings are global in WebGL 1 with no
   * vertex array objects, so one shared context drawing several different
   * models cannot inherit the last one's pointers; the upload, which is the
   * expensive half, is what the identity check saves.
   */
  const fresh = cached.mesh !== mesh;
  const attach = (name: string, data: Float32Array, size: number): void => {
    const location = gl.getAttribLocation(program, name);
    if (location < 0) return;
    let buffer = cached.buffers.get(name);
    if (!buffer) {
      const created = gl.createBuffer();
      if (!created) throw new Error('Could not create a buffer.');
      buffer = created;
      cached.buffers.set(name, buffer);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    if (fresh) gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  };

  attach('position', mesh.positions, 3);
  attach('normal', mesh.normals, 3);
  attach('uv', mesh.uvs ?? new Float32Array((mesh.positions.length / 3) * 2), 2);
  cached.mesh = mesh;

  const useMap = Boolean(mesh.uvs && textureImage);
  gl.uniform1i(gl.getUniformLocation(program, 'useMap'), useMap ? 1 : 0);
  if (useMap && textureImage) {
    if (!cached.texture) {
      const created = gl.createTexture();
      if (!created) throw new Error('Could not create a texture.');
      cached.texture = created;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cached.texture);
    /*
     * Re-uploaded only when the picture actually changes. This is the one that
     * mattered: a token's art is a full-size bitmap, and re-sending it on every
     * frame of a drag is what exhausted the driver.
     */
    if (cached.uploaded !== textureImage) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textureImage);
      // Arbitrary sizes are allowed as long as the mode does not need mipmaps.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      cached.uploaded = textureImage;
    }
    gl.uniform1i(gl.getUniformLocation(program, 'map'), 0);
  }

  const distance = (mesh.bounds.radius / camera.zoom) * 3.2;
  gl.uniformMatrix4fv(
    gl.getUniformLocation(program, 'projection'),
    false,
    perspective(Math.PI / 5, canvas.width / canvas.height, distance / 100, distance * 10)
  );
  gl.uniformMatrix4fv(
    gl.getUniformLocation(program, 'modelView'),
    false,
    modelView(mesh.bounds, distance, camera.yaw, camera.pitch)
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
}

/*
 * ---------------------------------------------------------------------------
 * One context, however many previews
 * ---------------------------------------------------------------------------
 *
 * `renderMeshToCanvas` draws to whichever canvas it is handed, and a caller
 * that hands over its own visible canvas owns a WebGL context for as long as
 * that canvas lives. That is fine for one viewer and breaks at scale: browsers
 * cap live contexts per page — Chrome in the mid-teens — and **silently lose
 * the oldest** once the cap is passed. `FiguresPanel` mounts a viewer per
 * figure, so an author with nineteen token components had three dead previews
 * before touching anything, each reporting "Shader failed to compile.", and
 * toggling one off and on did not repair it so much as move the failure to
 * whichever preview was then oldest.
 *
 * `snapshot.ts` already reached this conclusion for the thumbnail grid and
 * says so in its own header. This is the same answer for the interactive case:
 * draw through one offscreen context and blit the result into an ordinary 2D
 * canvas, of which a page may have as many as it likes. Two contexts exist in
 * the whole app — this one and the snapshot's — whatever the figure count.
 */

let sharedCanvas: HTMLCanvasElement | null = null;

/** Redrawn by every live viewer after the context comes back. */
const restoreListeners = new Set<() => void>();

/**
 * Ask to be told when the shared context is restored, so a viewer can draw
 * itself again. Returns its own unsubscribe, for an effect's teardown.
 */
export function onContextRestored(listener: () => void): () => void {
  restoreListeners.add(listener);
  return () => restoreListeners.delete(listener);
}

function sharedSource(): HTMLCanvasElement {
  if (sharedCanvas) return sharedCanvas;

  const canvas = document.createElement('canvas');

  /*
   * `preventDefault` is what makes the loss recoverable at all — without it
   * the browser never fires `webglcontextrestored`. The cached program and
   * buffers belong to a context that no longer has them, so the entry goes
   * too; `programFor` rebuilds on the next draw.
   */
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    const gl = canvas.getContext('webgl');
    if (gl) contexts.delete(gl);
  });

  canvas.addEventListener('webglcontextrestored', () => {
    for (const listener of restoreListeners) listener();
  });

  sharedCanvas = canvas;
  return canvas;
}

/**
 * Draw `mesh` into an ordinary 2D canvas, by way of the one shared 3D context.
 *
 * The target needs no WebGL of its own, so a page may show as many previews as
 * it likes. Sizing the source to the target each time is what keeps the
 * viewport and the aspect right; the canvas keeps its context across a resize,
 * so this costs a buffer reallocation and nothing else.
 *
 * This is the second reason `renderMeshToCanvas` asks for
 * `preserveDrawingBuffer` — the blit reads the 3D canvas back after the draw
 * has returned, which is exactly the case that option exists for.
 */
export function drawMeshInto(
  target: HTMLCanvasElement,
  mesh: Mesh,
  textureImage: HTMLImageElement | null,
  camera: Camera
): void {
  const source = sharedSource();
  if (source.width !== target.width || source.height !== target.height) {
    source.width = target.width;
    source.height = target.height;
  }

  renderMeshToCanvas(source, mesh, textureImage, camera);

  const context = target.getContext('2d');
  if (!context) throw new Error('This browser will not give the page a 2D context.');
  context.clearRect(0, 0, target.width, target.height);
  context.drawImage(source, 0, 0);
}
