-- Keep cleanup batches comfortably inside pg_net's two-minute request limit.
--
-- The original daily job asked the Edge Function to process as many as 500
-- objects. That worked while the candidate ledger was small, but a normal
-- retention rollover eventually produced a batch large enough for pg_net to
-- time out before the function could finish. One hundred objects each hour
-- raises daily capacity from 500 to 2,400 while making each invocation much
-- less likely to lose its caller halfway through deletion.

do $$
begin
  perform cron.unschedule(jobid)
    from cron.job
   where jobname in ('storage-cleanup-daily', 'storage-cleanup-hourly');

  perform cron.schedule(
    'storage-cleanup-hourly',
    '20 * * * *',
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
        body := '{"dryRun":false,"limit":100}'::jsonb,
        timeout_milliseconds := 120000
      ) as request_id;
    $command$
  );
end;
$$;
