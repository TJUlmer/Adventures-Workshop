import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  cleanupCandidates,
  cleanupRequest,
  encodedObjectPath,
  publicReport,
  secretKeyValues,
} from '../supabase/functions/_shared/storage-cleanup.mjs';

assert.deepEqual(cleanupRequest({}), {
  dryRun: true,
  graceDays: 30,
  limit: 250,
  mode: 'standard',
});
assert.deepEqual(
  cleanupRequest({ dryRun: false, graceDays: 1, limit: 900 }),
  { dryRun: false, graceDays: 30, limit: 500, mode: 'standard' },
);
assert.deepEqual(
  cleanupRequest({ mode: 'legacy-card-previews', limit: 10 }),
  { dryRun: true, graceDays: 30, limit: 10, mode: 'legacy-card-previews' },
);
assert.deepEqual(
  cleanupRequest({
    mode: 'owner-superseded',
    ownerId: '44C2EEC0-E640-42E8-A292-799F3EE0C948',
    dryRun: false,
  }),
  {
    dryRun: false,
    graceDays: 30,
    limit: 250,
    mode: 'owner-superseded',
    ownerId: '44c2eec0-e640-42e8-a292-799f3ee0c948',
  },
);
assert.deepEqual(
  cleanupRequest({ mode: 'owner-superseded', ownerId: 'tombadil_bombadil' }),
  {
    dryRun: true,
    graceDays: 30,
    limit: 250,
    mode: 'owner-superseded',
    ownerId: null,
  },
);
assert.deepEqual(
  cleanupRequest({
    mode: 'owner-gallery-previews',
    ownerId: '44C2EEC0-E640-42E8-A292-799F3EE0C948',
    dryRun: false,
  }),
  {
    dryRun: false,
    graceDays: 30,
    limit: 250,
    mode: 'owner-gallery-previews',
    ownerId: '44c2eec0-e640-42e8-a292-799f3ee0c948',
  },
);
assert.deepEqual(
  cleanupRequest({
    mode: 'owner-tts-unretained',
    ownerId: '44C2EEC0-E640-42E8-A292-799F3EE0C948',
    sourceKey: 'set_example-123',
  }),
  {
    dryRun: true,
    graceDays: 30,
    limit: 250,
    mode: 'owner-tts-unretained',
    ownerId: '44c2eec0-e640-42e8-a292-799f3ee0c948',
    sourceKey: 'set_example-123',
  },
);
assert.deepEqual(
  cleanupRequest({ mode: 'owner-tts-unretained', ownerId: 'bad', sourceKey: '../set' }),
  {
    dryRun: true,
    graceDays: 30,
    limit: 250,
    mode: 'owner-tts-unretained',
    ownerId: null,
    sourceKey: null,
  },
);
assert.deepEqual(secretKeyValues({ default: 'sb_secret_value' }), ['sb_secret_value']);
assert.deepEqual(secretKeyValues(['legacy-secret']), ['legacy-secret']);
assert.deepEqual(secretKeyValues({ default: '', wrong: 12 }), []);

assert.equal(
  encodedObjectPath('draft-assets', 'owner/set/a picture.png'),
  'draft-assets/owner/set/a%20picture.png',
);
assert.equal(
  encodedObjectPath('tts-assets', 'owner/set/card sheet.jpg'),
  'tts-assets/owner/set/card%20sheet.jpg',
);
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

assert.deepEqual(cleanupCandidates(plan), [
  {
    bucketId: 'set-assets',
    name: 'set/hash.png',
    firstObservedAt: '2026-08-01T12:00:00Z',
    objectUpdatedAt: '2026-07-01T12:00:00Z',
  },
  {
    bucketId: 'tts-assets',
    name: 'external/save.png',
    firstObservedAt: '2026-08-01T12:00:00Z',
    objectUpdatedAt: '2026-07-01T12:00:00Z',
  },
]);

assert.deepEqual(publicReport(plan, {
  dryRun: true,
  mode: 'standard',
  attempted: 0,
  deleted: 0,
  skipped: 0,
  failed: 0,
  recheckFailed: 0,
  deleteFailed: 0,
  forgetFailed: 0,
}), {
  dryRun: true,
  mode: 'standard',
  generatedAt: '2026-09-02T12:00:00Z',
  graceSeconds: 2_592_000,
  limit: 250,
  staleMarkersRemoved: 2,
  buckets: [{ bucketId: 'set-assets', dueCount: 1, dueBytes: 120 }],
  attempted: 0,
  deleted: 0,
  skipped: 0,
  failed: 0,
  recheckFailed: 0,
  deleteFailed: 0,
  forgetFailed: 0,
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

console.log('Storage cleanup helpers and Edge Function: 16 assertions passed');
