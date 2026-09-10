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
 * Edge Middleware is bundled and run outside Vite entirely, so `$lib` is not
 * a resolvable alias here. Its HTTP calls therefore stay local, while the one
 * pure relative import (`cloud/social-metadata.ts`) keeps the words and image
 * choice identical to the creator-visible preview. The request shape (the
 * `apikey` / `Authorization: Bearer` pair, the anonymous RPC call) mirrors
 * `cloud/http.ts`'s `headers()` and `cloud/sets.ts`'s `fetchSetBySlug`
 * exactly — see those for why each header is there.
 *
 * Reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` from
 * `process.env` — the same two Environment Variables already configured in
 * the Vercel project for the client build to have picked them up in the
 * first place (Vite's `VITE_` prefix only controls what reaches the browser
 * bundle; it says nothing about what a server-side function may read). No
 * new configuration is needed for this to work.
 */

import {
  SITE_NAME,
  socialMetadata,
  type SocialMetadataSource
} from './src/lib/cloud/social-metadata';

export const config = {
  matcher: '/shared/:slug*'
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

const SLUG_PATTERN = /^\/shared\/([A-Za-z0-9_-]+)\/?$/;

/** Minimal — this only ever feeds a `content="…"` attribute, never a tag. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface SetSummaryRow extends SocialMetadataSource {
  owner_id: string;
}

/**
 * The same anonymous `set_by_slug` call the client makes — see
 * `fetchSetBySlug` in `src/lib/cloud/sets.ts`. Returns `null` for anything
 * that goes wrong (no project configured, the slug leads nowhere, the network
 * is down): a preview that falls back to the generic one is a far better
 * outcome than a link that fails to unfurl at all.
 */
async function fetchSummary(slug: string): Promise<SetSummaryRow | null> {
  const url = process.env['VITE_SUPABASE_URL'];
  const key = process.env['VITE_SUPABASE_PUBLISHABLE_KEY'];
  if (!url || !key) return null;

  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/set_by_slug`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ share_slug: slug })
    });
    if (!response.ok) return null;

    const rows = (await response.json()) as SetSummaryRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** A display name is enrichment only; the set preview remains useful without it. */
async function fetchAuthorName(ownerId: string): Promise<string> {
  const url = process.env['VITE_SUPABASE_URL'];
  const key = process.env['VITE_SUPABASE_PUBLISHABLE_KEY'];
  if (!url || !key) return '';

  try {
    const response = await fetch(
      `${url.replace(/\/+$/, '')}/rest/v1/profiles?id=eq.${encodeURIComponent(ownerId)}&select=display_name&limit=1`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`
        }
      }
    );
    if (!response.ok) return '';
    const rows = (await response.json()) as { display_name: string }[];
    return rows[0]?.display_name ?? '';
  } catch {
    return '';
  }
}

function renderPreview(
  slug: string,
  summary: SetSummaryRow | null,
  authorName: string,
  canonicalUrl: string
): string {
  const metadata = socialMetadata(summary, authorName);
  const imageTags = metadata.image
    ? `<meta property="og:image" content="${escapeAttr(metadata.image)}">
<meta property="og:image:alt" content="${escapeAttr(metadata.imageAlt)}">
<meta name="twitter:image" content="${escapeAttr(metadata.image)}">
<meta name="twitter:image:alt" content="${escapeAttr(metadata.imageAlt)}">
`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeAttr(metadata.title)} · ${SITE_NAME}</title>
<meta name="description" content="${escapeAttr(metadata.description)}">
<link rel="canonical" href="${escapeAttr(canonicalUrl)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:locale" content="en_US">
<meta property="og:url" content="${escapeAttr(canonicalUrl)}">
<meta property="og:title" content="${escapeAttr(metadata.title)}">
<meta property="og:description" content="${escapeAttr(metadata.description)}">
${imageTags}<meta name="twitter:card" content="${metadata.image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${escapeAttr(metadata.title)}">
<meta name="twitter:description" content="${escapeAttr(metadata.description)}">
</head>
<body>
<h1>${escapeAttr(metadata.title)}</h1>
<p>${escapeAttr(metadata.description)}</p>
<p><a href="/shared/${encodeURIComponent(slug)}">Open in Unmatched Labs</a></p>
</body>
</html>`;
}

export default async function middleware(request: Request): Promise<Response | undefined> {
  if (!isBot(request.headers.get('user-agent'))) return undefined;

  const slug = SLUG_PATTERN.exec(new URL(request.url).pathname)?.[1];
  if (!slug) return undefined;

  const summary = await fetchSummary(slug);
  const authorName = summary ? await fetchAuthorName(summary.owner_id) : '';
  const canonicalUrl = new URL(`/shared/${encodeURIComponent(slug)}`, request.url).toString();
  return new Response(renderPreview(slug, summary, authorName, canonicalUrl), {
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}
