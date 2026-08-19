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

  /**
   * A tab to land on the *next* time the selected character changes,
   * consumed by `CharacterEditor`'s own reset effect rather than written
   * directly by whoever wants it. Selecting a character always resets `tab`
   * to `'identity'` — right when switching between two already-open
   * characters, wrong for a caller who selected one *in order* to land
   * somewhere specific on it (e.g. `StyleCascadePanel`'s jump straight to
   * Action card defaults). Writing `tab` directly after `selectCharacter`
   * races that reset, since the reset effect may run after the direct write
   * rather than before it.
   *
   * Deliberately **not** `$state`. The reset effect has to both read this
   * and clear it in the same pass — read, to know what to land on; clear,
   * so a stale request from three character-switches ago doesn't resurface
   * on an unrelated one. A reactive field that one effect both reads and
   * writes retriggers that same effect a second time: Svelte sees the
   * clearing write as a fresh change worth reacting to, reruns the effect
   * with the now-`null` value, and the reset-to-`'identity'` the request was
   * trying to avoid happens anyway, one microtask later. A plain field
   * carries the same one-shot value with no reactive tracking at all, so
   * consuming it cannot retrigger anything — `requestTab`/`consumePendingTab`
   * exist rather than a public field so nothing outside this reset cycle is
   * tempted to read or write it directly.
   */
  #pendingTab: string | null = null;

  requestTab(tab: string): void {
    this.#pendingTab = tab;
  }

  /** Called only by `CharacterEditor`'s own reset effect. */
  consumePendingTab(): string | null {
    const tab = this.#pendingTab;
    this.#pendingTab = null;
    return tab;
  }
}

export const characterEditorView = new CharacterEditorView();
