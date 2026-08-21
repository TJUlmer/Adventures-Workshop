import type { CardStyleOverride } from '$lib/cards/style';
import type { Card } from '$lib/cards/types';
import type { Character } from '$lib/characters/types';
import type { Artwork } from '$lib/core/artwork';
import type { Id, IsoDateTime } from '$lib/core/id';
import type { Deck } from '$lib/decks/types';
import type { Figure } from '$lib/figures/types';
import type { AdventureMap } from '$lib/map/types';
import type { CustomSymbol } from '$lib/symbols/types';
import type { ThreatTrack } from '$lib/threat/types';

export type SetId = Id<'Set'>;

/**
 * Bumped whenever the persisted shape changes. The importer refuses files it
 * does not know how to migrate rather than silently mangling them.
 *
 * v2 — introduced decks as first-class entities (cards moved from
 *      `characterId` to `deckId`), replaced focal-point art with an artwork
 *      reference plus crop rectangle, and added the style cascade.
 * v3 — cards became template-shaped (action / initiative / rules) to match the
 *      printed Adventures layouts: separate attack and defense values, timed
 *      ability blocks, and a theme built from fills rather than flat colours.
 * v4 — event cards (then called "modifier"); split action cards; per-band
 *      initiative styling, card type text, character assignment and move value.
 * v5 — set-level tools: threat track, figures and box art; character cardbacks.
 * v6 — `modifier` card type and deck kind renamed to `event`. Documents saved
 *      before this still carry the old value; `normalize.ts` maps it.
 * v7 — generated tokens gained a side count and a two-sided flag, and the `hex`
 *      shape became a six-sided `polygon`. Old `hex` tokens map on load; a build
 *      that only knows ≤ v6 would round a polygon token off, so it is refused.
 * v8 — health dials gained a value range, and an event card's reverse heading
 *      gained a placement (offset and rotation). Both fill from the factories on
 *      load, so an older document opens with the stock dial and an unmoved
 *      heading.
 * v9 — every card gained a full-face replacement image, an event card a second
 *      one for its reverse, and the set one for the initiative deck's back. All
 *      default to absent and switched off, so an older document opens composing
 *      exactly what it composed before.
 *
 * v10 — the adventure map: circular spaces, the paths between them, and the
 *      board they are painted on. Absent on an older document, which opens with
 *      the map switched off and empty — a set that never had one is not a set
 *      with a broken one.
 *
 * v11 — placed text gained a rotation, the threat nameplate gained an
 *      uploadable logo, and the map gained placed text of its own plus a
 *      start-position number per space. Every one fills from its factory on
 *      load, so an older document opens with level text, the drawn placeholder
 *      lockup, no map copy and no start markers.
 *
 * v12 — a set copied from a published one records where it came from, as
 *      `origin`. Absent on everything authored from scratch and on every
 *      document written before this, which is exactly right: those sets did
 *      not come from anywhere.
 *
 * v13 — the hero role gained a printed action card (a combat symbol and value
 *      in the ribbon, and who may play it, in place of the attack/defense pair
 *      a villain or minion card carries) and a character card (attack type,
 *      health and special ability the character already had, plus a sidekick
 *      or a flavour quote). Every field fills from its factory on load, so an
 *      older document opens with a plain "attack" ribbon, no sidekick, and no
 *      quote — none of which it had an opinion about before now.
 *
 * v14 — `attackType` gained `lunge`, `reach` and `large` beside `melee` and
 *      `ranged`. A bump for an added enum value rather than an added field,
 *      because `normalizeSet` repairs an unknown attack type by falling back
 *      to `melee` — which is right for a damaged document and wrong for a
 *      newer one, where it would quietly throw the author's choice away.
 *
 * v15 — a hero's character card gained artwork behind each of its three
 *      bands, and `subtitle` became a *shortened name* rather than an epithet
 *      — the action cards' ribbon prints it where the character card prints
 *      the full one. Nothing is lost by the change of meaning: the field was
 *      never drawn on anything.
 *
 * v16 — a hero gained `additionalCards`, further named identities sharing its
 *      roster entry, deck and figures — a duo like Cloak & Dagger, entered as
 *      "+1 character card" rather than as two linked characters — and
 *      `printedName`, the joint label printed when there is more than one. A
 *      hero's sidekick, when it was a single tracked companion rather than a
 *      swarm, is folded into its first additional card on load; a swarm
 *      sidekick is untouched. Absent on an older document, which opens with
 *      no additional cards and its sidekick exactly as it was.
 *
 * v17 — a character card's design gained `replacement`/`useReplacement`, the
 *      same finished-image escape hatch every other printed face already
 *      has, and each additional card gained a `characterCard` of its own —
 *      independent of the primary's, since two identities sharing one deck
 *      do not have to share one look. Absent on an older document, which
 *      opens with every design composed as before and every additional card
 *      matching the primary's own colours, exactly what a shared design was.
 *
 * v18 — an action card's `AbilityBlocks` gained `bonusAbility`, printed last
 *      below After Combat with its own ink (`CardTheme.bonusAbilityInk`)
 *      rather than sharing the timed blocks' colour, since it is not a fourth
 *      timing. `CardTheme` also gained `abilityFontSize`, overriding
 *      `ABILITY.size` in `renderer/geometry.ts` — a temporary dial for
 *      finding the right printed size by eye, not a genuine per-card choice.
 *      Absent on an older document, which opens with no bonus text and the
 *      template's own measured size, exactly as it printed before.
 *
 * v19 — a set gained `customSymbols`: author-uploaded glyphs, usable inline in
 *      ability text and rich text anywhere the four built-in combat symbols
 *      are. Absent on an older document, which opens with an empty registry
 *      and no `{{custom:…}}` tokens to resolve, exactly as before.
 *
 * v20 — a character card's design gained `healthBadge` and `healthBadgeAccent`,
 *      the START HEALTH shield's own colour and the small triangle notched
 *      into it, independently of the border's. Absent on an older document,
 *      which opens with both in their printed colours, exactly as before. Unrelated:
 *      every `Artwork` gained an `opacity` adjustment, needing no version of
 *      its own — `adjustments` was already read back key by key with a
 *      default for anything missing, the same way an older document already
 *      opened with no sepia or greyscale applied.
 *
 * v21 — an action card's `AbilityBlocks` gained `bonusIcon`, a larger icon
 *      printed beside the Bonus ability paragraph in its own column rather
 *      than inline with the text. Stored as the same `{{token}}` string an
 *      inline symbol uses, so it resolves through the existing symbol
 *      machinery. Absent on an older document, which opens with no bonus
 *      icon, exactly as it printed before. Unrelated: `CardTheme` gained
 *      `bonusIconSize`, the icon's printed height, needing no version of its
 *      own — a style override was already read back generically and merged
 *      key by key with a default for anything missing (`mergeCardStyle`),
 *      the same way an older document already opened with the icon at its
 *      stock size.
 *
 * `CardTheme` also later gained `customPattern`, a single non-repeating
 * image laid over the body panel alongside the tiled `pattern`. Needs no
 * version bump of its own, for the same reason `bonusIconSize` (v21) and
 * `opacity` (v20) did not — a style override is already read back
 * generically and merged key by key with a default for anything missing.
 *
 * v22 — a character card's design gained `quoteInk`, the colour of the quote
 *      text, its attribution and its quotation marks — previously fixed ink
 *      (cream marks, white text), independently of the border's colour, the
 *      same shape as `healthBadge`/`healthBadgeAccent` (v20). Absent on an
 *      older document, which opens with the quote panel in its printed
 *      colours, exactly as before.
 *
 * v23 — a map's start marker gained `startSide`, which edge of the rim its
 *      diamond sits on, replacing a single hardcoded upper-left corner; and
 *      the map gained `startInk`, the numeral's own colour, replacing an
 *      unwired CSS variable no document had ever set. Absent on an older
 *      document, which opens with every marker at `'top'` and the numeral in
 *      its previous fixed cream — the same colour that variable's fallback
 *      always resolved to, so nothing visibly changes on load.
 *
 * v24 — a character card's design gained `abilityInk` (the special ability's
 *      name, rule and body text, one colour for all three) and `moveInk`
 *      (the move value's own ink, starting with the digit and the arrow
 *      beside it — see v25) — both previously fixed black, independently of
 *      the border's colour, the same shape as `quoteInk` (v22). The arrow
 *      came out of the printed `ink` art into its own mask for this — see
 *      `tools/hero-card-assets.py`'s `split_move_ink` — so it could take a
 *      colour at all. Absent on an older document, which opens with both in
 *      their printed black, exactly as before.
 *
 * v25 — a character card's design gained `healthInk`, the START HEALTH
 *      value's own colour — the hero's own badge and every reused copy of
 *      it (a swarm sidekick's shifted or paired badges) — previously fixed
 *      white, the same shape as `healthBadge`/`healthBadgeAccent` (v20).
 *      Unrelated: `moveInk` (v24) now also covers the word MOVE, which
 *      `split_move_ink` (renamed from `split_move_arrow`) pulls out of
 *      `ink` alongside the arrow rather than leaving fixed — needs no
 *      version bump of its own, since the field already existed and every
 *      document already had an opinion about its colour. Absent on an
 *      older document, `healthInk` opens in its printed white, exactly as
 *      before.
 *
 * v26 — a map gained `size`, one of `MAP_SIZES`' three named board shapes
 *      (`small`/`medium`/`large`), replacing a fixed single default aspect
 *      with an author's own choice — see `map/types.ts`. Setting it also
 *      sets `aspect` to match, but the two are stored separately: an older
 *      document has no `size` and is labelled `large` for it, without
 *      touching whatever `aspect` it already had, so a map already placed
 *      against its own numbers does not shift under its spaces. Absent on
 *      an older document otherwise, which opens exactly as it always
 *      printed.
 *
 * v27 — a map space gained `rotation`, degrees clockwise applied to its
 *      `zones`' own wedges (see `MapBoard.svelte`'s `wedge()`), so a split
 *      space's colours can be turned without moving the space itself.
 *      Absent on an older document, which opens at 0° — the same wedge
 *      layout it always drew. The map itself gained `palette`, colours an
 *      author has explicitly added to the "Colour this space" swatch via
 *      its "+" button, on top of whatever the swatch already finds by
 *      reading the board. Absent on an older document, which opens with an
 *      empty one — nothing it showed before is lost, since that swatch
 *      still reads the board directly regardless.
 *
 * v28 — a set gained `kind`, one of `SET_KINDS`: an *adventure*, which is
 *      everything the app has ever made, or a *heroes set*, a box of
 *      playable figures with no villain to face. The kind only ever hides
 *      what a heroes set has no use for — the villain and minion rosters,
 *      the initiative deck, events, the threat track — and changes which
 *      completeness checks apply; nothing about a card, a character or a
 *      map is stored differently because of it. Absent on an older
 *      document, which opens as `adventure` and is therefore untouched:
 *      every set authored before this existed was an adventure by the only
 *      definition there was.
 *
 * v29 — a generated token gained `lengthMm`, its reach on the Z axis
 *      alongside `diameterMm`'s reach on X — see `models/token.ts`'s
 *      `faceGeometry`. Only a polygon reads it; a circle stays a circle.
 *      Equal reaches is the regular polygon every token used to be forced
 *      into, which for four sides could only ever be a square — unequal is
 *      what makes it a rectangle, or an elongated hexagon, instead. Absent
 *      on an older document, `lengthMm` is repaired to that document's own
 *      `diameterMm`, not the factory default — a token that was regular
 *      before this field existed opens exactly as regular now, whatever its
 *      own size happened to be.
 *
 *      Unrelated, and needing no bump of its own: the health dial's new
 *      two-sided art reads the *existing* `Figure.token.twoSided` field —
 *      present on every figure regardless of kind, but never once consulted
 *      for a dial before now. See `figures/health-dial.ts`'s
 *      `healthDialSpec`.
 *
 * Older documents are *repaired*, not rejected — see `sets/normalize.ts`. Only
 * a version newer than this build understands is refused.
 */
export const SET_SCHEMA_VERSION = 29;

/**
 * What a set is for.
 *
 * `adventure` is the original and stays the default everywhere — a villain,
 * its minions, the threat track it advances along and the board it is fought
 * on. `heroes` is a box of playable figures on their own: no antagonist, and
 * so no initiative deck driving one, no events and no threat track.
 *
 * A map belongs to *both*, deliberately. Heroes need somewhere to fight each
 * other, which is why `MAP_SIZES` offers boards smaller than an adventure's.
 */
export const SET_KINDS = ['adventure', 'heroes'] as const;
export type SetKind = (typeof SET_KINDS)[number];

export interface SetKindMeta {
  readonly label: string;
  readonly /** One line for a chooser. Says what the box *is*. */ summary: string;
  /** What the app does differently. Written for someone who has never seen it. */
  readonly detail: string;
  readonly icon: string;
}

export const SET_KIND_META: Readonly<Record<SetKind, SetKindMeta>> = {
  adventure: {
    label: 'Adventure',
    summary: 'Heroes face a villain and its minions.',
    detail:
      'The full box: heroes, a villain, minions, an initiative deck that drives ' +
      'the villain’s turn, event cards, a threat track and a map.',
    icon: 'skull'
  },
  heroes: {
    label: 'Heroes set',
    summary: 'A box of heroes, with no villain to face.',
    detail:
      'Just heroes and their cards — plus rule cards and a map if you want them. ' +
      'Villains, minions, the initiative deck, events and the threat track are ' +
      'hidden, because a heroes set has nothing to use them for.',
    icon: 'users'
  }
} as const;

/**
 * Where a set was copied from, if it was copied.
 *
 * Recorded once, when the copy is taken, and never rewritten — this describes
 * an *event*, not a relationship, so it stays true after the original is
 * renamed, withdrawn or deleted. Two things it deliberately is not: a live
 * link (the original may be gone, and the copy must still open), and a grant
 * of any kind (nothing about a fork is enforced by it).
 *
 * `revision` is the load-bearing field. It is the merge base for offering
 * changes back, and it is only obtainable here: publishing overwrites, so the
 * document a fork started from stops existing the moment its original is
 * published again. See `fingerprint` for the rest of that argument.
 */
export interface SetOrigin {
  /** The share token copied from. The handle a person can still follow. */
  slug: string;
  /** The published row's id — what a contribution will be addressed to. */
  setId: string;
  /** The revision copied. The merge base. */
  revision: number;
  /** The author's display name at the time. A credit, never an authority. */
  authorName: string;
  copiedAt: IsoDateTime;
  /**
   * A content hash per entity id, as things stood at the moment of copying.
   *
   * This is how a change offered back can tell "I changed this" from "the
   * owner changed this" without keeping a second copy of the whole document —
   * see `sets/fingerprint.ts`. Optional because a reader must never assume it
   * is there: a fork taken by a future build that drops it, or a hand-edited
   * document, is still a valid fork.
   */
  fingerprint?: Record<string, string>;
}

export interface SetMeta {
  author: string;
  description: string;
  /** Author-facing release string, e.g. "0.3.0". Distinct from the schema. */
  version: string;
  readonly createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * The whole document, and the only thing that gets saved or exported.
 *
 * Characters, decks and cards are kept as flat arrays rather than nested
 * trees, related by ID:
 *
 *   Set ─┬─ characters
 *        ├─ decks   (ownerId → Character, or null for the adventure itself)
 *        └─ cards   (deckId  → Deck)
 *
 * Re-parenting anything is then a one-field edit, every grouping the UI shows
 * is derived rather than duplicated, and the whole document is plain JSON —
 * no Maps, Sets or Dates to reconstruct on load.
 */
export interface AdventureSet {
  readonly id: SetId;
  readonly schemaVersion: number;
  /**
   * Whether this is an adventure or a box of heroes. See `SET_KINDS`.
   *
   * Presentation and completeness only — it hides sections a heroes set has
   * no use for and changes which checks `assessSet` applies. Nothing is stored
   * differently because of it, which is what makes switching back and forth
   * lossless: everything a hidden section held is still in the document.
   */
  kind: SetKind;
  name: string;
  subtitle: string;
  meta: SetMeta;
  /** Look overrides applied to every card in the set, under each card's own. */
  style: CardStyleOverride;
  characters: Character[];
  decks: Deck[];
  cards: Card[];
  /** The villain's threat track, if the adventure uses one. */
  threat: ThreatTrack;
  /** The board the adventure is played on, if it has one. */
  map: AdventureMap;
  /** Miniatures, tokens and other physical components. */
  figures: Figure[];
  /** Author-uploaded glyphs, insertable inline in ability text and rich text. */
  customSymbols: CustomSymbol[];
  /** Box art, shown on the set's home page. */
  boxArt: Artwork;
  /**
   * A finished image standing in for the printed initiative deck back.
   *
   * Set-wide rather than per card, because that is what the back is: the
   * initiative deck belongs to the adventure and every card in it shows the
   * same reverse. A character's deck back lives on the character for the same
   * reason — one back, wherever the thing it backs is owned.
   */
  initiativeBack: Artwork;
  useInitiativeBack: boolean;
  /** Where this set was copied from. `null` for anything authored here. */
  origin: SetOrigin | null;
}

/** A deck with its cards resolved, as the sidebar and stats want them. */
export interface DeckEntry {
  deck: Deck;
  cards: Card[];
  /** Physical cards once quantities are counted. */
  printCount: number;
}

/** A character with its non-initiative decks resolved. */
export interface CharacterEntry {
  character: Character;
  decks: DeckEntry[];
  cardCount: number;
  printCount: number;
}

/**
 * The set grouped the way the sidebar presents it. Every deck appears exactly
 * once: initiative decks are collected under `initiative` whoever owns them,
 * and a deck whose owner was deleted lands in `loose`.
 */
export interface SetOutline {
  /** Shown first — a hero is who the set is played *as*, the rest is who it is played against. */
  heroes: CharacterEntry[];
  /** At most one, per `MAX_VILLAINS` — empty for a box of heroes with none. */
  villains: CharacterEntry[];
  minions: CharacterEntry[];
  /** Sidekicks, shown only when the role is in use. Not offered yet — see `SELECTABLE_ROLES`. */
  others: CharacterEntry[];
  initiative: DeckEntry[];
  rules: DeckEntry[];
  events: DeckEntry[];
  loose: DeckEntry[];
}
