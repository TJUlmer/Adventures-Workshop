import {
  cleanupCandidates,
  cleanupRequest,
  encodedObjectPath,
  publicReport,
} from '../_shared/storage-cleanup.mjs';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = requireEnvironment('SUPABASE_URL').replace(/\/$/, '');
  const credentials = cleanupCredentials();
  if (!await authorised(request.headers.get('apikey'), credentials.acceptedKeys)) {
    return json({ error: 'Unauthorised' }, 401);
  }

  let rawBody: unknown = {};
  try {
    rawBody = await request.json();
  } catch {
    // An empty request intentionally uses the safest defaults.
  }
  const options = cleanupRequest(rawBody);
  const canExecute = Deno.env.get('STORAGE_CLEANUP_EXECUTE') === 'enabled';
  if (!options.dryRun && !canExecute) {
    return json({ error: 'Deletion is disabled; run with dryRun=true' }, 409);
  }

  try {
    const plan = await rpc<Record<string, unknown>>(
      supabaseUrl,
      credentials.requestKey,
      'storage_cleanup_plan',
      {
        requested_grace: `${options.graceDays} days`,
        requested_limit: options.limit,
      },
    );

    const result = {
      dryRun: options.dryRun,
      attempted: 0,
      deleted: 0,
      skipped: 0,
      failed: 0,
    };

    if (!options.dryRun) {
      const candidates = cleanupCandidates(plan);
      result.attempted = candidates.length;
      await runBounded(candidates, 4, async (candidate) => {
        try {
          const due = await rpc<boolean>(
            supabaseUrl,
            credentials.requestKey,
            'storage_cleanup_candidate_is_due',
            {
              requested_bucket_id: candidate.bucketId,
              requested_name: candidate.name,
              expected_first_observed_at: candidate.firstObservedAt,
              expected_object_updated_at: candidate.objectUpdatedAt,
              requested_grace: `${options.graceDays} days`,
            },
          );
          if (!due) {
            result.skipped += 1;
            return;
          }

          await deleteStorageObject(
            supabaseUrl,
            credentials.requestKey,
            candidate.bucketId,
            candidate.name,
          );
          await rpc<void>(supabaseUrl, credentials.requestKey, 'storage_cleanup_forget', {
            requested_bucket_id: candidate.bucketId,
            requested_name: candidate.name,
          });
          result.deleted += 1;
        } catch {
          // Object paths and document contents must not appear in logs or responses.
          result.failed += 1;
        }
      });
    }

    return json(publicReport(plan, result));
  } catch {
    return json({ error: 'Storage cleanup could not be planned' }, 500);
  }
});

function cleanupCredentials() {
  const secretKeys = parseSecretKeys(Deno.env.get('SUPABASE_SECRET_KEYS'));
  const legacyServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '';
  const acceptedKeys = [...secretKeys];
  if (legacyServiceRole) acceptedKeys.push(legacyServiceRole);
  if (acceptedKeys.length === 0) throw new Error('No Supabase secret key is configured');

  return {
    acceptedKeys,
    requestKey: secretKeys[0] ?? legacyServiceRole,
  };
}

function parseSecretKeys(raw: string | undefined) {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
  } catch {
    return [];
  }
}

async function authorised(supplied: string | null, acceptedKeys: string[]) {
  if (!supplied) return false;
  const suppliedDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(supplied));
  for (const key of acceptedKeys) {
    const keyDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    if (constantTimeEqual(new Uint8Array(suppliedDigest), new Uint8Array(keyDigest))) return true;
  }
  return false;
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
    headers: serviceHeaders(requestKey),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Storage deletion failed with ${response.status}`);
  }
}

function serviceHeaders(requestKey: string) {
  const headers: Record<string, string> = {
    apikey: requestKey,
    'content-type': 'application/json',
  };
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
