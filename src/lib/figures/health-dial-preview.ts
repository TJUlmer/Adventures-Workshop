import {
  HEALTH_DIAL_CONTROLS,
  HEALTH_DIAL_INK,
  HEALTH_DIAL_MODEL_BOUNDS
} from '$lib/figures/health-dial';
import type { ModelAnnotation } from '$lib/models/gl';

const BUTTON_UNITS_PER_MODEL_UNIT = 700;
/** Thumbnail labels keep Lua's proportions but need less crowding on screen. */
const PREVIEW_LABEL_SCALE = 0.6;

/**
 * The replacement dial's scripted controls, in the mesh coordinates used by
 * its Tabletop Simulator Lua. The browser cannot execute that Lua, so the
 * shared 3D renderer projects these over the model for both live views and
 * still thumbnails.
 *
 * The y coordinate sits nearly flush with the mesh's upper face. The arrows
 * and RESET label are part of the skin rather than scripted text, so the
 * preview adds only the changing health value that TTS creates at runtime.
 */
export function healthDialPreviewAnnotations(value: number): readonly ModelAnnotation[] {
  const faceY = HEALTH_DIAL_MODEL_BOUNDS.max.y + 0.002;
  const normal = [0, 1, 0] as const;
  const common = {
    normal,
    color: HEALTH_DIAL_INK,
    weight: 700
  } as const;

  return [
    {
      ...common,
      text: String(Math.round(value)),
      position: [HEALTH_DIAL_CONTROLS.value.x, faceY, HEALTH_DIAL_CONTROLS.value.z],
      size: (600 / BUTTON_UNITS_PER_MODEL_UNIT) * PREVIEW_LABEL_SCALE
    }
  ];
}
