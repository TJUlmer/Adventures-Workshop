import { rememberLastOpen, saveSet } from '/src/lib/storage/library.ts';
import { buildBaselineSet, serializeBaselineSet } from './fixture.js';

const button = document.querySelector('#load-fixture');
const status = document.querySelector('#status');

button.addEventListener('click', () => {
  button.disabled = true;
  status.textContent = 'Writing the fixture to this isolated origin…';
  void (async () => {
    const set = buildBaselineSet();
    const saved = await saveSet(set, serializeBaselineSet(set));
    if (!saved) throw new Error('IndexedDB refused the fixture write.');
    await rememberLastOpen(set.id);
    // Screenshot evidence must not inherit view preferences from an earlier run
    // on this otherwise-isolated origin.
    window.localStorage.setItem('workshop-theme', 'light');
    window.localStorage.setItem('unmatched-labs.preview-width', '424');
    status.textContent = `Loaded ${set.name}. Opening Cards…`;
    window.location.assign('/?mobile-baseline=1&mobile-baseline-view=cards');
  })().catch((error) => {
    status.textContent = error instanceof Error ? error.message : 'Fixture load failed.';
    button.disabled = false;
  });
});
