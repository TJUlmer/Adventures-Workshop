/**
 * The wire to Supabase.
 *
 * Hand-rolled rather than the official client, for the reason everything else
 * here is hand-rolled: PostgREST, Storage and Auth are all plain HTTP with two
 * headers, and `package.json` has no runtime dependencies to spend.
 *
 * The header rules were established against the live project rather than read
 * off a page, because the newer `sb_publishable_…` keys are not JWTs and do not
 * behave quite like the `anon` keys most examples assume:
 *
 *  - `apikey` always carries the publishable key. It identifies the project.
 *  - `Authorization: Bearer` carries the *signed-in user's* access token when
 *    there is one, and the publishable key when there is not. PostgREST reads
 *    this one to decide which RLS policies apply, so getting it wrong does not
 *    fail loudly — it silently makes every request anonymous.
 *  - `GET /rest/v1/` answers 401 whatever you send, because the schema endpoint
 *    wants a *secret* key. It is not a health check, and reading it as one
 *    costs an hour. Query a table instead.
 */
import { cloudConfig } from './config';

/** Thrown for anything the caller could reasonably show a person. */
export class CloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** PostgREST's own code, where it gave one — `23505` is a unique clash. */
    readonly code: string | null = null
  ) {
    super(message);
    this.name = 'CloudError';
  }
}

/** Raised when a caller reaches the network with no project configured. */
export class CloudNotConfiguredError extends CloudError {
  constructor() {
    super('Sharing is not set up in this build.', 0);
    this.name = 'CloudNotConfiguredError';
  }
}

/**
 * The access token for the signed-in user, or `null`.
 *
 * A function rather than a value because `auth.ts` owns the session and
 * refreshes it behind everyone's back; reading it per request is what stops a
 * long-lived module holding a token that expired twenty minutes ago.
 */
let accessTokenSource: () => string | null = () => null;

export function useAccessToken(source: () => string | null): void {
  accessTokenSource = source;
}

export function headers(
  extra: Readonly<Record<string, string>> = {},
  /**
   * Send the project key even when someone is signed in.
   *
   * For requests that are public by definition — the gallery, a share link.
   * Attaching a user token to those buys nothing (the RLS policy is the same
   * either way) and costs everything when the token is stale: PostgREST
   * rejects an expired JWT outright, so a session left overnight emptied the
   * gallery for its owner while every stranger saw it fine. A public read must
   * not be able to fail for a reason that belongs to the reader.
   */
  anonymous = false
): Record<string, string> {
  const config = cloudConfig();
  if (!config) throw new CloudNotConfiguredError();

  const token = anonymous ? config.key : (accessTokenSource() ?? config.key);

  return {
    apikey: config.key,
    // The user's token when signed in; the project key otherwise. This is the
    // header RLS reads, and the difference between "me" and "anyone".
    Authorization: `Bearer ${token}`,
    ...extra
  };
}

export function endpoint(path: string): string {
  const config = cloudConfig();
  if (!config) throw new CloudNotConfiguredError();
  return `${config.url}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Turn a failed response into something worth showing someone.
 *
 * Supabase answers with several different error shapes depending on which
 * service replied — PostgREST, GoTrue and Storage each have their own — so
 * this tries them in turn rather than assuming one.
 */
async function toError(response: Response): Promise<CloudError> {
  let message = `${response.status} ${response.statusText}`.trim();
  let code: string | null = null;

  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      const text =
        record['message'] ?? record['error_description'] ?? record['error'] ?? record['msg'];
      if (typeof text === 'string' && text.length > 0) message = text;

      /*
       * PostgREST puts a string in `code` — `23505` for a unique clash. GoTrue
       * puts the HTTP status there as a *number* and the useful name in
       * `error_code` (`otp_expired`, `validation_failed`). Taking whichever is
       * a string gets the meaningful one from both without branching on which
       * service answered.
       */
      const candidate = typeof record['code'] === 'string' ? record['code'] : record['error_code'];
      if (typeof candidate === 'string' && candidate.length > 0) code = candidate;
    }
  } catch {
    // A body that is not JSON tells us nothing the status has not.
  }

  /*
   * A dead session, in words. PostgREST answers an expired token with a bare
   * "JWT expired", which went straight to the screen — a person is told an
   * acronym and given nothing to do about it. Public reads no longer send a
   * token at all, so anything reaching here is an action that genuinely needed
   * a signed-in person, and signing in again is genuinely the answer.
   */
  /*
   * Matched on PostgREST's codes as well as its wording, because the wording
   * is not one message: `PGRST303` says "JWT expired" and `PGRST301` says "No
   * suitable key or wrong key type" — both meaning the token is no good, and
   * only the second reads like a fault in the app.
   */
  const deadToken = code === 'PGRST301' || code === 'PGRST303';
  if (response.status === 401 && (deadToken || /jwt (expired|invalid)/i.test(message))) {
    return new CloudError('Your sign-in has expired. Sign in again to continue.', 401, code);
  }

  return new CloudError(message, response.status, code);
}

async function send(url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    /*
     * `fetch` rejects for offline, DNS and CORS alike, and cannot tell them
     * apart from script. Local-first means this is an ordinary condition
     * rather than a fault, so it is worded as one.
     */
    throw new CloudError('Could not reach the server. You may be offline.', 0);
  }

  if (!response.ok) throw await toError(response);
  return response;
}

export interface RequestOptions {
  method?: string;
  /** Sent as JSON. Mutually exclusive with `raw`. */
  body?: unknown;
  /** Sent as-is, for Storage uploads. */
  raw?: Blob | ArrayBuffer;
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  /** Send as the project rather than as whoever is signed in. See `headers`. */
  anonymous?: boolean;
}

/** A request that returns JSON. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const extra: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;

  if (options.raw !== undefined) {
    body = options.raw;
  } else if (options.body !== undefined) {
    extra['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await send(endpoint(path), {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
    headers: headers(extra, options.anonymous),
    body,
    signal: options.signal
  });

  // 204, and PostgREST's `return=minimal`, have nothing to parse.
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (text.length === 0) return undefined as T;
  return JSON.parse(text) as T;
}

/** A request whose answer is bytes — a published asset on its way back down. */
export async function requestBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  /*
   * Public bucket objects are ordinary URLs and need no key. Sending one anyway
   * would turn a cacheable public GET into an authorised request for no gain.
   */
  const response = await send(url, { signal });
  return response.blob();
}
