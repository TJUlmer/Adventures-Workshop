/**
 * Tabletop Simulator saved-object export: what goes in it, and what it says.
 *
 * Two halves, and this is the pure one — it plans the piles and writes the
 * object graph, and never touches the DOM. `tts-bundle.ts` renders the images
 * the plan asks for and puts the whole thing on disk.
 *
 * ## How the piles are chosen
 *
 * The obvious grouping is the author's decks, and it is the wrong one: an
 * Adventures set has a figure's action deck, its initiative deck and its rules
 * cards all authored separately but *played* as one pile per figure. Worse, TTS
 * lays a deck out as a single sheet of one cell size, so a pile may only ever
 * hold one card format. So the piles here are one per figure, one for rules,
 * one for initiative and one for events — the author's decks merged by who
 * holds them, then split by format because TTS cannot do otherwise.
 *
 * That split is also what makes the two scales come out right. Poker cards and
 * mini-euro cards are different objects with different `Transform` scales; the
 * previous exporter's single "Deck" and "Initiative" could only ever be one
 * size each.
 *
 * ## Why the images are URLs
 *
 * TTS does not embed art. A `DeckCustom` names a face sheet by URL and fetches
 * it at load, so an export is only useful once its images have an address. See
 * `exports-folder.ts` for where they get one.
 */
import { cardLabel } from '$lib/cards/factory';
import type { Card, CardType } from '$lib/cards/types';
import { CARD_TYPE_META } from '$lib/cards/types';
import { characterLabel } from '$lib/characters/factory';
import type { Character, HeroCharacterCard } from '$lib/characters/types';
import { richTextToPlain } from '$lib/text/rich-text';
import { CARD_FORMATS, THREAT_TRACK } from '$lib/renderer/geometry';
import type { CardFormat } from '$lib/renderer/geometry';
import { TEMPLATE_ASSETS } from '$lib/renderer/assets';
import { getVillain, outline } from '$lib/sets/queries';
import type { AdventureSet, DeckEntry } from '$lib/sets/types';
import { threatTotal } from '$lib/threat/types';
import { slugify } from './json';

/** TTS lays a deck out as a single sheet, at most 10 columns by 7 rows. */
export const MAX_SHEET_COLUMNS = 10;
export const MAX_SHEET_ROWS = 7;
export const MAX_SHEET_CARDS = MAX_SHEET_COLUMNS * MAX_SHEET_ROWS;

/**
 * The card every other size is measured against: the poker card TTS hands out
 * at scale 1. A card's scale is simply its printed height over this one's.
 */
const REFERENCE_MM = CARD_FORMATS.action.mm;

const MM_PER_INCH = 25.4;

// -- The plan -----------------------------------------------------------

/** How a pile's backs are drawn. */
export type TtsBack =
  /** One image for the pile: this figure's deck back. */
  | { readonly kind: 'character'; readonly character: Character }
  /** One image for the pile, already drawn and shipped with the app. */
  | { readonly kind: 'asset'; readonly url: string }
  /** Every card draws its own back — event cards are designed on both sides. */
  | { readonly kind: 'perCard' }
  /** Nothing to draw: a flat card in the set's own colour. */
  | { readonly kind: 'plain' };

export interface TtsCardPlan {
  /**
   * The card to draw, or `null` for a face that is not one.
   *
   * Nullable because a hero's character card is not in `set.cards` — it is a
   * stat sheet read straight off the character, exactly like a deck back. See
   * `statCard` below.
   */
  readonly card: Card | null;
  /**
   * Draw this hero's character card instead. `card` is `null` when this is set.
   */
  readonly statCard?: Character | null;
  /** Which of `statCard`'s identities. Absent draws their own. */
  readonly statCardEntry?: HeroCharacterCard | null;
  /** Owning figure, for the name ribbon. */
  readonly character: Character | null;
}

export interface TtsDeckPlan {
  /** Slug. Names every file this pile writes, so it has to be unique. */
  readonly id: string;
  readonly nickname: string;
  readonly description: string;
  readonly format: CardFormat;
  /** Expanded by quantity: a TTS deck holds physical cards, not counts. */
  readonly cards: readonly TtsCardPlan[];
  readonly back: TtsBack;
}

/**
 * Cards expanded by quantity, because TTS decks hold physical cards — a card
 * with `quantity: 3` is three entries, not one with a count.
 */
function expand(cards: readonly Card[], character: Character | null): TtsCardPlan[] {
  return cards.flatMap((card) =>
    Array.from({ length: Math.max(1, card.quantity) }, () => ({ card, character }))
  );
}

/**
 * A pile's own `CardType` plus a landscape rules card's split — the latter is
 * still a `'rules'` card everywhere that reads `card.type` (`backFor`, in
 * particular), it just cannot share a sheet, or a name, with a portrait one.
 */
type PileKey = CardType | 'rules-landscape';

function pileKeyFor(card: Card): PileKey {
  if (card.type === 'rules' && card.landscape) return 'rules-landscape';
  return card.type;
}

function formatFor(key: PileKey): CardFormat {
  if (key === 'rules-landscape') return CARD_FORMATS.rulesLandscape;
  if (key === 'initiative') return CARD_FORMATS.initiative;
  if (key === 'rules') return CARD_FORMATS.rules;
  if (key === 'event') return CARD_FORMATS.event;
  return CARD_FORMATS.action;
}

function pileLabel(key: PileKey): string {
  if (key === 'rules-landscape') return 'Rules cards (landscape)';
  return CARD_TYPE_META[key].plural;
}

/**
 * A pile's back.
 *
 * Follows the card's template first: an event card is designed on both sides,
 * and the initiative deck's back is a printed image the set does not compose.
 * Everything else takes the back of whichever figure holds it, falling back to
 * the villain's so a set's rules cards match the rest of the box.
 */
function backFor(set: AdventureSet, type: CardType, character: Character | null): TtsBack {
  if (type === 'event') return { kind: 'perCard' };
  if (type === 'initiative') {
    /* The author's own back if they supplied one. It is stored as a data URL,
       which is an address like any other as far as the sheet renderer is
       concerned — it fetches this the same way it fetches the shipped file. */
    const supplied = set.useInitiativeBack && set.initiativeBack.source;
    return { kind: 'asset', url: supplied || TEMPLATE_ASSETS.initiativeCardback };
  }

  const owner = character ?? getVillain(set);
  return owner ? { kind: 'character', character: owner } : { kind: 'plain' };
}

function uniqueId(taken: Set<string>, name: string, fallback: string): string {
  const base = slugify(name, fallback);
  let id = base;
  let suffix = 2;
  while (taken.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  taken.add(id);
  return id;
}

/** One group of the author's decks, before it is split by card format. */
interface Bucket {
  readonly label: string;
  readonly fallbackId: string;
  readonly character: Character | null;
  readonly entries: readonly DeckEntry[];
}

/**
 * Split a bucket by card format, because a TTS sheet has one cell size.
 *
 * The name only says which format when there is more than one, so the common
 * case — a figure with an action deck — comes out as the figure's name and
 * nothing else.
 */
function plansFor(set: AdventureSet, bucket: Bucket, taken: Set<string>): TtsDeckPlan[] {
  const byKey = new Map<PileKey, { type: CardType; cards: TtsCardPlan[] }>();

  for (const entry of bucket.entries) {
    for (const planned of expand(entry.cards, bucket.character)) {
      /* Every plan built here comes from `expand`, which only ever makes plans
         from real cards — a character card never reaches this function, it is
         its own pile. The guard is for the type, not for a case that happens. */
      if (!planned.card) continue;
      const key = pileKeyFor(planned.card);
      const bucketed = byKey.get(key);
      if (bucketed) bucketed.cards.push(planned);
      else byKey.set(key, { type: planned.card.type, cards: [planned] });
    }
  }

  const split = byKey.size > 1;

  return [...byKey].map(([key, { type, cards }]) => {
    const name = split ? `${bucket.label} — ${pileLabel(key)}` : bucket.label;
    return {
      id: uniqueId(taken, name, bucket.fallbackId),
      nickname: name,
      description: bucket.character?.subtitle ?? '',
      format: formatFor(key),
      cards,
      back: backFor(set, type, bucket.character)
    };
  });
}

/**
 * A hero's character card, as a pile of exactly one.
 *
 * One card rather than an object built by hand, because `deckObject` already
 * turns a one-card pile into a `CardCustom` rather than a `DeckCustom` — which
 * is precisely what this wants to be. A stat sheet shuffled into the hero's
 * deck would be dealt into somebody's hand; as its own card it sits on the
 * table, is picked up, and is put in front of whoever is playing them.
 *
 * `back: 'plain'` because the printed card is single-sided. Showing the hero's
 * deck back here would look tidier and be a lie — it would read as a card that
 * belongs in the deck, which is the one thing this must not be mistaken for.
 */
function characterCardPlans(character: Character, taken: Set<string>): TtsDeckPlan[] {
  if (character.role !== 'hero') return [];

  const sheets: { entry: HeroCharacterCard | null; name: string }[] = [
    { entry: null, name: `${characterLabel(character)} character card` },
    ...character.additionalCards.map((extra) => ({
      entry: extra,
      name: `${characterLabel(character)} — ${extra.name.trim() || 'character card'}`
    }))
  ];

  return sheets.map(({ entry, name }) => ({
    id: uniqueId(taken, name, 'character-card'),
    nickname: name,
    description: 'Reference card — keep it face up in front of you.',
    format: CARD_FORMATS.action,
    cards: [{ card: null, character: null, statCard: character, statCardEntry: entry }],
    back: { kind: 'plain' as const }
  }));
}

/** Every pile the set makes, in the order they are laid out on the table. */
export function planTabletopDecks(set: AdventureSet): TtsDeckPlan[] {
  const view = outline(set);
  const taken = new Set<string>();

  const buckets: Bucket[] = [
    /*
     * One pile per figure: everything that figure plays, however it was filed.
     *
     * Heroes first and in the same list as everyone else — they were left out
     * of a hand-written role list here for a whole release and exported
     * nothing at all, which is the argument for never writing that list twice.
     */
    ...[...view.heroes, ...view.villains, ...view.minions, ...view.others].map((entry) => ({
      label: characterLabel(entry.character),
      fallbackId: 'figure',
      character: entry.character,
      entries: entry.decks
    })),
    { label: 'Rules', fallbackId: 'rules', character: null, entries: view.rules },
    { label: 'Initiative', fallbackId: 'initiative', character: null, entries: view.initiative },
    { label: 'Events', fallbackId: 'events', character: null, entries: view.events },
    // A figure's deck outlives it; its cards still belong on the table.
    { label: 'Unfiled', fallbackId: 'unfiled', character: null, entries: view.loose }
  ];

  const piles = buckets
    .flatMap((bucket) => plansFor(set, bucket, taken))
    .filter((plan) => plan.cards.length > 0);

  /* After the decks, so a hero's own cards land beside their pile on the
     table rather than the stat sheets being grouped off on their own. */
  return [...piles, ...view.heroes.flatMap((entry) => characterCardPlans(entry.character, taken))];
}

// -- The images the plan resolved to ------------------------------------

/** One face sheet, and the cards it holds in slot order. */
export interface TtsSheet {
  readonly faceUrl: string;
  readonly backUrl: string;
  /** True when the back sheet has a cell per card rather than one image. */
  readonly uniqueBack: boolean;
  readonly columns: number;
  readonly rows: number;
  readonly cards: readonly TtsCardPlan[];
}

/**
 * A pile with its images resolved. More than one sheet when the pile holds more
 * than 70 cards — TTS allows a deck several `CustomDeck` entries, so a long
 * deck is still one pile rather than the author's problem.
 */
export interface TtsDeckImages {
  readonly plan: TtsDeckPlan;
  readonly sheets: readonly TtsSheet[];
}

export interface TtsMapImage {
  readonly url: string;
  /** Printed proportions, so the board can be scaled back to the right shape. */
  readonly mm: { readonly width: number; readonly height: number };
}

export interface TtsThreatImage {
  readonly url: string;
  /** Printed proportions, so the card can be scaled back to the right shape. */
  readonly mm: { readonly width: number; readonly height: number };
}

export interface TtsSaveInput {
  readonly set: AdventureSet;
  readonly decks: readonly TtsDeckImages[];
  /** The threat board, as a single card. */
  readonly threat: TtsThreatImage | null;
  /** The map, as a single card behind it. */
  readonly map: TtsMapImage | null;
  /** Figures: models written beside the save, and whole saved objects spliced in. */
  readonly components: readonly object[];
}

// -- The object graph ---------------------------------------------------

interface TtsTransform {
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

/**
 * The stock fields every object carries.
 *
 * Written out rather than left to TTS's defaults because a saved object with
 * fields missing loads with them *off* — `Tooltip: false` on every card is not
 * a default anyone chose.
 */
const OBJECT_DEFAULTS = {
  GMNotes: '',
  ColorDiffuse: { r: 0.713, g: 0.713, b: 0.713 },
  Locked: false,
  Grid: true,
  Snap: true,
  IgnoreFoW: false,
  MeasureMovement: false,
  DragSelectable: true,
  Autoraise: true,
  Sticky: true,
  Tooltip: true,
  GridProjection: false,
  HideWhenFaceDown: true,
  Hands: true,
  LuaScript: '',
  LuaScriptState: '',
  XmlUI: ''
} as const;

/** Face up, and the way round TTS writes a freshly spawned deck. */
function transform(posX: number, posZ: number, scale: number): TtsTransform {
  const value = Number(scale.toFixed(4));
  return {
    posX: Number(posX.toFixed(3)),
    posY: 1,
    posZ,
    rotX: 0,
    rotY: 180,
    rotZ: 180,
    scaleX: value,
    scaleY: value,
    scaleZ: value
  };
}

/**
 * A card's size relative to the poker card TTS hands out — one uniform scale,
 * never per-axis, and that distinction is the whole of a bug worth remembering.
 *
 * A TTS custom card takes its *shape* from the face image's aspect ratio; the
 * object's scale only sets its overall size. Scaling the axes separately
 * therefore applies the aspect a *second* time, on top of the one already baked
 * into the sheet — which stretched every event card flat and blew the threat
 * track out to eight times its width while leaving its height right (the height
 * axis happened to carry the correct figure). So the shape is left to the image
 * and the card is sized by height alone, exactly as the hand-made Oz export did
 * with its uniform 67/88 mini-euro deck.
 */
function scaleOf(mm: { readonly width: number; readonly height: number }): number {
  return mm.height / REFERENCE_MM.height;
}

/** One line of rules text, for the card's TTS description. */
function describe(card: Card): string {
  switch (card.type) {
    case 'action': {
      const parts: string[] = [];
      if (card.attack !== null) parts.push(`Attack ${card.attack}`);
      if (card.defense !== null) parts.push(`Defense ${card.defense}`);
      if (card.boost !== null) parts.push(`Boost ${card.boost}`);
      const stats = parts.join(' · ');
      const text = [card.ability.plain, card.defenseAbility.plain].filter(Boolean).join(' / ');
      return [stats, text].filter(Boolean).join('\n');
    }
    case 'initiative':
      return [
        card.rightNow && `Right now: ${card.rightNow}`,
        card.endOfRound && `End of round: ${card.endOfRound}`
      ]
        .filter(Boolean)
        .join('\n');
    default:
      return richTextToPlain(card.body);
  }
}

/**
 * The card's identity in this document, carried through to TTS.
 *
 * `GMNotes` is the only field TTS keeps verbatim and shows nobody, so it is
 * where a re-export can recognise what it is looking at.
 */
function gmNotes(plan: TtsCardPlan): string {
  /* A character card has no `Card` to name, so it identifies itself by the
     hero it belongs to and which of their sheets it is — enough for a
     re-import to recognise it, which is all this field is for. */
  if (!plan.card) {
    return JSON.stringify({
      cardType: 'characterCard',
      characterId: plan.statCard?.id ?? null,
      entryId: plan.statCardEntry?.id ?? null
    });
  }

  return JSON.stringify({
    cardId: plan.card.id,
    cardType: plan.card.type,
    characterId: plan.character?.id ?? null
  });
}

/** What a pile's one card calls itself on the table, and what it says it is. */
function cardName(plan: TtsCardPlan): { nickname: string; description: string } {
  if (!plan.card) {
    const hero = plan.statCard ? characterLabel(plan.statCard) : 'Hero';
    const sheet = plan.statCardEntry?.name.trim();
    return {
      nickname: sheet ? `${hero} — ${sheet}` : `${hero} character card`,
      description: 'Reference card — keep it face up in front of you.'
    };
  }
  return { nickname: cardLabel(plan.card), description: describe(plan.card) };
}

function customDeck(sheet: TtsSheet): object {
  return {
    FaceURL: sheet.faceUrl,
    BackURL: sheet.backUrl,
    NumWidth: sheet.columns,
    NumHeight: sheet.rows,
    BackIsHidden: true,
    UniqueBack: sheet.uniqueBack,
    Type: 0
  };
}

function cardObject(
  plan: TtsCardPlan,
  cardId: number,
  sheet: TtsSheet,
  sheetId: number,
  at: TtsTransform,
  sideways: boolean
): object {
  const named = cardName(plan);

  return {
    Name: 'Card',
    Transform: at,
    Nickname: named.nickname,
    Description: named.description,
    ...OBJECT_DEFAULTS,
    GMNotes: gmNotes(plan),
    CardID: cardId,
    SidewaysCard: sideways,
    CustomDeck: { [sheetId]: customDeck(sheet) }
  };
}

/**
 * A pile, as one object.
 *
 * A one-card pile is a `CardCustom` rather than a `DeckCustom`: TTS treats a
 * deck of one as a deck, which cannot be picked up and played, and there is no
 * reason for a set's only rules card to arrive unusable.
 */
function deckObject(images: TtsDeckImages, at: TtsTransform, sheetIdBase: number): object {
  const { plan, sheets } = images;
  // Landscape cards go sideways in hand, which is what the printed ones do.
  const sideways = plan.format.mm.width > plan.format.mm.height;

  const contained: object[] = [];
  const deckIds: number[] = [];
  const decks: Record<number, object> = {};

  sheets.forEach((sheet, page) => {
    const sheetId = sheetIdBase + page;
    decks[sheetId] = customDeck(sheet);
    sheet.cards.forEach((card, slot) => {
      const cardId = sheetId * 100 + slot;
      deckIds.push(cardId);
      contained.push(cardObject(card, cardId, sheet, sheetId, at, sideways));
    });
  });

  if (deckIds.length === 1) {
    const only = contained[0] as Record<string, unknown>;
    return { ...only, Name: 'CardCustom', Nickname: plan.nickname };
  }

  return {
    Name: 'DeckCustom',
    Transform: at,
    Nickname: plan.nickname,
    Description: plan.description,
    ...OBJECT_DEFAULTS,
    Hands: false,
    SidewaysCard: sideways,
    CustomDeck: decks,
    DeckIDs: deckIds,
    ContainedObjects: contained
  };
}

/**
 * The threat board, as a card.
 *
 * A card rather than a tile or a board because that is what it is used as: it
 * comes out of the box, goes on the table and is put away. Its long strip shape
 * is carried by the face image — 5846 × 827px is already 7:1 — so the card only
 * has to be *sized*, by height, like every other. Scaling its width as well was
 * what stretched it to eight times its length.
 */
/**
 * The map, as a card.
 *
 * A `CardCustom` like the threat track, and for the same reason: its shape is
 * carried by the face image, so it only has to be *sized*, by height. Scaling
 * width as well applies the aspect twice — the trap that once blew the threat
 * track out to eight times its length.
 *
 * Not merged with the threat track into one object, though on the table they
 * are one board. Two objects can be laid against each other by hand; one merged
 * image cannot be taken apart, and the merge would have to bake the track into
 * the map at a fixed scale. Placed so its far edge meets the track's near one,
 * which is where it sits on the printed board.
 */
function mapObject(set: AdventureSet, map: TtsMapImage, posZ: number): object {
  const spaces = set.map.spaces.length;

  return {
    Name: 'CardCustom',
    Transform: transform(0, posZ, scaleOf(map.mm)),
    Nickname: `${set.name} — map`,
    Description: `${spaces} ${spaces === 1 ? 'space' : 'spaces'}, ${set.map.paths.length} ${set.map.paths.length === 1 ? 'path' : 'paths'}.`,
    ...OBJECT_DEFAULTS,
    Hands: false,
    HideWhenFaceDown: false,
    /*
     * `CardID` is not a name — it is an *index*: the CustomDeck key times 100,
     * plus the slot on that sheet (see `deckObject`). So it has to agree with
     * the key below, and 1 → 100.
     *
     * It was 200 against a CustomDeck keyed 1, which sent TTS looking for a
     * sheet that was not there. The card still spawned, at the right size and
     * in the right place, and drew as a blank rectangle — no error, no missing
     * texture, just nothing on it. Uniqueness across objects is not the point
     * and never was; each object carries its own CustomDeck.
     */
    CardID: 100,
    SidewaysCard: false,
    CustomDeck: {
      1: {
        FaceURL: map.url,
        BackURL: map.url,
        NumWidth: 1,
        NumHeight: 1,
        BackIsHidden: true,
        UniqueBack: false,
        Type: 0
      }
    }
  };
}

function threatObject(set: AdventureSet, threat: TtsThreatImage, posZ: number): object {
  const spaces = set.threat.steps.length;

  return {
    Name: 'CardCustom',
    Transform: transform(0, posZ, scaleOf(threat.mm)),
    Nickname: `${set.name} — threat track`,
    Description: [
      `${spaces} ${spaces === 1 ? 'space' : 'spaces'}, ${threatTotal(set.threat)} threat in total.`,
      set.threat.rules
    ]
      .filter(Boolean)
      .join('\n'),
    ...OBJECT_DEFAULTS,
    Hands: false,
    HideWhenFaceDown: false,
    CardID: 100,
    SidewaysCard: false,
    CustomDeck: {
      1: {
        FaceURL: threat.url,
        BackURL: threat.url,
        NumWidth: 1,
        NumHeight: 1,
        BackIsHidden: true,
        UniqueBack: false,
        Type: 0
      }
    }
  };
}

// -- Components ---------------------------------------------------------

/** Where a figure's objects go: a second row, clear of the piles. */
const COMPONENT_ROW_Z = 6;

export interface TtsModelComponent {
  readonly nickname: string;
  readonly description: string;
  /** URL of the `.obj`. TTS fetches it at load, as it does a face sheet. */
  readonly meshUrl: string;
  readonly diffuseUrl: string;
}

/**
 * A generated or attached model, as a custom model object.
 *
 * `Convex` is on because everything this app produces or accepts here is a
 * token or a miniature that behaves better with a simple collider — a concave
 * collider is slower and stacks badly, and neither is worth it for a disc.
 */
export function modelObject(component: TtsModelComponent, index: number): object {
  return {
    Name: 'Custom_Model',
    Transform: {
      posX: index * 2,
      posY: 1,
      posZ: COMPONENT_ROW_Z,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1
    },
    Nickname: component.nickname,
    Description: component.description,
    ...OBJECT_DEFAULTS,
    Hands: false,
    HideWhenFaceDown: false,
    CustomMesh: {
      MeshURL: component.meshUrl,
      DiffuseURL: component.diffuseUrl,
      NormalURL: '',
      ColliderURL: '',
      Convex: true,
      /* Plastic, and a generic type — the same answers the token export's own
         instructions give for the import dialogue. */
      MaterialIndex: 0,
      TypeIndex: 0,
      CastShadows: true
    }
  };
}

/**
 * Objects lifted out of a saved object the author attached, moved into the row.
 *
 * Everything else in the file is left exactly as it was found. These are files
 * TTS itself wrote — health dials with their own Lua, models with hosted
 * meshes — and there is nothing in them this export understands better than
 * they do. Only the position is ours, and only so two of them do not land in
 * the same place.
 */
export function placeSavedObjects(states: readonly unknown[], index: number): object[] {
  return states.filter((state): state is Record<string, unknown> => {
    return typeof state === 'object' && state !== null;
  }).map((state, offset) => ({
    ...state,
    Transform: {
      ...(typeof state['Transform'] === 'object' && state['Transform'] !== null
        ? (state['Transform'] as Record<string, unknown>)
        : { rotX: 0, rotY: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 }),
      posX: (index + offset) * 2,
      posY: 1,
      posZ: COMPONENT_ROW_Z
    }
  }));
}

/**
 * Lay the piles out left to right, in a row a player can see all of.
 *
 * Spaced by each pile's real width so nothing overlaps whatever mix of formats
 * a set turns out to have — a row of poker decks and a row that includes a
 * landscape event deck should both come out readable.
 */
function layOut(images: readonly TtsDeckImages[]): TtsTransform[] {
  let cursor = 0;
  return images.map((deck) => {
    const width = deck.plan.format.mm.width / MM_PER_INCH;
    const at = transform(cursor + width / 2, 0, scaleOf(deck.plan.format.mm));
    cursor += width + 1;
    return at;
  });
}

/**
 * The whole set, as one saved object.
 *
 * `ObjectStates` is a flat list, which is what makes "everything in one file"
 * possible at all: piles, the threat board and every component are peers, and
 * spawning the file puts the lot on the table at once.
 */
export function buildTabletopSimulatorSave(input: TtsSaveInput): string {
  const { set, decks, threat, map, components } = input;
  const positions = layOut(decks);

  const objects: object[] = decks.map((deck, index) =>
    /* 100 apart, so a pile can grow to 70 cards and its `CardID`s — sheet × 100
       plus slot — still cannot reach the next pile's. */
    deckObject(deck, positions[index] ?? transform(index * 3, 0, 1), 100 + index * 10)
  );

  // Behind the piles, where a wide strip has room.
  if (threat) objects.push(threatObject(set, threat, -6));

  /* Behind the track, far enough back that the two meet edge to edge rather
     than overlapping: half the track's depth plus half the map's, in inches. */
  if (map) {
    const gap = (THREAT_TRACK.mm.height / 2 + map.mm.height / 2) / MM_PER_INCH;
    objects.push(mapObject(set, map, Number((-6 - gap).toFixed(3))));
  }
  objects.push(...components);

  const save = {
    SaveName: set.name,
    GameMode: set.name,
    Date: new Date().toISOString(),
    VersionNumber: '',
    GameType: 'Unmatched Adventures',
    GameComplexity: '',
    Gravity: 0.5,
    PlayArea: 0.5,
    Table: '',
    Sky: '',
    Note: [set.subtitle, set.meta.description].filter(Boolean).join('\n'),
    Rules: '',
    TabStates: {},
    LuaScript: '',
    LuaScriptState: '',
    XmlUI: '',
    ObjectStates: objects
  };

  return JSON.stringify(save, null, 2);
}

/** The threat board's printed proportions, for the card that carries it. */
export const THREAT_CARD_MM = THREAT_TRACK.mm;
