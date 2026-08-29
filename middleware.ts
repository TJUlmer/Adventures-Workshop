/**
 * A Discord/Slack/Twitter-shaped preview for a shared set's link.
 *
 * This is the server side of the problem `shareUrl` (`src/lib/cloud/sets.ts`)
 * exists to solve: a link unfurler fetches a URL with plain HTTP and reads
 * whatever `<meta>` tags come back — it never runs the app's JavaScript, so
 * the real single-page app (which decides everything from the URL *fragment*,
 * a part of the URL no HTTP request ever carries) has nothing to show it. This
 * middleware runs ahead of that: it matches only `/shared/:slug`, and only for
 * requests whose User-Agent names a known link-unfurling bot. Everyone else —
 * every real visitor — is invisible to it; `return` with nothing falls through
 * to Vercel's normal routing, which is `vercel.json`'s rewrite serving the
 * ordinary `index.html` SPA, exactly as if this file did not exist.
 *
 * Deliberately self-contained rather than importing from `src/lib/cloud/` —
 * Edge Middleware is bundled and run outside Vite entirely, so `$lib` is not
 * a resolvable alias here, and the one PostgREST call this needs is small
 * enough that duplicating it beats wiring up a shared build step for it. The
 * request shape (the `apikey` / `Authorization: Bearer` pair, the anonymous
 * RPC call) mirrors `cloud/http.ts`'s `headers()` and `cloud/sets.ts`'s
 * `fetchSetBySlug` exactly — see those for why each header is there.
 *
 * Reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` from
 * `process.env` — the same two Environment Variables already configured in
 * the Vercel project for the client build to have picked them up in the
 * first place (Vite's `VITE_` prefix only controls what reaches the browser
 * bundle; it says nothing about what a server-side function may read). No
 * new configuration is needed for this to work.
 */

/*
 * Both real paths this app has. Everything else routes on a hash, which never
 * reaches a server and so can never be unfurled — see
 * `state/navigation.svelte.ts`. A third entry belongs here only alongside the
 * same argument.
 */
export const config = {
  matcher: ['/shared/:slug*', '/collection/:slug*']
};

/** Substrings of known link-unfurling bots' User-Agent strings, lower-cased. */
const BOT_MARKERS = [
  'discordbot',
  'slackbot',
  'twitterbot',
  'facebookexternalhit',
  'facebot',
  'linkedinbot',
  'telegrambot',
  'whatsapp',
  'skypeuripreview',
  'embedly',
  'quora link preview',
  'w3c_validator',
  'redditbot',
  'pinterest',
  'vkshare',
  'iframely'
] as const;

function isBot(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const lower = userAgent.toLowerCase();
  return BOT_MARKERS.some((marker) => lower.includes(marker));
}

const SHARED_PATTERN = /^\/shared\/([A-Za-z0-9_-]+)\/?$/;
const COLLECTION_PATTERN = /^\/collection\/([A-Za-z0-9_-]+)\/?$/;

/** Minimal — this only ever feeds a `content="…"` attribute, never a tag. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface CollectionRow {
  name: string;
  subtitle: string;
  blurb: string;
  banner_url: string;
}

interface SetSummaryRow {
  name: string;
  subtitle: string;
  thumbnail_url: string;
  social_image_url: string;
  character_count: number;
  card_count: number;
}

/**
 * The same anonymous `set_by_slug` call the client makes — see
 * `fetchSetBySlug` in `src/lib/cloud/sets.ts`. Returns `null` for anything
 * that goes wrong (no project configured, the slug leads nowhere, the network
 * is down): a preview that falls back to the generic one is a far better
 * outcome than a link that fails to unfurl at all.
 */
async function fetchRow<T>(rpc: string, slug: string): Promise<T | null> {
  const url = process.env['VITE_SUPABASE_URL'];
  const key = process.env['VITE_SUPABASE_PUBLISHABLE_KEY'];
  if (!url || !key) return null;

  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ share_slug: slug })
    });
    if (!response.ok) return null;

    const rows = (await response.json()) as T[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * One preview page. `path` is where a human is sent if they land on the HTML
 * a bot was served, which happens when somebody pastes a link into a client
 * that follows it themselves.
 */
function page(
  title: string,
  description: string,
  image: string,
  path: string,
  label: string
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeAttr(title)}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeAttr(title)}">
<meta property="og:description" content="${escapeAttr(description)}">
${image ? `<meta property="og:image" content="${escapeAttr(image)}">\n` : ''}<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
</head>
<body>
<h1>${escapeAttr(title)}</h1>
<p>${escapeAttr(description)}</p>
<p><a href="${escapeAttr(path)}">${escapeAttr(label)}</a></p>
</body>
</html>`;
}

/**
 * A collection's preview.
 *
 * No composed picture of its own — a collection has no cards to render, and
 * its banner is a file its organizers uploaded, so there is nothing to fall
 * back to when they have not. That is the deliberate answer recorded in
 * `COLLECTIONS.md`: the cheap option is the right one here, and an absent
 * banner simply yields a text-only unfurl rather than borrowing some member's
 * artwork and implying it speaks for the whole box.
 */
function renderCollectionPreview(slug: string, row: CollectionRow | null): string {
  const title = row?.name || 'A collection on Unmatched Labs';
  const description =
    row?.subtitle || row?.blurb || 'A themed box of decks, each owned by the person who made it.';
  return page(
    title,
    description,
    row?.banner_url || '',
    `/collection/${encodeURIComponent(slug)}`,
    'Open in Unmatched Labs'
  );
}

function renderPreview(slug: string, summary: SetSummaryRow | null): string {
  const title = summary?.name || 'Unmatched Labs';

  /*
   * The subtitle first, then the one line of stats an author never has to
   * write themselves — free information a reader would otherwise only get by
   * opening the link. Skipped when both counts are zero, which is what an
   * empty (never-hydrated) summary row looks like, so a broken lookup does
   * not print "0 characters · 0 cards" under the generic fallback text.
   */
  const stats =
    summary && (summary.character_count > 0 || summary.card_count > 0)
      ? `${summary.character_count} ${summary.character_count === 1 ? 'character' : 'characters'} · ${summary.card_count} cards`
      : '';
  const description = summary?.subtitle
    ? stats
      ? `${summary.subtitle} — ${stats}`
      : summary.subtitle
    : stats || 'A local-first builder for custom Unmatched sets.';

  /*
   * The composed, trimmed render (`cloud/social-image.ts`) over the plain
   * gallery-tile downscale — see `social_image_url`'s own note in
   * `cloud/sets.ts` for why the two are different pictures at all. Empty for
   * a row published before that existed, which is exactly when the fallback
   * matters.
   */
  const image = summary?.social_image_url || summary?.thumbnail_url || '';

  return page(
    title,
    description,
    image,
    `/shared/${encodeURIComponent(slug)}`,
    'Open in Unmatched Labs'
  );
}

export default async function middleware(request: Request): Promise<Response | undefined> {
  if (!isBot(request.headers.get('user-agent'))) return undefined;

  const { pathname } = new URL(request.url);
  const html = (body: string) =>
    new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });

  const collection = COLLECTION_PATTERN.exec(pathname)?.[1];
  if (collection) {
    const row = await fetchRow<CollectionRow>('collection_by_slug', collection);
    return html(renderCollectionPreview(collection, row));
  }

  const slug = SHARED_PATTERN.exec(pathname)?.[1];
  if (!slug) return undefined;

  const summary = await fetchRow<SetSummaryRow>('set_by_slug', slug);
  return html(renderPreview(slug, summary));
}
