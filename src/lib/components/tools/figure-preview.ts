import { buildTokenPreviewMesh, resolvedTokenSpec, tokenTextureUrl } from '$lib/export/token-model';
import type { Figure } from '$lib/figures/types';
import { generatedTokenSpec } from '$lib/figures/types';
import { isViewableModel, loadMesh } from '$lib/models/load';
import type { Mesh } from '$lib/models/mesh';
import { MM_PER_TTS_UNIT } from '$lib/models/token';

export interface FigurePreviewModel {
  mesh: Mesh;
  texture: string | null;
  /** Physical calibration for the viewer grid; null for unitless attached meshes. */
  millimetresPerUnit: number | null;
  /** A useful mesh can still be shown when only its generated paint failed. */
  warning: string | null;
}

/**
 * A content key for the geometry and texture that make up a component preview.
 * `null` means the component only has flat reference artwork to inspect.
 */
export function figurePreviewKey(figure: Figure): string | null {
  const spec = generatedTokenSpec(figure);
  if (spec) {
    return [
      'token',
      figure.kind,
      JSON.stringify(spec),
      figure.reference.source ?? '',
      figure.reference.transform.scale,
      figure.token.outlineDetail,
      figure.token.rimColor,
      figure.kind === 'dial' ? figure.dialRange.max : ''
    ].join('|');
  }

  const modelName = figure.model?.name ?? '';
  const modelSource = figure.model?.source ?? null;
  if (modelSource === null || !isViewableModel(modelName)) return null;
  return `model|${modelName}|${modelSource}|${figure.reference.source ?? ''}`;
}

/**
 * Resolve the same viewable mesh for both Overview thumbnails and the modal.
 * Generated silhouettes are deliberately re-resolved here: a shared set has
 * never passed through the figure editor's own retrace effect, so its stored
 * outline may be stale relative to the embedded reference art.
 */
export async function loadFigurePreview(figure: Figure): Promise<FigurePreviewModel | null> {
  const spec = generatedTokenSpec(figure);
  if (spec) {
    const resolved = await resolvedTokenSpec(figure, spec);
    const mesh = buildTokenPreviewMesh(figure, resolved);
    if (mesh.triangles === 0) throw new Error('The generated component contains no triangles.');
    try {
      return {
        mesh,
        texture: await tokenTextureUrl(figure),
        millimetresPerUnit: MM_PER_TTS_UNIT,
        warning: null
      };
    } catch (error) {
      return {
        mesh,
        texture: null,
        millimetresPerUnit: MM_PER_TTS_UNIT,
        warning: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const modelName = figure.model?.name ?? '';
  const modelSource = figure.model?.source ?? null;
  if (modelSource === null || !isViewableModel(modelName)) return null;
  const mesh = await loadMesh(modelName, modelSource);
  if (mesh.triangles === 0) throw new Error('The attached model contains no triangles.');
  return {
    mesh,
    texture: figure.reference.source,
    millimetresPerUnit: null,
    warning: null
  };
}

/** The token rasteriser hands ownership of generated blob URLs to its caller. */
export function releaseFigurePreview(preview: FigurePreviewModel | null): void {
  if (preview?.texture?.startsWith('blob:')) URL.revokeObjectURL(preview.texture);
}
