import type { Card } from '$lib/cards/types';
import type { Character, HeroCharacterCard } from '$lib/characters/types';

/** One shared scale so the Overview and its parent-owned Explore bar cannot drift. */
export const GALLERY_CARD_SIZE = { min: 110, max: 410, start: 260, step: 10 } as const;

export type GalleryCardSide = 'front' | 'back';

interface GalleryCardItemBase {
  /** Stable within the collection shown in one lightbox session. */
  key: string;
  label: string;
  meta: string;
  /** Authoritative published pixels. Absent in the editable Overview and on legacy rows. */
  previews?: Partial<Record<GalleryCardSide, string>>;
}

export interface GalleryPrintedCardItem extends GalleryCardItemBase {
  kind: 'card';
  card: Card;
  character: Character | null;
}

export interface GalleryDeckBackItem extends GalleryCardItemBase {
  kind: 'deck-back';
  character: Character;
}

export interface GalleryCharacterCardItem extends GalleryCardItemBase {
  kind: 'character-card';
  character: Character;
  entry: HeroCharacterCard | null;
}

/** Every card-shaped thing the Overview can inspect at full reading size. */
export type GalleryCardItem =
  | GalleryPrintedCardItem
  | GalleryDeckBackItem
  | GalleryCharacterCardItem;
