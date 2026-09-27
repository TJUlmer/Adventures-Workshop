import type { ArtTransform } from '$lib/core/artwork';

/**
 * Every direct-manipulation surface and precision control uses these limits.
 * Keeping them together prevents a drag from producing a value that the
 * neighbouring slider cannot represent or recover from.
 */
export const ARTWORK_TRANSFORM_LIMITS = {
  offset: { min: -1, max: 1 },
  scale: { min: 0.2, max: 4 },
  stretch: { min: 0.1, max: 4 },
  rotation: { min: -180, max: 180 }
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampArtworkOffset(value: number): number {
  return clamp(value, ARTWORK_TRANSFORM_LIMITS.offset.min, ARTWORK_TRANSFORM_LIMITS.offset.max);
}

export function clampArtworkScale(value: number): number {
  return clamp(value, ARTWORK_TRANSFORM_LIMITS.scale.min, ARTWORK_TRANSFORM_LIMITS.scale.max);
}

export function clampArtworkStretch(value: number): number {
  return clamp(value, ARTWORK_TRANSFORM_LIMITS.stretch.min, ARTWORK_TRANSFORM_LIMITS.stretch.max);
}

export function normalizeArtworkRotation(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

/** Copy the numbers a cancelled pointer session must restore. */
export function snapshotArtworkTransform(transform: ArtTransform): ArtTransform {
  return { ...transform };
}
