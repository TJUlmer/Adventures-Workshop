import type { DraftDiagnosticInput } from '../src/lib/persistence/diagnostics.svelte';

const status = document.querySelector<HTMLParagraphElement>('#status');
const checks = document.querySelector<HTMLUListElement>('#checks');
if (!status || !checks) throw new Error('Verification page is incomplete.');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function addCheck(message: string): void {
  const item = document.createElement('li');
  item.textContent = message;
  checks.append(item);
}

try {
  // Importing after this replacement exercises the same unavailable-database branch a
  // refused browser database or failed open reaches, without touching the user's real store.
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: undefined
  });
  assert(typeof indexedDB === 'undefined', 'This browser would not isolate IndexedDB for the probe.');

  const [coordinatorModule, factoryModule, idModule, jsonModule] = await Promise.all([
    import('../src/lib/persistence/coordinator.svelte'),
    import('../src/lib/sets/factory'),
    import('../src/lib/core/id'),
    import('../src/lib/export/json')
  ]);
  const set = {
    ...factoryModule.createEmptySet({ name: 'Phase 6 unavailable IndexedDB', kind: 'heroes' }),
    id: idModule.asId<import('../src/lib/sets/types').SetId>(
      `set_phase6_no_indexeddb_${crypto.randomUUID()}`
    )
  };
  const diagnostics: DraftDiagnosticInput[] = [];
  let cloudCalls = 0;
  const coordinator = new coordinatorModule.PersistenceCoordinator({
    hasPermanentSession: () => true,
    isOnline: () => true,
    recordDiagnostic: (event) => diagnostics.push(event),
    saveDraft: async () => {
      cloudCalls += 1;
      throw new Error('Cloud delivery must not start without the local safety copy.');
    }
  });

  const wrote = await coordinator.flush(set, jsonModule.serializeSet(set));
  assert(!wrote, 'The coordinator claimed the unavailable local database was durable.');
  assert(cloudCalls === 0, 'A cloud save started after the local safety copy failed.');
  assert(
    diagnostics.some(
      (event) => event.stage === 'local-cache' && event.outcome === 'failed' && event.statusCode === null
    ),
    'The local failure was not recorded in diagnostics.'
  );

  addCheck('The failed IndexedDB write was reported as a failed local-cache stage.');
  addCheck('No cloud document or asset request was attempted after local durability failed.');
  addCheck('The normal workshop IndexedDB database was never opened or modified by this page.');
  status.textContent = 'PASS — IndexedDB failure stayed local and blocked cloud delivery.';
} catch (cause) {
  status.textContent = `FAIL — ${cause instanceof Error ? cause.message : 'Unknown error'}`;
  throw cause;
}
