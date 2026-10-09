-- The hourly schedule was temporary capacity for clearing the accumulated
-- cleanup backlog. Once caught up, six-hour batches retain ample headroom for
-- normal activity without invoking the Edge Function unnecessarily.

do $$
begin
  perform cron.unschedule(jobid)
    from cron.job
   where jobname in (
     'storage-cleanup-daily',
     'storage-cleanup-hourly',
     'storage-cleanup-six-hourly'
   );

  perform cron.schedule(
    'storage-cleanup-six-hourly',
    '20 */6 * * *',
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
