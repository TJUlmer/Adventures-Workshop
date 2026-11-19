import { createArtwork, hasArtwork } from '$lib/core/artwork';
import type { Artwork, ArtworkInit } from '$lib/core/artwork';
import { customSymbolToken } from '$lib/text/tokens';
import type { ActionCard, Card, CardCopyVisual, CopySymbolSlot } from './types';
import { COPY_STYLE_KEYS } from './types';
import type { CardCopyStyle } from './types';

function pickCopyStyle(style: CardCopyStyle | undefined): CardCopyStyle | undefined {
  if (!style) return undefined;
  return Object.fromEntries(COPY_STYLE_KEYS.flatMap((key) => {
    const value = style[key];
    return value === undefined ? [] : [[key, typeof value === 'object' ? { ...value } : value]];
  })) as CardCopyStyle;
}

export function copyStyleFor(card: Card | null, copy = 1): CardCopyStyle | undefined {
  if (card?.type !== 'action' || copy < 1 || copy > physicalCopyCount(card) ||
      (card.useReplacement && hasArtwork(card.replacement))) return undefined;
  return pickCopyStyle(card.copyVisuals.find((entry) => entry.copy === copy)?.style);
}

export function cloneCopyVisuals(visuals: readonly CardCopyVisual[]): CardCopyVisual[] {
  return visuals.map((visual) => ({
    copy: visual.copy,
    ...(visual.style ? { style: pickCopyStyle(visual.style) } : {}),
    ...(visual.boostSymbol !== undefined ? { boostSymbol: visual.boostSymbol } : {}),
    ...(visual.ribbonSymbol !== undefined ? { ribbonSymbol: visual.ribbonSymbol } : {}),
    ...(visual.boost !== undefined ? { boost: visual.boost } : {}),
    ...(visual.tuckEffect !== undefined ? { tuckEffect: visual.tuckEffect } : {}),
    ...(visual.cornerBadge !== undefined ? { cornerBadge: visual.cornerBadge } : {}),
    ...(visual.artwork ? { artwork: { ...visual.artwork,
      ...Object.fromEntries((['crop', 'transform', 'adjustments', 'effects'] as const)
        .filter((group) => visual.artwork?.[group])
        .map((group) => [group, { ...visual.artwork?.[group] }])) } } : {}),
    ...(visual.symbols ? { symbols: { ...visual.symbols } } : {})
  }));
}

export function physicalCopyCount(card: Card): number {
  return Number.isFinite(card.quantity) ? Math.max(1, Math.trunc(card.quantity)) : 1;
}

export function physicalCopies(card: Card): number[] {
  return Array.from({ length: physicalCopyCount(card) }, (_, index) => index + 1);
}

export function mergeCopyArtwork(base: Artwork, override?: ArtworkInit): Artwork {
  if (!override) return base;
  return createArtwork({
    source: override.source === undefined ? base.source : override.source,
    label: override.label ?? base.label,
    crop: { ...base.crop, ...override.crop },
    transform: { ...base.transform, ...override.transform },
    adjustments: { ...base.adjustments, ...override.adjustments },
    effects: { ...base.effects, ...override.effects }
  });
}

/** Icon choices are independent of the shared icon, but keep shared visibility. */
export function copySymbolAvailable(card: ActionCard, slot: CopySymbolSlot): boolean {
  if (slot === 'ribbonSymbol') return card.showRibbonSymbol;
  if (slot === 'cornerBadge') return card.showCornerBadge;
  return true;
}

/** Zero means shared artwork in the editor; elsewhere copy 1 is representative. */
export function resolveCardCopy<T extends Card>(card: T, copy = 1): T {
  if (card.type !== 'action' || copy < 1 || copy > physicalCopyCount(card) || (card.useReplacement && hasArtwork(card.replacement))) return card;
  const visual = card.copyVisuals?.find((entry) => entry.copy === copy);
  if (!visual) return card;
  const resolved: ActionCard = { ...card, artwork: mergeCopyArtwork(card.artwork, visual.artwork) };
  for (const slot of ['ribbonSymbol', 'boostSymbol', 'cornerBadge'] as const) {
    const symbol = visual.symbols?.[slot];
    if (symbol && copySymbolAvailable(card, slot)) resolved[slot] = customSymbolToken(symbol);
  }
  if (visual.boost !== undefined) resolved.boost = visual.boost;
  if (visual.boostSymbol !== undefined) resolved.boostSymbol = visual.boostSymbol;
  if (card.showRibbonSymbol && visual.ribbonSymbol !== undefined) resolved.ribbonSymbol = visual.ribbonSymbol;
  if (card.showTuckEffect && visual.tuckEffect !== undefined) resolved.tuckEffect = visual.tuckEffect;
  if (card.showCornerBadge && visual.cornerBadge !== undefined) resolved.cornerBadge = visual.cornerBadge;
  if (visual.style) resolved.style = { ...card.style, ...copyStyleFor(card, copy) };
  return resolved as T;
}

/** Render-equivalent copies share image jobs, but never lose physical quantity. */
export function cardAppearanceCopies(card: Card): number[] {
  if (card.type !== 'action' || !card.copyVisuals?.length || (card.useReplacement && hasArtwork(card.replacement))) return [1];
  const seen: ActionCard[] = [];
  return physicalCopies(card).filter((copy) => {
    const resolved = resolveCardCopy(card, copy);
    if (seen.some((face) => sameAppearance(face, resolved))) return false;
    seen.push(resolved);
    return true;
  });
}

export function appearanceCopyFor(card: Card, copy = 1): number {
  if (card.type !== 'action') return 1;
  const resolved = resolveCardCopy(card, copy);
  return cardAppearanceCopies(card).find((candidate) => {
    const face = resolveCardCopy(card, candidate);
    return sameAppearance(face, resolved);
  }) ?? 1;
}

function sameAppearance(a: ActionCard, b: ActionCard): boolean {
  // Compare source strings directly: serializing a multi-megabyte image for
  // every thumbnail/copy would dominate gallery updates.
  return a.artwork.source === b.artwork.source && a.ribbonSymbol === b.ribbonSymbol &&
    a.boostSymbol === b.boostSymbol && a.cornerBadge === b.cornerBadge &&
    (Boolean(a.boostSymbol) || a.boost === b.boost) &&
    (!a.showTuckEffect || a.tuckEffect === b.tuckEffect) &&
    JSON.stringify(COPY_STYLE_KEYS.map((key) => a.style[key])) === JSON.stringify(COPY_STYLE_KEYS.map((key) => b.style[key])) &&
    JSON.stringify([a.artwork.crop, a.artwork.transform, a.artwork.adjustments, a.artwork.effects]) ===
    JSON.stringify([b.artwork.crop, b.artwork.transform, b.artwork.adjustments, b.artwork.effects]);
}
