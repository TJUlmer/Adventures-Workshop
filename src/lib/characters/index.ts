export type {
  AttackType,
  Character,
  CharacterAbility,
  CharacterId,
  CharacterRole,
  CharacterRoleMeta
} from './types';
export { ATTACK_TYPE_LABELS, ATTACK_TYPES, CHARACTER_ROLES, CHARACTER_ROLE_META, isVillain } from './types';

export type { CharacterDraft } from './factory';
export { characterLabel, createCharacter, duplicateCharacter } from './factory';
