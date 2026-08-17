/**
 * Which tab is open in the hero character editor.
 *
 * Module-level rather than a prop: `Workspace.svelte`'s `CharacterEditor` and
 * `PreviewPanel.svelte` are siblings, neither receiving the other, and the
 * preview needs to know which single card a hero's tabs currently has open
 * so it can show exactly that one thing instead of stacking every identity,
 * the deck back and the action-card-defaults sample all at once.
 *
 * A plain string rather than a discriminated union because `Tabs.svelte` is
 * generic over `TValue extends string`. Values in use: `'identity'`,
 * `'primary'`, `` `card:${HeroCharacterCardId}` ``, `'design'`, `'cardback'`,
 * `'defaults'` — see `CharacterEditor.svelte`.
 */
class CharacterEditorView {
  tab = $state('identity');
}

export const characterEditorView = new CharacterEditorView();
