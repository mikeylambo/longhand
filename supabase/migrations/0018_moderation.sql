-- The moderation floor.
--
-- Once strangers draw, somebody draws something that should not stay in the
-- archive. The tools have to exist before that happens rather than be built
-- in the hour it does, so this is the smallest set that is genuinely enough:
--
--   report        anyone, one tap, no form and no text field
--   hide a layer  the work stays in the ledger and stops being served
--   unlist        the canvas keeps its URL and leaves the gallery
--   a queue       reports in one place, not scattered across the database
--
-- Nothing here deletes anything, including the reports. `layers.hidden` and
-- `canvases.listed` already existed and are already the only two levers; what
-- was missing was a way for a stranger to point at something and a way for the
-- operator to find it afterwards.
--
-- No peer review, no community moderation, no earn-your-turn-by-judging. Those
-- need a population and this needs to exist before there is one.

-- ------------------------------------------------------------------ reports

create table if not exists public.reports (
  id         uuid primary key default gen_random_uuid(),
  canvas_id  uuid not null references public.canvases (id) on delete restrict,
  -- Null means "this canvas", which is what the button during a turn sends:
  -- a player halfway through drawing can see something wrong without being
  -- asked to work out which of eleven hands put it there.
  layer_id   uuid references public.layers (id) on delete restrict,
  -- The reporting browser. Never served to a client — it exists to collapse
  -- duplicates and to make a flood of reports from one device visible as one
  -- device rather than as consensus.
  device_key text not null,
  created_at timestamptz not null default now(),
  -- Set when the operator has looked. Reports are never deleted, so the queue
  -- is a record of what was raised, not only of what is outstanding.
  resolved_at timestamptz,
  resolution  text check (resolution in ('hidden', 'unlisted', 'dismissed'))
);

-- One report per browser per thing. A second tap is a no-op rather than a
-- second vote, so nobody can manufacture weight by tapping.
create unique index if not exists reports_once_per_canvas
  on public.reports (device_key, canvas_id) where layer_id is null;
create unique index if not exists reports_once_per_layer
  on public.reports (device_key, layer_id) where layer_id is not null;

create index if not exists reports_open_idx
  on public.reports (created_at desc) where resolved_at is null;

alter table public.reports enable row level security;

-- No policy at all: reports are written by the definer function below and read
-- by the operator. A client can neither read them nor write them directly.
revoke all on public.reports from anon, authenticated;

-- ------------------------------------------------------------ what was done

-- Every hide, unhide and unlist, kept. The archive's promise is that nothing
-- vanishes without a trace, and that has to include the moderation itself —
-- otherwise "we only ever hide" is a claim with no record behind it.
create table if not exists public.moderation_actions (
  id        uuid primary key default gen_random_uuid(),
  action    text not null check (action in ('hide', 'unhide', 'unlist', 'list', 'dismiss')),
  canvas_id uuid references public.canvases (id) on delete restrict,
  layer_id  uuid references public.layers (id) on delete restrict,
  note      text,
  acted_at  timestamptz not null default now()
);

alter table public.moderation_actions enable row level security;
revoke all on public.moderation_actions from anon, authenticated;

-- ------------------------------------------------------------- the report rpc

/**
 * One tap. No form, no text field, no category — the drawing is the only
 * channel this product has, and a free-text reason would be a message box by
 * another name.
 *
 * Always returns true for a well-formed report. A duplicate is collapsed and a
 * device past the hourly cap is dropped, and neither is reported back: the
 * button is a single tap that says "reported", and telling one browser it has
 * been rate-limited only tells it how to spread its taps around. Malformed
 * input — a canvas that does not exist, a layer on a different canvas — still
 * raises, because that is a bug in the client rather than abuse.
 */
create or replace function public.report_content(
  p_canvas     uuid,
  p_layer      uuid,
  p_device_key text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  if p_device_key is null or length(p_device_key) < 8 then
    raise exception 'a device key is required to report';
  end if;
  if not exists (select 1 from public.canvases where id = p_canvas) then
    raise exception 'no such canvas';
  end if;
  if p_layer is not null and not exists (
    select 1 from public.layers where id = p_layer and canvas_id = p_canvas
  ) then
    raise exception 'that layer is not on that canvas';
  end if;

  select count(*) into recent
    from public.reports
   where device_key = p_device_key
     and created_at > now() - interval '1 hour';

  if recent >= 30 then
    return true;
  end if;

  insert into public.reports (canvas_id, layer_id, device_key)
  values (p_canvas, p_layer, p_device_key)
  on conflict do nothing;

  return true;
end
$$;

revoke execute on function public.report_content(uuid, uuid, text) from public;
grant execute on function public.report_content(uuid, uuid, text) to anon, authenticated;

comment on function public.report_content(uuid, uuid, text) is
  'Records a report. SECURITY DEFINER and anon-executable on purpose: v1 has no accounts. One report per device per target; silently drops duplicates and floods.';

-- --------------------------------------------------------------- the queue

/**
 * Everything outstanding, one row per reported thing, worst first.
 *
 * `security_invoker` matters here: a view in `public` otherwise runs with its
 * owner's rights, which would make it a hole straight through the RLS on
 * `reports`. With it on, the view is only as readable as the caller, and the
 * caller is meant to be the operator.
 */
create or replace view public.moderation_queue
with (security_invoker = true) as
select
  r.canvas_id,
  r.layer_id,
  count(*)                          as reports,
  min(r.created_at)                 as first_reported,
  max(r.created_at)                 as last_reported,
  count(distinct r.device_key)      as devices,
  c.seed_word,
  c.status,
  c.listed,
  c.slot_count,
  l.slot_index,
  l.hidden
from public.reports r
join public.canvases c on c.id = r.canvas_id
left join public.layers l on l.id = r.layer_id
where r.resolved_at is null
group by r.canvas_id, r.layer_id, c.seed_word, c.status, c.listed,
         c.slot_count, l.slot_index, l.hidden
order by count(distinct r.device_key) desc, min(r.created_at);

revoke all on public.moderation_queue from anon, authenticated;

comment on view public.moderation_queue is
  'Outstanding reports, grouped by what was reported. Operator-only: never grant this to anon.';

-- ---------------------------------------------------------------- the levers

/**
 * Hide a layer. The row stays exactly where it is — the append-only trigger
 * permits this one column and nothing else — and RLS stops serving it, so the
 * canvas, its timelapse and its video all render as though that hand had not
 * arrived. Reversible, recorded, and the only removal this product has.
 */
create or replace function public.hide_layer(p_layer uuid, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare c uuid;
begin
  update public.layers set hidden = true where id = p_layer returning canvas_id into c;
  if c is null then
    raise exception 'no such layer';
  end if;

  insert into public.moderation_actions (action, canvas_id, layer_id, note)
  values ('hide', c, p_layer, p_note);

  update public.reports
     set resolved_at = now(), resolution = 'hidden'
   where layer_id = p_layer and resolved_at is null;

  return true;
end
$$;

create or replace function public.unhide_layer(p_layer uuid, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare c uuid;
begin
  update public.layers set hidden = false where id = p_layer returning canvas_id into c;
  if c is null then
    raise exception 'no such layer';
  end if;
  insert into public.moderation_actions (action, canvas_id, layer_id, note)
  values ('unhide', c, p_layer, p_note);
  return true;
end
$$;

/**
 * Take a canvas off the shelf, or put it back. Curation rather than
 * moderation: it keeps its URL, everyone who drew on it still sees exactly
 * what they saw before, and nothing leaves the ledger.
 */
create or replace function public.set_canvas_listed(
  p_canvas uuid,
  p_listed boolean,
  p_note   text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.canvases set listed = p_listed where id = p_canvas;
  if not found then
    raise exception 'no such canvas';
  end if;

  insert into public.moderation_actions (action, canvas_id, note)
  values (case when p_listed then 'list' else 'unlist' end, p_canvas, p_note);

  if not p_listed then
    update public.reports
       set resolved_at = now(), resolution = 'unlisted'
     where canvas_id = p_canvas and layer_id is null and resolved_at is null;
  end if;

  return true;
end
$$;

/** Looked at it, nothing to do. The report stays; the queue moves on. */
create or replace function public.dismiss_reports(
  p_canvas uuid,
  p_layer  uuid default null,
  p_note   text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.reports
     set resolved_at = now(), resolution = 'dismissed'
   where canvas_id = p_canvas
     and (p_layer is null and layer_id is null or layer_id = p_layer)
     and resolved_at is null;
  get diagnostics n = row_count;

  insert into public.moderation_actions (action, canvas_id, layer_id, note)
  values ('dismiss', p_canvas, p_layer, p_note);

  return n;
end
$$;

-- These are the operator's, not the product's. A publishable key must never
-- reach them, so they are revoked from every client role and granted only to
-- the service role — which is exactly the key that never ships in a bundle.
revoke execute on function public.hide_layer(uuid, text)               from public, anon, authenticated;
revoke execute on function public.unhide_layer(uuid, text)             from public, anon, authenticated;
revoke execute on function public.set_canvas_listed(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.dismiss_reports(uuid, uuid, text)    from public, anon, authenticated;

grant execute on function public.hide_layer(uuid, text)                to service_role;
grant execute on function public.unhide_layer(uuid, text)              to service_role;
grant execute on function public.set_canvas_listed(uuid, boolean, text) to service_role;
grant execute on function public.dismiss_reports(uuid, uuid, text)     to service_role;

-- ------------------------------------------------- one door fewer to guard

-- `open_or_join_canvas` has been dead since 0004: claim_turn does all of this
-- and does it under a lock, and nothing in the client, the seed script or the
-- tests has called it since. What it still had was EXECUTE for anon, which
-- means anyone holding the publishable key could open empty canvases in a
-- loop. That was harmless while the only visitors were the people building it.
-- The moderation surface is meant to be small, and an unused write path
-- reachable by strangers is surface for nothing in return.
revoke execute on function public.open_or_join_canvas() from public, anon, authenticated;

comment on function public.open_or_join_canvas() is
  'Superseded by claim_turn in 0004 and closed to clients in 0018. Kept because the ledger migrations are the schema''s history, not a tidy-up.';
