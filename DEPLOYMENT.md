# Deployment

Vercel, from GitHub, with preview builds on every branch.

The app is a static bundle — no server, no serverless functions — so most of
this is Vercel's defaults being right. What follows is the parts that are not
obvious, and the two that fail *silently* if they are missed.

## Vercel project settings

Nothing to configure. Vercel detects Vite and gets all three right:

| | |
|---|---|
| Framework | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |
| Install command | `npm install` |

There is deliberately **no `vercel.json`**. A file that only restates what is
already detected is a second copy of the truth to keep correct, and the usual
reason for one — an SPA rewrite so deep links reach `index.html` — does not
apply here: the app routes on the **hash** (`#/shared/<slug>`), which the server
never sees. That was chosen so the build could be dropped anywhere, including
`file://`, and it is why hosting needs no rewrite rules.

## Environment variables

Set both, for **Production, Preview and Development**:

    VITE_SUPABASE_URL
    VITE_SUPABASE_PUBLISHABLE_KEY

Ticking Preview is the part that gets missed, and the failure is quiet:
`cloud/config.ts` returns `null` when either is absent and the whole app
switches sharing off rather than erroring. A preview build with no variables
does not break — it just has no gallery, no publishing and no sign-in, which
looks like a regression in the feature you were previewing.

The publishable key ships inside the bundle. That is expected: it identifies
the project and authorises nothing. Row level security is the boundary. A key
beginning `sb_secret_` would be a full compromise sitting in a JavaScript file,
which is why `config.ts` refuses to start on one.

## Supabase, for preview URLs

This is the one that actually breaks previews, because every deployment gets a
different hostname and Supabase refuses to redirect to a host it does not know.

In **Authentication → URL Configuration**:

- **Site URL** — the production domain.
- **Redirect URLs** — add a wildcard covering preview hostnames as well as the
  production one:

      https://<project>.vercel.app/**
      https://<project>-*.vercel.app/**

The second entry is what matters. Vercel names branch deployments
`<project>-git-<branch>-<scope>.vercel.app` and individual ones
`<project>-<hash>-<scope>.vercel.app`, so a single glob covers both and every
future branch. Without it, "Continue with Discord" from a preview returns to a
refused redirect and the sign-in silently fails.

`signInWithProvider` sends `redirect_to=window.location.href` — the current URL
including its hash — so the `/**` suffix is doing real work.

**Discord and Google need no per-preview change.** Their OAuth apps redirect to
Supabase's own callback, `https://<ref>.supabase.co/auth/v1/callback`, which is
one fixed URL whatever host the app is served from. That is worth knowing
because it is the first place anyone looks.

## Previews share the production database

A preview build points at the same Supabase project as production, so a set
published from a branch appears in the real gallery, and a migration applied
while testing is applied to live data.

For most branches that is fine and simpler than the alternative. If a branch is
going to write rubbish or change the schema, either use a second Supabase
project and override the two variables for Preview, or use Supabase's branching
so the preview gets its own database. Worth deciding *before* the branch that
needs it, not during.

## The build gate is strict, on purpose

`npm run build` is `npm run check && vite build`, so **any** `svelte-check`
output fails the deployment — an unused import is a failed deploy, not a
warning. That is the same gate as locally and it is the intended behaviour:
`tsconfig.json` turns on `noUnusedLocals`, `noUnusedParameters` and
`noUncheckedIndexedAccess` for the same reason.

Run `npm run check` before pushing and a preview will not surprise you.

## What is not in a production build

The `exports-folder` plugin in `vite.config.ts` is `apply: 'serve'` — dev only.
It is what writes a Tabletop Simulator bundle straight into `exports/` so TTS
can reach the images by URL. In a deployed build that endpoint does not exist,
`findExportsFolder` gets nothing, and the exporter falls back to a `.zip` with
the image URLs left blank. That is by design; nothing else in the app may depend
on that endpoint.

## Never commit

`.gitignore` covers `.env*` (except the example), `.vercel`, and two files that
live beside the project and hold real credentials — `OAuth2.txt` and
`recovery-codes.md`. They were committed once before the repo had a remote and
had to be taken back out. Nothing that opens an account belongs in a repository,
however convenient it is to keep it next to the thing it configures.
