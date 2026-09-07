/**
 * Attack the production draft backend as the public anon role.
 *
 * Reads the ordinary Vite public configuration, never prints it, and logs only
 * status codes. Any successful request is a failure: the table, RPC and private
 * bucket must all refuse a caller carrying only the publishable project key.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let envText = null;
for (const candidate of [resolve(root, '.env.local'), resolve(root, '..', 'Adventures_Workshop', '.env.local')]) {
  try {
    envText = await readFile(candidate, 'utf8');
    break;
  } catch (cause) {
    if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'ENOENT') throw cause;
  }
}
if (envText === null) throw new Error('No local Supabase public configuration was found.');
const entries = new Map(
  envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=');
      if (at < 1) return ['', ''];
      const key = line.slice(0, at).trim();
      let value = line.slice(at + 1).trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      return [key, value];
    })
);

const url = entries.get('VITE_SUPABASE_URL');
const key = entries.get('VITE_SUPABASE_PUBLISHABLE_KEY') ?? entries.get('VITE_SUPABASE_ANON_KEY');
if (!url || !key) throw new Error('Supabase public configuration is missing from .env.local.');

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`
};
const testId = `set_phase1_public_${crypto.randomUUID()}`;
const document = {
  format: 'adventures-workshop-set',
  schemaVersion: 47,
  exportedAt: '2026-09-01T00:00:00.000Z',
  set: { id: testId, schemaVersion: 47, name: 'Phase 1 public-boundary probe' }
};

const probes = [
  {
    name: 'draft table read',
    request: () =>
      fetch(`${url}/rest/v1/set_drafts?select=id&limit=1`, {
        headers
      })
  },
  {
    name: 'draft save RPC',
    request: () =>
      fetch(`${url}/rest/v1/rpc/save_set_draft`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_local_id: testId,
          p_name: 'Phase 1 public-boundary probe',
          p_subtitle: '',
          p_kind: 'adventure',
          p_card_count: 0,
          p_character_count: 0,
          p_characters: [],
          p_blockers: 0,
          p_gaps: 0,
          p_issue_count: 0,
          p_origin_author: null,
          p_origin_revision: null,
          p_origin_slug: null,
          p_document_updated_at: '2026-09-01T00:00:00.000Z',
          p_schema_version: 47,
          p_document: document,
          p_expected_revision: null
        })
      })
  },
  {
    name: 'private asset upload',
    request: () =>
      fetch(`${url}/storage/v1/object/draft-assets/public-probe/${testId}/${'0'.repeat(64)}.bin`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array([0])
      })
  }
];

let failed = false;
for (const probe of probes) {
  const response = await probe.request();
  console.log(`${probe.name}: HTTP ${response.status} (${response.ok ? 'UNEXPECTEDLY ALLOWED' : 'denied'})`);
  if (response.ok) failed = true;
}

if (failed) throw new Error('The public anon role reached at least one private draft operation.');
console.log('Public anon boundary: PASS');
