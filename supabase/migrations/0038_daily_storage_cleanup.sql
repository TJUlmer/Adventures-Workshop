-- Run the guarded Storage cleanup once per day.
--
-- Provision these two secrets before applying this migration:
--   * storage_cleanup_project_url in Supabase Vault
--   * storage_cleanup_cron_token in both Supabase Vault and Edge Function secrets
--
-- The cron token is purpose-specific. The Edge Function continues to use its
-- injected project secret internally for service-role database and Storage work.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'storage_cleanup_project_url'
  ) then
    raise exception 'Vault secret storage_cleanup_project_url must be created first';
  end if;

  if not exists (
    select 1 from vault.secrets where name = 'storage_cleanup_cron_token'
  ) then
    raise exception 'Vault secret storage_cleanup_cron_token must be created first';
  end if;

  perform cron.unschedule(jobid)
    from cron.job
   where jobname = 'storage-cleanup-daily';

  perform cron.schedule(
    'storage-cleanup-daily',
    '20 9 * * *',
    $command$
      select net.http_post(
        url := (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'storage_cleanup_project_url'
        ) || '/functions/v1/storage-cleanup',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            select decrypted_secret
              from vault.decrypted_secrets
             where name = 'storage_cleanup_cron_token'
          )
        ),
        body := '{"dryRun":false,"limit":500}'::jsonb,
        timeout_milliseconds := 120000
      ) as request_id;
    $command$
  );
end;
$$;
