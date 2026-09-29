/**
 * Importing a picture from a link, or from a picture on the clipboard.
 *
 * This is an *import*, not a link: the bytes are downloaded once, handed to
 * `readArtworkFile` exactly as a chosen file is, and embedded in the document.
 * Keeping a remote URL in the set instead was considered and rejected: every
 * export and publish draws cards onto a canvas, and a browser refuses to let a
 * page read pixels from another site unless that site allows it, so linked art
 * would export blank from most hosts. It would also break offline editing and
 * the one-file set, rot when the host deletes or expires the file, and let a
 * published picture be swapped after moderation. Downloading once keeps every
 * one of those guarantees and still spares an author the save-then-upload
 * round trip.
 *
 * The same browser rule decides which links can work at all. Imgur's image
 * server allows any site to read it, which covers the common case; many hosts
 * do not, and for those the fallback is copying the image itself — a pasted
 * image arrives as bytes and needs no host's permission.
 */

/** Largest download accepted: several times any unedited phone photo. */
export const MAX_LINKED_IMAGE_BYTES = 25 * 1024 * 1024;

/** Long enough for a large photo on a slow connection; short enough to give up. */
const DOWNLOAD_TIMEOUT_MS = 30_000;

const TOO_SLOW = 'That link took too long to download. Try again, or save the image and use Choose.';

/* Advice written for a mouse and a touch screen at once: a phone has no right
   click, and "Copy image address" is where a long press puts it too. */
const COPY_ADDRESS =
  'Open it, right-click (or long-press) the picture and choose “Copy image address”, then paste that here.';

export type ResolvedImageLink = { ok: true; url: string } | { ok: false; message: string };

const VIDEO_EXTENSION = /\.(gifv|mp4|webm|mov)$/i;

/**
 * Imgur's image server answers any extension with the original file, so
 * `.png` fetches a JPEG original as JPEG, untouched. Asking for `.webp`
 * instead would get a re-encoded copy, so the original extension is never
 * trusted to mean "the format you get".
 */
function imgurDirect(id: string): string {
  return `https://i.imgur.com/${id}.png`;
}

/**
 * The picture a link names, as a URL this page is allowed to download.
 *
 * Imgur links are rewritten rather than followed, for two measured reasons:
 * `imgur.com/<id>` is a web page, and the redirect `imgur.com/<id>.png` takes
 * to the image server only allows imgur.com itself, so a browser refuses it.
 * The image server (`i.imgur.com`) allows every site. Thumbnail forms are
 * undone too — the address copied from Imgur's own feed is a 520px-wide
 * `_d.webp?maxwidth=520` preview of a 2268×4032 original, and a size letter
 * (`h`, `l`…) resamples, even enlarging a small original.
 */
export function resolveImageLink(raw: string): ResolvedImageLink {
  const text = raw.trim();
  if (!text) return { ok: false, message: 'Paste a link to an image.' };
  if (/^data:image\//i.test(text)) return { ok: true, url: text };

  /* `new URL` happily percent-encodes stray words into a hostname, so a
     sentence pasted by mistake would otherwise be fetched as a web address. */
  let url: URL;
  try {
    if (/\s/.test(text)) throw new Error('whitespace');
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    if (!url.hostname.includes('.')) throw new Error('no domain');
  } catch {
    return { ok: false, message: 'That does not look like a link.' };
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') return { ok: false, message: 'Only web links (https://…) can be imported.' };

  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  if (host === 'imgur.com' || host === 'i.imgur.com') {
    const [first = '', second] = url.pathname.split('/').filter(Boolean);
    if (['a', 'gallery', 't', 'r', 'user', 'topic'].includes(first.toLowerCase()) || second) {
      return { ok: false, message: `That is an Imgur post or album, not a single image. ${COPY_ADDRESS}` };
    }
    if (VIDEO_EXTENSION.test(first)) {
      return { ok: false, message: 'That link is a video. Choose a still image instead.' };
    }
    const match = /^([A-Za-z0-9]{5,10})(?:_[a-z]+)?(?:\.[A-Za-z0-9]+)?$/.exec(first);
    const found = match?.[1];
    if (!found) return { ok: false, message: 'That Imgur link does not name an image.' };
    /* Current ids are seven characters; an eighth letter from this set is a
       resized thumbnail of the seven-character original. */
    const id = found.length === 8 && /[sbtmlh]$/.test(found) ? found.slice(0, 7) : found;
    return { ok: true, url: imgurDirect(id) };
  }

  if (VIDEO_EXTENSION.test(url.pathname)) {
    return { ok: false, message: 'That link is a video. Choose a still image instead.' };
  }
  return { ok: true, url: url.href };
}

/** A readable name for what `accept` allows, for the refusal message. */
function describeAccept(accept: string): string {
  const names = new Set<string>();
  for (const token of accept.split(',').map((part) => part.trim().toLowerCase())) {
    if (token === 'image/*') return 'an image';
    const kind = token.replace(/^image\//, '').replace(/^\./, '');
    names.add(kind === 'jpg' ? 'JPEG' : kind.toUpperCase());
  }
  return [...names].join(' or ') || 'an image';
}

/** Whether a file satisfies a file input's `accept` list. */
export function matchesAccept(accept: string | undefined, file: File): boolean {
  if (!accept) return file.type.startsWith('image/');
  const name = file.name.toLowerCase();
  return accept
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .some((token) =>
      token.endsWith('/*')
        ? file.type.startsWith(token.slice(0, -1))
        : token.startsWith('.')
          ? name.endsWith(token)
          : file.type === token
    );
}

export function acceptMessage(accept: string | undefined): string {
  return `This spot needs ${accept ? describeAccept(accept) : 'an image'}.`;
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg'
};

function fileNameFor(url: string, type: string): string {
  const extension = EXTENSIONS[type] ?? 'img';
  if (url.startsWith('data:')) return `pasted-image.${extension}`;
  const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? 'linked-image';
  const stem = decodeURIComponent(last).replace(/\.[A-Za-z0-9]+$/, '') || 'linked-image';
  return `${stem}.${extension}`;
}

/**
 * Download a resolved link into a `File`, or throw an `Error` whose message
 * says what to do instead.
 *
 * No referrer and no credentials: some hosts refuse hotlinked requests by
 * referrer, and nothing here should send an author's cookies anywhere.
 */
export async function downloadImageLink(url: string, signal?: AbortSignal): Promise<File> {
  const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: combined
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    if (timeout.aborted) throw new Error(TOO_SLOW);
    // A browser reports a refused cross-site read exactly like a network
    // failure, so this cannot tell the two apart — and the advice is the same.
    throw new Error(
      'That site does not let other websites download its images. Copy the image itself ' +
        '(right-click or long-press it and choose “Copy image”) and paste it here, or save it and use Choose.'
    );
  }

  /* Imgur answers a deleted image with a redirect to its "removed" placeholder
     and a success status, so without this the placeholder was imported as art. */
  const missing = /^https:\/\/i\.imgur\.com\/removed\.png$/i.test(response.url);
  if (!response.ok || missing) {
    throw new Error(
      missing || response.status === 404 || response.status === 410
        ? 'There is no image at that link any more.'
        : `That site refused the download (error ${response.status}).`
    );
  }

  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_LINKED_IMAGE_BYTES) throw new Error('That image is over 25 MB.');

  /* The signal still governs the body after the headers arrive, so a large
     picture on a slow line times out here, not in `fetch` — and would otherwise
     surface as the browser's own "signal timed out". */
  let blob: Blob;
  try {
    blob = await response.blob();
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error(timeout.aborted ? TOO_SLOW : 'The download was interrupted. Try again.');
  }
  const type = blob.type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!type.startsWith('image/')) {
    throw new Error(
      type === 'text/html' ? `That link is a web page, not an image. ${COPY_ADDRESS}` : 'That link is not an image.'
    );
  }
  if (blob.size > MAX_LINKED_IMAGE_BYTES) throw new Error('That image is over 25 MB.');

  return new File([blob], fileNameFor(url, type), { type });
}

/** The first image on a paste, if the clipboard holds one rather than text. */
export function pastedImage(event: ClipboardEvent): File | null {
  const file = [...(event.clipboardData?.files ?? [])].find((candidate) =>
    candidate.type.startsWith('image/')
  );
  if (!file) return null;
  const extension = EXTENSIONS[file.type] ?? 'png';
  return file.name && file.name !== 'image.png'
    ? file
    : new File([file], `pasted-image.${extension}`, { type: file.type });
}
