/**
 * Signing in, by emailed code.
 *
 * Codes rather than magic links, and that is a decision worth the paragraph.
 * A magic link opens a *new* tab, and this app's entire state — the document
 * being edited — lives in the `localStorage` of the tab the author is already
 * in. Landing them in a second tab with a session, beside the tab that has
 * their work, is a worse place than where they started. A six-digit code is
 * typed into the tab they are in, and nothing moves.
 *
 * There is no session on the server to speak of: GoTrue hands back a JWT and a
 * refresh token, and that is all `http.ts` ever needs. Being signed out is not
 * an error state here — the app is local-first, so it is simply the state in
 * which sharing is unavailable and everything else works.
 */
import { cloudConfig } from './config';
import { CloudError, CloudNotConfiguredError, request, useAccessToken } from './http';

const SESSION_KEY = 'adventures-workshop:session:v1';

/** How long the app treats a token as usable, short of its real expiry. */
const REFRESH_MARGIN_MS = 60_000;

export interface CloudUser {
  id: string;
  email: string;
}

interface Session {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  user: CloudUser;
}

/**
 * Providers this app knows how to finish a sign-in with.
 *
 * Deliberately not "every provider Supabase supports": each one has to have its
 * redirect registered and its round trip actually walked before it belongs
 * here. Order is display order.
 */
const SUPPORTED = [
  { id: 'google', label: 'Google' },
  { id: 'discord', label: 'Discord' }
] as const;

export type ProviderId = (typeof SUPPORTED)[number]['id'];

/** What GoTrue sends back from `/token` and `/verify`. */
interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id?: string; email?: string };
}

/**
 * One claim out of a JWT payload, without verifying it.
 *
 * Reading is safe here and verifying would be pointless: the token came from
 * our own auth server over TLS, and every request it is used on is checked
 * again server-side. This only decides what the interface shows.
 */
function readClaim<T>(token: string, claim: string): T | null {
  try {
    // base64url — two characters differ from base64, and padding is optional.
    const part = token.split('.')[1] ?? '';
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as Record<string, unknown>)[claim] as T;
  } catch {
    return null;
  }
}

function readSubject(token: string): string | null {
  return readClaim<string>(token, 'sub');
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Private mode, or storage blocked by policy — sign-in just will not stick.
    return null;
  }
}

function toSession(payload: TokenResponse): Session | null {
  const { access_token: access, refresh_token: refresh, user } = payload;
  if (!access || !refresh || !user?.id) return null;

  /*
   * `expires_at` is seconds since the epoch and `expires_in` is a duration;
   * GoTrue sends whichever it feels like. Preferring the absolute one matters
   * on a machine whose clock is off — the duration is measured against *our*
   * clock, which is the one that might be wrong.
   */
  const expiresAt =
    typeof payload.expires_at === 'number'
      ? payload.expires_at * 1000
      : Date.now() + (payload.expires_in ?? 3600) * 1000;

  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt,
    user: { id: user.id, email: user.email ?? '' }
  };
}

class Auth {
  #session = $state<Session | null>(null);

  /** In flight, so the UI can say which step it is on. */
  sending = $state(false);
  verifying = $state(false);

  /**
   * Which providers to actually offer, in the order they are shown.
   *
   * The intersection of two things, and it needs both. `SUPPORTED` is what this
   * app has written and walked the round trip for — GitHub sat enabled on the
   * project for a while pointing at a client id of `resend`, and offering a
   * button that leads to a provider's error page is worse than offering none.
   * `external` from the settings endpoint is what the project has switched on,
   * so a provider enabled later appears here with no code change and one that
   * is switched off stops being offered the moment it is.
   */
  providers = $state<{ id: ProviderId; label: string }[]>([]);

  /** The address a code was last sent to, which the code form needs to verify. */
  pendingEmail = $state<string | null>(null);

  readonly user = $derived(this.#session?.user ?? null);
  readonly signedIn = $derived(this.#session !== null);

  /**
   * A single in-flight refresh, shared.
   *
   * Publishing fires several requests at once, and each calls `ensureFresh`.
   * Without this they would each spend the refresh token — and GoTrue rotates
   * it, so the second call would be presenting one that had just been retired
   * and the author would be signed out mid-publish.
   */
  #refreshing: Promise<void> | null = null;

  constructor() {
    // `http.ts` reads the token per request rather than being handed one, so a
    // token refreshed here is picked up without anything being re-wired.
    useAccessToken(() => this.#session?.accessToken ?? null);
  }

  /** Reload a session saved in a previous visit. Safe to call more than once. */
  restore(): void {
    const raw = storage()?.getItem(SESSION_KEY);
    if (!raw) return;

    try {
      const parsed: unknown = JSON.parse(raw);
      const session = parsed as Session;
      if (session?.accessToken && session?.refreshToken && session?.user?.id) {
        this.#session = session;
      }
    } catch {
      storage()?.removeItem(SESSION_KEY);
    }
  }

  #persist(session: Session | null): void {
    this.#session = session;
    const store = storage();
    if (!store) return;
    if (session) store.setItem(SESSION_KEY, JSON.stringify(session));
    else store.removeItem(SESSION_KEY);
  }

  /**
   * Ask for a code.
   *
   * `create_user` is on, so signing in and signing up are the same act. There
   * is nothing to a person's account here beyond an address and the sets they
   * published, so a separate registration step would be a form standing between
   * an author and their own work for no gain.
   */
  async requestCode(email: string): Promise<void> {
    const address = email.trim().toLowerCase();
    if (!address.includes('@')) throw new CloudError('That does not look like an email address.', 0);

    this.sending = true;
    try {
      await request('/auth/v1/otp', {
        method: 'POST',
        body: { email: address, create_user: true }
      });
      this.pendingEmail = address;
    } catch (cause) {
      // The rate limiter's own wording is unhelpfully technical.
      if (cause instanceof CloudError && cause.status === 429) {
        throw new CloudError('Too many codes requested. Wait a minute and try again.', 429);
      }
      throw cause;
    } finally {
      this.sending = false;
    }
  }

  /**
   * Sign in with no account at all.
   *
   * Supabase mints a real user with no address attached. It is a *user*, not
   * the anon key: it gets the `authenticated` role, so every policy already
   * written applies to it unchanged and the storage prefix keeps meaning what
   * it meant. What separates it from a permanent account is one JWT claim,
   * `is_anonymous`, which the database uses to keep throwaway accounts out of
   * the public gallery.
   *
   * The honest limitation, which the UI has to say out loud: this session is
   * *this browser*. Clearing site data or moving to another machine loses the
   * ability to update or withdraw what was published. Nothing is destroyed —
   * the document is still in the library and the share link still resolves —
   * but the published copy becomes unmanageable, so an author has to know that
   * before they rely on it.
   *
   * When email starts working, `linkEmail` turns this into a real account and
   * everything published under it comes along.
   */
  async signInAnonymously(): Promise<void> {
    this.verifying = true;
    try {
      const payload = await request<TokenResponse>('/auth/v1/signup', {
        method: 'POST',
        body: {}
      });

      const session = toSession(payload);
      if (!session) {
        throw new CloudError('The server did not return a usable session.', 0);
      }
      this.#persist(session);
    } catch (cause) {
      if (cause instanceof CloudError && cause.status === 422) {
        throw new CloudError(
          'Anonymous sharing is switched off for this project. Turn on “Anonymous sign-ins” in Supabase.',
          422
        );
      }
      throw cause;
    } finally {
      this.verifying = false;
    }
  }

  /** Whether this session is a throwaway one rather than a real account. */
  readonly isAnonymous = $derived.by(() => {
    const token = this.#session?.accessToken;
    return token ? readClaim<boolean>(token, 'is_anonymous') === true : false;
  });

  /**
   * Attach an address to a throwaway account, keeping everything it published.
   *
   * The row's `owner_id` never changes, which is the whole point — the sets
   * stay exactly where they are and simply acquire a way back in.
   */
  async linkEmail(email: string): Promise<void> {
    await this.ensureFresh();
    if (!this.#session) throw new CloudError('Nothing to upgrade — no session.', 401);

    const address = email.trim().toLowerCase();
    if (!address.includes('@')) throw new CloudError('That does not look like an email address.', 0);

    await request('/auth/v1/user', { method: 'PUT', body: { email: address } });
    this.pendingEmail = address;
  }

  /**
   * Sign in through a provider — Google, GitHub or Discord.
   *
   * The route that made the gallery possible. Email one-time codes need a
   * verified sending domain, and until there is one nobody can get a permanent
   * account at all; OAuth needs no mail to leave the building. It also arrives
   * carrying the two things a gallery wants anyway — a display name and an
   * avatar — which `handle_new_user` copies into `profiles` on first sign-in.
   *
   * This *leaves the page*, which is the one thing the emailed-code flow was
   * chosen to avoid. It is acceptable here and was not there: a code is typed
   * mid-edit, where losing the tab would lose the work, whereas signing in to
   * publish is a deliberate detour and the document is in `localStorage` when
   * the redirect comes back.
   */
  /**
   * Ask the project which providers are live, and keep the ones we support.
   *
   * Failing quietly is right: with no answer the panel simply offers the
   * anonymous and email routes, which is a smaller sign-in box rather than a
   * broken one.
   */
  async loadProviders(): Promise<void> {
    try {
      const settings = await request<{ external?: Record<string, boolean> }>('/auth/v1/settings');
      const external = settings.external ?? {};
      this.providers = SUPPORTED.filter((p) => external[p.id] === true).map((p) => ({ ...p }));
    } catch {
      this.providers = [];
    }
  }

  signInWithProvider(provider: ProviderId): void {
    const config = cloudConfig();
    if (!config) throw new CloudNotConfiguredError();

    /*
     * Back to exactly where we are, hash and all. `redirect_to` has to be on
     * the project's allow-list — Supabase refuses anything else — so a new
     * deployment needs its URL added there before this works from it.
     */
    const back = encodeURIComponent(window.location.href);
    window.location.href =
      `${config.url}/auth/v1/authorize?provider=${provider}&redirect_to=${back}`;
  }

  /**
   * Pick up a session the provider left in the URL.
   *
   * Supabase comes back with the tokens in the *fragment*, which never reaches
   * a server — that is the point of it — so the page has to read them itself.
   * They are stripped from the address bar immediately afterwards: an access
   * token sitting in a URL is one browser-history entry away from being shared
   * by accident.
   *
   * Returns true when a session was found, so the caller can tell an arriving
   * redirect apart from an ordinary page load.
   */
  captureRedirect(): boolean {
    const hash = window.location.hash;
    if (!hash.includes('access_token=')) return false;

    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const access = params.get('access_token');
    const refresh = params.get('refresh_token');
    if (!access || !refresh) return false;

    const expiresIn = Number(params.get('expires_in') ?? '3600');
    this.#persist({
      accessToken: access,
      refreshToken: refresh,
      expiresAt: Date.now() + expiresIn * 1000,
      /* The provider's own claims, read straight off the token. `profiles` is
         the durable copy; this is only what the header needs immediately. */
      user: { id: readSubject(access) ?? '', email: params.get('email') ?? '' }
    });

    history.replaceState(null, '', window.location.pathname + window.location.search);
    return true;
  }

  /** Exchange the emailed code for a session. */
  async verifyCode(code: string): Promise<void> {
    const email = this.pendingEmail;
    if (!email) throw new CloudError('Ask for a code first.', 0);

    this.verifying = true;
    try {
      const payload = await request<TokenResponse>('/auth/v1/verify', {
        method: 'POST',
        body: { email, token: code.trim(), type: 'email' }
      });

      const session = toSession(payload);
      if (!session) throw new CloudError('The server did not return a usable session.', 0);

      this.#persist(session);
      this.pendingEmail = null;
    } catch (cause) {
      if (cause instanceof CloudError && (cause.status === 401 || cause.status === 403)) {
        throw new CloudError('That code was wrong or has expired. Ask for another.', cause.status);
      }
      throw cause;
    } finally {
      this.verifying = false;
    }
  }

  /**
   * Make sure the token is worth sending.
   *
   * Called before a request rather than on a timer: a tab left open overnight
   * would have burnt a dozen refreshes by morning and still needed this check,
   * because a laptop that was asleep did not run the timer anyway.
   */
  async ensureFresh(): Promise<void> {
    const session = this.#session;
    if (!session) return;
    if (session.expiresAt - Date.now() > REFRESH_MARGIN_MS) return;

    this.#refreshing ??= this.#refresh(session.refreshToken).finally(() => {
      this.#refreshing = null;
    });

    return this.#refreshing;
  }

  async #refresh(refreshToken: string): Promise<void> {
    try {
      const payload = await request<TokenResponse>('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: { refresh_token: refreshToken }
      });

      const session = toSession(payload);
      if (session) this.#persist(session);
      else this.#persist(null);
    } catch (cause) {
      /*
       * A refresh token is rejected because it was used, revoked or expired —
       * all of which mean the same thing to an author, and none of which get
       * better by retrying. Dropping the session is what puts the sign-in form
       * back in front of them. A network failure is different, and must *not*
       * sign anyone out for being on a train.
       */
      if (cause instanceof CloudError && cause.status !== 0) this.#persist(null);
      throw cause;
    }
  }

  async signOut(): Promise<void> {
    const session = this.#session;
    // Local first, and unconditionally: a logout that failed because the
    // network was down must still sign the author out of this browser.
    this.#persist(null);
    this.pendingEmail = null;
    if (!session) return;

    try {
      await request('/auth/v1/logout', { method: 'POST' });
    } catch {
      // The token expires on its own. Nothing here is worth showing anyone.
    }
  }
}

export const auth = new Auth();
