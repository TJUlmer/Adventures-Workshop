import { actionTextIsEmpty } from '$lib/text/action-text';
import { usedTimings, type AbilityBlocks, type ActionCard, type CardId } from './types';

export type AbilitySourceRegion = 'primary-ability' | 'defense-ability';
/** Optional special effects whose stored source is visibly printed when active. */
export type SpecialEffectField =
  | 'boostEffect'
  | 'bonusAttackTitle'
  | 'bonusAttackValue'
  | 'bonusAttackAbility'
  | 'tuckEffect';
export type AbilityParagraphField =
  | 'plain'
  | 'immediately'
  | 'duringCombat'
  | 'afterCombat';

/**
 * The stored source behind one visible part of an action card.
 *
 * Keeping region and field separate makes the dangerous distinctions explicit:
 * primary and defense copy cannot alias, and a visible Bonus paragraph carries
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
      field: SpecialEffectField | 'cornerBadge';
    }
  | { region: 'replacement'; field: 'wholeFace' };

export type CardEditAddress = CardEditLocation & { cardId: CardId };

export type PreviewFieldBehaviour = 'direct' | 'navigate' | 'none';

interface PreviewFieldContract {
  key: string;
  behaviour: PreviewFieldBehaviour;
  milestone: 'first' | 'special-effects' | 'later' | 'never';
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
    condition: 'visible numeric defense'
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
    condition: 'the addressed paragraph or standalone timing heading is visible'
  },
  {
    key: 'defense-ability:*',
    behaviour: 'direct',
    milestone: 'first',
    condition: 'the addressed split-defense paragraph or timing heading is visible'
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
    key: 'advanced:boostEffect',
    behaviour: 'direct',
    milestone: 'special-effects',
    condition: 'effect on and boost printed; blank text edits in place like a blank title'
  },
  {
    key: 'advanced:bonusAttackTitle',
    behaviour: 'direct',
    milestone: 'special-effects',
    condition: 'stored title is non-empty; the derived Bonus Attack label navigates'
  },
  {
    key: 'advanced:bonusAttackValue',
    behaviour: 'direct',
    milestone: 'special-effects',
    condition: 'Bonus Attack on'
  },
  {
    key: 'advanced:bonusAttackAbility',
    behaviour: 'direct',
    milestone: 'special-effects',
    condition: 'Bonus Attack on and its ability is non-empty (blank is not rendered)'
  },
  {
    key: 'advanced:tuckEffect',
    behaviour: 'direct',
    milestone: 'special-effects',
    condition: 'Tuck Effect on and non-empty, either orientation; blank navigates'
  },
  {
    key: 'advanced:cornerBadge',
    behaviour: 'none',
    milestone: 'later',
    condition: 'corner badge remains a centre-editor control'
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
  boostSymbol: 'boost:boostSymbol',
  boostEffect: 'advanced:boostEffect',
  bonusAttackTitle: 'advanced:bonusAttackTitle',
  bonusAttackValue: 'advanced:bonusAttackValue',
  bonusAttackAbility: 'advanced:bonusAttackAbility',
  tuckEffect: 'advanced:tuckEffect'
} as const;

const SPECIAL_EFFECT_FIELDS: readonly SpecialEffectField[] = [
  'boostEffect',
  'bonusAttackTitle',
  'bonusAttackValue',
  'bonusAttackAbility',
  'tuckEffect'
];

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

  if (target.startsWith('advanced:')) {
    const field = target.slice('advanced:'.length) as SpecialEffectField;
    return SPECIAL_EFFECT_FIELDS.includes(field) ? { cardId, region: 'advanced', field } : null;
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

const SPECIAL_EFFECT_LABELS: Record<SpecialEffectField | 'cornerBadge', string> = {
  boostEffect: 'boost effect text',
  bonusAttackTitle: 'Bonus Attack title',
  bonusAttackValue: 'Bonus Attack value',
  bonusAttackAbility: 'Bonus Attack ability',
  tuckEffect: 'tuck effect text',
  cornerBadge: 'corner badge'
};

export function cardEditAddressLabel(address: CardEditAddress): string {
  switch (address.region) {
    case 'title':
      return 'card title';
    case 'ribbon':
      return address.field === 'symbolValue' ? 'combat value' : 'name on the ribbon';
    case 'combat':
      return address.field === 'attack' ? 'attack value' : 'defense value';
    case 'boost':
      return address.field === 'boost' ? 'boost value' : 'boost symbol';
    case 'primary-ability':
    case 'defense-ability': {
      const side = address.region === 'defense-ability' ? 'defense-side ' : '';
      if (address.field === 'bonus') return `${side}Bonus ability ${address.bonusIndex + 1}`;
      if (address.field === 'plain') return `${side}ability text`;
      if (address.field === 'duringCombat') return `${side}During Combat text`;
      return `${side}${address.field === 'immediately' ? 'Immediately' : 'After Combat'} text`;
    }
    case 'advanced':
      return SPECIAL_EFFECT_LABELS[address.field];
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
  /**
   * `title` is formatted single-line text and `ability` formatted multiline.
   * `plain` exists for a field the renderer prints literally: a formatted
   * editor there would save bold or `{{…}}` tokens that then print as markup.
   */
  kind: 'title' | 'ability' | 'number' | 'plain';
  value: string | number;
  min?: number;
  max?: number;
  /** Shown in an empty editor; never written to the card. */
  placeholder?: string;
}

/** The Boost Effect capsule is part of the boost assembly, printed only with a boost. */
function boostEffectVisible(card: ActionCard): boolean {
  return card.showBoostEffect && card.boost !== null;
}

function specialEffectField(
  card: ActionCard,
  field: SpecialEffectField | 'cornerBadge'
): PreviewDirectField | null {
  switch (field) {
    case 'boostEffect':
      /* Deliberately direct when blank, like the card title: turning the
         effect on prints an empty capsule, and that is where an author types. */
      return boostEffectVisible(card)
        ? { kind: 'plain', value: card.boostEffect, placeholder: 'Boost effect' }
        : null;
    case 'bonusAttackTitle':
      /* A blank title prints the derived "Bonus Attack" label, which must
         never be loaded as source text; the centre control handles it. */
      return card.showBonusAttack && !actionTextIsEmpty(card.bonusAttackTitle)
        ? { kind: 'title', value: card.bonusAttackTitle, placeholder: 'Bonus attack title' }
        : null;
    case 'bonusAttackValue':
      return card.showBonusAttack
        ? { kind: 'number', value: card.bonusAttackValue, min: 0, max: 9 }
        : null;
    case 'bonusAttackAbility':
      return card.showBonusAttack && !actionTextIsEmpty(card.bonusAttackAbility)
        ? { kind: 'ability', value: card.bonusAttackAbility, placeholder: 'Ability text' }
        : null;
    case 'tuckEffect':
      return card.showTuckEffect && !actionTextIsEmpty(card.tuckEffect)
        ? { kind: 'title', value: card.tuckEffect, placeholder: 'Tuck effect' }
        : null;
    case 'cornerBadge':
      return null;
  }
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
    return { kind: 'title', value: card.title, placeholder: 'Card Title' };
  }

  if (address.region === 'advanced') return specialEffectField(card, address.field);

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
  if (ability) {
    const visibleTiming =
      (address.region === 'primary-ability' || address.region === 'defense-ability') &&
      address.field !== 'plain' && address.field !== 'bonus' &&
      usedTimings(ability.ability).includes(address.field);
    if (visibleTiming || !actionTextIsEmpty(ability.value)) {
      return { kind: 'ability', value: ability.value, placeholder: 'Ability text' };
    }
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

  if (address.region === 'advanced') {
    switch (address.field) {
      case 'boostEffect':
        if (typeof value !== 'string') return false;
        card.boostEffect = value;
        return true;
      case 'bonusAttackTitle':
        if (typeof value !== 'string') return false;
        card.bonusAttackTitle = value;
        return true;
      case 'bonusAttackAbility':
        if (typeof value !== 'string') return false;
        card.bonusAttackAbility = value;
        return true;
      case 'tuckEffect':
        if (typeof value !== 'string') return false;
        card.tuckEffect = value;
        return true;
      case 'bonusAttackValue':
        if (typeof value !== 'number' || !Number.isFinite(value)) return false;
        card.bonusAttackValue = clampPreviewNumber(field, value);
        return true;
      case 'cornerBadge':
        return false;
    }
  }

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
