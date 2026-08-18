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
