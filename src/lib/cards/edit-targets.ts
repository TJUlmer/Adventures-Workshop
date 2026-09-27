import type { CardId } from './types';

export type AbilitySourceRegion = 'primary-ability' | 'defense-ability';
export type AbilityParagraphField =
  | 'plain'
  | 'immediately'
  | 'duringCombat'
  | 'afterCombat';

/**
 * The stored source behind one visible part of an action card.
 *
 * Keeping region and field separate makes the dangerous distinctions explicit:
 * primary and defence copy cannot alias, and a visible Bonus paragraph carries
 * its original array index even when an earlier entry is empty and filtered out.
 */
export type CardEditAddress =
  | { cardId: CardId; region: 'title'; field: 'title' }
  | { cardId: CardId; region: 'ribbon'; field: 'symbolValue' | 'ownerName' }
  | { cardId: CardId; region: 'combat'; field: 'attack' | 'defense' }
  | { cardId: CardId; region: 'boost'; field: 'boost' | 'boostSymbol' }
  | {
      cardId: CardId;
      region: AbilitySourceRegion;
      field: AbilityParagraphField;
    }
  | {
      cardId: CardId;
      region: AbilitySourceRegion;
      field: 'bonus';
      bonusIndex: number;
    }
  | {
      cardId: CardId;
      region: 'advanced';
      field: 'bonusAttack' | 'boostEffect' | 'tuckEffect' | 'cornerBadge';
    }
  | { cardId: CardId; region: 'replacement'; field: 'wholeFace' };

export type PreviewFieldBehaviour = 'direct' | 'navigate' | 'none';

interface PreviewFieldContract {
  key: string;
  behaviour: PreviewFieldBehaviour;
  milestone: 'first' | 'later' | 'never';
  condition: string;
}

/**
 * The code-facing field map locked by Phase 0. Phase 1 uses the same keys for
 * renderer markers and editor focus targets; later phases add editors without
 * changing what any visible region means.
 */
export const DIRECT_PREVIEW_FIELD_CONTRACT = [
  { key: 'title:title', behaviour: 'direct', milestone: 'first', condition: 'always' },
  {
    key: 'ribbon:symbolValue',
    behaviour: 'direct',
    milestone: 'first',
    condition: 'visible ordinary hero value'
  },
  {
    key: 'combat:attack',
    behaviour: 'direct',
    milestone: 'first',
    condition: 'visible numeric attack'
  },
  {
    key: 'combat:defense',
    behaviour: 'direct',
    milestone: 'first',
    condition: 'visible numeric defence'
  },
  {
    key: 'boost:boost',
    behaviour: 'direct',
    milestone: 'first',
    condition: 'visible numeric boost without a custom symbol'
  },
  {
    key: 'boost:boostSymbol',
    behaviour: 'navigate',
    milestone: 'first',
    condition: 'custom boost symbol is visible'
  },
  {
    key: 'primary-ability:*',
    behaviour: 'direct',
    milestone: 'first',
    condition: 'the addressed paragraph contains text'
  },
  {
    key: 'defense-ability:*',
    behaviour: 'direct',
    milestone: 'first',
    condition: 'the addressed split-defence paragraph contains text'
  },
  {
    key: 'primary-ability:bonus[index]',
    behaviour: 'direct',
    milestone: 'first',
    condition: 'preserve the original array index before display filtering'
  },
  {
    key: 'defense-ability:bonus[index]',
    behaviour: 'direct',
    milestone: 'first',
    condition: 'preserve the original array index and split side'
  },
  {
    key: 'ability:empty-or-structural',
    behaviour: 'navigate',
    milestone: 'first',
    condition: 'open the matching complete Ability Text stack'
  },
  {
    key: 'ribbon:ownerName',
    behaviour: 'navigate',
    milestone: 'first',
    condition: 'derived names never masquerade as the card title'
  },
  {
    key: 'advanced:*',
    behaviour: 'navigate',
    milestone: 'later',
    condition: 'Bonus Attack, boost effect, tuck effect and corner badge'
  },
  {
    key: 'replacement:wholeFace',
    behaviour: 'none',
    milestone: 'never',
    condition: 'composed text is baked into the replacement image'
  }
] as const satisfies readonly PreviewFieldContract[];

export const CARD_EDIT_MARKERS = {
  title: 'title:title'
} as const;

export type PreviewEditValue = string | number | null;
export type PreviewEditInvalidationReason =
  | 'card-changed'
  | 'card-deleted'
  | 'target-hidden'
  | 'replacement-enabled'
  | 'artwork-adjustment';

export type PreviewEditSession =
  | { status: 'inactive' }
  | { status: 'targeting'; address: CardEditAddress }
  | {
      status: 'editing' | 'committing' | 'cancelling';
      address: CardEditAddress;
      original: PreviewEditValue;
      draft: PreviewEditValue;
    }
  | {
      status: 'invalidated';
      address: CardEditAddress;
      reason: PreviewEditInvalidationReason;
    };

/** Allowed lifecycle edges; an invalidated session returns to inactive without writing. */
export const PREVIEW_EDIT_SESSION_TRANSITIONS = {
  inactive: ['targeting'],
  targeting: ['editing', 'invalidated', 'inactive'],
  editing: ['committing', 'cancelling', 'invalidated'],
  committing: ['inactive', 'invalidated'],
  cancelling: ['inactive'],
  invalidated: ['inactive']
} as const;

/** Interaction decisions proved by the Phase 0 prototype and used by later editors. */
export const PREVIEW_EDIT_LIFECYCLE = {
  singleLineCommit: 'Enter',
  multilineCommit: 'Mod+Enter',
  multilineLineBreak: 'Enter',
  cancel: 'Escape',
  validOutsideBlur: 'commit',
  toolbarBlur: 'keep-editing',
  nextField: 'commit-valid-first',
  exportWithDraft: 'block',
  cardMismatch: 'invalidate-without-write',
  artworkAdjustment: 'commit-valid-or-cancel-invalid'
} as const;
