-- Ink sets, and prints.
--
-- The two places money could enter this product, and the two places it is most
-- likely to ruin it. So both are built with the constraint stated in the
-- schema rather than in a policy document:
--
--   * An ink set is cosmetic. It changes which of the *existing* colours a pen
--     is loaded with and nothing else. It buys no extra turns, no extra ink,
--     no better placement, no larger canvas, no earlier slot. There is no
--     column here that could express any of those, which is deliberate: the
--     day somebody wants to sell an advantage, the schema has to be the thing
--     that says no.
--   * A print is of a canvas you contributed to, and every other contributor
--     has to agree before it is made. That is not politeness — it is the terms
--     from Phase A, which say a contributor can decline to be in something
--     sold, and it belongs in the database rather than in a promise.
--
-- **No payment processor is wired to any of this.** `paid_at` and `price_pence`
-- exist so the shape is right and the consent rules can be tested, and nothing
-- reads or writes them yet. Wiring them needs a Stripe account and a print
-- vendor, neither of which is something code in this repository can conjure.
-- Until then an ink set can be granted by hand and a print request is a queue
-- an operator reads — which is genuinely how the first ones should be filled.

-- --------------------------------------------------------------- ink sets

create table if not exists public.ink_sets (
  id          text primary key,
  name        text not null,
  -- Hexes, all of which must already be legal on a canvas. A set is a
  -- selection from this world's light, not a way into another one.
  colours     jsonb not null,
  price_pence integer not null default 0 check (price_pence >= 0),
  released_at timestamptz not null default now(),
  retired     boolean not null default false
);

alter table public.ink_sets enable row level security;
drop policy if exists ink_sets_read on public.ink_sets;
create policy ink_sets_read on public.ink_sets
  for select to anon, authenticated using (not retired);
grant select on public.ink_sets to anon, authenticated;

/**
 * A set is only ever a rearrangement of colours that were already allowed.
 *
 * Without this a "set" is the obvious back door: ship one containing a colour
 * outside the gamut and the palette rule is gone, sold rather than argued
 * away. The check runs on write, so the door cannot be opened by an INSERT
 * somebody makes at speed one evening.
 */
create or replace function public.ink_sets_are_cosmetic()
returns trigger
language plpgsql
set search_path = public
as $$
declare bad text;
begin
  select value into bad
    from jsonb_array_elements_text(new.colours) value
   where not public.colour_allowed(value,
     (select jsonb_agg(hex order by base_idx) from public.palette_colors where step = 0))
   limit 1;

  if bad is not null then
    raise exception 'ink set % contains %, which is not a colour this world has',
      new.id, bad;
  end if;
  if jsonb_array_length(new.colours) < 2 then
    raise exception 'an ink set needs at least two colours';
  end if;
  return new;
end
$$;

drop trigger if exists ink_sets_are_cosmetic_trg on public.ink_sets;
create trigger ink_sets_are_cosmetic_trg
  before insert or update on public.ink_sets
  for each row execute function public.ink_sets_are_cosmetic();

revoke execute on function public.ink_sets_are_cosmetic() from public, anon, authenticated;

-- The seeds go in *after* the trigger, so the house sets are checked by the
-- rule they exist to demonstrate. Ordering it the other way round is how the
-- first version of this shipped `#F2EDE3` in Orchard — an off-white close
-- enough to the palette's own `#FBF8F1` to read as a typo, which is exactly
-- the kind of thing the check is for. A seed that skips the check is a rule
-- with an exception carved into the same file that states it.
insert into public.ink_sets (id, name, colours, price_pence) values
  ('house', 'The house set',
   (select jsonb_agg(hex order by base_idx) from public.palette_colors where step = 0), 0),
  ('nightfall', 'Nightfall',
   '["#1B1A17","#2B3A72","#3B6288","#6A4B82","#A94578","#E3A59C"]'::jsonb, 0),
  ('orchard', 'Orchard',
   '["#7C8A47","#48764F","#B8873C","#E5A23C","#A73A34","#FBF8F1"]'::jsonb, 0),
  ('low-tide', 'Low tide',
   '["#2C7A73","#3B6288","#9C978B","#FBF8F1","#5B5850","#E3A59C"]'::jsonb, 0)
on conflict (id) do update
  set name = excluded.name, colours = excluded.colours;

create table if not exists public.ink_entitlements (
  signature_id uuid not null references public.signatures (id) on delete restrict,
  ink_set      text not null references public.ink_sets (id) on delete restrict,
  granted_at   timestamptz not null default now(),
  -- Null means it was given rather than bought. Every one of them is, today.
  paid_at      timestamptz,
  primary key (signature_id, ink_set)
);

alter table public.ink_entitlements enable row level security;
revoke all on public.ink_entitlements from anon, authenticated;

/** Which sets this hand may load a pen with. Free sets are everyone's, so the
 *  answer is never empty and the pen never has nothing to draw with. */
create or replace function public.my_ink_sets(p_signature uuid, p_device_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.owns_signature(p_signature, p_device_key) then
    raise exception 'that mark does not belong to this browser';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'name', s.name, 'colours', s.colours) order by s.released_at),
           '[]'::jsonb)
      from public.ink_sets s
     where not s.retired
       and (s.price_pence = 0
            or exists (select 1 from public.ink_entitlements e
                        where e.signature_id = p_signature and e.ink_set = s.id))
  );
end
$$;

create or replace function public.grant_ink_set(p_signature uuid, p_set text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ink_entitlements (signature_id, ink_set)
  values (p_signature, p_set)
  on conflict do nothing;
  return true;
end
$$;

revoke execute on function public.my_ink_sets(uuid, text) from public;
revoke execute on function public.grant_ink_set(uuid, text) from public, anon, authenticated;
grant execute on function public.my_ink_sets(uuid, text) to anon, authenticated;
grant execute on function public.grant_ink_set(uuid, text) to service_role;

-- ----------------------------------------------------------------- prints

create table if not exists public.print_requests (
  id            uuid primary key default gen_random_uuid(),
  canvas_id     uuid not null references public.canvases (id) on delete restrict,
  requested_by  uuid not null references public.signatures (id) on delete restrict,
  requested_at  timestamptz not null default now(),
  state         text not null default 'consent'
    check (state in ('consent', 'ready', 'declined', 'fulfilled', 'cancelled')),
  price_pence   integer,
  paid_at       timestamptz,
  note          text
);

create index if not exists print_requests_open
  on public.print_requests (requested_at) where state in ('consent', 'ready');

/**
 * One row per contributor per request. A print is made when every one of them
 * says yes, and a single no is enough to stop it — which is what "every
 * contributor can decline to be in something sold" means when it is written
 * as data instead of as a sentence.
 */
create table if not exists public.print_consents (
  request_id   uuid not null references public.print_requests (id) on delete restrict,
  signature_id uuid not null references public.signatures (id) on delete restrict,
  answer       text check (answer in ('yes', 'no')),
  answered_at  timestamptz,
  primary key (request_id, signature_id)
);

alter table public.print_requests enable row level security;
alter table public.print_consents enable row level security;
revoke all on public.print_requests from anon, authenticated;
revoke all on public.print_consents from anon, authenticated;

/**
 * Asks for a print, and asks everybody else.
 *
 * Only a contributor may ask, only of a finished canvas, and asking creates a
 * consent row for every hand on it — including the asker, who is marked yes
 * because asking is consent. Nothing is charged and nothing is printed here;
 * this produces a question, and the question is the part that must not be
 * skipped.
 */
create or replace function public.request_print(
  p_canvas     uuid,
  p_signature  uuid,
  p_device_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.canvases;
  r public.print_requests;
begin
  if not public.owns_signature(p_signature, p_device_key) then
    raise exception 'that mark does not belong to this browser';
  end if;

  select * into c from public.canvases where id = p_canvas;
  if not found then raise exception 'no such canvas'; end if;
  if c.status <> 'closed' then
    raise exception 'a canvas has to be finished before it can be printed';
  end if;
  if not exists (
    select 1 from public.layers where canvas_id = p_canvas and signature_id = p_signature
  ) then
    raise exception 'only somebody who drew on it can ask for a print of it';
  end if;

  insert into public.print_requests (canvas_id, requested_by)
  values (p_canvas, p_signature)
  returning * into r;

  insert into public.print_consents (request_id, signature_id, answer, answered_at)
  select distinct r.id, l.signature_id,
         case when l.signature_id = p_signature then 'yes' end,
         case when l.signature_id = p_signature then now() end
    from public.layers l
   where l.canvas_id = p_canvas;

  return to_jsonb(r);
end
$$;

/** Yes or no, from one contributor. A no closes the whole request immediately:
 *  there is no negotiating, and nobody is asked twice. */
create or replace function public.answer_print(
  p_request    uuid,
  p_signature  uuid,
  p_device_key text,
  p_yes        boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  outstanding int;
begin
  if not public.owns_signature(p_signature, p_device_key) then
    raise exception 'that mark does not belong to this browser';
  end if;

  update public.print_consents
     set answer = case when p_yes then 'yes' else 'no' end,
         answered_at = now()
   where request_id = p_request and signature_id = p_signature;
  if not found then
    raise exception 'you were not asked about that print';
  end if;

  if not p_yes then
    update public.print_requests set state = 'declined' where id = p_request;
    return 'declined';
  end if;

  select count(*) into outstanding
    from public.print_consents
   where request_id = p_request and answer is distinct from 'yes';

  if outstanding = 0 then
    update public.print_requests set state = 'ready'
     where id = p_request and state = 'consent';
    return 'ready';
  end if;

  return 'waiting';
end
$$;

/** What a contributor has been asked. The only way anybody learns a request
 *  exists, because there is no messaging here to tell them with. */
create or replace function public.my_print_questions(p_signature uuid, p_device_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.owns_signature(p_signature, p_device_key) then
    raise exception 'that mark does not belong to this browser';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'request', r.id, 'canvas', c.id, 'seed', c.seed_word,
             'state', r.state, 'answered', k.answer)), '[]'::jsonb)
      from public.print_consents k
      join public.print_requests r on r.id = k.request_id
      join public.canvases c on c.id = r.canvas_id
     where k.signature_id = p_signature
       and r.state in ('consent', 'ready')
  );
end
$$;

revoke execute on function public.request_print(uuid, uuid, text) from public;
revoke execute on function public.answer_print(uuid, uuid, text, boolean) from public;
revoke execute on function public.my_print_questions(uuid, text) from public;
grant execute on function public.request_print(uuid, uuid, text) to anon, authenticated;
grant execute on function public.answer_print(uuid, uuid, text, boolean) to anon, authenticated;
grant execute on function public.my_print_questions(uuid, text) to anon, authenticated;

comment on table public.print_requests is
  'A print of a finished canvas, pending every contributor''s consent. No '
  'payment processor is wired to price_pence or paid_at — see 0026''s header.';
