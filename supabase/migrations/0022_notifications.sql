-- The return hook.
--
-- The relay has never had a way to pull anyone back. Somebody draws, submits,
-- and that is the end of it — the canvas they are part of finishes weeks later
-- and nothing tells them. That is the largest structural gap in the product
-- and it is why the review screen currently has to say "keep the link", which
-- is honest rather than good.
--
-- Two moments are worth a notification and no others:
--
--   added   somebody drew on a canvas you are part of
--   closed  a canvas you are part of finished, and there is something to see
--
-- Not "somebody looked at it", not "it has been a while", not a digest, not a
-- weekly summary. Two events that are genuinely about your work, and a way to
-- turn them off. Anything more and this becomes an app that pesters people,
-- which is the opposite of the thing being built.
--
-- The queue is a table rather than a direct send, because a trigger that makes
-- an HTTP call is a trigger that can fail a player's submit. Writing a row is
-- the only thing that happens inside the transaction; something else picks it
-- up afterwards.

-- ------------------------------------------------------------ subscriptions

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  signature_id uuid not null references public.signatures (id) on delete restrict,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  created_at   timestamptz not null default now(),
  -- Set when the push service says the endpoint is gone. Kept rather than
  -- deleted so a browser that comes back can be recognised.
  failed_at    timestamptz
);

create index if not exists push_by_signature
  on public.push_subscriptions (signature_id) where failed_at is null;

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

/**
 * Registers a browser for push.
 *
 * Bound to the signature that browser holds, so a notification about a canvas
 * goes to the hand that drew on it rather than to a device. The subscription
 * itself is the browser's — endpoint, and the two keys the push service needs
 * — and is never readable by any client.
 */
create or replace function public.subscribe_push(
  p_signature  uuid,
  p_device_key text,
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.owns_signature(p_signature, p_device_key) then
    raise exception 'that mark does not belong to this browser';
  end if;
  if coalesce(length(p_endpoint), 0) < 12 then
    raise exception 'that is not a push endpoint';
  end if;

  insert into public.push_subscriptions (signature_id, endpoint, p256dh, auth)
  values (p_signature, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set signature_id = excluded.signature_id,
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        failed_at    = null;

  return true;
end
$$;

/** Turning it off has to be as easy as turning it on, and has to work from the
 *  device that is being pestered rather than only from the one that opted in. */
create or replace function public.unsubscribe_push(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  delete from public.push_subscriptions where endpoint = p_endpoint;
  get diagnostics n = row_count;
  return n > 0;
end
$$;

revoke execute on function public.subscribe_push(uuid, text, text, text, text) from public;
revoke execute on function public.unsubscribe_push(text) from public;
grant execute on function public.subscribe_push(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.unsubscribe_push(text) to anon, authenticated;

-- ------------------------------------------------------------------- queue

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  signature_id uuid not null references public.signatures (id) on delete restrict,
  canvas_id    uuid not null references public.canvases (id) on delete restrict,
  kind         text not null check (kind in ('added', 'closed')),
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  -- Why it was never sent, when it wasn't. A queue that silently drops is a
  -- queue nobody can debug at the moment it matters.
  failed       text
);

-- One notification per person per canvas per kind. A twelve fills up over
-- weeks and eleven separate "somebody drew" pushes for the same canvas is how
-- an app gets muted.
create unique index if not exists notifications_once
  on public.notifications (signature_id, canvas_id, kind);

create index if not exists notifications_pending
  on public.notifications (created_at) where sent_at is null and failed is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;

/**
 * Enqueues, inside the transaction that caused it, and does nothing else.
 *
 * A trigger that made an HTTP call would put a push service on the critical
 * path of somebody submitting a drawing, which is the one operation in this
 * product that must not fail for an unrelated reason.
 */
create or replace function public.layers_notify()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  c     public.canvases;
  filled int;
begin
  select * into c from public.canvases where id = new.canvas_id;
  select count(*) into filled from public.layers where canvas_id = new.canvas_id;

  -- The hand that fills the last slot says something better a moment later, so
  -- it does not also say this. Two pushes about one event is how an app gets
  -- muted, and "somebody drew" is strictly worse news than "it is finished".
  if filled >= c.slot_count then
    return new;
  end if;

  insert into public.notifications (signature_id, canvas_id, kind)
  select distinct l.signature_id, new.canvas_id, 'added'
    from public.layers l
   where l.canvas_id = new.canvas_id
     and l.signature_id <> new.signature_id
  on conflict do nothing;

  return new;
end
$$;

/**
 * The closing notification, hung off the canvas rather than the layer.
 *
 * It has to fire when the status actually changes, which happens in a separate
 * statement inside `submit_turn` after the layer lands. Watching the layer
 * insert instead would mean reading a canvas row that has not been updated yet
 * — the bug that made the first version of this fire on a canvas it thought
 * was still open.
 */
create or replace function public.canvases_notify_closed()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    insert into public.notifications (signature_id, canvas_id, kind)
    select distinct l.signature_id, new.id, 'closed'
      from public.layers l
     where l.canvas_id = new.id
    on conflict do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists layers_notify_trg on public.layers;
create trigger layers_notify_trg
  after insert on public.layers
  for each row execute function public.layers_notify();

drop trigger if exists canvases_notify_closed_trg on public.canvases;
create trigger canvases_notify_closed_trg
  after update on public.canvases
  for each row execute function public.canvases_notify_closed();

revoke execute on function public.layers_notify() from public, anon, authenticated;
revoke execute on function public.canvases_notify_closed()
  from public, anon, authenticated;

/**
 * What the sender reads. Service-role only, and it hands back everything a
 * push needs in one call so the worker does no joins and holds no schema
 * knowledge of its own.
 */
create or replace function public.pending_notifications(p_limit int default 100)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row), '[]'::jsonb) from (
    select jsonb_build_object(
             'id',       n.id,
             'kind',     n.kind,
             'canvas',   n.canvas_id,
             'seed',     c.seed_word,
             'slots',    c.slot_count,
             'filled',   c.slots_filled,
             'endpoint', s.endpoint,
             'p256dh',   s.p256dh,
             'auth',     s.auth
           ) as row
      from public.notifications n
      join public.canvases c on c.id = n.canvas_id
      join public.push_subscriptions s
        on s.signature_id = n.signature_id and s.failed_at is null
     where n.sent_at is null and n.failed is null
     order by n.created_at
     limit p_limit
  ) q
$$;

/** Marks the result of one send. `p_gone` retires an endpoint the push service
 *  has told us no longer exists, which is the normal end of a subscription. */
create or replace function public.mark_notification(
  p_id       uuid,
  p_sent     boolean,
  p_error    text default null,
  p_endpoint text default null,
  p_gone     boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications
     set sent_at = case when p_sent then now() else null end,
         failed  = case when p_sent then null else coalesce(p_error, 'unknown') end
   where id = p_id;

  if p_gone and p_endpoint is not null then
    update public.push_subscriptions set failed_at = now() where endpoint = p_endpoint;
  end if;
end
$$;

revoke execute on function public.pending_notifications(int) from public, anon, authenticated;
revoke execute on function public.mark_notification(uuid, boolean, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.pending_notifications(int) to service_role;
grant execute on function public.mark_notification(uuid, boolean, text, text, boolean)
  to service_role;

-- Backfill deliberately skipped. Everyone already in the archive drew before
-- any of this existed and never asked to hear from it; a first notification
-- about a canvas somebody finished with weeks ago would be the worst possible
-- introduction to the feature.
