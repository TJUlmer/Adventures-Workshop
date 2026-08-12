/**
 * Artwork references, placement and treatment.
 *
 * A reference is always local — a data URL from a file the user picked. The app
 * never fetches remote images.
 *
 * Placement is split in two on purpose:
 *  - `crop` selects a rectangle of the *source* image, the way a crop tool does.
 *  - `transform` scales, offsets and rotates what is left inside the window.
 * Keeping them separate means re-cropping does not throw away a careful
 * position, and either can be reset alone.
 */

export interface CropRect {
  /** Left edge, 0..1 of source width. */
  x: number;
  /** Top edge, 0..1 of source height. */
  y: number;
  /** Visible width, 0..1 of source width. */
  width: number;
  /** Visible height, 0..1 of source height. */
  height: number;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

export interface ArtTransform {
  /** 1 = fill the window. */
  scale: number;
  /** Offset as a fraction of the window, so it survives a resize. */
  offsetX: number;
  offsetY: number;
  /** Degrees. */
  rotation: number;
  flipX: boolean;
}

export const DEFAULT_TRANSFORM: ArtTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  flipX: false
};

/** Non-destructive colour grade. All values are multipliers except hue. */
export interface ArtAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  /** Degrees of hue rotation. */
  hue: number;
  /** 0..1 */
  blur: number;
  /** 0..1, mixes the image toward greyscale. */
  grayscale: number;
  /** 0..1, mixes the image toward sepia. */
  sepia: number;
}

export const DEFAULT_ADJUSTMENTS: ArtAdjustments = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  hue: 0,
  blur: 0,
  grayscale: 0,
  sepia: 0
};

export const ART_MASKS = ['none', 'vignette', 'fade-bottom', 'fade-edges', 'oval'] as const;
export type ArtMask = (typeof ART_MASKS)[number];

export const ART_MASK_LABELS: Readonly<Record<ArtMask, string>> = {
  none: 'None',
  vignette: 'Vignette',
  'fade-bottom': 'Fade bottom',
  'fade-edges': 'Fade edges',
  oval: 'Oval'
} as const;

export interface ArtEffects {
  mask: ArtMask;
  /** 0..1. How strongly the mask bites. */
  maskStrength: number;
  /** Darkening laid over the image, 0..1. */
  vignette: number;
}

export const DEFAULT_EFFECTS: ArtEffects = {
  mask: 'none',
  maskStrength: 0.6,
  vignette: 0
};

export interface Artwork {
  /** Data URL. `null` until the author picks an image. */
  source: string | null;
  /** Original file name, so a missing source is still identifiable. */
  label: string;
  /** Attribution, rendered in the card's fine print. */
  credit: string;
  crop: CropRect;
  transform: ArtTransform;
  adjustments: ArtAdjustments;
  effects: ArtEffects;
}

/**
 * Seed values. The nested blocks are partial too, so a document saved before a
 * field existed can be repaired one key at a time.
 */
export interface ArtworkInit {
  source?: string | null;
  label?: string;
  credit?: string;
  crop?: Partial<CropRect>;
  transform?: Partial<ArtTransform>;
  adjustments?: Partial<ArtAdjustments>;
  effects?: Partial<ArtEffects>;
}

export function createArtwork(init: ArtworkInit = {}): Artwork {
  return {
    source: null,
    label: '',
    credit: '',
    ...init,
    crop: { ...FULL_CROP, ...init.crop },
    transform: { ...DEFAULT_TRANSFORM, ...init.transform },
    adjustments: { ...DEFAULT_ADJUSTMENTS, ...init.adjustments },
    effects: { ...DEFAULT_EFFECTS, ...init.effects }
  };
}

export function cloneArtwork(artwork: Artwork): Artwork {
  return {
    ...artwork,
    crop: { ...artwork.crop },
    transform: { ...artwork.transform },
    adjustments: { ...artwork.adjustments },
    effects: { ...artwork.effects }
  };
}

export function hasArtwork(artwork: Artwork): boolean {
  return artwork.source !== null && artwork.source.length > 0;
}

// -- CSS projection -----------------------------------------------------

/**
 * Layout for the cropped image inside a window it should fill.
 * The crop rectangle is scaled up so the visible slice covers the window; the
 * transform is then applied on top.
 */
export interface ArtLayout {
  width: string;
  height: string;
  left: string;
  top: string;
  transform: string;
  filter: string;
}

export function artLayout(artwork: Artwork): ArtLayout {
  const { crop, transform, adjustments } = artwork;
  const width = crop.width > 0 ? crop.width : 1;
  const height = crop.height > 0 ? crop.height : 1;

  const filters = [
    `brightness(${adjustments.brightness})`,
    `contrast(${adjustments.contrast})`,
    `saturate(${adjustments.saturation})`,
    adjustments.hue !== 0 ? `hue-rotate(${adjustments.hue}deg)` : '',
    adjustments.grayscale > 0 ? `grayscale(${adjustments.grayscale})` : '',
    adjustments.sepia > 0 ? `sepia(${adjustments.sepia})` : '',
    adjustments.blur > 0 ? `blur(${(adjustments.blur * 2).toFixed(2)}cqw)` : ''
  ].filter(Boolean);

  const parts = [
    `translate(${(transform.offsetX * 100).toFixed(3)}%, ${(transform.offsetY * 100).toFixed(3)}%)`,
    `rotate(${transform.rotation}deg)`,
    `scale(${(transform.flipX ? -transform.scale : transform.scale).toFixed(4)}, ${transform.scale.toFixed(4)})`
  ];

  return {
    width: `${(100 / width).toFixed(4)}%`,
    height: `${(100 / height).toFixed(4)}%`,
    left: `${(-(crop.x / width) * 100).toFixed(4)}%`,
    top: `${(-(crop.y / height) * 100).toFixed(4)}%`,
    transform: parts.join(' '),
    filter: filters.join(' ')
  };
}

/** CSS `mask-image` for the art window's soft-edge treatment. */
export function artMaskCss(effects: ArtEffects): string | null {
  const strength = Math.min(1, Math.max(0, effects.maskStrength));
  const edge = `${(100 - strength * 55).toFixed(1)}%`;

  switch (effects.mask) {
    case 'vignette':
      return `radial-gradient(ellipse at center, #000 ${edge}, transparent 100%)`;
    case 'fade-bottom':
      return `linear-gradient(180deg, #000 ${(100 - strength * 70).toFixed(1)}%, transparent 100%)`;
    case 'fade-edges':
      return `radial-gradient(ellipse 120% 120% at center, #000 ${edge}, transparent 100%)`;
    case 'oval':
      return `radial-gradient(ellipse 74% 88% at center, #000 ${(strength * 92).toFixed(1)}%, transparent 100%)`;
    case 'none':
      return null;
  }
}
