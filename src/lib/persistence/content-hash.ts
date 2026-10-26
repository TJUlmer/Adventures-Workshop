/** Full-document hash used to acknowledge one exact cloud-draft generation. */
import { hashHex } from '$lib/core/hash';
import { canonicalJson } from '$lib/sets/fingerprint';
import type { AdventureSet } from '$lib/sets/types';

const encoder = new TextEncoder();

export async function draftContentHash(set: AdventureSet): Promise<string> {
  return hashHex(encoder.encode(canonicalJson(set)));
}
