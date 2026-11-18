# Private gallery activity

Views and successful exports are collected privately, ready for future popularity
reporting. There are no public counters or Most viewed sort controls. Likes and
comments keep their existing behaviour.

## Deployment

Apply `supabase/migrations/0048_private_gallery_metrics.sql` before deploying the
client. The migration is re-runnable. No set-document schema change or artwork
migration is needed. A client without the RPC still works: recording errors are
silent and never block viewing or exporting.

Measurements start at deployment. Historical downloads are not reconstructed.
The legacy `sets.view_count` column remains for compatibility but is not updated;
`record_set_view` becomes a no-op for older clients. Existing values are hidden
in the gallery and author profiles. New counts never enter public set rows,
character views or summaries.

## Counting rules

- A view means opening published content, not seeing a gallery tile, prefetching
  a collection member or opening a card lightbox.
- Set identity is `(owner_id, local_id)`, shared by full publications and their
  separately published hero/villain slices. A full-set publication is not required
  for character visits to contribute to the parent total.
- Each browser contributes at most one view and one export per set per UTC day.
  Character targets and the villain side have their own deduplicated totals.
  Visiting multiple characters does not multiply the parent set total.
- Exports count after project/PNG/TTS generation and handoff to the download path,
  or after local TTS files are written. Cached shared TTS saves count too. This
  measures exports, not confirmation that a file was kept or a set was played.
- Failed exports, opening print sheets, authoring-library backups and making a
  library fork do not count. Browser print/cancel cannot distinguish a completed
  output reliably, so printing is excluded.
- Full, hero, villain and customized-selection exports have separate breakdowns,
  as do PNG, TTS and editable-project outputs. A published hero/villain slice is
  classified as that scope even if its picker says Whole set. Customized exports
  use `custom`; a selected hero still has its character target.
- Full-set exports contribute to the parent total, not every character's total.
  Successful collection PNG/TTS outputs contribute to each included public set.
- Only public, non-hidden listings are eligible. Unlisted/private content is not
  gallery activity. Known signed-in owners are skipped by the client; the RPC
  also rejects an authenticated owner's own event.

## Privacy and storage

`gallery_activity_daily` stores UTC daily aggregates. Anonymous users have no
table access. Authenticated users can read rows only if their existing profile
has `is_admin`; even admins cannot directly mutate counts. The service role can
administer the tables. Owners have no new statistics screen.

`record_gallery_activity` is the only visitor write path. It derives ownership
from a reachable public slug, validates character membership and activity/output
values, and returns no counts. Published documents, timestamps and revisions are
untouched.

A random browser key is replaced each UTC day in IndexedDB preferences. An atomic
transaction makes concurrent tabs share it. The server stores only a day-scoped
hash in `gallery_activity_receipts`; a unique constraint provides atomic
deduplication. Receipts older than two days are pruned on the next valid event.
Aggregates remain. No visitor account ID, IP address, user-agent or card content
is recorded.

Counts are approximate browser-days, not verified unique people. Clearing browser
storage, changing devices, blocked requests and offline use affect them. There is
no offline analytics outbox; rotating keys is not a complete anti-abuse system.
Monthly/yearly totals sum daily activity, without claiming to deduplicate one
person throughout the month/year.

## Reading private totals

Admins can read `gallery_activity_daily` through the authenticated Supabase API
or inspect it in the database. There is no new dashboard. For this month in UTC:

```sql
select owner_id, local_id,
       coalesce(sum(total) filter (where activity_kind = 'view'), 0) as views,
       coalesce(sum(total) filter (where activity_kind = 'export'), 0) as exports
from public.gallery_activity_daily
where target_key = 'set'
  and scope_key = 'all' and format_key = 'all'
  and activity_day >= date_trunc('month', now() at time zone 'UTC')::date
group by owner_id, local_id;
```

Remove the date condition for all-time, or use `year` instead of `month` for
year-to-date. Individual targets are `character:<character id>` or `villain-side`.

Breakdown rows overlap: someone exporting PNGs and TTS counts once in the headline
total and once in each format breakdown. Do not sum `all` rows with breakdowns or
expect the breakdown sum to equal the deduplicated headline count.

## Verification

The migration was run twice in a disposable PostgreSQL engine with minimal
fixtures for existing Supabase tables/auth roles. Checks covered repeat events,
parent/character aggregation, format/scope breakdowns, distinct visitors,
invalid/hidden/unlisted targets, owner exclusion, receipt pruning, anonymous
denial, non-admin row filtering, admin read-only access and unchanged public
counts/revisions.

Browser checks used the real Gallery, SharedSetScreen and ExportPanel against
synthetic local data: hidden non-zero legacy counts, full/character views,
successful project/PNG/shared TTS exports, repeated exports, failed preparation
and TTS download, and exporting while the metrics backend was stopped. Temporary
fixtures/dependencies were removed. No live metrics were changed.
