import { actionTextIsEmpty } from '$lib/text/action-text';
import type { AbilityBlocks, ActionCard, CardId } from './types';

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
export type CardEditLocation =
  | { region: 'title'; field: 'title' }
  | { region: 'ribbon'; field: 'symbolValue' | 'ownerName' }
  | { region: 'combat'; field: 'attack' | 'defense' }
  | { region: 'boost'; field: 'boost' | 'boostSymbol' }
  | {
      region: AbilitySourceRegion;
      field: AbilityParagraphField;
    }
  | {
      region: AbilitySourceRegion;
      field: 'bonus';
      bonusIndex: number;
    }
  | {
      region: 'advanced';
      field: 'bonusAttack' | 'boostEffect' | 'tuckEffect' | 'cornerBadge';
    }
  | { region: 'replacement'; field: 'wholeFace' };

export type CardEditAddress = CardEditLocation & { cardId: CardId };

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
  title: 'title:title',
  ownerName: 'ribbon:ownerName',
  symbolValue: 'ribbon:symbolValue',
  attack: 'combat:attack',
  defense: 'combat:defense',
  boost: 'boost:boost',
  boostSymbol: 'boost:boostSymbol'
} as const;

export function cardEditTarget(location: CardEditLocation): string {
  if (location.field === 'bonus') {
    return `${location.region}:bonus:${location.bonusIndex}`;
  }
  return `${location.region}:${location.field}`;
}

export function cardEditAddressFromTarget(
  cardId: CardId,
  target: string
): CardEditAddress | null {
  switch (target) {
    case CARD_EDIT_MARKERS.title:
      return { cardId, region: 'title', field: 'title' };
    case CARD_EDIT_MARKERS.ownerName:
      return { cardId, region: 'ribbon', field: 'ownerName' };
    case CARD_EDIT_MARKERS.symbolValue:
      return { cardId, region: 'ribbon', field: 'symbolValue' };
    case CARD_EDIT_MARKERS.attack:
      return { cardId, region: 'combat', field: 'attack' };
    case CARD_EDIT_MARKERS.defense:
      return { cardId, region: 'combat', field: 'defense' };
    case CARD_EDIT_MARKERS.boost:
      return { cardId, region: 'boost', field: 'boost' };
    case CARD_EDIT_MARKERS.boostSymbol:
      return { cardId, region: 'boost', field: 'boostSymbol' };
  }

  const match = /^(primary-ability|defense-ability):(plain|immediately|duringCombat|afterCombat|bonus)(?::(\d+))?$/.exec(
    target
  );
  if (!match) return null;

  const region = match[1] as AbilitySourceRegion;
  const field = match[2] as AbilityParagraphField | 'bonus';
  if (field !== 'bonus') return { cardId, region, field };

  const bonusIndex = Number(match[3]);
  if (!Number.isSafeInteger(bonusIndex) || bonusIndex < 0) return null;
  return { cardId, region, field: 'bonus', bonusIndex };
}

export function cardEditTargetForAddress(address: CardEditAddress): string {
  return cardEditTarget(address);
}

export function cardEditAddressLabel(address: CardEditAddress): string {
  switch (address.region) {
    case 'title':
      return 'card title';
    case 'ribbon':
      return address.field === 'symbolValue' ? 'combat value' : 'name on the ribbon';
    case 'combat':
      return address.field === 'attack' ? 'attack value' : 'defence value';
    case 'boost':
      return address.field === 'boost' ? 'boost value' : 'boost symbol';
    case 'primary-ability':
    case 'defense-ability': {
      const side = address.region === 'defense-ability' ? 'defence-side ' : '';
      if (address.field === 'bonus') return `${side}Bonus ability ${address.bonusIndex + 1}`;
      if (address.field === 'plain') return `${side}ability text`;
      if (address.field === 'duringCombat') return `${side}During Combat text`;
      return `${side}${address.field === 'immediately' ? 'Immediately' : 'After Combat'} text`;
    }
    case 'advanced':
      return address.field;
    case 'replacement':
      return 'replacement image';
  }
}

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
      valid: boolean;
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

export interface PreviewDirectField {
  kind: 'title' | 'ability' | 'number';
  value: string | number;
  min?: number;
  max?: number;
}

function abilitySource(
  card: ActionCard,
  address: CardEditAddress
): { ability: AbilityBlocks; value: string } | null {
  if (address.region !== 'primary-ability' && address.region !== 'defense-ability') {
    return null;
  }
  if (address.region === 'defense-ability' && !card.split) return null;

  const ability =
    address.region === 'primary-ability' ? card.ability : card.defenseAbility;
  if (address.field === 'bonus') {
    const bonus = ability.bonusAbilities[address.bonusIndex];
    return bonus ? { ability, value: bonus.text } : null;
  }
  return { ability, value: ability[address.field] };
}

/**
 * Resolve the stored source behind a rendered direct-edit marker. Returning
 * `null` deliberately suppresses optional, derived, or replacement content.
 */
export function previewDirectField(
  card: ActionCard,
  address: CardEditAddress
): PreviewDirectField | null {
  if (card.id !== address.cardId || card.useReplacement) return null;

  if (address.region === 'title') {
    return { kind: 'title', value: card.title };
  }

  if (address.region === 'ribbon' && address.field === 'symbolValue') {
    if (card.symbol === 'scheme' || card.symbolValue === null) return null;
    return { kind: 'number', value: card.symbolValue, min: 0, max: 9 };
  }

  if (address.region === 'combat') {
    const value = address.field === 'attack' ? card.attack : card.defense;
    return value === null ? null : { kind: 'number', value, min: 0, max: 20 };
  }

  if (address.region === 'boost' && address.field === 'boost') {
    if (card.boostSymbol || card.boost === null) return null;
    return { kind: 'number', value: card.boost, min: 1, max: 9 };
  }

  const ability = abilitySource(card, address);
  if (ability && !actionTextIsEmpty(ability.value)) {
    return { kind: 'ability', value: ability.value };
  }

  return null;
}

export function clampPreviewNumber(field: PreviewDirectField, value: number): number {
  if (field.kind !== 'number') return value;
  return Math.min(field.max ?? value, Math.max(field.min ?? value, value));
}

/** Revalidate the source path at the mutation boundary before writing it. */
export function writePreviewDirectField(
  card: ActionCard,
  address: CardEditAddress,
  value: PreviewEditValue
): boolean {
  const field = previewDirectField(card, address);
  if (!field) return false;

  if (field.kind === 'title') {
    if (typeof value !== 'string') return false;
    card.title = value;
    return true;
  }

  if (field.kind === 'ability') {
    if (typeof value !== 'string') return false;
    const source = abilitySource(card, address);
    if (!source) return false;
    if (address.region !== 'primary-ability' && address.region !== 'defense-ability') {
      return false;
    }
    if (address.field === 'bonus') {
      const bonus = source.ability.bonusAbilities[address.bonusIndex];
      if (!bonus) return false;
      bonus.text = value;
    } else {
      source.ability[address.field] = value;
    }
    return true;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const next = clampPreviewNumber(field, value);
  if (address.region === 'ribbon' && address.field === 'symbolValue') {
    card.symbolValue = next;
  } else if (address.region === 'combat' && address.field === 'attack') {
    card.attack = next;
  } else if (address.region === 'combat' && address.field === 'defense') {
    card.defense = next;
  } else if (address.region === 'boost' && address.field === 'boost') {
    card.boost = next;
  } else {
    return false;
  }
  return true;
}
