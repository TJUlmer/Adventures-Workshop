import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  cleanupCandidates,
  cleanupRequest,
  encodedObjectPath,
  publicReport,
} from '../supabase/functions/_shared/storage-cleanup.mjs';

assert.deepEqual(cleanupRequest({}), { dryRun: true, graceDays: 30, limit: 250 });
assert.deepEqual(
  cleanupRequest({ dryRun: false, graceDays: 1, limit: 900 }),
  { dryRun: false, graceDays: 30, limit: 500 },
);

assert.equal(
  encodedObjectPath('draft-assets', 'owner/set/a picture.png'),
  'draft-assets/owner/set/a%20picture.png',
);
assert.throws(() => encodedObjectPath('tts-assets', 'set/card.png'));
assert.throws(() => encodedObjectPath('set-assets', '../secret'));

const plan = {
  generatedAt: '2026-09-02T12:00:00Z',
  graceSeconds: 2_592_000,
  limit: 250,
  staleMarkersRemoved: 2,
  buckets: [{ bucketId: 'set-assets', dueCount: 1, dueBytes: 120 }],
  candidates: [
    {
      bucket_id: 'set-assets',
      name: 'set/hash.png',
      first_observed_at: '2026-08-01T12:00:00Z',
      object_updated_at: '2026-07-01T12:00:00Z',
    },
    {
      bucket_id: 'tts-assets',
      name: 'external/save.png',
      first_observed_at: '2026-08-01T12:00:00Z',
      object_updated_at: '2026-07-01T12:00:00Z',
    },
  ],
};

assert.deepEqual(cleanupCandidates(plan), [{
  bucketId: 'set-assets',
  name: 'set/hash.png',
  firstObservedAt: '2026-08-01T12:00:00Z',
  objectUpdatedAt: '2026-07-01T12:00:00Z',
}]);

assert.deepEqual(publicReport(plan, {
  dryRun: true,
  attempted: 0,
  deleted: 0,
  skipped: 0,
  failed: 0,
}), {
  dryRun: true,
  generatedAt: '2026-09-02T12:00:00Z',
  graceSeconds: 2_592_000,
  limit: 250,
  staleMarkersRemoved: 2,
  buckets: [{ bucketId: 'set-assets', dueCount: 1, dueBytes: 120 }],
  attempted: 0,
  deleted: 0,
  skipped: 0,
  failed: 0,
});

const edgeFunctionUrl = new URL('../supabase/functions/storage-cleanup/index.ts', import.meta.url);
const edgeFunction = readFileSync(edgeFunctionUrl, 'utf8');
const syntax = ts.transpileModule(edgeFunction, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  fileName: edgeFunctionUrl.pathname,
  reportDiagnostics: true,
});
const syntaxErrors = (syntax.diagnostics ?? []).filter(
  (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
);
assert.deepEqual(syntaxErrors, []);

console.log('Storage cleanup helpers and Edge Function: 12 assertions passed');
