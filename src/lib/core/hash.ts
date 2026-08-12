/**
 * Content hashing, for naming a file after what is in it.
 *
 * Two callers, and the same reason behind both: a consumer that caches by URL
 * will keep serving the old bytes when a file changes underneath a stable name.
 * Tabletop Simulator does exactly that with its texture cache, and so does every
 * CDN in front of published artwork. Putting the hash in the name makes a
 * changed file a *different* file, which is the only thing such a cache reliably
 * respects.
 */

/** SHA-256 as lower-case hex. */
export async function hashHex(bytes: Uint8Array): Promise<string> {
  // A fresh buffer: `bytes` may be a view onto a larger one, and `digest`
  // would hash the whole thing rather than the slice it was handed.
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The first 8 hex characters, for a filename.
 *
 * Short enough to keep a path readable and long enough that a collision needs
 * about 4 billion distinct images in one export. The full digest is still used
 * where the hash has to *identify* an asset rather than merely version it.
 */
export async function shortHash(bytes: Uint8Array): Promise<string> {
  return (await hashHex(bytes)).slice(0, 8);
}
