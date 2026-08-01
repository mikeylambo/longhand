-- The expiry sweep, on a schedule.
--
-- `claim_turn` already sweeps opportunistically, so the loop cannot deadlock
-- behind an abandoned turn even with no scheduler running. This exists so a
-- slot comes back to the pool on time rather than whenever the next player
-- happens to arrive — which matters most precisely when nobody is arriving.

create extension if not exists pg_cron with schema cron;

-- Idempotent: unscheduling a job that isn't there would raise.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'longhand-sweep-turns') then
    perform cron.unschedule('longhand-sweep-turns');
  end if;
end $$;

select cron.schedule(
  'longhand-sweep-turns',
  '* * * * *',
  $$select public.sweep_expired_turns()$$
);
