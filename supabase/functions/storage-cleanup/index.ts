import {
  cleanupCandidates,
  cleanupRequest,
  encodedObjectPath,
  publicReport,
  secretKeyValues,
} from '../_shared/storage-cleanup.mjs';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = requireEnvironment('SUPABASE_URL').replace(/\/$/, '');
  const credentials = cleanupCredentials();
  const suppliedCredentials = [
    request.headers.get('apikey'),
    bearerCredential(request.headers.get('authorization')),
  ].filter((value): value is string => Boolean(value));
  if (!await authorised(suppliedCredentials, credentials.acceptedKeys)) {
    return json({ error: 'Unauthorised' }, 401);
  }

  let rawBody: unknown = {};
  try {
    rawBody = await request.json();
  } catch {
    // An empty request intentionally uses the safest defaults.
  }
  const options = cleanupRequest(rawBody);
  if (
    (options.mode === 'owner-superseded' || options.mode === 'owner-gallery-previews')
    && !options.ownerId
  ) {
    return json({ error: 'A valid ownerId is required for owner cleanup' }, 400);
  }
  if (options.mode === 'owner-tts-unretained' && (!options.ownerId || !options.sourceKey)) {
    return json({ error: 'A valid ownerId and sourceKey are required for owner TTS cleanup' }, 400);
  }
  const canExecute = executionEnabled(options.mode);
  if (!options.dryRun && !canExecute) {
    return json({ error: 'Deletion is disabled; run with dryRun=true' }, 409);
  }

  try {
    const legacyCardPreviews = options.mode === 'legacy-card-previews';
    const ownerSuperseded = options.mode === 'owner-superseded';
    const ownerGalleryPreviews = options.mode === 'owner-gallery-previews';
    const ownerTtsUnretained = options.mode === 'owner-tts-unretained';
    const plan = await rpc<Record<string, unknown>>(
      supabaseUrl,
      credentials.requestKey,
      ownerTtsUnretained
        ? 'storage_cleanup_owner_tts_unretained_plan'
        : ownerGalleryPreviews
        ? 'storage_cleanup_owner_gallery_preview_plan'
        : ownerSuperseded
        ? 'storage_cleanup_owner_superseded_plan'
        : legacyCardPreviews
          ? 'storage_cleanup_legacy_card_preview_plan'
          : 'storage_cleanup_plan',
      ownerTtsUnretained
        ? {
            requested_owner_id: options.ownerId,
            requested_source_key: options.sourceKey,
            requested_limit: options.limit,
          }
        : ownerGalleryPreviews
        ? { requested_owner_id: options.ownerId, requested_limit: options.limit }
        : ownerSuperseded
        ? { requested_owner_id: options.ownerId, requested_limit: options.limit }
        : legacyCardPreviews
          ? { requested_limit: options.limit }
          : {
            requested_grace: `${options.graceDays} days`,
            requested_limit: options.limit,
          },
    );

    const result = {
      dryRun: options.dryRun,
      mode: options.mode,
      attempted: 0,
      deleted: 0,
      skipped: 0,
      failed: 0,
      recheckFailed: 0,
      deleteFailed: 0,
      forgetFailed: 0,
    };

    if (!options.dryRun) {
      const candidates = cleanupCandidates(plan);
      result.attempted = candidates.length;
      await runBounded(candidates, 4, async (candidate) => {
        let due: boolean;
        try {
          due = await rpc<boolean>(supabaseUrl, credentials.requestKey,
            ownerTtsUnretained
              ? 'storage_cleanup_owner_tts_asset_is_unretained'
              : ownerGalleryPreviews
              ? 'storage_cleanup_owner_gallery_preview_is_unreferenced'
              : ownerSuperseded
              ? 'storage_cleanup_owner_asset_is_unreferenced'
              : legacyCardPreviews
                ? 'storage_cleanup_legacy_card_preview_is_unreferenced'
                : 'storage_cleanup_candidate_is_due',
            ownerTtsUnretained
              ? {
                  requested_owner_id: options.ownerId,
                  requested_source_key: options.sourceKey,
                  requested_name: candidate.name,
                  expected_object_updated_at: candidate.objectUpdatedAt,
                }
              : ownerGalleryPreviews
              ? {
                  requested_owner_id: options.ownerId,
                  requested_name: candidate.name,
                  expected_object_updated_at: candidate.objectUpdatedAt,
                }
              : ownerSuperseded
              ? {
                  requested_owner_id: options.ownerId,
                  requested_bucket_id: candidate.bucketId,
                  requested_name: candidate.name,
                  expected_object_updated_at: candidate.objectUpdatedAt,
                }
              : legacyCardPreviews
                ? {
                  requested_name: candidate.name,
                  expected_object_updated_at: candidate.objectUpdatedAt,
                }
                : {
                  requested_bucket_id: candidate.bucketId,
                  requested_name: candidate.name,
                  expected_first_observed_at: candidate.firstObservedAt,
                  expected_object_updated_at: candidate.objectUpdatedAt,
                  requested_grace: `${options.graceDays} days`,
                });
        } catch {
          result.recheckFailed += 1;
          result.failed += 1;
          return;
        }
        if (!due) {
          result.skipped += 1;
          return;
        }

        try {
          await deleteStorageObject(
            supabaseUrl,
            credentials.requestKey,
            candidate.bucketId,
            candidate.name,
          );
          result.deleted += 1;
        } catch {
          result.deleteFailed += 1;
          result.failed += 1;
          return;
        }

        try {
          await rpc<void>(supabaseUrl, credentials.requestKey, 'storage_cleanup_forget', {
            requested_bucket_id: candidate.bucketId,
            requested_name: candidate.name,
          });
        } catch {
          // Deletion succeeded; the next general plan removes the stale marker.
          result.forgetFailed += 1;
          result.failed += 1;
        }
      });
    }

    return json(publicReport(plan, result));
  } catch {
    return json({ error: 'Storage cleanup could not be planned' }, 500);
  }
});

function executionEnabled(mode: string) {
  if (mode === 'legacy-card-previews') {
    return Deno.env.get('STORAGE_CLEANUP_LEGACY_PREVIEWS_EXECUTE') === 'enabled';
  }
  if (
    mode === 'owner-superseded'
    || mode === 'owner-gallery-previews'
    || mode === 'owner-tts-unretained'
  ) {
    return Deno.env.get('STORAGE_CLEANUP_OWNER_EXECUTE') === 'enabled';
  }
  return Deno.env.get('STORAGE_CLEANUP_EXECUTE') === 'enabled';
}

function cleanupCredentials() {
  const secretKeys = parseSecretKeys(Deno.env.get('SUPABASE_SECRET_KEYS'));
  const legacyServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '';
  const cronToken = Deno.env.get('STORAGE_CLEANUP_CRON_TOKEN')?.trim() ?? '';
  const acceptedKeys = [...secretKeys];
  if (legacyServiceRole) acceptedKeys.push(legacyServiceRole);
  /* The scheduler gets a purpose-specific credential that can invoke only
     this function. It must never need a project-wide secret key. */
  if (cronToken) acceptedKeys.push(cronToken);
  if (acceptedKeys.length === 0) throw new Error('No Supabase secret key is configured');

  return {
    acceptedKeys,
    /* Storage's object-delete route still accepts the legacy service-role JWT
       on both headers, while a new secret key must never be put in
       Authorization. Prefer the JWT for these server-to-server calls until
       every downstream route supports the new secret-key form consistently. */
    requestKey: legacyServiceRole || secretKeys[0]!,
  };
}

function parseSecretKeys(raw: string | undefined) {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return secretKeyValues(parsed);
  } catch {
    return [];
  }
}

async function authorised(supplied: string[], acceptedKeys: string[]) {
  for (const suppliedKey of supplied) {
    const suppliedDigest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(suppliedKey),
    );
    for (const key of acceptedKeys) {
      const keyDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
      if (constantTimeEqual(new Uint8Array(suppliedDigest), new Uint8Array(keyDigest))) return true;
    }
  }
  return false;
}

function bearerCredential(header: string | null) {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

async function rpc<T>(
  supabaseUrl: string,
  requestKey: string,
  functionName: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: serviceHeaders(requestKey),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`RPC failed with ${response.status}`);
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

async function deleteStorageObject(
  supabaseUrl: string,
  requestKey: string,
  bucketId: string,
  name: string,
) {
  const objectPath = encodedObjectPath(bucketId, name);
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${objectPath}`, {
    method: 'DELETE',
    headers: serviceHeaders(requestKey, false),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Storage deletion failed with ${response.status}`);
  }
}

function serviceHeaders(requestKey: string, json = true) {
  const headers: Record<string, string> = {
    apikey: requestKey,
  };
  if (json) headers['content-type'] = 'application/json';
  if (!requestKey.startsWith('sb_secret_')) headers.authorization = `Bearer ${requestKey}`;
  return headers;
}

async function runBounded<T>(values: T[], concurrency: number, work: (value: T) => Promise<void>) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const value = values[nextIndex];
      nextIndex += 1;
      if (value !== undefined) await work(value);
    }
  });
  await Promise.all(workers);
}

function requireEnvironment(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}
