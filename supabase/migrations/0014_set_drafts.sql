-- Private, revision-safe cloud drafts.
--
-- Published rows remain explicit snapshots in `public.sets`. A draft is the
-- author's editable source document, so it has a separate private table and a
-- private Storage bucket. IndexedDB remains the client cache and offline
-- outbox; nothing in this migration changes or removes local documents.

-- ---------------------------------------------------------------------------
-- Drafts and their Home-screen summaries
-- ---------------------------------------------------------------------------

create table if not exists public.set_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  local_id text not null check (length(local_id) > 0),

  name text not null,
  subtitle text not null default '',
  kind text not null check (kind in ('adventure', 'heroes')),
  card_count integer not null default 0 check (card_count >= 0),
  character_count integer not null default 0 check (character_count >= 0),
  characters jsonb not null default '[]'::jsonb
    check (jsonb_typeof(characters) = 'array'),
  blockers integer not null default 0 check (blockers >= 0),
  gaps integer not null default 0 check (gaps >= 0),
  issue_count integer not null default 0 check (issue_count >= 0),

  /*
   * Shelf-only fork lineage. The complete `SetOrigin` remains in `document`;
   * these three values are a display/index contract, never authority.
   */
  origin_author text,
  origin_revision bigint check (origin_revision is null or origin_revision > 0),
  origin_slug text,

  /*
   * `document_updated_at` belongs to the portable document and controls Home's
   * ordering. `updated_at` belongs to this cloud row. Keeping them distinct is
   * what stops first migration making every old project look newly edited.
   */
  document_updated_at timestamptz not null,
  schema_version integer not null check (schema_version > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (owner_id, local_id),

  constraint set_drafts_origin_all_or_none check (
    num_nonnulls(origin_author, origin_revision, origin_slug) in (0, 3)
  ),
  constraint set_drafts_document_format check (
    (document ->> 'format' = 'adventures-workshop-set') is true
    and (jsonb_typeof(document -> 'schemaVersion') = 'number') is true
    and ((document ->> 'schemaVersion')::integer = schema_version) is true
    and (jsonb_typeof(document -> 'set') = 'object') is true
    and (document -> 'set' ->> 'id' = local_id) is true
    and (jsonb_typeof(document -> 'set' -> 'schemaVersion') = 'number') is true
    and ((document -> 'set' ->> 'schemaVersion')::integer = schema_version) is true
  )
);

create index if not exists set_drafts_owner_active_idx
  on public.set_drafts (owner_id, document_updated_at desc)
  where deleted_at is null;

create index if not exists set_drafts_owner_deleted_idx
  on public.set_drafts (owner_id, deleted_at desc)
  where deleted_at is not null;

alter table public.set_drafts enable row level security;

/*
 * Reads are the only direct client operation. Every mutation goes through a
 * narrow revision-aware function below, so a broad table grant can never turn
 * a newly-added column into client-owned state by accident.
 */
drop policy if exists set_drafts_owner_read on public.set_drafts;
create policy set_drafts_owner_read on public.set_drafts
  for select to authenticated
  using (
    owner_id = auth.uid()
    and (auth.jwt() ->> 'is_anonymous')::boolean is not true
  );

revoke all on public.set_drafts from anon, authenticated;
grant select on public.set_drafts to authenticated;

-- ---------------------------------------------------------------------------
-- Revision-safe writes
-- ---------------------------------------------------------------------------

/*
 * Save one complete generation and its denormalised summary atomically.
 *
 * A null expected revision means "create" and only inserts when no row with
 * this local id exists. An integer means "replace the active generation I
 * read" and updates only that exact revision. A stale or missing generation
 * returns `conflict` with whatever owner-visible state still exists; it never
 * falls through to a last-write-wins upsert.
 */
create or replace function public.save_set_draft(
  p_local_id text,
  p_name text,
  p_subtitle text,
  p_kind text,
  p_card_count integer,
  p_character_count integer,
  p_characters jsonb,
  p_blockers integer,
  p_gaps integer,
  p_issue_count integer,
  p_origin_author text,
  p_origin_revision bigint,
  p_origin_slug text,
  p_document_updated_at timestamptz,
  p_schema_version integer,
  p_document jsonb,
  p_expected_revision bigint
)
returns table (
  outcome text,
  draft_id uuid,
  revision bigint,
  document_updated_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  saved public.set_drafts%rowtype;
begin
  if caller is null then
    raise exception 'Permanent sign-in required.' using errcode = '42501';
  end if;

  if (auth.jwt() ->> 'is_anonymous')::boolean is true then
    raise exception 'Permanent sign-in required.' using errcode = '42501';
  end if;

  if p_expected_revision is not null and p_expected_revision < 1 then
    raise exception 'Expected revision must be null or positive.' using errcode = '22023';
  end if;

  if p_expected_revision is null then
    insert into public.set_drafts (
      owner_id,
      local_id,
      name,
      subtitle,
      kind,
      card_count,
      character_count,
      characters,
      blockers,
      gaps,
      issue_count,
      origin_author,
      origin_revision,
      origin_slug,
      document_updated_at,
      schema_version,
      document
    )
    values (
      caller,
      p_local_id,
      p_name,
      p_subtitle,
      p_kind,
      p_card_count,
      p_character_count,
      p_characters,
      p_blockers,
      p_gaps,
      p_issue_count,
      p_origin_author,
      p_origin_revision,
      p_origin_slug,
      p_document_updated_at,
      p_schema_version,
      p_document
    )
    on conflict (owner_id, local_id) do nothing
    returning * into saved;
  else
    update public.set_drafts as draft
    set name = p_name,
        subtitle = p_subtitle,
        kind = p_kind,
        card_count = p_card_count,
        character_count = p_character_count,
        characters = p_characters,
        blockers = p_blockers,
        gaps = p_gaps,
        issue_count = p_issue_count,
        origin_author = p_origin_author,
        origin_revision = p_origin_revision,
        origin_slug = p_origin_slug,
        document_updated_at = p_document_updated_at,
        schema_version = p_schema_version,
        document = p_document,
        revision = draft.revision + 1,
        updated_at = now()
    where draft.owner_id = caller
      and draft.local_id = p_local_id
      and draft.revision = p_expected_revision
      and draft.deleted_at is null
    returning draft.* into saved;
  end if;

  if saved.id is not null then
    return query select
      'saved'::text,
      saved.id,
      saved.revision,
      saved.document_updated_at,
      saved.updated_at,
      saved.deleted_at;
    return;
  end if;

  return query
  select
    'conflict'::text,
    draft.id,
    draft.revision,
    draft.document_updated_at,
    draft.updated_at,
    draft.deleted_at
  from public.set_drafts as draft
  where draft.owner_id = caller and draft.local_id = p_local_id;

  if not found then
    return query select
      'conflict'::text,
      null::uuid,
      null::bigint,
      null::timestamptz,
      null::timestamptz,
      null::timestamptz;
  end if;
end;
$$;

revoke execute on function public.save_set_draft(
  text, text, text, text, integer, integer, jsonb, integer, integer, integer,
  text, bigint, text, timestamptz, integer, jsonb, bigint
) from public, anon, authenticated;
grant execute on function public.save_set_draft(
  text, text, text, text, integer, integer, jsonb, integer, integer, integer,
  text, bigint, text, timestamptz, integer, jsonb, bigint
) to authenticated;

/*
 * Soft deletion is part of the synchronised state, so it consumes a revision
 * just like a document save. It deliberately leaves `document_updated_at`
 * alone: moving a set to Recently Deleted is not an edit to the set itself.
 */
create or replace function public.soft_delete_set_draft(
  p_local_id text,
  p_expected_revision bigint
)
returns table (
  outcome text,
  draft_id uuid,
  revision bigint,
  document_updated_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  changed public.set_drafts%rowtype;
begin
  if caller is null or (auth.jwt() ->> 'is_anonymous')::boolean is true then
    raise exception 'Permanent sign-in required.' using errcode = '42501';
  end if;

  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'Expected revision must be positive.' using errcode = '22023';
  end if;

  update public.set_drafts as draft
  set deleted_at = now(),
      revision = draft.revision + 1,
      updated_at = now()
  where draft.owner_id = caller
    and draft.local_id = p_local_id
    and draft.revision = p_expected_revision
    and draft.deleted_at is null
  returning draft.* into changed;

  if changed.id is not null then
    return query select
      'deleted'::text,
      changed.id,
      changed.revision,
      changed.document_updated_at,
      changed.updated_at,
      changed.deleted_at;
    return;
  end if;

  return query
  select
    'conflict'::text,
    draft.id,
    draft.revision,
    draft.document_updated_at,
    draft.updated_at,
    draft.deleted_at
  from public.set_drafts as draft
  where draft.owner_id = caller and draft.local_id = p_local_id;

  if not found then
    return query select
      'not_found'::text,
      null::uuid,
      null::bigint,
      null::timestamptz,
      null::timestamptz,
      null::timestamptz;
  end if;
end;
$$;

revoke execute on function public.soft_delete_set_draft(text, bigint)
  from public, anon, authenticated;
grant execute on function public.soft_delete_set_draft(text, bigint) to authenticated;

create or replace function public.restore_set_draft(
  p_local_id text,
  p_expected_revision bigint
)
returns table (
  outcome text,
  draft_id uuid,
  revision bigint,
  document_updated_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  changed public.set_drafts%rowtype;
begin
  if caller is null or (auth.jwt() ->> 'is_anonymous')::boolean is true then
    raise exception 'Permanent sign-in required.' using errcode = '42501';
  end if;

  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'Expected revision must be positive.' using errcode = '22023';
  end if;

  update public.set_drafts as draft
  set deleted_at = null,
      revision = draft.revision + 1,
      updated_at = now()
  where draft.owner_id = caller
    and draft.local_id = p_local_id
    and draft.revision = p_expected_revision
    and draft.deleted_at is not null
  returning draft.* into changed;

  if changed.id is not null then
    return query select
      'restored'::text,
      changed.id,
      changed.revision,
      changed.document_updated_at,
      changed.updated_at,
      changed.deleted_at;
    return;
  end if;

  return query
  select
    'conflict'::text,
    draft.id,
    draft.revision,
    draft.document_updated_at,
    draft.updated_at,
    draft.deleted_at
  from public.set_drafts as draft
  where draft.owner_id = caller and draft.local_id = p_local_id;

  if not found then
    return query select
      'not_found'::text,
      null::uuid,
      null::bigint,
      null::timestamptz,
      null::timestamptz,
      null::timestamptz;
  end if;
end;
$$;

revoke execute on function public.restore_set_draft(text, bigint)
  from public, anon, authenticated;
grant execute on function public.restore_set_draft(text, bigint) to authenticated;

/* Delete forever is only reachable for a row already in Recently Deleted. */
create or replace function public.purge_set_draft(
  p_local_id text,
  p_expected_revision bigint
)
returns table (
  outcome text,
  draft_id uuid,
  revision bigint,
  document_updated_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  removed public.set_drafts%rowtype;
begin
  if caller is null or (auth.jwt() ->> 'is_anonymous')::boolean is true then
    raise exception 'Permanent sign-in required.' using errcode = '42501';
  end if;

  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'Expected revision must be positive.' using errcode = '22023';
  end if;

  delete from public.set_drafts as draft
  where draft.owner_id = caller
    and draft.local_id = p_local_id
    and draft.revision = p_expected_revision
    and draft.deleted_at is not null
  returning draft.* into removed;

  if removed.id is not null then
    return query select
      'purged'::text,
      removed.id,
      removed.revision,
      removed.document_updated_at,
      removed.updated_at,
      removed.deleted_at;
    return;
  end if;

  return query
  select
    'conflict'::text,
    draft.id,
    draft.revision,
    draft.document_updated_at,
    draft.updated_at,
    draft.deleted_at
  from public.set_drafts as draft
  where draft.owner_id = caller and draft.local_id = p_local_id;

  if not found then
    return query select
      'not_found'::text,
      null::uuid,
      null::bigint,
      null::timestamptz,
      null::timestamptz,
      null::timestamptz;
  end if;
end;
$$;

revoke execute on function public.purge_set_draft(text, bigint)
  from public, anon, authenticated;
grant execute on function public.purge_set_draft(text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Private draft assets
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('draft-assets', 'draft-assets', false)
on conflict (id) do update set public = false;

/*
 * Objects are `<owner>/<local-set-id>/<content-hash>.<extension>`. Uploads may
 * precede the document row, so policy cannot require that the set already
 * exists; the permanent caller's owner prefix is the security boundary.
 */
drop policy if exists draft_assets_read on storage.objects;
create policy draft_assets_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'draft-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] is not null
    and (auth.jwt() ->> 'is_anonymous')::boolean is not true
  );

drop policy if exists draft_assets_write on storage.objects;
create policy draft_assets_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'draft-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] is not null
    and (auth.jwt() ->> 'is_anonymous')::boolean is not true
  );

drop policy if exists draft_assets_update on storage.objects;
create policy draft_assets_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'draft-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] is not null
    and (auth.jwt() ->> 'is_anonymous')::boolean is not true
  )
  with check (
    bucket_id = 'draft-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] is not null
    and (auth.jwt() ->> 'is_anonymous')::boolean is not true
  );

drop policy if exists draft_assets_delete on storage.objects;
create policy draft_assets_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'draft-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] is not null
    and (auth.jwt() ->> 'is_anonymous')::boolean is not true
  );

-- ---------------------------------------------------------------------------
-- Catalogue assertions
-- ---------------------------------------------------------------------------

do $$
begin
  if has_table_privilege('anon', 'public.set_drafts', 'SELECT')
     or has_table_privilege('anon', 'public.set_drafts', 'INSERT')
     or has_table_privilege('anon', 'public.set_drafts', 'UPDATE')
     or has_table_privilege('anon', 'public.set_drafts', 'DELETE')
     or has_table_privilege('authenticated', 'public.set_drafts', 'INSERT')
     or has_table_privilege('authenticated', 'public.set_drafts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.set_drafts', 'DELETE')
     or not has_table_privilege('authenticated', 'public.set_drafts', 'SELECT') then
    raise exception 'Draft relation grants do not match the private RPC boundary.';
  end if;

  if has_function_privilege(
       'anon',
       'public.save_set_draft(text,text,text,text,integer,integer,jsonb,integer,integer,integer,text,bigint,text,timestamptz,integer,jsonb,bigint)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.save_set_draft(text,text,text,text,integer,integer,jsonb,integer,integer,integer,text,bigint,text,timestamptz,integer,jsonb,bigint)',
       'EXECUTE'
     )
     or has_function_privilege('anon', 'public.soft_delete_set_draft(text,bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.restore_set_draft(text,bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.purge_set_draft(text,bigint)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.soft_delete_set_draft(text,bigint)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.restore_set_draft(text,bigint)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.purge_set_draft(text,bigint)', 'EXECUTE') then
    raise exception 'Draft function grants do not match the permanent-account boundary.';
  end if;

  if (select bucket.public from storage.buckets as bucket where bucket.id = 'draft-assets')
     is distinct from false then
    raise exception 'The draft-assets bucket is not private.';
  end if;
end;
$$;
