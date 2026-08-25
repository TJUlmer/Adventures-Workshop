-- ---------------------------------------------------------------------------
-- A published row carries its own link-preview image, separate from its tile
-- ---------------------------------------------------------------------------
--
-- `thumbnail_url` is a plain downscale of whatever artwork `coverArtwork`
-- finds — right for a small square gallery tile, wrong for a Discord/Slack
-- link preview, which posted the raw bleed-inclusive deck-back replacement
-- image undistinguished from a finished card. `social_image_url` is a second,
-- purpose-built picture: a trimmed render of the set's own cards (a hero's
-- deck back plus their character card for a one-hero set, a grid of deck
-- backs for several), composed at publish time by `cloud/social-image.ts`.
-- `thumbnail_url` is untouched and keeps doing the gallery-tile job alone.

alter table public.sets
  add column if not exists social_image_url text not null default '';

-- No RLS change: orthogonal to `owner_id`/`visibility`/`hidden`, same as
-- `kind` in 0009.
--
-- No backfill, and this one genuinely cannot have one the way `kind` did in
-- 0010 — that backfill read a fact already sitting in the stored `document`;
-- this column holds a *rendered picture*, which only the browser's own card
-- stage can produce, and a migration is SQL running on the server with no
-- DOM to rasterise anything in. A row published before this migration simply
-- keeps `''` until its author republishes; `middleware.ts` falls back to
-- `thumbnail_url` whenever this is empty, so an old link's preview does not
-- regress, only stays as it was. Only the *columns the app selects*
-- (`SUMMARY_COLUMNS` in `cloud/sets.ts`) need this added for the client to
-- read it back — `set_by_slug` already returns `select *` and needs nothing.
