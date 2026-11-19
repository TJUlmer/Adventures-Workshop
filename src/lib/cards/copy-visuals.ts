import { createArtwork, hasArtwork } from '$lib/core/artwork';
import type { Artwork, ArtworkInit } from '$lib/core/artwork';
import { customSymbolToken } from '$lib/text/tokens';
import type { ActionCard, Card, CardCopyVisual, CopySymbolSlot } from './types';

export function cloneCopyVisuals(visuals: readonly CardCopyVisual[]): CardCopyVisual[] {
  return visuals.map((visual) => ({
    copy: visual.copy,
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

/** Substitution is allowed only in an already configured, symbol-only slot. */
export function copySymbolAvailable(card: ActionCard, slot: CopySymbolSlot): boolean {
  if (slot === 'ribbonSymbol' && !card.showRibbonSymbol) return false;
  if (slot === 'cornerBadge' && !card.showCornerBadge) return false;
  return /^\{\{custom:[^{}]+\}\}$/.test(card[slot].trim());
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
    JSON.stringify([a.artwork.crop, a.artwork.transform, a.artwork.adjustments, a.artwork.effects]) ===
    JSON.stringify([b.artwork.crop, b.artwork.transform, b.artwork.adjustments, b.artwork.effects]);
}
