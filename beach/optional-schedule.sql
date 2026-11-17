-- Optional lightweight availability check from the separate Supabase Free project.
-- Install only after confirming the Render provider permits scheduled keepalive traffic.
-- This is NOT a guarantee of uptime: Render may still restart or suspend free services.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'pikachus-beach-check',
  '*/14 * * * *',
  $job$
    select net.http_get(
      url := 'https://pikachus-beach.onrender.com/api/health',
      timeout_milliseconds := 10000
    );
  $job$
);
-- Inspect cron.job_run_details, net._http_response and server health periodically.
-- Disable with: select cron.unschedule('pikachus-beach-check');
