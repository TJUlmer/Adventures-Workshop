const BUCKETS = new Set(['draft-assets', 'set-assets', 'tts-assets']);

export function cleanupRequest(value) {
  const body = value && typeof value === 'object' ? value : {};
  const graceDays = boundedInteger(body.graceDays, 30, 30, 90);
  const limit = boundedInteger(body.limit, 250, 1, 500);
  const mode = body.mode === 'legacy-card-previews'
    || body.mode === 'owner-superseded'
    || body.mode === 'owner-tts-unretained'
    ? body.mode
    : 'standard';
  const ownerId = typeof body.ownerId === 'string' && UUID.test(body.ownerId)
    ? body.ownerId.toLowerCase()
    : null;
  const sourceKey = typeof body.sourceKey === 'string' && SOURCE_KEY.test(body.sourceKey)
    ? body.sourceKey
    : null;

  return {
    dryRun: body.dryRun !== false,
    graceDays,
    limit,
    mode,
    ...(mode === 'owner-superseded' ? { ownerId } : {}),
    ...(mode === 'owner-tts-unretained' ? { ownerId, sourceKey } : {}),
  };
}

export function cleanupCandidates(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.candidates)) return [];

  return plan.candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const bucketId = candidate.bucket_id;
    const name = candidate.name;
    const firstObservedAt = candidate.first_observed_at;
    const objectUpdatedAt = candidate.object_updated_at;
    if (!BUCKETS.has(bucketId)
      || typeof name !== 'string'
      || !name
      || typeof firstObservedAt !== 'string'
      || typeof objectUpdatedAt !== 'string') return [];

    return [{ bucketId, name, firstObservedAt, objectUpdatedAt }];
  });
}

export function encodedObjectPath(bucketId, name) {
  if (!BUCKETS.has(bucketId)) throw new Error('Unsupported cleanup bucket');
  const parts = name.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid Storage object path');
  }
  return [bucketId, ...parts].map(encodeURIComponent).join('/');
}

export function publicReport(plan, result) {
  const source = plan && typeof plan === 'object' ? plan : {};
  return {
    dryRun: result.dryRun,
    mode: result.mode,
    generatedAt: source.generatedAt ?? null,
    graceSeconds: source.graceSeconds ?? null,
    limit: source.limit ?? null,
    staleMarkersRemoved: source.staleMarkersRemoved ?? 0,
    buckets: Array.isArray(source.buckets) ? source.buckets : [],
    attempted: result.attempted,
    deleted: result.deleted,
    skipped: result.skipped,
    failed: result.failed,
    recheckFailed: result.recheckFailed,
    deleteFailed: result.deleteFailed,
    forgetFailed: result.forgetFailed,
  };
}

export function secretKeyValues(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === 'string' && entry.length > 0);
  }
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).filter(
    (entry) => typeof entry === 'string' && entry.length > 0,
  );
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_KEY = /^[A-Za-z0-9_-]+$/;
