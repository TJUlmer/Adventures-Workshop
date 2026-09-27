import '../../src/styles/index.css';
import { parseSetFile } from '/src/lib/export/json.ts';
import { exportCardPngs } from '/src/lib/export/card-pngs.ts';
import { writeToExportsFolder } from '/src/lib/export/exports-folder.ts';
import {
  BASELINE_FIXTURE_VERSION,
  buildBaselineSet,
  serializeBaselineSet
} from '../mobile-baseline/fixture.js';

const PROFILE = 'direct-preview-phase0';
const status = document.querySelector('#status');
const runAgain = document.querySelector('#run-again');
const encoder = new TextEncoder();
const lines = [];

function requireCard(set, id) {
  const card = set.cards.find((candidate) => candidate.id === id);
  if (!card || card.type !== 'action') throw new Error(`Missing action-card fixture ${id}.`);
  return card;
}

function cloneCard(card, id, title) {
  const clone = structuredClone(card);
  clone.id = id;
  clone.title = title;
  clone.name = '';
  clone.quantity = 1;
  return clone;
}

function buildDirectPreviewSet() {
  const set = buildBaselineSet();
  set.id = 'set_direct_preview_phase0';
  set.name = 'Direct Preview Editing Phase 0';
  set.subtitle = 'Target identity and export-safety fixture';
  set.meta.description =
    'Deterministic action-card edge cases for direct preview editing evidence.';

  const hero = requireCard(set, 'card_baseline_hero_attack');
  const minion = requireCard(set, 'card_baseline_minion_action');
  const villain = requireCard(set, 'card_baseline_villain_action');

  const bonusTwo = cloneCard(hero, 'card_direct_preview_bonus_two', 'Second Wind');
  const emptyBonus = structuredClone(bonusTwo.ability.bonusAbilities[0]);
  if (!emptyBonus) throw new Error('The hero fixture has no Bonus ability template.');
  bonusTwo.ability.bonusAbilities = [
    emptyBonus,
    {
      ...structuredClone(emptyBonus),
      text: '<strong>Second</strong> Bonus only. Move {{name}} 1 space.',
      showDivider: true
    }
  ];

  const customBoost = cloneCard(
    minion,
    'card_direct_preview_custom_boost',
    'Signal the Guard'
  );
  customBoost.boostSymbol = '{{custom:symbol_baseline_spark}}';

  const replacement = cloneCard(
    villain,
    'card_direct_preview_replacement',
    'Baked into the Image'
  );
  replacement.replacement = structuredClone(replacement.artwork);
  replacement.useReplacement = true;

  set.cards.push(bonusTwo, customBoost, replacement);
  return set;
}

function log(message) {
  lines.push(message);
  status.textContent = lines.join('\n');
}

async function bytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

async function writeText(path, text) {
  await writeToExportsFolder(path, encoder.encode(text));
}

async function writeBlob(path, blob) {
  await writeToExportsFolder(path, await bytes(blob));
}

async function run() {
  const sourceSet = buildDirectPreviewSet();
  const fixtureText = serializeBaselineSet(sourceSet);
  const parsed = parseSetFile(fixtureText);
  if (!parsed.ok) throw new Error(`The fixture failed its own importer: ${parsed.error}`);
  const set = parsed.set;

  log(`Fixture v${BASELINE_FIXTURE_VERSION} validated at schema v${set.schemaVersion}.`);
  await writeText(`${PROFILE}/fixture.awset.json`, fixtureText);
  log('Wrote fixture.awset.json.');

  for (const bleed of [false, true]) {
    const label = bleed ? 'bleed' : 'trim';
    const result = await exportCardPngs(set, {
      bleed,
      onProgress(done, total) {
        status.textContent = `${lines.join('\n')}\nRendering ${label} card ${done}/${total}…`;
      }
    });
    await writeBlob(`${PROFILE}/cards-${label}.zip`, result.blob);
    log(`Wrote cards-${label}.zip.`);
  }

  const cases = {
    ordinaryHero: 'card_baseline_hero_attack',
    splitHero: 'card_baseline_hero_split',
    villain: 'card_baseline_villain_action',
    minion: 'card_baseline_minion_action',
    formattedAbilityAndOnlyBonusTwo: 'card_direct_preview_bonus_two',
    customBoostSymbol: 'card_direct_preview_custom_boost',
    wholeFaceReplacement: 'card_direct_preview_replacement'
  };
  await writeText(
    `${PROFILE}/run.json`,
    `${JSON.stringify(
      {
        format: 'direct-preview-editing-baseline-run',
        version: 1,
        schemaVersion: set.schemaVersion,
        setId: set.id,
        cases,
        outputs: ['fixture.awset.json', 'cards-trim.zip', 'cards-bleed.zip']
      },
      null,
      2
    )}\n`
  );
  log('Wrote run.json.');
  log('DONE — generate the evidence manifest from a terminal.');
  document.title = 'DONE — Direct preview editing baseline exporter';
}

async function execute() {
  runAgain.disabled = true;
  lines.length = 0;
  status.textContent = 'Starting…';
  document.title = 'Direct preview editing baseline exporter';
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
    log(`FAILED\n${message}`);
    document.title = 'FAILED — Direct preview editing baseline exporter';
    console.error(error);
  } finally {
    runAgain.disabled = false;
  }
}

runAgain.addEventListener('click', () => void execute());
void execute();
