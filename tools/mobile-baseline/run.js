import { parseSetFile } from '/src/lib/export/json.ts';
import { exportCardPngs } from '/src/lib/export/card-pngs.ts';
import { photographMapBoard, photographThreatBoard } from '/src/lib/export/card-stage.ts';
import { writeToExportsFolder } from '/src/lib/export/exports-folder.ts';
import { exportTabletopSimulator } from '/src/lib/export/tts-bundle.ts';
import {
  BASELINE_FIXTURE_VERSION,
  buildBaselineSet,
  serializeBaselineSet
} from './fixture.js';

const status = document.querySelector('#status');
const encoder = new TextEncoder();
const lines = [];

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
  const sourceSet = buildBaselineSet();
  const fixtureText = serializeBaselineSet(sourceSet);
  const parsed = parseSetFile(fixtureText);
  if (!parsed.ok) throw new Error(`The baseline fixture failed its own importer: ${parsed.error}`);
  const set = parsed.set;

  log(`Fixture v${BASELINE_FIXTURE_VERSION} validated at schema v${set.schemaVersion}.`);
  await writeText('mobile-ui-baseline/fixture.awset.json', fixtureText);
  log('Wrote fixture.awset.json.');

  for (const bleed of [false, true]) {
    const label = bleed ? 'bleed' : 'trim';
    const result = await exportCardPngs(set, {
      bleed,
      onProgress(done, total) {
        status.textContent = `${lines.join('\n')}\nRendering ${label} card ${done}/${total}…`;
      }
    });
    await writeBlob(`mobile-ui-baseline/cards-${label}.zip`, result.blob);
    log(`Wrote cards-${label}.zip.`);
  }

  const map = set.maps.find((candidate) => candidate.enabled);
  if (!map) throw new Error('The baseline fixture has no enabled map.');
  const mapBlob = await photographMapBoard(map, {
    customSymbols: set.customSymbols,
    setName: set.name,
    authorName: set.meta.author
  });
  if (!mapBlob) throw new Error('The map renderer returned no image.');
  await writeBlob('mobile-ui-baseline/map.png', mapBlob);
  log('Wrote map.png.');

  const threatBlob = await photographThreatBoard(set);
  if (!threatBlob) throw new Error('The threat renderer returned no image.');
  await writeBlob('mobile-ui-baseline/threat.png', threatBlob);
  log('Wrote threat.png.');

  const tts = await exportTabletopSimulator(set, {
    hosting: { kind: 'local', savedObjectsPath: 'C:\\Baseline\\Saved Objects' },
    onProgress(done, total, label) {
      status.textContent = `${lines.join('\n')}\nTTS ${done}/${total}: ${label}`;
    }
  });
  if (tts.hosting !== 'local' || tts.directory === null) {
    throw new Error('The dev export endpoint was not available for the TTS bundle.');
  }
  log(`Wrote ${tts.fileCount} TTS bundle files (${tts.removedCount} stale files pruned).`);

  const runSummary = {
    format: 'mobile-ui-baseline-run',
    version: BASELINE_FIXTURE_VERSION,
    schemaVersion: set.schemaVersion,
    setId: set.id,
    outputs: {
      cardArchives: ['cards-trim.zip', 'cards-bleed.zip'],
      boards: ['map.png', 'threat.png'],
      tabletopSimulatorFolder: 'mobile-ui-baseline-tts'
    },
    tts: {
      fileCount: tts.fileCount,
      warningCount: tts.warnings.length
    }
  };
  await writeText('mobile-ui-baseline/run.json', JSON.stringify(runSummary, null, 2));
  log('Wrote run.json.');
  log('DONE — generate the evidence manifest from a terminal.');
  document.title = 'DONE — Mobile UI baseline exporter';
}

run().catch((error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  log(`FAILED\n${message}`);
  document.title = 'FAILED — Mobile UI baseline exporter';
  console.error(error);
});
