/**
 * The application store.
 *
 * One document is open at a time — a set *is* the file. `$state` is deeply
 * reactive, so editors bind straight into the document for field-level edits
 * and the sidebar, workspace and preview all follow from the same object.
 * The commands here cover the structural changes (create, re-parent, delete)
 * that a form field cannot express.
 *
 * Nothing derived is ever stored: `outline`, `stats` and the resolved preview
 * theme are all `$derived` from the document, so they cannot drift out of sync
 * with it.
 *
 * One rule about mutation: a component may `bind:` into an object it read from
 * the store itself, but anything handed across a component boundary is edited
 * through a command here, addressed by a typed reference rather than by object
 * identity. That keeps shared editors (style, artwork) from mutating props
 * they do not own.
 */
import type { AdventureMap } from '$lib/map/types';
import { applyEntries } from '$lib/sets/contribution';
import type { ChangeEntry } from '$lib/sets/contribution';
import { normalizeSet } from '$lib/sets/normalize';
import { createCard, createDeceptionCard, duplicateCard } from '$lib/cards/factory';
import type { CardStyleOverride, CardTheme } from '$lib/cards/style';
import { stockTheme } from '$lib/cards/theme';
import type {
  Card,
  CardId,
  CardType,
  InitiativeBandKey,
  InitiativeBandStyle,
  InitiativeVariant
} from '$lib/cards/types';
import { createCharacter } from '$lib/characters/factory';
import type {
  CardbackDesign,
  Character,
  CharacterBandName,
  CharacterCardDesign,
  CharacterId,
  CharacterRole,
  HeroCharacterCardId
} from '$lib/characters/types';
import type {
  ArtAdjustments,
  ArtEffects,
  ArtTransform,
  Artwork,
  CropRect
} from '$lib/core/artwork';
import {
  DEFAULT_ADJUSTMENTS,
  DEFAULT_EFFECTS,
  DEFAULT_TRANSFORM,
  FULL_CROP
} from '$lib/core/artwork';
import type { IsoDateTime } from '$lib/core/id';
import { createId, now } from '$lib/core/id';
import { createActionDeck, createDeck } from '$lib/decks/factory';
import type { Figure, FigureId, FigureKind } from '$lib/figures/types';
import { createFigure } from '$lib/figures/types';
import type { CustomSymbol, CustomSymbolId } from '$lib/symbols/types';
import { createCustomSymbol } from '$lib/symbols/types';
import { getLastWriteError, readStorageEstimate } from '$lib/storage/indexeddb';
import type { LibraryEntry } from '$lib/storage/library';
import {
  deleteSet as deleteSetFromLibrary,
  loadSet as loadSetFromLibrary,
  readIndex,
  rememberLastOpen,
  saveSet as saveSetToLibrary
} from '$lib/storage/library';
import type {
  ThreatNote,
  ThreatNoteId,
  ThreatSlotId,
  ThreatStepId,
  ThreatTrack
} from '$lib/threat/types';
import {
  canAddThreatStep,
  clampNotePosition,
  createThreatNote,
  createThreatSlot,
  createThreatStep
} from '$lib/threat/types';
import { navigation } from './navigation.svelte';
import type { SetPage } from './navigation.svelte';
import type { Deck, DeckId, DeckKind } from '$lib/decks/types';
import { createEmptySet } from '$lib/sets/factory';
import {
  cardsForCharacter,
  cardsInDeck,
  characterForCard,
  decksForCharacter,
  findCard,
  findCharacter,
  findDeck,
  initiativeDecks as getInitiativeDecks,
  outline as buildOutline,
  resolveStyleForCard,
  rulesDecks as getRulesDecks,
  setStats
} from '$lib/sets/queries';
import type { AdventureSet, SetId, SetKind } from '$lib/sets/types';
import type { Selection } from './selection';
import { SET_SELECTION } from './selection';

/**
 * An adventure has at most one villain.
 *
 * Two were allowed for a while, but nothing else in the document can tell two
 * villains apart: minions carry no field saying which villain they belong to,
 * `ThreatTrack.villainId` only ever names one, and the map has no ownership
 * concept at all. At one villain, "the villain side" (villain + every minion
 * + the threat track + the map + every set-level deck) is unambiguous by
 * construction — see `sets/scope.ts`, which is the reason this was lowered.
 *
 * Gates new additions only. A set that already has two — loaded from before
 * this changed — keeps working exactly as it does today; nothing here or in
 * `sets/normalize.ts` counts or repairs villains on load.
 */
export const MAX_VILLAINS = 1;

/** Card template a new card in this deck should use. */
function defaultCardType(deck: Deck): CardType {
  if (deck.kind === 'initiative') return 'initiative';
  if (deck.kind === 'rules') return 'rules';
  if (deck.kind === 'event') return 'event';
  return 'action';
}

/** Addresses an entity that owns artwork. */
export type EntityRef =
  | { readonly entity: 'card'; readonly id: CardId }
  | { readonly entity: 'character'; readonly id: CharacterId }
  /**
   * One band of a character card. Addressed by band *name* rather than by
   * index so a layout change cannot re-point somebody's picture. `cardId`
   * picks which sheet — absent means the primary's own, present means one of
   * `additionalCards` — since each identity's design is independent.
   */
  | {
      readonly entity: 'characterBand';
      readonly id: CharacterId;
      readonly band: CharacterBandName;
      readonly cardId?: HeroCharacterCardId;
    }
  /** The threat track's background. The board has one, so it needs no id. */
  | { readonly entity: 'threat' };

/** Addresses one layer of the style cascade. */
export type StyleTarget = EntityRef | { readonly entity: 'set' };

export class WorkshopStore {
  /** The open document. The single source of truth for everything on screen. */
  adventure = $state<AdventureSet>(createEmptySet());

  selection = $state<Selection>(SET_SELECTION);

  /** When the document last reached durable storage. `null` = never saved. */
  savedAt = $state<IsoDateTime | null>(null);

  /**
   * Why the last autosave failed, if it did. Embedded artwork can push a set
   * past the browser's storage quota, and silently dropping saves would be the
   * worst possible failure mode for a local-first tool.
   */
  saveError = $state<string | null>(null);

  // -- Derived views ---------------------------------------------------

  /** The whole hierarchy, grouped the way the sidebar renders it. */
  outline = $derived(buildOutline(this.adventure));
  stats = $derived(setStats(this.adventure));
  initiativeDecks = $derived(getInitiativeDecks(this.adventure));
  rulesDecks = $derived(getRulesDecks(this.adventure));

  selectedCard = $derived(
    this.selection.target === 'card' ? findCard(this.adventure, this.selection.id) : null
  );

  selectedCharacter = $derived(
    this.selection.target === 'character' ? findCharacter(this.adventure, this.selection.id) : null
  );

  /**
   * What the preview renders: the selected card, or the first card a selected
   * character owns, so the panel is not blank while editing a figure.
   */
  previewCard = $derived.by((): Card | null => {
    if (this.selectedCard) return this.selectedCard;
    const character = this.selectedCharacter;
    if (!character) return null;
    return cardsForCharacter(this.adventure, character.id)[0] ?? null;
  });

  /** The figure the previewed card belongs to, for its name ribbon. */
  previewCharacter = $derived(
    this.previewCard ? characterForCard(this.adventure, this.previewCard) : null
  );

  /** The previewed card's look, with the full cascade already flattened. */
  previewTheme: CardTheme = $derived(
    this.previewCard ? resolveStyleForCard(this.adventure, this.previewCard) : stockTheme()
  );

  // -- Reads ------------------------------------------------------------

  decksFor(characterId: CharacterId): Deck[] {
    return decksForCharacter(this.adventure, characterId);
  }

  cardsIn(deckId: DeckId): Card[] {
    return cardsInDeck(this.adventure, deckId);
  }

  // -- Library ----------------------------------------------------------
  //
  // Every command here is async now — `storage/library.ts` moved from
  // `localStorage` to IndexedDB, which has no synchronous API to have kept
  // any of this on. Nothing outside this class reads a return value from
  // `createSet`/`openSet`/`duplicateSet`/`removeSet`/`closeSet` today, so a
  // caller that does not need to wait on one uses `void`, same as any other
  // fire-and-forget write in the app. `saveNow` is the exception: its boolean
  // is what the title bar's flash message reads, so that one is worth
  // awaiting.

  /** Index rows for the library screen. Refreshed on write, not derived. */
  library = $state<LibraryEntry[]>([]);

  async refreshLibrary(): Promise<void> {
    this.library = await readIndex();
  }

  /**
   * Create a set, put it in the library, and open it.
   *
   * `name` defaults to undefined rather than to a string, so `createEmptySet`
   * gets to name it after the kind — "Untitled Heroes" for a heroes set. A
   * default written here would silently call every new heroes set an
   * adventure.
   */
  async createSet(name?: string, kind: SetKind = 'adventure'): Promise<AdventureSet> {
    const set = createEmptySet({ ...(name === undefined ? {} : { name }), kind });
    await saveSetToLibrary(set);
    await this.refreshLibrary();
    this.load(set);
    await rememberLastOpen(set.id);
    navigation.openSet('home');
    return set;
  }

  async openSet(id: SetId): Promise<boolean> {
    const set = await loadSetFromLibrary(id);
    if (!set) return false;
    this.load(set);
    this.markSaved(set.meta.updatedAt);
    await rememberLastOpen(id);
    navigation.openSet('home');
    return true;
  }

  /**
   * Open a set and land straight on one of its characters, rather than on
   * Home — the library's "browse by character" list exists so an author who
   * remembers a character but not which box they are in can jump straight to
   * editing them, and landing on Home would mean one more click to get there
   * anyway. `selectCharacter` already navigates to the editor on its own, so
   * this only has to sequence the two.
   */
  async openCharacter(setId: SetId, characterId: CharacterId): Promise<boolean> {
    const opened = await this.openSet(setId);
    if (opened) this.selectCharacter(characterId);
    return opened;
  }

  /**
   * Open a set and land on a specific page rather than Home — same shape as
   * `openCharacter`, for the library's own attention strip: "3 contributions
   * waiting" wants to land on Contributions, not on Home with one more click
   * to get there.
   */
  async openSetPage(id: SetId, page: SetPage): Promise<boolean> {
    const opened = await this.openSet(id);
    if (opened) navigation.go(page);
    return opened;
  }

  async closeSet(): Promise<void> {
    await this.refreshLibrary();
    await rememberLastOpen(null);
    navigation.openHome();
  }

  async removeSet(id: SetId): Promise<void> {
    await deleteSetFromLibrary(id);
    await this.refreshLibrary();
    if (this.adventure.id === id) await this.closeSet();
  }

  /** Copy a set under a new identity — the Save As of a local-first tool. */
  async duplicateSet(id: SetId): Promise<void> {
    const source = id === this.adventure.id ? this.adventure : await loadSetFromLibrary(id);
    if (!source) return;

    const copy: AdventureSet = {
      ...structuredClone($state.snapshot(source)),
      id: createId<SetId>('set'),
      name: `${source.name} (copy)`
    };
    copy.meta.updatedAt = now();
    await saveSetToLibrary(copy);
    await this.refreshLibrary();
  }

  // -- Document ---------------------------------------------------------

  load(set: AdventureSet): void {
    this.adventure = set;
    this.selection = SET_SELECTION;
  }

  reset(): void {
    this.load(createEmptySet());
    this.savedAt = null;
    this.saveError = null;
  }

  markSaved(at: IsoDateTime = now()): void {
    this.savedAt = at;
    this.saveError = null;
  }

  markSaveFailed(reason: string): void {
    this.saveError = reason;
  }

  /**
   * Write the document now instead of waiting for autosave.
   *
   * Autosave is debounced and can fail — a full quota is the usual reason, and
   * embedded artwork makes that reachable. Reporting it in the status bar is
   * not much use without a way to try again, which is what this is.
   */
  async saveNow(): Promise<boolean> {
    if (await saveSetToLibrary(this.adventure)) {
      this.markSaved();
      this.library = await readIndex();
      return true;
    }

    // `idbPut`'s own boolean can't distinguish a genuinely full quota from a
    // blocked database, a browser policy, or anything else a transaction can
    // abort for — `getLastWriteError` reads the real `DOMException` the
    // write actually failed with, and `readStorageEstimate` says whether
    // usage was anywhere near quota when it happened. Neither changes what
    // the status bar says (asserting a cause the code can't confirm is worse
    // than a plain one), but both go to the console, because a report of
    // "storage is full" that survived the IndexedDB migration needs a real
    // cause behind it before it can be fixed rather than guessed at again.
    const error = getLastWriteError();
    const estimate = await readStorageEstimate();
    console.error('[workshop] Save failed.', {
      error,
      usageBytes: estimate?.usageBytes ?? null,
      quotaBytes: estimate?.quotaBytes ?? null
    });

    const quotaExceeded = error?.name === 'QuotaExceededError';
    this.markSaveFailed(
      quotaExceeded
        ? 'Could not save — storage is full. Export the set to keep your work.'
        : 'Could not save. Export the set to keep your work.'
    );
    return false;
  }

  private touch(): void {
    this.adventure.meta.updatedAt = now();
  }

  // -- Selection --------------------------------------------------------

  select(selection: Selection): void {
    this.selection = selection;
  }

  /** Selecting always means "take me to the editor" — that is what it is for. */
  selectSet(): void {
    this.selection = SET_SELECTION;
    navigation.go('editor');
  }

  /** Selecting always means "take me to the editor" — that is what it is for. */
  selectCharacter(id: CharacterId): void {
    this.selection = { target: 'character', id };
    navigation.go('editor');
  }

  selectCard(id: CardId): void {
    this.selection = { target: 'card', id };
    navigation.go('editor');
  }

  // -- Contributions ----------------------------------------------------

  /**
   * Fold accepted changes from someone else into the open set.
   *
   * Normalised on the way in, and that is not belt-and-braces: every value in
   * an entry arrived as JSON from another person's browser, so this is the same
   * boundary a file import crosses and it gets the same repair pass. Without it
   * a missing field would reach the renderer as `undefined` and throw inside
   * Svelte's effect graph, which also stops *later* updates painting — so the
   * damage would show up somewhere else entirely.
   *
   * The `id` is pinned across the merge. `applyEntries` cannot change it, but
   * a hand-made payload could carry a whole set's worth of keys, and a document
   * that quietly became a different set would take its library row with it.
   */
  applyContribution(entries: readonly ChangeEntry[]): void {
    const merged = applyEntries($state.snapshot(this.adventure), entries);
    this.adventure = normalizeSet({ ...merged, id: this.adventure.id });
    this.touch();
  }

  // -- Threat track -----------------------------------------------------

  editThreat(mutate: (track: ThreatTrack) => void): void {
    mutate(this.adventure.threat);
    this.touch();
  }

  /**
   * Mutate the map and mark the document dirty.
   *
   * Same shape as `editThreat`, and for the same reason: `touch()` is private,
   * so a component that mutated the document directly would be relying on the
   * autosave effect noticing — which it would, but the save timestamp and the
   * dirty flag would not move, and the status bar would quietly lie.
   */
  editMap(mutate: (map: AdventureMap) => void): void {
    mutate(this.adventure.map);
    this.touch();
  }

  /**
   * Add a space, unless the printed rail is full.
   *
   * Refused here as well as disabled in the UI: a space is a fixed printed
   * size, so the rail holding a fixed number of them is a rule about the board
   * rather than a hint about the button.
   */
  addThreatStep(value = 1): boolean {
    if (!canAddThreatStep(this.adventure.threat)) return false;
    this.adventure.threat.steps.push(createThreatStep(value));
    this.touch();
    return true;
  }

  removeThreatStep(id: ThreatStepId): void {
    this.adventure.threat.steps = this.adventure.threat.steps.filter((step) => step.id !== id);
    this.touch();
  }

  addThreatSlot(): void {
    this.adventure.threat.slots.push(createThreatSlot());
    this.touch();
  }

  removeThreatSlot(id: ThreatSlotId): void {
    this.adventure.threat.slots = this.adventure.threat.slots.filter((slot) => slot.id !== id);
    this.touch();
  }

  addThreatNote(): ThreatNote {
    const note = createThreatNote();
    this.adventure.threat.notes.push(note);
    this.touch();
    return note;
  }

  removeThreatNote(id: ThreatNoteId): void {
    this.adventure.threat.notes = this.adventure.threat.notes.filter((note) => note.id !== id);
    this.touch();
  }

  /**
   * Dragging a note is a stream of moves, not a single edit, so it does not go
   * through `editThreat` — that would stamp the document on every pointer
   * event. The position is written straight through and `touch` is left to the
   * end of the drag.
   */
  moveThreatNote(id: ThreatNoteId, x: number, y: number): void {
    const note = this.adventure.threat.notes.find((entry) => entry.id === id);
    if (!note) return;
    const at = clampNotePosition(x, y);
    note.x = at.x;
    note.y = at.y;
  }

  // -- Figures ----------------------------------------------------------

  addFigure(kind: FigureKind = 'figure'): Figure {
    const figure = createFigure(kind);
    this.adventure.figures.push(figure);
    this.touch();
    return figure;
  }

  removeFigure(id: FigureId): void {
    this.adventure.figures = this.adventure.figures.filter((figure) => figure.id !== id);
    this.touch();
  }

  editFigure(id: FigureId, mutate: (figure: Figure) => void): void {
    const figure = this.adventure.figures.find((candidate) => candidate.id === id);
    if (!figure) return;
    mutate(figure);
    figure.updatedAt = now();
    this.touch();
  }

  // -- Custom symbols -----------------------------------------------------

  addCustomSymbol(): CustomSymbol {
    const symbol = createCustomSymbol();
    this.adventure.customSymbols.push(symbol);
    this.touch();
    return symbol;
  }

  removeCustomSymbol(id: CustomSymbolId): void {
    this.adventure.customSymbols = this.adventure.customSymbols.filter(
      (symbol) => symbol.id !== id
    );
    this.touch();
  }

  editCustomSymbol(id: CustomSymbolId, mutate: (symbol: CustomSymbol) => void): void {
    const symbol = this.adventure.customSymbols.find((candidate) => candidate.id === id);
    if (!symbol) return;
    mutate(symbol);
    symbol.updatedAt = now();
    this.touch();
  }

  // -- What kind of set this is -----------------------------------------

  /** True while the open set is a box of heroes rather than an adventure. */
  readonly isHeroesSet = $derived(this.adventure.kind === 'heroes');

  /**
   * Why switching to a heroes set is not allowed, or `null` when it is.
   *
   * A heroes set hides the villain and minion rosters, so a set holding either
   * would hide characters the author cannot then reach — invisible, but still
   * in the document, still exported, still counted. Refusing is the honest
   * answer; silently hiding them is the one that produces bug reports.
   *
   * Returns the *reason*, not a boolean, because the caller has to say what is
   * in the way and how much of it. "You can't do that" is not an explanation.
   */
  heroesSetBlockedBy(): string | null {
    const villains = this.adventure.characters.filter((c) => c.role === 'villain').length;
    const minions = this.adventure.characters.filter((c) => c.role === 'minion').length;
    if (villains === 0 && minions === 0) return null;

    const parts: string[] = [];
    if (villains > 0) parts.push(`${villains} villain${villains === 1 ? '' : 's'}`);
    if (minions > 0) parts.push(`${minions} minion${minions === 1 ? '' : 's'}`);

    return (
      `This set has ${parts.join(' and ')}. A heroes set has nowhere to show ` +
      `${parts.length > 1 ? 'them' : 'that'}, so ${parts.length > 1 ? 'they' : 'it'} would ` +
      'stay in the set without being editable. Delete or move ' +
      `${parts.length > 1 ? 'them' : 'it'} first, then switch.`
    );
  }

  /**
   * Change what kind of set this is.
   *
   * Answers whether it happened rather than throwing — the caller is a control
   * that has to explain a refusal, not recover from an error. Switching *to*
   * an adventure is always allowed: it only ever reveals sections, and an
   * empty villain roster is exactly what a new adventure starts with.
   */
  setKind(kind: SetKind): boolean {
    if (kind === this.adventure.kind) return true;
    if (kind === 'heroes' && this.heroesSetBlockedBy() !== null) return false;

    this.adventure.kind = kind;
    /*
     * A hidden page must not stay open under it — `SetNav` drops the tab, but
     * dropping a tab does not move whoever is standing on it, and they would
     * be left on a page with no way back to it.
     *
     * Unreachable today: this is only called from Settings, so the open page
     * is always `settings`. Kept because it costs a comparison and the thing
     * it guards against is the kind of gap a later deep link or shortcut opens
     * without anyone thinking about this function.
     */
    if (kind === 'heroes' && navigation.page === 'threat') navigation.go('home');
    this.touch();
    return true;
  }

  // -- Characters -------------------------------------------------------

  /**
   * An adventure supports at most one villain — and a heroes set none at all,
   * which is what keeps the roster from growing something the sidebar has
   * stopped drawing.
   */
  canAddVillain(): boolean {
    if (this.isHeroesSet) return false;
    return this.adventure.characters.filter((c) => c.role === 'villain').length < MAX_VILLAINS;
  }

  /** Adds the figure and the action deck it will need. */
  addCharacter(role: CharacterRole): Character | null {
    if (role === 'villain' && !this.canAddVillain()) return null;
    /* Refused rather than hidden. A heroes set draws no minion roster, so one
       added here would exist with nowhere to edit it — see `setKind`. */
    if (role === 'minion' && this.isHeroesSet) return null;

    const character = createCharacter(role);
    this.adventure.characters.push(character);
    this.adventure.decks.push(createActionDeck(character.id));
    this.selectCharacter(character.id);
    this.touch();
    return character;
  }

  /**
   * Removes the figure only. Its decks outlive it as unowned decks rather than
   * taking the author's cards down with them.
   */
  removeCharacter(id: CharacterId): void {
    this.adventure.characters = this.adventure.characters.filter(
      (character) => character.id !== id
    );
    for (const deck of this.adventure.decks) {
      if (deck.ownerId === id) deck.ownerId = null;
    }
    if (this.selection.target === 'character' && this.selection.id === id) {
      this.selectSet();
    }
    this.touch();
  }

  // -- Decks ------------------------------------------------------------

  addDeck(kind: DeckKind, ownerId: CharacterId | null = null): Deck {
    const deck = createDeck(kind, { ownerId });
    this.adventure.decks.push(deck);
    this.touch();
    return deck;
  }

  /** Deleting a deck deletes the cards in it — they have nowhere else to live. */
  removeDeck(id: DeckId): void {
    const removed = new Set(this.cardsIn(id).map((card) => card.id));
    this.adventure.decks = this.adventure.decks.filter((deck) => deck.id !== id);
    this.adventure.cards = this.adventure.cards.filter((card) => card.deckId !== id);
    if (this.selection.target === 'card' && removed.has(this.selection.id)) {
      this.selectSet();
    }
    this.touch();
  }

  /** A set-level deck of the given kind, created on first use. */
  ensureDeck(kind: DeckKind): Deck {
    const existing = this.adventure.decks.find(
      (deck) => deck.kind === kind && deck.ownerId === null
    );
    return existing ?? this.addDeck(kind);
  }

  // -- Cards ------------------------------------------------------------

  addCard(deckId: DeckId, type?: CardType): Card | null {
    const deck = findDeck(this.adventure, deckId);
    if (!deck) return null;

    const card = createCard(type ?? defaultCardType(deck), deck.id);
    this.adventure.cards.push(card);
    this.selectCard(card.id);
    this.touch();
    return card;
  }

  /**
   * Add to the set-level initiative deck, creating the deck if needed.
   *
   * The two variants are different enough at birth to be worth separating: a
   * character card acts, so it prints a move badge; an effect card resolves,
   * so it does not. Setting that here means the sidebar's two entry points
   * each land on a card that is already right rather than one to be corrected.
   */
  addInitiativeCard(variant: InitiativeVariant = 'card'): Card | null {
    const card = this.addCard(this.ensureDeck('initiative').id, 'initiative');
    if (card?.type === 'initiative') {
      card.variant = variant;
      card.showMove = variant === 'card';
      if (variant === 'card') card.moveValue = 3;
      this.touch();
    }
    return card;
  }

  /** Add to the set-level rules deck, creating the deck if needed. */
  addRulesCard(): Card | null {
    return this.addCard(this.ensureDeck('rules').id, 'rules');
  }

  /** Add to the set-level event deck, creating the deck if needed. */
  addEventCard(): Card | null {
    return this.addCard(this.ensureDeck('event').id, 'event');
  }

  /**
   * Add a Deception card, unassigned.
   *
   * Every villain and minion deck wants one, and which deck this one is for is
   * the author's call — so it lands in the unowned action deck and waits there
   * rather than guessing at a figure. Its Deck field is how it is claimed.
   */
  addDeceptionCard(): Card {
    const card = createDeceptionCard(this.ensureDeck('action').id);
    this.adventure.cards.push(card);
    this.selectCard(card.id);
    this.touch();
    return card;
  }

  removeCard(id: CardId): void {
    this.adventure.cards = this.adventure.cards.filter((card) => card.id !== id);
    if (this.selection.target === 'card' && this.selection.id === id) {
      this.selectSet();
    }
    this.touch();
  }

  duplicateCard(id: CardId): Card | null {
    const card = findCard(this.adventure, id);
    if (!card) return null;
    const index = this.adventure.cards.indexOf(card);
    const copy = duplicateCard(card);
    this.adventure.cards.splice(index + 1, 0, copy);
    this.selectCard(copy.id);
    this.touch();
    return copy;
  }

  moveCard(id: CardId, deckId: DeckId): void {
    if (!findDeck(this.adventure, deckId)) return;
    this.editCard(id, (card) => {
      card.deckId = deckId;
    });
  }

  /**
   * Drop `id` next to `targetId`, adopting the target's deck.
   *
   * Order within a deck is order within the flat `cards` array, so a reorder is
   * a splice: pull the card out, then put it back beside its target. Adopting
   * the deck means one gesture both reorders and re-parents.
   */
  reorderCard(id: CardId, targetId: CardId, side: 'before' | 'after'): void {
    if (id === targetId) return;

    const cards = this.adventure.cards;
    const from = cards.findIndex((card) => card.id === id);
    const moving = cards[from];
    if (from === -1 || !moving) return;

    const target = cards.find((card) => card.id === targetId);
    if (!target) return;

    const deckId = target.deckId;
    cards.splice(from, 1);

    // Recompute after the removal — the target may have shifted down one.
    const to = cards.findIndex((card) => card.id === targetId);
    if (to === -1) {
      cards.splice(from, 0, moving);
      return;
    }

    moving.deckId = deckId;
    moving.updatedAt = now();
    cards.splice(side === 'before' ? to : to + 1, 0, moving);
    this.touch();
  }

  /** Drop onto a deck rather than a card: append to the end of that deck. */
  reorderCardIntoDeck(id: CardId, deckId: DeckId): void {
    const cards = this.adventure.cards;
    const from = cards.findIndex((card) => card.id === id);
    const moving = cards[from];
    if (from === -1 || !moving || !findDeck(this.adventure, deckId)) return;

    cards.splice(from, 1);
    moving.deckId = deckId;
    moving.updatedAt = now();

    // After the last card of the destination deck, or at the end if it is empty.
    let insertAt = cards.length;
    for (let index = cards.length - 1; index >= 0; index -= 1) {
      if (cards[index]?.deckId === deckId) {
        insertAt = index + 1;
        break;
      }
    }
    cards.splice(insertAt, 0, moving);
    this.touch();
  }

  /** Edit a character's deck back. A command, for the same reason as bands. */
  editCardback(id: CharacterId, mutate: (design: CardbackDesign) => void): void {
    const character = findCharacter(this.adventure, id);
    if (!character) return;
    mutate(character.cardback);
    character.updatedAt = now();
    this.touch();
  }

  /** `cardId` absent edits the primary's own design; present edits that one additional card's. */
  editCharacterCard(
    id: CharacterId,
    mutate: (design: CharacterCardDesign) => void,
    cardId?: HeroCharacterCardId
  ): void {
    const character = findCharacter(this.adventure, id);
    const design = this.characterCardDesignFor(id, cardId);
    if (!character || !design) return;
    mutate(design);
    character.updatedAt = now();
    this.touch();
  }

  /**
   * Edit one band of an initiative card. A command rather than a bound object
   * because the bands panel is a shared child component.
   */
  editBand(
    id: CardId,
    band: InitiativeBandKey,
    mutate: (style: InitiativeBandStyle) => void
  ): void {
    this.editCard(id, (card) => {
      if (card.type === 'initiative') mutate(card.bands[band]);
    });
  }

  /** Edit a card through a mutator, keeping `updatedAt` honest. */
  editCard(id: CardId, mutate: (card: Card) => void): void {
    const card = findCard(this.adventure, id);
    if (!card) return;
    mutate(card);
    card.updatedAt = now();
    this.touch();
  }

  // -- Artwork ----------------------------------------------------------

  /**
   * The character-card design a character or one of its `additionalCards`
   * owns — `cardId` absent means the primary's own, present means that
   * specific additional card's. `null` when either half of the address is
   * stale (character deleted, or that card removed).
   */
  characterCardDesignFor(id: CharacterId, cardId?: HeroCharacterCardId): CharacterCardDesign | null {
    const character = findCharacter(this.adventure, id);
    if (!character) return null;
    if (!cardId) return character.characterCard;
    return character.additionalCards.find((card) => card.id === cardId)?.characterCard ?? null;
  }

  /** The artwork block a ref points at, or `null` if the ref is stale. */
  artworkFor(ref: EntityRef): Artwork | null {
    if (ref.entity === 'threat') return this.adventure.threat.background;
    if (ref.entity === 'characterBand') {
      return this.characterCardDesignFor(ref.id, ref.cardId)?.[ref.band].artwork ?? null;
    }
    const owner =
      ref.entity === 'card'
        ? findCard(this.adventure, ref.id)
        : findCharacter(this.adventure, ref.id);
    return owner ? owner.artwork : null;
  }

  /** Attach a local image. Passing `null` detaches it and resets placement. */
  setArtworkSource(ref: EntityRef, source: string | null, label = ''): void {
    const artwork = this.artworkFor(ref);
    if (!artwork) return;
    artwork.source = source;
    artwork.label = source === null ? '' : label;
    artwork.crop = { ...FULL_CROP };
    artwork.transform = { ...DEFAULT_TRANSFORM };
    this.touch();
  }

  setCrop(ref: EntityRef, patch: Partial<CropRect>): void {
    const artwork = this.artworkFor(ref);
    if (!artwork) return;
    artwork.crop = { ...artwork.crop, ...patch };
    this.touch();
  }

  setTransform(ref: EntityRef, patch: Partial<ArtTransform>): void {
    const artwork = this.artworkFor(ref);
    if (!artwork) return;
    artwork.transform = { ...artwork.transform, ...patch };
    this.touch();
  }

  setAdjustments(ref: EntityRef, patch: Partial<ArtAdjustments>): void {
    const artwork = this.artworkFor(ref);
    if (!artwork) return;
    artwork.adjustments = { ...artwork.adjustments, ...patch };
    this.touch();
  }

  setEffects(ref: EntityRef, patch: Partial<ArtEffects>): void {
    const artwork = this.artworkFor(ref);
    if (!artwork) return;
    artwork.effects = { ...artwork.effects, ...patch };
    this.touch();
  }

  /** Reset one aspect of the artwork without disturbing the others. */
  resetArtwork(ref: EntityRef, part: 'crop' | 'transform' | 'adjustments' | 'effects'): void {
    const artwork = this.artworkFor(ref);
    if (!artwork) return;
    switch (part) {
      case 'crop':
        artwork.crop = { ...FULL_CROP };
        break;
      case 'transform':
        artwork.transform = { ...DEFAULT_TRANSFORM };
        break;
      case 'adjustments':
        artwork.adjustments = { ...DEFAULT_ADJUSTMENTS };
        break;
      case 'effects':
        artwork.effects = { ...DEFAULT_EFFECTS };
        break;
    }
    this.touch();
  }

  // -- Style ------------------------------------------------------------

  /**
   * The override object for one layer of the cascade.
   *
   * The threat board has artwork but no card style, so it has no layer here —
   * it is not part of the cascade at all.
   */
  styleFor(target: StyleTarget): CardStyleOverride | null {
    if (target.entity === 'set') return this.adventure.style;
    if (target.entity === 'threat') return null;
    if (target.entity === 'card') return findCard(this.adventure, target.id)?.style ?? null;
    return findCharacter(this.adventure, target.id)?.style ?? null;
  }

  /**
   * Set or clear one key on one layer. `undefined` deletes the key so the
   * value inherits from the layer above again.
   */
  setStyle<TKey extends keyof CardTheme>(
    target: StyleTarget,
    key: TKey,
    value: CardTheme[TKey] | undefined
  ): void {
    const layer = this.styleFor(target);
    if (!layer) return;
    if (value === undefined) delete layer[key];
    else layer[key] = value;
    this.touch();
  }

  /** Drop every override on a layer, returning it to what it inherits. */
  clearStyle(target: StyleTarget): void {
    const layer = this.styleFor(target);
    if (!layer) return;
    for (const key of Object.keys(layer)) {
      delete layer[key as keyof CardTheme];
    }
    this.touch();
  }
}

/** The app-wide instance. Components import this directly. */
export const workshop = new WorkshopStore();
