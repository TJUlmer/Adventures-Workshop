/**
 * Repairing a loaded document.
 *
 * A set that was saved before a field existed is missing that field. Rejecting
 * it would cost the author their work, and leaving it alone means the renderer
 * reads `undefined` and throws — which, inside Svelte's effect graph, also
 * stops *later* updates from painting. So every document is normalised on the
 * way in: known gaps are filled with the same defaults the factories use.
 *
 * This runs on file import and on session restore alike, because both are
 * equally likely to be out of date.
 */
import {
  CARD_OWNERS,
  COMBAT_SYMBOLS,
  createAbilityBlocks,
  createHeadingPlacement,
  HEADING_ALIGNMENTS
} from '$lib/cards/types';
import type { AdventureMap, MapNoteId, MapPath, MapPathId, MapSpace, MapSpaceId } from '$lib/map/types';
import {
  createAdventureMap,
  createMapNote,
  createMapPath,
  createMapSpace,
  MAP_SIZES_ALL
} from '$lib/map/types';
import type {
  ActionCard,
  Card,
  CardOwner,
  CombatSymbol,
  EventCard,
  HeadingAlign,
  HeadingPlacement,
  InitiativeBands,
  InitiativeCard,
  RulesCard
} from '$lib/cards/types';
import { NO_CUSTOM_PATTERN, solid } from '$lib/cards/style';
import type { CustomPatternStyle, Fill } from '$lib/cards/style';
import {
  createCardback,
  createCharacterCard,
  createHeroCharacterCard,
  createHeroSidekick
} from '$lib/characters/factory';
import { ATTACK_TYPES, CHARACTER_BAND_NAMES, CHARACTER_ROLES } from '$lib/characters/types';
import type { CharacterBandName } from '$lib/characters/types';
import type {
  AttackType,
  CharacterAbility,
  CharacterCardDesign,
  HeroCharacterCard,
  HeroCharacterCardId,
  HeroQuote,
  HeroSidekick
} from '$lib/characters/types';
import type { Artwork } from '$lib/core/artwork';
import { createArtwork } from '$lib/core/artwork';
import type { DialRange, Figure, ModelFile, TokenBuild } from '$lib/figures/types';
import { createDialRange, createFigure, createTokenBuild, FIGURE_KINDS } from '$lib/figures/types';
import { MAX_POLYGON_SIDES, MIN_POLYGON_SIDES, TOKEN_SHAPES } from '$lib/models/token';
import type { TokenOutline } from '$lib/models/silhouette';
import { MAX_OUTLINE_DETAIL, MIN_OUTLINE_DETAIL } from '$lib/models/silhouette';
import { INITIATIVE_BAND_DEFAULTS } from '$lib/renderer/geometry';
import type { CustomSymbol } from '$lib/symbols/types';
import { createCustomSymbol } from '$lib/symbols/types';
import type { ThreatNote, ThreatSlot, ThreatTrack } from '$lib/threat/types';
import {
  clampNotePosition,
  createThreatNote,
  createThreatSlot,
  createThreatStep,
  createThreatTrack
} from '$lib/threat/types';
import { SET_KINDS } from './types';
import type { AdventureSet, SetKind, SetOrigin } from './types';

/** Anything loaded from JSON is untrusted shape-wise. */
type Loose = Record<string, unknown>;

function asRecord(value: unknown): Loose {
  return typeof value === 'object' && value !== null ? (value as Loose) : {};
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function nullableNum(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function fill(value: unknown, fallback: Fill): Fill {
  const raw = asRecord(value);
  if (typeof raw['color'] !== 'string') return fallback;
  return {
    kind: raw['kind'] === 'gradient' ? 'gradient' : 'solid',
    color: raw['color'],
    color2: str(raw['color2'], raw['color']),
    angle: num(raw['angle'], 180)
  };
}

function customPatternStyle(value: unknown): CustomPatternStyle {
  const raw = asRecord(value);
  return {
    source: typeof raw['source'] === 'string' ? raw['source'] : null,
    label: str(raw['label']),
    /*
     * `scale` briefly split into independent `scaleX`/`scaleY` mid-development
     * before going back to one uniform slider — never shipped either way, but
     * a document saved during that window is still a real document someone
     * has open. `scaleX` is read as the fallback (arbitrary, but no worse a
     * guess than `scaleY` for a shape nothing can recover losslessly).
     */
    scale: num(raw['scale'], num(raw['scaleX'], NO_CUSTOM_PATTERN.scale)),
    offsetX: num(raw['offsetX'], NO_CUSTOM_PATTERN.offsetX),
    offsetY: num(raw['offsetY'], NO_CUSTOM_PATTERN.offsetY),
    rotation: num(raw['rotation'], NO_CUSTOM_PATTERN.rotation),
    opacity: num(raw['opacity'], NO_CUSTOM_PATTERN.opacity),
    brightness: num(raw['brightness'], NO_CUSTOM_PATTERN.brightness),
    contrast: num(raw['contrast'], NO_CUSTOM_PATTERN.contrast),
    saturation: num(raw['saturation'], NO_CUSTOM_PATTERN.saturation),
    hue: num(raw['hue'], NO_CUSTOM_PATTERN.hue),
    grayscale: num(raw['grayscale'], NO_CUSTOM_PATTERN.grayscale),
    sepia: num(raw['sepia'], NO_CUSTOM_PATTERN.sepia)
  };
}

/**
 * A style override is read generically elsewhere — `CardStyleOverride` is
 * sparse by design, and `mergeCardStyle` treats an absent key as "inherit"
 * — so there is deliberately no per-key normalize branch for most of
 * `CardTheme`. `customPattern` is the one exception: unlike adding a new
 * key (which an older document simply lacks, and resolves from the default
 * theme for free), its own *shape* changed after shipping (it gained
 * `rotation` and a colour grade, and `scale` itself went through a brief
 * `scaleX`/`scaleY` detour on the way). A layer that already saved an older
 * shape is not absent — the whole cascade key is present and wins outright
 * — so every field the old shape lacked reads as `undefined` and crashes
 * the first control that formats it as a number.
 * Repairing it here, once, is what makes that self-heal on next load rather
 * than needing every reader of `theme.customPattern` to guard itself.
 */
function repairStyleOverride(raw: Loose): Loose {
  if (raw['customPattern'] === undefined) return raw;
  return { ...raw, customPattern: customPatternStyle(raw['customPattern']) };
}

/** Fills in transform, adjustments and effects added after the first release. */
function artwork(value: unknown): Artwork {
  const raw = asRecord(value);
  return createArtwork({
    source: typeof raw['source'] === 'string' ? raw['source'] : null,
    label: str(raw['label']),
    crop: asRecord(raw['crop']),
    transform: asRecord(raw['transform']),
    adjustments: asRecord(raw['adjustments']),
    effects: asRecord(raw['effects'])
  });
}

/** `null` is a valid, meaningful value here — see `ActionCard.symbol`. */
function combatSymbol(value: unknown): CombatSymbol | null {
  return (COMBAT_SYMBOLS as readonly unknown[]).includes(value) ? (value as CombatSymbol) : null;
}

function headingAlign(value: unknown): HeadingAlign {
  return (HEADING_ALIGNMENTS as readonly unknown[]).includes(value)
    ? (value as HeadingAlign)
    : 'left';
}

/**
 * `'hero'`/`'sidekick'`/`'any'`, or a `HeroCharacterCard`'s own id addressing
 * one of a hero's additional identities. Not cross-validated against
 * `additionalCards` here — this repo already tolerates a dangling foreign key
 * rather than checking one at load (`Figure.characterId`,
 * `InitiativeCard.characterId`); an id that no longer resolves to anything
 * just reads as `'hero'` would, at render time.
 */
function cardOwner(value: unknown): CardOwner {
  if ((CARD_OWNERS as readonly unknown[]).includes(value)) return value as CardOwner;
  return typeof value === 'string' && value.length > 0 ? (value as CardOwner) : 'hero';
}

function heroSidekick(value: unknown): HeroSidekick {
  const raw = asRecord(value);
  const defaults = createHeroSidekick();
  return {
    enabled: bool(raw['enabled'], defaults.enabled),
    name: str(raw['name'], defaults.name),
    attackType: (ATTACK_TYPES as readonly unknown[]).includes(raw['attackType'])
      ? (raw['attackType'] as HeroSidekick['attackType'])
      : defaults.attackType,
    multiple: bool(raw['multiple'], defaults.multiple),
    health: nullableNum(raw['health'], defaults.health),
    count: num(raw['count'], defaults.count)
  };
}

function heroQuote(value: unknown): HeroQuote {
  const raw = asRecord(value);
  return { text: str(raw['text']), attribution: str(raw['attribution']) };
}

/**
 * `fallbackDesign` is what an entry with no `characterCard` of its own seeds
 * from — a pre-v17 document's additional cards never had one, and starting
 * them from the *primary's own current colours* (a clone, via `characterCard`
 * itself — never the same object twice, or editing one card's design would
 * silently repaint another's) reads as "nothing changed yet" rather than a
 * surprise reset to the stock template the moment the document is reopened.
 */
function heroCharacterCard(value: unknown, fallbackDesign: CharacterCardDesign): HeroCharacterCard {
  const raw = asRecord(value);
  const defaults = createHeroCharacterCard();
  return {
    id: typeof raw['id'] === 'string' ? (raw['id'] as HeroCharacterCardId) : defaults.id,
    name: str(raw['name'], defaults.name),
    subtitle: str(raw['subtitle'], defaults.subtitle),
    attackType: (ATTACK_TYPES as readonly unknown[]).includes(raw['attackType'])
      ? (raw['attackType'] as AttackType)
      : defaults.attackType,
    health: nullableNum(raw['health'], defaults.health),
    move: num(raw['move'], defaults.move),
    abilities: Array.isArray(raw['abilities']) ? (raw['abilities'] as CharacterAbility[]) : [],
    quote: heroQuote(raw['quote']),
    characterCard: characterCard(raw['characterCard'] ?? fallbackDesign)
  };
}

/**
 * The character card's border and its three bands, keyed by band rather than
 * by position — a document written before this existed simply gets the printed
 * template's own colours and three empty artwork slots.
 */
function characterCard(value: unknown): CharacterCardDesign {
  const raw = asRecord(value);
  const defaults = createCharacterCard();
  const band = (name: CharacterBandName) => {
    const entry = asRecord(raw[name]);
    return {
      fill: fill(entry['fill'], defaults[name].fill),
      artwork: artwork(entry['artwork'])
    };
  };
  return {
    border: fill(raw['border'], defaults.border),
    healthBadge: fill(raw['healthBadge'], defaults.healthBadge),
    healthBadgeAccent: fill(raw['healthBadgeAccent'], defaults.healthBadgeAccent),
    healthInk: fill(raw['healthInk'], defaults.healthInk),
    quoteInk: fill(raw['quoteInk'], defaults.quoteInk),
    quoteScale: num(raw['quoteScale'], defaults.quoteScale),
    abilityInk: fill(raw['abilityInk'], defaults.abilityInk),
    moveInk: fill(raw['moveInk'], defaults.moveInk),
    ...(Object.fromEntries(CHARACTER_BAND_NAMES.map((name) => [name, band(name)])) as Pick<
      CharacterCardDesign,
      CharacterBandName
    >),
    replacement: artwork(raw['replacement']),
    useReplacement: bool(raw['useReplacement'], defaults.useReplacement)
  };
}

function cardback(value: unknown, role: string) {
  const raw = asRecord(value);
  const defaults = createCardback(
    (CHARACTER_ROLES as readonly string[]).includes(role)
      ? (role as (typeof CHARACTER_ROLES)[number])
      : 'minion'
  );
  return {
    background: fill(raw['background'], defaults.background),
    ink: str(raw['ink'], defaults.ink),
    artwork: artwork(raw['artwork']),
    replacement: artwork(raw['replacement']),
    useReplacement: bool(raw['useReplacement'], false),
    label: str(raw['label'], defaults.label),
    frame: fill(raw['frame'], defaults.frame)
  };
}

function abilityBlocks(value: unknown) {
  const raw = asRecord(value);
  return createAbilityBlocks({
    plain: str(raw['plain']),
    immediately: str(raw['immediately']),
    duringCombat: str(raw['duringCombat']),
    afterCombat: str(raw['afterCombat']),
    bonusAbility: str(raw['bonusAbility']),
    bonusIcon: str(raw['bonusIcon'])
  });
}

/**
 * The reverse heading's placement. Clamped to the card and to one turn, so a
 * hand-edited file cannot push the title off the face or spin it past sense.
 */
function headingPlacement(value: unknown): HeadingPlacement {
  const raw = asRecord(value);
  const base = createHeadingPlacement();
  const clamp = (at: number) => Math.min(100, Math.max(-100, at));
  return {
    offsetX: clamp(num(raw['offsetX'], base.offsetX)),
    offsetY: clamp(num(raw['offsetY'], base.offsetY)),
    rotation: Math.min(180, Math.max(-180, num(raw['rotation'], base.rotation)))
  };
}

function initiativeBands(value: unknown): InitiativeBands {
  const raw = asRecord(value);

  const band = (key: keyof InitiativeBands) => {
    const source = asRecord(raw[key]);
    const stock = INITIATIVE_BAND_DEFAULTS[key];
    return {
      fill: fill(source['fill'], solid(stock.fill)),
      ink: str(source['ink'], stock.ink),
      artwork: artwork(source['artwork']),
      showArtwork: bool(source['showArtwork'], false)
    };
  };

  return {
    subject: band('subject'),
    rightNow: band('rightNow'),
    endOfRound: band('endOfRound')
  };
}

/**
 * The adventure map.
 *
 * Every field falls back to the factory, so a document from before v10 opens
 * with the map switched off and empty rather than with a half-built one. The
 * spaces and paths are rebuilt rather than trusted: a path naming a space that
 * is not there would draw a line to nowhere, and it is cheaper to drop it here
 * than to guard every consumer.
 */
function adventureMap(value: unknown): AdventureMap {
  const raw = asRecord(value);
  const defaults = createAdventureMap();

  const spaces: MapSpace[] = (Array.isArray(raw['spaces']) ? raw['spaces'] : []).map((entry) => {
    const space = asRecord(entry);
    const zones = Array.isArray(space['zones']) ? space['zones'] : [];
    const base =
      typeof space['id'] === 'string'
        ? { id: space['id'] as MapSpaceId }
        : createMapSpace(0, 0);
    return {
      ...createMapSpace(num(space['x'], 0.5), num(space['y'], 0.5)),
      ...base,
      x: num(space['x'], 0.5),
      y: num(space['y'], 0.5),
      /* Never empty: a space with no wedge would draw as a hole in the board. */
      zones: zones.length > 0 ? zones.map((z) => fill(z, solid('#cfd3d6'))) : [solid('#cfd3d6')],
      stroke: typeof space['stroke'] === 'string' ? space['stroke'] : null,
      label: str(space['label']),
      /* 1..5, and anything else is no marker at all rather than a guess. */
      start:
        typeof space['start'] === 'number' && space['start'] >= 1 && space['start'] <= 5
          ? Math.round(space['start'])
          : null,
      startSide: (['top', 'right', 'bottom', 'left'] as const).includes(
        space['startSide'] as never
      )
        ? (space['startSide'] as MapSpace['startSide'])
        : 'top',
      rotation: num(space['rotation'], 0),
      notes: str(space['notes'])
    };
  });

  const known = new Set(spaces.map((space) => space.id));
  const paths: MapPath[] = (Array.isArray(raw['paths']) ? raw['paths'] : [])
    .map((entry) => {
      const path = asRecord(entry);
      const from = path['from'] as MapSpaceId;
      const to = path['to'] as MapSpaceId;
      if (typeof from !== 'string' || typeof to !== 'string') return null;
      if (!known.has(from) || !known.has(to) || from === to) return null;
      return {
        ...createMapPath(from, to),
        ...(typeof path['id'] === 'string' ? { id: path['id'] as MapPathId } : {}),
        curve: num(path['curve'], 0)
      };
    })
    .filter((path): path is MapPath => path !== null);

  return {
    enabled: bool(raw['enabled'], defaults.enabled),
    name: str(raw['name']),
    /* Absent on anything written before `size` existed, which read `aspect`
       below verbatim rather than through a preset — defaulting to `large`
       here is a label for that existing shape, not a repair of it.
       `MAP_SIZES_ALL` rather than a literal list, so adding a shape is one
       edit: the literal that used to be here silently rejected `custom` the
       moment it was added and snapped every custom board back to `large`. */
    size: (MAP_SIZES_ALL as readonly string[]).includes(raw['size'] as string)
      ? (raw['size'] as AdventureMap['size'])
      : defaults.size,
    /* A zero or negative aspect would divide by nothing in `mapHeight`. */
    aspect: num(raw['aspect'], defaults.aspect) > 0 ? num(raw['aspect'], defaults.aspect) : defaults.aspect,
    artwork: artwork(raw['artwork']),
    background: fill(raw['background'], defaults.background),
    spaceDiameter: num(raw['spaceDiameter'], defaults.spaceDiameter),
    spaceOpacity: Math.min(1, Math.max(0, num(raw['spaceOpacity'], defaults.spaceOpacity))),
    spaceStroke: str(raw['spaceStroke'], defaults.spaceStroke),
    pathColor: str(raw['pathColor'], defaults.pathColor),
    startInk: str(raw['startInk'], defaults.startInk),
    palette: (Array.isArray(raw['palette']) ? raw['palette'] : []).filter(
      (color): color is string => typeof color === 'string'
    ),
    spaces,
    paths,
    notes: (Array.isArray(raw['notes']) ? raw['notes'] : []).map((entry) => {
      const note = asRecord(entry);
      const base = createMapNote();
      return {
        ...base,
        ...(typeof note['id'] === 'string' ? { id: note['id'] as MapNoteId } : {}),
        text: str(note['text']),
        x: num(note['x'], base.x),
        y: num(note['y'], base.y),
        size: num(note['size'], base.size),
        rotation: num(note['rotation'], 0),
        color: str(note['color'], base.color)
      };
    })
  };
}

function threatTrack(value: unknown): ThreatTrack {
  const raw = asRecord(value);
  const defaults = createThreatTrack();
  const steps = Array.isArray(raw['steps']) ? raw['steps'] : null;
  const slots = Array.isArray(raw['slots']) ? raw['slots'] : null;

  return {
    enabled: bool(raw['enabled'], false),
    villainId: typeof raw['villainId'] === 'string' ? (raw['villainId'] as never) : null,
    steps: steps
      ? steps.map((entry) => {
          const step = asRecord(entry);
          const base =
            typeof step['id'] === 'string'
              ? { id: step['id'] as never, value: num(step['value'], 1), effect: str(step['effect']) }
              : createThreatStep(num(step['value'], 1), str(step['effect']));
          /* Absent means "follow the board", which is not the same as a colour. */
          return {
            ...base,
            fill: step['fill'] === undefined ? null : fill(step['fill'], solid('#3d4450')),
            stroke:
              step['stroke'] === undefined
                ? null
                : fill(step['stroke'], solid(defaults.spaceStroke)),
            bannerFill:
              step['bannerFill'] === undefined
                ? null
                : fill(step['bannerFill'], solid(defaults.accent)),
            /* Absent is "the printed white", which is not the same as white. */
            numberColor: typeof step['numberColor'] === 'string' ? step['numberColor'] : null
          };
        })
      : defaults.steps,
    finalLabel: str(raw['finalLabel'], defaults.finalLabel),
    finalEffect: str(raw['finalEffect']),
    subtitle: str(raw['subtitle']),
    /*
     * Absent means a set written before the board had slots, and an empty row
     * of them is what that board looked like — so it gets the stock three
     * rather than none, which would read as a deliberate choice.
     */
    slots: slots ? slots.map(threatSlot) : defaults.slots,
    winLabel: str(raw['winLabel']),
    notes: (Array.isArray(raw['notes']) ? raw['notes'] : []).map(threatNote),
    /* Absent means the drawn placeholder, which is every board before v11. */
    logo: artwork(raw['logo']),
    background: artwork(raw['background']),
    replacement: artwork(raw['replacement']),
    useReplacement: bool(raw['useReplacement'], false),
    rules: str(raw['rules']),
    accent: str(raw['accent'], defaults.accent),
    /*
     * A board written before spaces had outlines gets the stock one rather
     * than none: the outline is part of how a space is drawn now, and an
     * unstroked board would look like a rendering fault, not an old file.
     */
    spaceStroke: str(raw['spaceStroke'], defaults.spaceStroke)
  };
}

function threatSlot(value: unknown): ThreatSlot {
  const raw = asRecord(value);
  return typeof raw['id'] === 'string'
    ? { id: raw['id'] as never, label: str(raw['label']), note: str(raw['note']) }
    : createThreatSlot(str(raw['label']), str(raw['note']));
}

function threatNote(value: unknown): ThreatNote {
  const raw = asRecord(value);
  const base = createThreatNote(str(raw['text']));
  const at = clampNotePosition(num(raw['x'], base.x), num(raw['y'], base.y));
  return {
    id: typeof raw['id'] === 'string' ? (raw['id'] as never) : base.id,
    text: base.text,
    x: at.x,
    y: at.y,
    size: Math.min(6, Math.max(0.6, num(raw['size'], base.size))),
    /* Absent means level, which is what every note was before v11. */
    rotation: num(raw['rotation'], 0),
    /* Notes written before they had a colour keep the ink they were shown in. */
    color: str(raw['color'], base.color)
  };
}

function figure(value: unknown): Figure {
  const raw = asRecord(value);
  const base = createFigure();

  return {
    ...base,
    ...(typeof raw['id'] === 'string' ? { id: raw['id'] as never } : {}),
    name: str(raw['name']),
    kind: (FIGURE_KINDS as readonly string[]).includes(String(raw['kind']))
      ? (raw['kind'] as Figure['kind'])
      : 'figure',
    characterId: typeof raw['characterId'] === 'string' ? (raw['characterId'] as never) : null,
    quantity: num(raw['quantity'], 1),
    reference: artwork(raw['reference']),
    model: modelFile(raw['model']),
    ttsSave: modelFile(raw['ttsSave']),
    token: tokenBuild(raw['token']),
    dialRange: dialRange(raw['dialRange']),
    notes: str(raw['notes']),
    /*
     * Carried over, not taken from `base`.
     *
     * `createFigure()` stamps both with `now()`, and every field above is set
     * explicitly — so without these two lines each load handed every figure a
     * fresh pair of timestamps and destroyed the real ones. That made
     * `normalizeSet` non-idempotent, which is what a fingerprint cannot
     * survive: a fork reported all of its components as edited the instant it
     * was made, because hashing the document twice gave two answers.
     */
    createdAt: str(raw['createdAt'], base.createdAt) as Figure['createdAt'],
    updatedAt: str(raw['updatedAt'], base.updatedAt) as Figure['updatedAt']
  };
}

function customSymbol(value: unknown): CustomSymbol {
  const raw = asRecord(value);
  const base = createCustomSymbol();

  return {
    ...base,
    ...(typeof raw['id'] === 'string' ? { id: raw['id'] as never } : {}),
    name: str(raw['name']),
    source: typeof raw['source'] === 'string' ? raw['source'] : null,
    // Carried over, not taken from `base` — see `figure()`, which fixed the
    // same non-idempotency bug for the same reason.
    createdAt: str(raw['createdAt'], base.createdAt) as CustomSymbol['createdAt'],
    updatedAt: str(raw['updatedAt'], base.updatedAt) as CustomSymbol['updatedAt']
  };
}

function dialRange(value: unknown): DialRange {
  const raw = asRecord(value);
  const base = createDialRange();
  const min = Math.round(num(raw['min'], base.min));
  /* Max stays at least min + 1, so the dial always has somewhere to count. */
  const max = Math.max(min + 1, Math.round(num(raw['max'], base.max)));
  return { min, max };
}

/** An attached file: only a stored source makes it real. */
function modelFile(value: unknown): ModelFile | null {
  const raw = asRecord(value);
  return typeof raw['source'] === 'string'
    ? { name: str(raw['name']), source: raw['source'], size: num(raw['size'], 0) }
    : null;
}

/**
 * Validated point by point rather than trusted: `outline` drives geometry
 * directly, and a NaN in it produces a mesh with no bounds for the camera to
 * frame. Anything malformed becomes `null` — which leaves `shape` exactly as
 * the author chose it and lets the retrace effect fill it back in from the
 * picture, rather than rewriting `shape` back to `'circle'` and silently
 * throwing the choice away. Until it is refilled, `faceGeometry` draws the
 * circle it always drew, which is the same graceful loss `hex` got in v7.
 */
function tokenOutline(value: unknown): TokenOutline | null {
  const raw = asRecord(value);
  const points = raw['points'];
  if (!Array.isArray(points) || points.length < 6 || points.length % 2 !== 0) return null;
  if (points.length > 1024 || !points.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null;
  }
  if (typeof raw['key'] !== 'string') return null;
  return { points: points as number[], key: raw['key'] };
}

function tokenBuild(value: unknown): TokenBuild {
  const raw = asRecord(value);
  const base = createTokenBuild();

  /* v7 folded `hex` into a six-sided `polygon`. A document written before that
     still says `hex`, and dropping it to the default would silently round the
     token off. */
  const stored = String(raw['shape']);
  const shape: TokenBuild['shape'] = stored === 'hex'
    ? 'polygon'
    : (TOKEN_SHAPES as readonly string[]).includes(stored)
      ? (stored as TokenBuild['shape'])
      : base.shape;
  const sides = stored === 'hex' ? 6 : num(raw['sides'], base.sides);

  /* Clamped rather than trusted: these drive geometry, and a zero or a
     negative would generate a mesh with no volume to look at. */
  const diameterMm = Math.min(200, Math.max(5, num(raw['diameterMm'], base.diameterMm)));

  return {
    enabled: bool(raw['enabled'], false),
    shape,
    sides: Math.min(MAX_POLYGON_SIDES, Math.max(MIN_POLYGON_SIDES, Math.round(sides))),
    diameterMm,
    /* v29. Defaulted to the document's own `diameterMm`, not the factory's —
       a token saved before this field existed was regular, and a document
       that has always agreed with itself must go on agreeing with itself
       rather than being pulled toward whatever `createTokenBuild()` happens
       to default to. */
    lengthMm: Math.min(200, Math.max(5, num(raw['lengthMm'], diameterMm))),
    thicknessMm: Math.min(30, Math.max(0.5, num(raw['thicknessMm'], base.thicknessMm))),
    rimColor: str(raw['rimColor'], base.rimColor),
    twoSided: bool(raw['twoSided'], base.twoSided),
    /* v36. See `tokenOutline`'s own comment for why a malformed outline
       drops to `null` rather than rewriting `shape`. */
    outline: tokenOutline(raw['outline']),
    outlineDetail: Math.min(
      MAX_OUTLINE_DETAIL,
      Math.max(MIN_OUTLINE_DETAIL, num(raw['outlineDetail'], base.outlineDetail))
    )
  };
}

/**
 * v6 renamed the `modifier` card type and deck kind to `event`. The word is the
 * only thing that changed — same template, same fields — so a document saved
 * under the old name is renamed on the way in rather than refused.
 */
function renameLegacyKind(value: unknown): unknown {
  return value === 'modifier' ? 'event' : value;
}

function normalizeCard(value: unknown): Card | null {
  const raw = asRecord(value);
  if (typeof raw['id'] !== 'string' || typeof raw['deckId'] !== 'string') return null;

  const common = {
    id: raw['id'],
    name: str(raw['name']),
    deckId: raw['deckId'],
    quantity: num(raw['quantity'], 1),
    artwork: artwork(raw['artwork']),
    replacement: artwork(raw['replacement']),
    useReplacement: bool(raw['useReplacement'], false),
    style: repairStyleOverride(asRecord(raw['style'])),
    notes: str(raw['notes']),
    createdAt: str(raw['createdAt'], new Date().toISOString()),
    updatedAt: str(raw['updatedAt'], new Date().toISOString())
  };

  switch (renameLegacyKind(raw['type'])) {
    case 'initiative':
      return {
        ...common,
        type: 'initiative',
        variant: raw['variant'] === 'effect' ? 'effect' : 'card',
        subject: raw['subject'] === 'minion' ? 'minion' : 'villain',
        characterId: typeof raw['characterId'] === 'string' ? raw['characterId'] : null,
        subjectText: str(raw['subjectText']),
        moveValue: num(raw['moveValue'], 3),
        rightNow: str(raw['rightNow']),
        endOfRound: str(raw['endOfRound']),
        showMove: bool(raw['showMove'], true),
        bands: initiativeBands(raw['bands'])
      } as InitiativeCard;

    case 'rules':
      return {
        ...common,
        type: 'rules',
        heading: str(raw['heading']),
        headingAlign: headingAlign(raw['headingAlign']),
        body: str(raw['body']),
        landscape: bool(raw['landscape'], false)
      } as RulesCard;

    case 'event':
      return {
        ...common,
        type: 'event',
        heading: str(raw['heading']),
        body: str(raw['body']),
        backHeading: headingPlacement(raw['backHeading']),
        backReplacement: artwork(raw['backReplacement']),
        useBackReplacement: bool(raw['useBackReplacement'], false)
      } as EventCard;

    default:
      return {
        ...common,
        type: 'action',
        title: str(raw['title']),
        attack: nullableNum(raw['attack'], 2),
        defense: nullableNum(raw['defense'], null),
        boost: nullableNum(raw['boost'], null),
        ability: abilityBlocks(raw['ability']),
        symbol: combatSymbol(raw['symbol']),
        symbolValue: nullableNum(raw['symbolValue'], 2),
        owner: cardOwner(raw['owner']),
        split: bool(raw['split'], false),
        defenseAbility: abilityBlocks(raw['defenseAbility']),
        /* Off on a document written before the ribbon foot existed, which is
           what keeps every existing card looking exactly as it did. */
        showRibbonSymbol: bool(raw['showRibbonSymbol'], false),
        ribbonSymbol: str(raw['ribbonSymbol'])
      } as ActionCard;
  }
}

/**
 * Where a set was copied from, or `null`.
 *
 * Stricter than most of what is repaired here, and deliberately: a half-read
 * origin is worse than none. It is the address a contribution gets sent to, so
 * a record missing its slug or its revision would point at nothing while
 * looking like provenance. Absent, malformed and "authored here" all collapse
 * to the same honest answer.
 *
 * The fingerprint is passed through only where it is a flat string map. It is
 * optional by design — a fork whose fingerprint did not survive is still a
 * fork, and still knows what it came from.
 */
function origin(value: unknown): SetOrigin | null {
  if (value === null || value === undefined) return null;
  const raw = asRecord(value);

  const slug = str(raw['slug']);
  const setId = str(raw['setId']);
  const revision = num(raw['revision'], 0);
  if (!slug || !setId || revision < 1) return null;

  const marks = asRecord(raw['fingerprint']);
  const fingerprint: Record<string, string> = {};
  for (const [key, mark] of Object.entries(marks)) {
    if (typeof mark === 'string' && mark.length > 0) fingerprint[key] = mark;
  }

  return {
    slug,
    setId,
    revision,
    authorName: str(raw['authorName']),
    copiedAt: str(raw['copiedAt'], new Date().toISOString()) as SetOrigin['copiedAt'],
    ...(Object.keys(fingerprint).length > 0 ? { fingerprint } : {})
  };
}

/**
 * Bring a loaded document up to the current shape. Cards that cannot be
 * identified at all are dropped rather than crashing the app; everything else
 * is repaired in place.
 */
export function normalizeSet(value: AdventureSet): AdventureSet {
  const raw = value as unknown as Loose;

  const characters = (Array.isArray(raw['characters']) ? raw['characters'] : []).map((entry) => {
    const character = asRecord(entry);
    const role = typeof character['role'] === 'string' ? character['role'] : 'minion';

    const sidekick = heroSidekick(character['sidekick']);
    const rawAdditionalCards = character['additionalCards'];
    const normalizedCharacterCard = characterCard(character['characterCard']);

    /*
     * A single tracked companion (not a swarm) folds into a first additional
     * card the first time this document loads under the new shape — see the
     * v16 note in `sets/types.ts`. Gated on *presence* of `additionalCards`
     * rather than on `sidekick`'s own value, and `sidekick` is reset to fully
     * disabled the moment the fold happens — that is what keeps this
     * idempotent, the same way `tokenBuild`'s `hex`→`polygon` migration
     * self-terminates: once folded, the trigger condition can never be true
     * again on a re-pass.
     */
    let additionalCards: HeroCharacterCard[];
    let normalizedSidekick: HeroSidekick;
    if (Array.isArray(rawAdditionalCards)) {
      additionalCards = rawAdditionalCards.map((entry) =>
        heroCharacterCard(entry, normalizedCharacterCard)
      );
      normalizedSidekick = sidekick;
    } else if (sidekick.enabled && !sidekick.multiple) {
      additionalCards = [
        {
          ...createHeroCharacterCard(),
          name: sidekick.name,
          attackType: sidekick.attackType,
          health: sidekick.health,
          characterCard: characterCard(normalizedCharacterCard)
        }
      ];
      normalizedSidekick = createHeroSidekick();
    } else {
      additionalCards = [];
      normalizedSidekick = sidekick;
    }

    return {
      ...character,
      artwork: artwork(character['artwork']),
      cardback: cardback(character['cardback'], role),
      sidekick: normalizedSidekick,
      quote: heroQuote(character['quote']),
      additionalCards,
      printedName: str(character['printedName']),
      characterCard: normalizedCharacterCard,
      style: repairStyleOverride(asRecord(character['style'])),
      abilities: Array.isArray(character['abilities']) ? character['abilities'] : []
    };
  });

  const decks = (Array.isArray(raw['decks']) ? raw['decks'] : []).map((entry) => {
    const deck = asRecord(entry);
    return { ...deck, kind: renameLegacyKind(deck['kind']) };
  });

  const cards = (Array.isArray(raw['cards']) ? raw['cards'] : [])
    .map(normalizeCard)
    .filter((card): card is Card => card !== null);

  return {
    ...value,
    /* Read back from the raw value, never defaulted blind — a set authored
       before `kind` existed opens as an adventure, which is what it was. */
    kind: SET_KINDS.includes(raw['kind'] as SetKind) ? (raw['kind'] as SetKind) : 'adventure',
    style: repairStyleOverride(asRecord(raw['style'])),
    characters,
    decks,
    cards,
    threat: threatTrack(raw['threat']),
    map: adventureMap(raw['map']),
    figures: (Array.isArray(raw['figures']) ? raw['figures'] : []).map(figure),
    customSymbols: (Array.isArray(raw['customSymbols']) ? raw['customSymbols'] : []).map(
      customSymbol
    ),
    boxArt: artwork(raw['boxArt']),
    initiativeBack: artwork(raw['initiativeBack']),
    useInitiativeBack: bool(raw['useInitiativeBack'], false),
    origin: origin(raw['origin'])
  } as AdventureSet;
}
