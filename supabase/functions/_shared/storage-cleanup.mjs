const BUCKETS = new Set(['draft-assets', 'set-assets']);

export function cleanupRequest(value) {
  const body = value && typeof value === 'object' ? value : {};
  const graceDays = boundedInteger(body.graceDays, 30, 30, 90);
  const limit = boundedInteger(body.limit, 250, 1, 500);

  return {
    dryRun: body.dryRun !== false,
    graceDays,
    limit,
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
    generatedAt: source.generatedAt ?? null,
    graceSeconds: source.graceSeconds ?? null,
    limit: source.limit ?? null,
    staleMarkersRemoved: source.staleMarkersRemoved ?? 0,
    buckets: Array.isArray(source.buckets) ? source.buckets : [],
    attempted: result.attempted,
    deleted: result.deleted,
    skipped: result.skipped,
    failed: result.failed,
  };
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}
