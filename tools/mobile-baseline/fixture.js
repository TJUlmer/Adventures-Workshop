import { createCard } from '/src/lib/cards/factory.ts';
import { solid } from '/src/lib/cards/style.ts';
import { createCharacter } from '/src/lib/characters/factory.ts';
import { createDeck } from '/src/lib/decks/factory.ts';
import { createFigure } from '/src/lib/figures/types.ts';
import {
  createAdventureMap,
  createMapEnvironmentPiece,
  createMapNote,
  createMapPath,
  createMapSecretPassage,
  createMapSpace
} from '/src/lib/map/types.ts';
import { createEmptySet } from '/src/lib/sets/factory.ts';
import { SET_SCHEMA_VERSION } from '/src/lib/sets/types.ts';
import { createCustomSymbol } from '/src/lib/symbols/types.ts';
import { createThreatNote, createThreatSlot, createThreatStep } from '/src/lib/threat/types.ts';

export const BASELINE_FIXTURE_VERSION = 1;
export const BASELINE_EXPORTED_AT = '2026-09-26T12:00:00.000Z';

const FIXED_TIME = BASELINE_EXPORTED_AT;

function svgData(label, start, end, accent = '#f6eada') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs><rect width="800" height="1000" fill="url(#g)"/><circle cx="610" cy="260" r="145" fill="${accent}" opacity=".28"/><path d="M0 790L260 520l150 140 180-240 210 230v350H0z" fill="${accent}" opacity=".22"/><text x="52" y="914" fill="${accent}" font-family="sans-serif" font-size="58" font-weight="700">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function setIdentity(value, id) {
  value.id = id;
  if ('createdAt' in value) value.createdAt = FIXED_TIME;
  if ('updatedAt' in value) value.updatedAt = FIXED_TIME;
  return value;
}

function setArtwork(artwork, source, label) {
  artwork.source = source;
  artwork.label = label;
  return artwork;
}

function makeCharacter(role, id, name, subtitle, art) {
  const character = setIdentity(createCharacter(role), id);
  character.name = name;
  character.subtitle = subtitle;
  character.notes = `Phase 0 ${role} fixture.`;
  setArtwork(character.artwork, art, `${id}.svg`);
  setArtwork(character.cardback.artwork, art, `${id}-back.svg`);
  return character;
}

function makeDeck(kind, id, name, ownerId = null) {
  return setIdentity(createDeck(kind, { name, ownerId }), id);
}

function makeCard(type, deckId, id, name, art) {
  const card = setIdentity(createCard(type, deckId, { name }), id);
  setArtwork(card.artwork, art, `${id}.svg`);
  return card;
}

/**
 * A representative document built without reading or writing the workshop store.
 * Random factory fields are replaced before the value leaves this function.
 */
export function buildBaselineSet() {
  const heroArt = svgData('HERO', '#152a47', '#0c6b78');
  const villainArt = svgData('VILLAIN', '#31172f', '#8a2438');
  const minionArt = svgData('MINION', '#302819', '#98752a');
  const boardArt = svgData('BOARD', '#173329', '#123f52', '#d6d0aa');
  const sparkArt = svgData('S', '#70284e', '#db725a', '#ffffff');

  const set = createEmptySet({
    name: 'Mobile UI Baseline',
    subtitle: 'Phase 0 interaction and rendered-output fixture',
    author: 'Unmatched Labs',
    description: 'Deterministic, offline fixture for mobile UI baselines.'
  });
  set.id = 'set_mobile_ui_baseline';
  set.schemaVersion = SET_SCHEMA_VERSION;
  set.meta.createdAt = FIXED_TIME;
  set.meta.updatedAt = FIXED_TIME;

  const symbol = setIdentity(createCustomSymbol('spark'), 'symbol_baseline_spark');
  symbol.source = sparkArt;
  set.customSymbols = [symbol];

  const hero = makeCharacter(
    'hero',
    'char_baseline_hero',
    'Mariner',
    'The Tidebound',
    heroArt
  );
  hero.attackType = 'ranged';
  hero.health = 15;
  hero.move = 3;
  hero.abilities = [
    {
      name: 'Read the Current',
      text: 'After you manoeuvre, you may move one opposing fighter 1 space.',
      kind: 'passive'
    }
  ];
  hero.sidekick = {
    enabled: true,
    name: 'Beacon',
    subtitle: 'First Mate',
    attackType: 'melee',
    multiple: false,
    health: 6,
    count: 1
  };
  setArtwork(hero.characterCard.hero.artwork, heroArt, 'hero-band.svg');
  setArtwork(hero.characterCard.sidekick.artwork, sparkArt, 'sidekick-band.svg');

  const villain = makeCharacter(
    'villain',
    'char_baseline_villain',
    'The Glass Regent',
    'Sovereign of the Shoals',
    villainArt
  );
  villain.health = 19;
  villain.move = 2;

  const minion = makeCharacter(
    'minion',
    'char_baseline_minion',
    'Lantern Guard',
    'Keepers of the Gate',
    minionArt
  );
  minion.figureCount = 3;
  minion.health = 5;

  set.characters = [hero, villain, minion];

  const heroDeck = makeDeck('action', 'deck_baseline_hero', 'Mariner action deck', hero.id);
  const villainDeck = makeDeck(
    'action',
    'deck_baseline_villain',
    'Glass Regent action deck',
    villain.id
  );
  const minionDeck = makeDeck(
    'action',
    'deck_baseline_minion',
    'Lantern Guard action deck',
    minion.id
  );
  const initiativeDeck = makeDeck('initiative', 'deck_baseline_initiative', 'Initiative');
  const rulesDeck = makeDeck('rules', 'deck_baseline_rules', 'Rules and reference');
  const eventDeck = makeDeck('event', 'deck_baseline_event', 'Tide events');
  set.decks = [heroDeck, villainDeck, minionDeck, initiativeDeck, rulesDeck, eventDeck];

  const heroCard = makeCard(
    'action',
    heroDeck.id,
    'card_baseline_hero_attack',
    '',
    heroArt
  );
  heroCard.title = 'Breakwater';
  heroCard.quantity = 2;
  heroCard.symbol = 'attack';
  heroCard.symbolValue = 4;
  heroCard.boost = 2;
  heroCard.ability.immediately =
    'Move the opposing fighter up to 2 spaces. {{custom:symbol_baseline_spark}}';
  heroCard.ability.afterCombat = 'If you won the combat, draw 1 card.';
  heroCard.showRibbonSymbol = true;
  heroCard.ribbonSymbol = '{{ranged}}';

  const heroSplit = makeCard(
    'action',
    heroDeck.id,
    'card_baseline_hero_split',
    '',
    boardArt
  );
  heroSplit.title = 'Turn the Tide';
  heroSplit.symbol = 'versatile';
  heroSplit.symbolValue = 3;
  heroSplit.boost = 1;
  heroSplit.split = true;
  heroSplit.attack = 3;
  heroSplit.defense = 2;
  heroSplit.ability.duringCombat = 'Add 1 to this card’s value for each adjacent fighter.';
  heroSplit.defenseAbility.afterCombat = 'You may place Mariner in any adjacent space.';
  heroSplit.showTuckEffect = true;
  heroSplit.tuckEffect = '+1 move while tucked';

  const villainCard = makeCard(
    'action',
    villainDeck.id,
    'card_baseline_villain_action',
    '',
    villainArt
  );
  villainCard.title = 'Fractured Command';
  villainCard.quantity = 3;
  villainCard.attack = 4;
  villainCard.defense = 1;
  villainCard.boost = 2;
  villainCard.symbol = null;
  villainCard.symbolValue = null;
  villainCard.ability.plain = 'Choose a Lantern Guard. Move it up to 3 spaces.';
  villainCard.showCornerBadge = true;
  villainCard.cornerBadge = 'I';

  const minionCard = makeCard(
    'action',
    minionDeck.id,
    'card_baseline_minion_action',
    '',
    minionArt
  );
  minionCard.title = 'Hold the Line';
  minionCard.quantity = 3;
  minionCard.attack = 2;
  minionCard.defense = 3;
  minionCard.boost = 1;
  minionCard.symbol = null;
  minionCard.symbolValue = null;
  minionCard.ability.afterCombat = 'If the Lantern Guard is adjacent to another Guard, recover 1 health.';

  const initiativeVillain = makeCard(
    'initiative',
    initiativeDeck.id,
    'card_baseline_initiative_villain',
    '',
    villainArt
  );
  initiativeVillain.characterId = villain.id;
  initiativeVillain.subject = 'villain';
  initiativeVillain.subjectText = 'The Glass Regent';
  initiativeVillain.rightNow = 'Move toward the nearest hero, then attack.';
  initiativeVillain.endOfRound = 'Advance the threat track by 1.';

  const initiativeMinion = makeCard(
    'initiative',
    initiativeDeck.id,
    'card_baseline_initiative_minion',
    '',
    minionArt
  );
  initiativeMinion.variant = 'effect';
  initiativeMinion.subject = 'minion';
  initiativeMinion.characterId = minion.id;
  initiativeMinion.subjectText = 'Relight the Beacon';
  initiativeMinion.rightNow = 'Place one defeated Lantern Guard adjacent to the Regent.';
  initiativeMinion.endOfRound = 'Each hero adjacent to a Guard takes 1 damage.';
  initiativeMinion.showMove = false;

  const rulesPortrait = makeCard(
    'rules',
    rulesDeck.id,
    'card_baseline_rules_portrait',
    'Setup',
    boardArt
  );
  rulesPortrait.heading = 'Setup';
  rulesPortrait.body =
    '<p><strong>Place the Regent</strong> on space A. Each hero starts on a numbered space.</p><p>Keep the tide marker nearby.</p>';

  const rulesLandscape = makeCard(
    'rules',
    rulesDeck.id,
    'card_baseline_rules_landscape',
    'Tide Reference',
    heroArt
  );
  rulesLandscape.heading = 'Tide Reference';
  rulesLandscape.headingAlign = 'center';
  rulesLandscape.landscape = true;
  rulesLandscape.body =
    '<p style="text-align:center"><strong>Low tide:</strong> blue paths are open.</p><p style="text-align:center"><strong>High tide:</strong> advance threat.</p>';

  const event = makeCard(
    'event',
    eventDeck.id,
    'card_baseline_event',
    'Sudden Squall',
    boardArt
  );
  event.heading = 'Sudden Squall';
  event.body = '<p>Move every fighter on a blue space to the nearest connected space.</p>';
  event.backHeading = { offsetX: 3, offsetY: -2, rotation: -5 };

  set.cards = [
    heroCard,
    heroSplit,
    villainCard,
    minionCard,
    initiativeVillain,
    initiativeMinion,
    rulesPortrait,
    rulesLandscape,
    event
  ];

  set.threat.enabled = true;
  set.threat.villainId = villain.id;
  set.threat.subtitle = 'The Shattered Causeway';
  set.threat.finalLabel = 'The sea wall breaks';
  set.threat.finalEffect = 'The heroes lose immediately.';
  set.threat.rules = 'Advance after resolving a Villain Effect card.';
  set.threat.steps = [1, 2, 3, 4, 4, 5, 5].map((value, index) => {
    const step = createThreatStep(value, index === 2 ? 'Spawn a Lantern Guard.' : '');
    step.id = `threat_step_${index + 1}`;
    return step;
  });
  set.threat.slots = [
    createThreatSlot('Tide', 'Starts low'),
    createThreatSlot('Gate', 'Closed'),
    createThreatSlot('Reserve', '3 Guards')
  ].map((slot, index) => {
    slot.id = `threat_slot_${index + 1}`;
    return slot;
  });
  const threatNote = createThreatNote('HIGH TIDE');
  threatNote.id = 'threat_note_high_tide';
  threatNote.x = 0.79;
  threatNote.y = 0.14;
  threatNote.rotation = -6;
  set.threat.notes = [threatNote];
  setArtwork(set.threat.background, villainArt, 'threat-background.svg');
  setArtwork(set.threat.logo, sparkArt, 'threat-logo.svg');

  const map = createAdventureMap(true, 'The Shattered Causeway');
  map.id = 'map_baseline_causeway';
  map.size = 'large';
  map.labelCorner = 'bottom-right';
  map.spaceOpacity = 0.88;
  map.palette = ['#3b8290', '#b78939', '#7b405f'];
  setArtwork(map.artwork, boardArt, 'baseline-map.svg');

  const mapSpaceSpecs = [
    ['space_baseline_a', 0.16, 0.17, '#3b8290', 'A', 1],
    ['space_baseline_b', 0.36, 0.31, '#b78939', 'B', null],
    ['space_baseline_c', 0.61, 0.18, '#7b405f', 'C', 2],
    ['space_baseline_d', 0.78, 0.43, '#3b8290', 'D', null],
    ['space_baseline_e', 0.48, 0.53, '#b78939', 'E', null]
  ];
  map.spaces = mapSpaceSpecs.map(([id, x, y, color, label, start]) => {
    const space = createMapSpace(x, y, solid(color));
    space.id = id;
    space.label = label;
    space.start = start;
    return space;
  });
  map.spaces[1].zones = [solid('#b78939'), solid('#3b8290')];
  map.spaces[1].rotation = 35;
  map.spaces[3].secretPassage = {
    ...createMapSecretPassage(),
    angle: 45,
    curve: 0.28,
    symbolId: symbol.id
  };

  const links = [
    [0, 1, 0.18, false, false],
    [1, 2, -0.16, true, true],
    [2, 3, 0, false, false],
    [1, 4, 0.1, false, true],
    [4, 3, -0.12, false, false]
  ];
  map.paths = links.map(([fromIndex, toIndex, curve, oneWay, modifier], index) => {
    const path = createMapPath(map.spaces[fromIndex].id, map.spaces[toIndex].id);
    path.id = `map_path_${index + 1}`;
    path.curve = curve;
    path.oneWay = oneWay;
    path.modifier = modifier;
    return path;
  });
  const mapNote = createMapNote('FLOODED AT HIGH TIDE');
  mapNote.id = 'map_note_flooded';
  mapNote.x = 0.25;
  mapNote.y = 0.55;
  mapNote.rotation = -4;
  map.notes = [mapNote];
  const environment = createMapEnvironmentPiece(sparkArt, 'Beacon flare', 1, 0.67, 0.43);
  environment.id = 'map_env_beacon';
  environment.width = 0.11;
  environment.opacity = 0.72;
  map.environment = [environment];
  set.maps = [map];

  const token = setIdentity(createFigure('token', 'Lantern Guard token'), 'figure_baseline_token');
  token.characterId = minion.id;
  token.quantity = 3;
  token.token.shape = 'polygon';
  token.token.sides = 6;
  token.token.diameterMm = 28;
  token.token.lengthMm = 32;
  setArtwork(token.reference, minionArt, 'lantern-guard-token.svg');
  set.figures = [token];

  setArtwork(set.initiativeBack, boardArt, 'initiative-back.svg');
  set.useInitiativeBack = true;
  set.box.enabled = false;

  return set;
}

export function baselineSetFile(set = buildBaselineSet()) {
  return {
    format: 'adventures-workshop-set',
    schemaVersion: SET_SCHEMA_VERSION,
    exportedAt: BASELINE_EXPORTED_AT,
    set
  };
}

export function serializeBaselineSet(set = buildBaselineSet()) {
  return `${JSON.stringify(baselineSetFile(set), null, 2)}\n`;
}
