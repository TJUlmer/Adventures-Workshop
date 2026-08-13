/**
 * Reading a picture the author picked, without letting it blow the document's
 * storage budget.
 *
 * Every image in the document is a data URL, embedded whole — see
 * `artwork.ts`. This started as a fix for `localStorage`'s ~5MB-per-origin
 * quota, shared across every set in the library rather than metered per set:
 * a single unedited camera photo is routinely 3-10MB before the ~33% this
 * format's base64 encoding adds on top, so "import one photo" was enough on
 * its own to leave nothing for the rest of the document, let alone anything
 * already saved beside it — reported as "storage is full" the moment
 * autosave next ran, with no indication that a single picture was the whole
 * cause. `storage/library.ts` has since moved the library itself onto
 * IndexedDB, which lifts that particular ceiling by two to three orders of
 * magnitude — but downscaling stays worth doing regardless: a 200-image
 * library of unedited photos is still tens or hundreds of megabytes of JSON
 * to parse, hash and hold in memory on every load, save and fingerprint, and
 * none of it prints any sharper for having skipped this.
 *
 * Nothing here changes what an author sees. The largest single print surface
 * a picked image is ever placed into is the event card's 2232px bleed —
 * everything else in `renderer/geometry.ts` is smaller — so a downscale that
 * only engages above `ARTWORK_MAX_DIMENSION` costs nothing anyone would
 * notice, on screen or printed. A picture already small enough is returned
 * exactly as read: this only touches files worth touching.
 */

/**
 * Longest edge a picture keeps, once it is large enough to be worth touching
 * at all.
 *
 * Set well above every printed surface in the app and well below what a
 * phone camera hands back by default, so the common case — importing an
 * unedited photo — is exactly the one this catches.
 */
export const ARTWORK_MAX_DIMENSION = 2400;

/** Below this many bytes, a file is never worth the round trip through canvas. */
const SKIP_BELOW_BYTES = 400 * 1024;

/**
 * WebP quality for a picture that has to be re-encoded.
 *
 * Set for something an author will crop, grade and print, not for the much
 * smaller bar a screen-only gallery thumbnail can get away with — see
 * `cloud/thumbnail.ts`, which is the same trick at a fraction of the size and
 * a correspondingly lower quality.
 */
const QUALITY = 0.92;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Decode straight from the file rather than from a data URL of it, so a
 * large picture is never base64-encoded twice over on its way to being made
 * smaller.
 */
function decode(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    // `image.decode()` can stall indefinitely in a backgrounded tab; `onload`
    // cannot — the same trap `card-image.ts` documents for the same reason.
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

/**
 * Downscale and re-encode a picture, or answer `null` for anything that
 * leaves this worse off than the original — a format the canvas will not
 * even decode, or a file that was already efficiently encoded at a size
 * `toBlob` cannot beat. `null` here always means "keep what was read," never
 * "the import failed."
 */
async function shrink(file: File): Promise<Blob | null> {
  const image = await decode(file);
  if (!image || image.naturalWidth === 0 || image.naturalHeight === 0) return null;

  const { naturalWidth: width, naturalHeight: height } = image;
  const scale = Math.min(1, ARTWORK_MAX_DIMENSION / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  // `toBlob` answers `null` for a format it will not encode rather than
  // throwing — the same fallback `renderThumbnail` uses, for the same reason.
  const encode = (type: string): Promise<Blob | null> =>
    new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));

  const blob = (await encode('image/webp')) ?? (await encode('image/png'));
  return blob && blob.size < file.size ? blob : null;
}

/**
 * Read a file the author picked into the data URL that goes in the document,
 * shrinking it first if it is large enough to be worth the trouble.
 *
 * The one call every "choose an image" control in the app should route
 * through — `ArtworkPanel`, `CardbackPanel`, `ReplacementPanel` and the rest.
 * Never rejects a file over this: a picture that only needed shrinking and
 * did not get it is a far better outcome than an import that failed outright
 * over a format this browser's canvas happens not to touch.
 */
export async function readArtworkFile(file: File): Promise<string> {
  if (file.size > SKIP_BELOW_BYTES) {
    try {
      const shrunk = await shrink(file);
      if (shrunk) return await readAsDataUrl(shrunk);
    } catch {
      // Decoding failed outright — fall through and import the original.
    }
  }
  return readAsDataUrl(file);
}
