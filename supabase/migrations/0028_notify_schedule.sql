-- Running the sender on a schedule.
--
-- The queue has been filling since 0022 and nothing has been reading it. This
-- is the reader: a cron job that pokes the edge function once a minute, which
-- drains whatever is owed and marks each row with what happened to it.
--
-- The scheduling is a *function* rather than a `cron.schedule` call written
-- out here, because scheduling it needs two things this repository must never
-- contain: the project's function URL and the shared secret that stops anyone
-- else calling it. `scripts/setup-notify.sh` calls this with the real values
-- once. The repo carries the mechanism; the secret lives in the cron row and
-- in the function's own environment, and nowhere else.
--
-- Until it is called, nothing sends and nothing breaks. The queue is a table
-- precisely so that a sender which does not exist yet costs nothing but delay.

create extension if not exists pg_net with schema extensions;

/**
 * Schedules — or reschedules — the minute-by-minute poke.
 *
 * Idempotent: unscheduling a job that is not there would raise, so it is
 * checked first, the same shape as the expiry sweep in 0005.
 *
 * One minute is the right interval for a reason worth writing down. This is a
 * notification about somebody drawing on a canvas, not a message: nobody is
 * waiting on it, and the difference between arriving now and arriving in sixty
 * seconds is nothing at all. What a minute buys is that the job is always
 * nearly empty, so one slow push never becomes a backlog.
 */
create or replace function public.schedule_notify(
  p_url    text,
  p_secret text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  job bigint;
begin
  if p_url is null or p_url !~ '^https://' then
    raise exception 'the function URL has to be https';
  end if;
  if p_secret is null or length(p_secret) < 16 then
    raise exception 'that secret is too short to be worth having';
  end if;

  if exists (select 1 from cron.job where jobname = 'longhand-notify') then
    perform cron.unschedule('longhand-notify');
  end if;

  select cron.schedule(
    'longhand-notify',
    '* * * * *',
    format(
      $cmd$select extensions.net.http_post(
             url     := %L,
             headers := jsonb_build_object(
                          'Content-Type',     'application/json',
                          'x-notify-secret',  %L),
             body    := '{}'::jsonb,
             timeout_milliseconds := 20000
           )$cmd$,
      p_url, p_secret)
  ) into job;

  return job;
end
$$;

/** Turns it off again, which has to be as easy as turning it on. */
create or replace function public.unschedule_notify()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from cron.job where jobname = 'longhand-notify') then
    perform cron.unschedule('longhand-notify');
    return true;
  end if;
  return false;
end
$$;

/**
 * What the operator needs to know without reading the cron row, which has the
 * secret in it. Counts only: how much is owed, how much has gone out, and what
 * has failed — the three numbers that say whether the sender is alive.
 */
create or replace function public.notify_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'scheduled',  exists (select 1 from cron.job where jobname = 'longhand-notify'),
    'pending',    (select count(*) from public.notifications where sent_at is null and failed is null),
    'sent',       (select count(*) from public.notifications where sent_at is not null),
    'failed',     (select count(*) from public.notifications where failed is not null),
    'oldest_pending', (select min(created_at) from public.notifications
                        where sent_at is null and failed is null),
    'subscriptions',  (select count(*) from public.push_subscriptions where failed_at is null),
    'retired',        (select count(*) from public.push_subscriptions where failed_at is not null)
  )
$$;

revoke execute on function public.schedule_notify(text, text) from public, anon, authenticated;
revoke execute on function public.unschedule_notify() from public, anon, authenticated;
revoke execute on function public.notify_health() from public, anon, authenticated;

grant execute on function public.schedule_notify(text, text) to service_role;
grant execute on function public.unschedule_notify() to service_role;
grant execute on function public.notify_health() to service_role;

comment on function public.schedule_notify(text, text) is
  'Schedules the notification sender. Called by scripts/setup-notify.sh with '
  'the project URL and the shared secret, which are deliberately not in this '
  'repository.';
