import type { Character } from '$lib/characters/types';

/** The character editor and its sibling preview share the selected tab. */
class CharacterEditorView {
  tab = $state('identity');

  open(character: Character | null, tab = 'identity'): void {
    if (tab === 'cardback' || tab === 'defaults') {
      this.tab = tab;
    } else if (character?.role === 'hero' && (
      tab === 'primary' || character.additionalCards.some((card) => tab === 'card:' + card.id)
    )) {
      this.tab = tab;
    } else {
      this.tab = 'identity';
    }
  }
}

export const characterEditorView = new CharacterEditorView();
